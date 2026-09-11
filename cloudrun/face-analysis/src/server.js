const express = require("express");
const { codedError, downloadPhoto: defaultDownloadPhoto, validateAnalyzeInput } = require("./validate");

const CLIENT_ERROR_CODES = new Set([
  "INVALID_CREDENTIAL", "INVALID_JOB_ID", "INVALID_PHOTO_URL", "INVALID_SHA256", "PHOTO_HOST_NOT_ALLOWED"
]);
const CREDENTIAL_ERROR_CODES = new Set(["CREDENTIAL_INVALID", "CREDENTIAL_EXPIRED", "CREDENTIAL_USED"]);
const PHOTO_ERROR_CODES = new Set([
  "PHOTO_DOWNLOAD_FAILED", "PHOTO_DOWNLOAD_TIMEOUT", "PHOTO_TOO_LARGE", "PHOTO_HASH_MISMATCH"
]);
const FACE_ERROR_CODES = new Set(["NO_FACE", "MULTIPLE_FACES"]);

function safeError(error) {
  const code = error && error.code;
  if (CLIENT_ERROR_CODES.has(code)) return { status: 400, code };
  if (CREDENTIAL_ERROR_CODES.has(code)) return { status: 401, code };
  if (code === "CREDENTIAL_SERVICE_UNAVAILABLE") return { status: 503, code };
  if (PHOTO_ERROR_CODES.has(code)) return { status: 422, code };
  if (FACE_ERROR_CODES.has(code)) return { status: 422, code };
  if (code === "INVALID_CONFIGURATION") return { status: 503, code };
  return { status: 500, code: "INTERNAL_ERROR" };
}

function createApp(dependencies) {
  const {
    allowedPhotoHosts,
    consumeCredential,
    inferBuffer,
    isModelLoaded,
    loadModels
  } = dependencies;
  const fetchPhoto = dependencies.downloadPhoto || ((url, sha256) => defaultDownloadPhoto(url, sha256));
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "16kb", strict: true }));

  app.get("/health", (_request, response) => {
    const modelLoaded = isModelLoaded();
    response.status(modelLoaded ? 200 : 503).json({ ok: modelLoaded, modelLoaded });
  });

  app.post("/analyze", async (request, response) => {
    try {
      const input = validateAnalyzeInput({ authorization: request.get("authorization"), body: request.body }, allowedPhotoHosts);
      await consumeCredential({ jobId: input.jobId, credential: input.credential });
      const photo = await fetchPhoto(input.photoUrl, input.expectedSha256);
      const result = await inferBuffer(photo, input.jobId);
      response.status(200).json(result);
    } catch (error) {
      const safe = safeError(error);
      response.status(safe.status).json({ ok: false, code: safe.code });
    }
  });

  app.use((error, _request, response, _next) => {
    const code = error && error.type === "entity.too.large" ? "INVALID_REQUEST" : "INVALID_REQUEST";
    response.status(400).json({ ok: false, code });
  });
  app.locals.loadModels = loadModels;
  return app;
}

function validateServiceUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw codedError("INVALID_CONFIGURATION");
  }
  if (url.protocol !== "https:" || url.username || url.password) throw codedError("INVALID_CONFIGURATION");
  return url.toString();
}

function createCredentialConsumer({ endpoint, fetchImpl = globalThis.fetch, timeoutMs = 5_000 }) {
  const serviceUrl = validateServiceUrl(endpoint);
  return async ({ jobId, credential }) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(serviceUrl, {
        method: "POST",
        redirect: "manual",
        signal: controller.signal,
        headers: { authorization: `Bearer ${credential}`, "content-type": "application/json" },
        body: JSON.stringify({ jobId })
      });
      if (response.status >= 300 && response.status < 400) throw codedError("CREDENTIAL_INVALID");
      if (!response.ok) {
        let body;
        try { body = await response.json(); } catch { body = {}; }
        const code = CREDENTIAL_ERROR_CODES.has(body.code) ? body.code : "CREDENTIAL_INVALID";
        throw codedError(code);
      }
    } catch (error) {
      if (CREDENTIAL_ERROR_CODES.has(error && error.code)) throw error;
      throw codedError("CREDENTIAL_SERVICE_UNAVAILABLE");
    } finally {
      clearTimeout(timeout);
    }
  };
}

async function start() {
  const inference = require("./inference");
  const allowedPhotoHosts = String(process.env.PHOTO_URL_HOSTS || "").split(",").map(value => value.trim()).filter(Boolean);
  const consumeCredential = createCredentialConsumer({ endpoint: process.env.CREDENTIAL_CONSUMER_URL });
  const app = createApp({ allowedPhotoHosts, consumeCredential, ...inference });
  await inference.loadModels();
  app.listen(Number(process.env.PORT) || 8080, "0.0.0.0");
}

if (require.main === module) {
  start().catch(() => {
    process.stderr.write("face analysis service failed to start\n");
    process.exitCode = 1;
  });
}

module.exports = { createApp, createCredentialConsumer, safeError, start };
