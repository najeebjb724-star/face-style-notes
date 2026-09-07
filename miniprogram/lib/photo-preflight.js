const FACE_CONSENT_STORAGE_KEY = "face-analysis-consent";
const FACE_PREFLIGHT_STORAGE_KEY = "face-analysis-preflight";
const FACE_CONSENT_VERSION = "2026-09-03";
const BASIC_QUALITY_SAMPLE_EDGE = 256;
let faceConsentRevoked = false;

function createFaceConsent(now = new Date()) {
  const acceptedAt = now instanceof Date ? now.toISOString() : new Date(now).toISOString();
  return { type: "face-analysis", version: FACE_CONSENT_VERSION, acceptedAt };
}

function isValidFaceConsent(consent) {
  const acceptedAt = consent && typeof consent.acceptedAt === "string" ? Date.parse(consent.acceptedAt) : NaN;
  return consent?.type === "face-analysis" && consent.version === FACE_CONSENT_VERSION && Number.isFinite(acceptedAt) && !consent.revokedAt;
}

function assertFaceConsent(consent) {
  if (faceConsentRevoked || !isValidFaceConsent(consent)) {
    throw new Error("CONSENT_REQUIRED");
  }
  return consent;
}

function activateFaceConsent(consent) {
  if (!isValidFaceConsent(consent)) throw new Error("CONSENT_REQUIRED");
  faceConsentRevoked = false;
  return consent;
}

function revokeFaceConsent(now = new Date()) {
  faceConsentRevoked = true;
  return {
    type: "face-analysis",
    version: FACE_CONSENT_VERSION,
    revokedAt: now instanceof Date ? now.toISOString() : new Date(now).toISOString()
  };
}

function fitPhotoDimensions(width, height, longestEdge = 1600) {
  if (![width, height, longestEdge].every(value => Number.isFinite(value) && value > 0)) {
    throw new Error("PHOTO_DIMENSIONS_INVALID");
  }
  const scale = Math.min(1, longestEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale))
  };
}

function callImageApi(api, method, options) {
  return new Promise((resolve, reject) => {
    api[method]({ ...options, success: resolve, fail: reject });
  });
}

function roundSignal(value) {
  return Math.round(value * 10) / 10;
}

function measureBasicPhotoQuality(imageData) {
  const width = imageData?.width;
  const height = imageData?.height;
  const pixels = imageData?.data;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 3 || height < 3 || !pixels || pixels.length < width * height * 4) {
    throw new Error("PHOTO_PIXEL_DATA_INVALID");
  }
  const gray = new Float32Array(width * height);
  let brightnessTotal = 0;
  for (let index = 0; index < gray.length; index += 1) {
    const offset = index * 4;
    const value = pixels[offset] * 0.299 + pixels[offset + 1] * 0.587 + pixels[offset + 2] * 0.114;
    gray[index] = value;
    brightnessTotal += value;
  }
  let lapTotal = 0;
  let lapSquaredTotal = 0;
  let lapCount = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      const laplacian = gray[index - width] + gray[index + width] + gray[index - 1] + gray[index + 1] - 4 * gray[index];
      lapTotal += laplacian;
      lapSquaredTotal += laplacian * laplacian;
      lapCount += 1;
    }
  }
  const lapMean = lapTotal / lapCount;
  return {
    laplacianVariance: roundSignal(lapSquaredTotal / lapCount - lapMean * lapMean),
    meanBrightness: roundSignal(brightnessTotal / gray.length),
    sampleSize: { width, height }
  };
}

function evaluateBasicPhotoQuality(signals) {
  const issues = [];
  const push = (condition, id, message, action) => {
    if (condition) issues.push({ id, message, action, severity: "reject" });
  };
  push(signals.laplacianVariance < 45, "blurry", "照片可能模糊", "擦净镜头并保持手机稳定");
  push(signals.meanBrightness < 55, "too_dark", "照片整体光线太暗", "面向窗户或增加均匀光线");
  push(signals.meanBrightness > 215, "too_bright", "照片整体可能过曝", "避开直射强光并降低曝光");
  return {
    accepted: issues.length === 0,
    level: issues.length ? "low" : "medium",
    issues,
    metrics: {
      laplacianVariance: signals.laplacianVariance,
      meanBrightness: signals.meanBrightness
    },
    scope: "local-basic",
    pendingFaceChecks: ["face_detection", "face_size", "head_pose"]
  };
}

