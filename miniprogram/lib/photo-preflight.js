const FACE_CONSENT_STORAGE_KEY = "face-analysis-consent";
const FACE_CONSENT_VERSION = "2026-09-03";

function createFaceConsent(now = new Date()) {
  const acceptedAt = now instanceof Date ? now.toISOString() : new Date(now).toISOString();
  return { type: "face-analysis", version: FACE_CONSENT_VERSION, acceptedAt };
}

function assertFaceConsent(consent) {
  const acceptedAt = consent && typeof consent.acceptedAt === "string" ? Date.parse(consent.acceptedAt) : NaN;
  if (consent?.type !== "face-analysis" || consent.version !== FACE_CONSENT_VERSION || !Number.isFinite(acceptedAt)) {
    throw new Error("CONSENT_REQUIRED");
  }
  return consent;
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

async function compressPhotoToJpeg(api, photo) {
  const target = fitPhotoDimensions(photo.width, photo.height);
  let result;
  try {
    result = await callImageApi(api, "compressImage", {
      src: photo.path,
      quality: 85,
      compressedWidth: target.width,
      compressedHeight: target.height
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
  const type = String(info?.type || "").toLowerCase();
  if (!Number.isFinite(info?.width) || !Number.isFinite(info?.height) || Math.max(info.width, info.height) > 1600 || !["jpg", "jpeg"].includes(type)) {
    throw new Error("PHOTO_COMPRESSION_FAILED");
  }
  return { path: result.tempFilePath, width: info.width, height: info.height, type: "jpeg" };
}

module.exports = {
  FACE_CONSENT_STORAGE_KEY,
  FACE_CONSENT_VERSION,
  createFaceConsent,
  assertFaceConsent,
  fitPhotoDimensions,
  compressPhotoToJpeg
};
