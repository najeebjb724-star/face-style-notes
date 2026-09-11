const { createHash, timingSafeEqual } = require("node:crypto");

const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;

function codedError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function validateAnalyzeInput({ authorization, body }, allowedPhotoHosts) {
  if (!Array.isArray(allowedPhotoHosts) || allowedPhotoHosts.length === 0) {
    throw codedError("INVALID_CONFIGURATION");
  }
  const match = typeof authorization === "string" && authorization.match(/^Bearer ([^\s]{16,512})$/);
  if (!match) throw codedError("INVALID_CREDENTIAL");
  if (!body || typeof body.jobId !== "string" || !/^job-[A-Za-z0-9_-]{1,124}$/.test(body.jobId)) {
    throw codedError("INVALID_JOB_ID");
  }
  if (typeof body.expectedSha256 !== "string" || !/^[a-f0-9]{64}$/.test(body.expectedSha256)) {
    throw codedError("INVALID_SHA256");
  }

  let url;
  try {
    url = new URL(body.photoUrl);
  } catch {
    throw codedError("INVALID_PHOTO_URL");
  }
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) {
    throw codedError("INVALID_PHOTO_URL");
  }
  const hosts = allowedPhotoHosts.map(host => String(host).trim().toLowerCase()).filter(Boolean);
  if (!hosts.includes(url.hostname.toLowerCase())) throw codedError("PHOTO_HOST_NOT_ALLOWED");

  return {
    credential: match[1],
    jobId: body.jobId,
    photoUrl: url.toString(),
    expectedSha256: body.expectedSha256
  };
}

function validateResult(result) {
  if (!Array.isArray(result.points) || result.points.length !== 68) throw codedError("INVALID_LANDMARK_COUNT");
  if (!result.points.every(point => point && Number.isFinite(point.x) && Number.isFinite(point.y))) {
    throw codedError("INVALID_LANDMARK_VALUE");
  }
  if (!Number.isFinite(result.detectionScore) || result.detectionScore < 0 || result.detectionScore > 1) {
    throw codedError("INVALID_DETECTION_SCORE");
  }
  const box = result.faceBox;
  if (!box || !Number.isFinite(box.x) || !Number.isFinite(box.y)
    || !Number.isFinite(box.width) || !Number.isFinite(box.height) || box.width <= 0 || box.height <= 0) {
    throw codedError("INVALID_FACE_BOX");
  }
  const size = result.imageSize;
  if (!size || !Number.isInteger(size.width) || !Number.isInteger(size.height) || size.width <= 0 || size.height <= 0) {
    throw codedError("INVALID_IMAGE_SIZE");
  }
  if (typeof result.jobId !== "string" || typeof result.modelVersion !== "string" || !result.modelVersion) {
    throw codedError("INVALID_RESULT_METADATA");
  }
  return result;
}

async function downloadPhoto(photoUrl, expectedSha256, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const maxBytes = options.maxBytes || DEFAULT_MAX_BYTES;
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetchImpl(photoUrl, { redirect: "manual", signal: controller.signal });
    if (!response || response.status !== 200) throw codedError("PHOTO_DOWNLOAD_FAILED");
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) throw codedError("PHOTO_TOO_LARGE");
    if (!response.body || typeof response.body.getReader !== "function") throw codedError("PHOTO_DOWNLOAD_FAILED");

    const chunks = [];
    let byteLength = 0;
    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > maxBytes) {
        await reader.cancel();
        throw codedError("PHOTO_TOO_LARGE");
      }
      chunks.push(Buffer.from(value));
    }
    const buffer = Buffer.concat(chunks, byteLength);
    const actual = Buffer.from(createHash("sha256").update(buffer).digest("hex"), "hex");
    const expected = Buffer.from(expectedSha256, "hex");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw codedError("PHOTO_HASH_MISMATCH");
    return buffer;
  } catch (error) {
    if (timedOut) throw codedError("PHOTO_DOWNLOAD_TIMEOUT");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { codedError, downloadPhoto, validateAnalyzeInput, validateResult };