function getPhotoCanvas(page) {
  return new Promise((resolve, reject) => {
    try {
      page.createSelectorQuery()
        .select("#photo-compressor")
        .fields({ node: true })
        .exec(result => {
          const canvas = result?.[0]?.node;
          if (canvas) resolve(canvas);
          else reject(new Error("PHOTO_CANVAS_UNAVAILABLE"));
        });
    } catch (_) {
      reject(new Error("PHOTO_CANVAS_UNAVAILABLE"));
    }
  });
}

function loadCanvasImage(canvas, path) {
  return new Promise((resolve, reject) => {
    try {
      const image = canvas.createImage();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("PHOTO_IMAGE_LOAD_FAILED"));
      image.src = path;
    } catch (_) {
      reject(new Error("PHOTO_IMAGE_LOAD_FAILED"));
    }
  });
}

function prepareWhiteCanvas(canvas, width, height) {
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context || typeof context.fillRect !== "function" || typeof context.drawImage !== "function") {
    throw new Error("PHOTO_CANVAS_UNAVAILABLE");
  }
  context.fillStyle = "#FFFFFF";
  context.fillRect(0, 0, width, height);
  return context;
}

async function compressPhotoToJpeg(api, canvas, photo) {
  const target = fitPhotoDimensions(photo.width, photo.height);
  let basicSignals;
  try {
    const image = await loadCanvasImage(canvas, photo.path);
    const sample = fitPhotoDimensions(photo.width, photo.height, BASIC_QUALITY_SAMPLE_EDGE);
    const sampleContext = prepareWhiteCanvas(canvas, sample.width, sample.height);
    if (typeof sampleContext.getImageData !== "function") throw new Error("PHOTO_CANVAS_UNAVAILABLE");
    sampleContext.drawImage(image, 0, 0, sample.width, sample.height);
    basicSignals = measureBasicPhotoQuality(sampleContext.getImageData(0, 0, sample.width, sample.height));
    const exportContext = prepareWhiteCanvas(canvas, target.width, target.height);
    exportContext.drawImage(image, 0, 0, target.width, target.height);
  } catch (_) {
    throw new Error("PHOTO_COMPRESSION_FAILED");
  }

  let result;
  try {
    result = await callImageApi(api, "canvasToTempFilePath", {
      canvas,
      fileType: "jpg",
      quality: 0.85,
      width: target.width,
      height: target.height,
      destWidth: target.width,
      destHeight: target.height
    });
  } catch (_) {
    throw new Error("PHOTO_COMPRESSION_FAILED");
  }

  if (!result?.tempFilePath) throw new Error("PHOTO_COMPRESSION_FAILED");
  let info;
  try {
    info = await callImageApi(api, "getImageInfo", { src: result.tempFilePath });
  } catch (_) {
    throw new Error("PHOTO_COMPRESSION_FAILED");
  }
  validateExportedPhoto(photo, target, info);
  return { path: result.tempFilePath, width: info.width, height: info.height, type: "jpeg", basicSignals };
}

function validateExportedPhoto(source, target, info) {
  const type = String(info?.type || "").toLowerCase();
  const validDimensions = Number.isFinite(info?.width) && Number.isFinite(info?.height) && info.width > 0 && info.height > 0;
  const actualRatio = validDimensions ? info.width / info.height : NaN;
  const sourceRatio = source.width / source.height;
  const roundingTolerance = validDimensions ? 2 / Math.min(info.width, info.height) : 0;
  if (!validDimensions || Math.max(info.width, info.height) > 1600 || !["jpg", "jpeg"].includes(type) || Math.abs(actualRatio - sourceRatio) > roundingTolerance) {
    throw new Error("PHOTO_COMPRESSION_FAILED");
  }
  if (Math.max(info.width, info.height) > Math.max(target.width, target.height)) throw new Error("PHOTO_COMPRESSION_FAILED");
  return info;
}

module.exports = {
  FACE_CONSENT_STORAGE_KEY,
  FACE_PREFLIGHT_STORAGE_KEY,
  FACE_CONSENT_VERSION,
  createFaceConsent,
  activateFaceConsent,
  revokeFaceConsent,
  assertFaceConsent,
  fitPhotoDimensions,
  measureBasicPhotoQuality,
  evaluateBasicPhotoQuality,
  validateExportedPhoto,
  getPhotoCanvas,
  compressPhotoToJpeg
};
