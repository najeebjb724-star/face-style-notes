const express = require("express");
const {
  codedError,
  downloadPhoto: defaultDownloadPhoto,
  validateAnalyzeInput,
  validateDownloadDescriptor
} = require("./validate");

const CLIENT_ERROR_CODES = new Set([
  "INVALID_CREDENTIAL", "INVALID_JOB_ID"
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
  if (["INVALID_PHOTO_URL", "INVALID_SHA256", "PHOTO_HOST_NOT_ALLOWED"].includes(code)) {
    return { status: 503, code: "CREDENTIAL_SERVICE_UNAVAILABLE" };
  }
  if (PHOTO_ERROR_CODES.has(code)) return { status: 422, code };
  if (FACE_ERROR_CODES.has(code)) return { status: 422, code };
  if (code === "INVALID_CONFIGURATION") return { status: 503, code };
  return { status: 500, code: "INTERNAL_ERROR" };
}

function createApp(dependencies) {
  const {
    allowedPhotoHosts,
    inferBuffer,
    isModelLoaded,
    jobCoordinator,
    loadModels
  } = dependencies;
  const fetchPhoto = dependencies.downloadPhoto || ((url, sha256) => defaultDownloadPhoto(url, sha256));
  const app = express();
  app.disable("x-powered-by");
  app.set("query parser", false);
  app.use(express.json({ limit: "16kb", strict: true }));
  let busy = false;

  app.get("/health", (_request, response) => {
    const modelLoaded = isModelLoaded();
    response.status(modelLoaded ? 200 : 503).json({ ok: modelLoaded, modelLoaded });
  });

  app.post("/analyze", async (request, response) => {
    if (busy) {
      response.status(429).json({ ok: false, code: "ANALYSIS_BUSY" });
      return;
    }
    busy = true;
    let claim;
    let settled = false;
    try {
      const input = validateAnalyzeInput({ authorization: request.get("authorization"), body: request.body });
      claim = await jobCoordinator.claim(input);
      if (!claim || claim.jobId !== input.jobId) throw codedError("CREDENTIAL_SERVICE_UNAVAILABLE");
      const download = validateDownloadDescriptor(claim.download, allowedPhotoHosts);
      const photo = await fetchPhoto(download.url, download.sha256);
      const result = await inferBuffer(photo, input.jobId);
      await jobCoordinator.complete({ claim, result });
      settled = true;
      response.status(200).json(result);
    } catch (error) {
      const safe = safeError(error);
      if (claim && !settled) {
        try { await jobCoordinator.fail({ claim, errorCode: safe.code }); } catch {}
      }
      response.status(safe.status).json({ ok: false, code: safe.code });
    } finally {
      busy = false;
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

async function discardResponse(response) {
  try { await response?.body?.cancel(); } catch {}
}

function createJobCoordinator({ endpoint, fetchImpl = globalThis.fetch, timeoutMs = 5_000 }) {
  const serviceUrl = validateServiceUrl(endpoint);
  const call = async ({ action, jobId, token, body }) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(serviceUrl, {
        method: "POST",
        redirect: "manual",
        signal: controller.signal,
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ action, jobId, ...body })
      });
      if (response.status === 401 || response.status === 403) {
        let body;
        try { body = await response.json(); } catch { body = {}; }
        const code = CREDENTIAL_ERROR_CODES.has(body.code) ? body.code : "CREDENTIAL_INVALID";
        throw codedError(code);
      }
      if (!response.ok) {
        await discardResponse(response);
        throw codedError("CREDENTIAL_SERVICE_UNAVAILABLE");
      }
      let result;
      try { result = await response.json(); } catch { throw codedError("CREDENTIAL_SERVICE_UNAVAILABLE"); }
      return result;
    } catch (error) {
      if (CREDENTIAL_ERROR_CODES.has(error && error.code)) throw error;
      throw codedError("CREDENTIAL_SERVICE_UNAVAILABLE");
    } finally {
      clearTimeout(timeout);
    }
  };
  return {
    async claim({ jobId, credential }) {
      const result = await call({ action: "claim", jobId, token: credential });
      if (!result || result.jobId !== jobId || typeof result.leaseId !== "string" || !result.leaseId
        || typeof result.leaseToken !== "string" || result.leaseToken.length < 16 || !result.download) {
        throw codedError("CREDENTIAL_SERVICE_UNAVAILABLE");
      }
      return result;
    },
    async complete({ claim, result }) {
      const response = await call({
        action: "complete", jobId: claim.jobId, token: claim.leaseToken,
        body: { leaseId: claim.leaseId, result }
      });
      if (!response || response.ok !== true || response.jobId !== claim.jobId || response.status !== "complete") {
        throw codedError("CREDENTIAL_SERVICE_UNAVAILABLE");
      }
      return response;
    },
    async fail({ claim, errorCode }) {
      const response = await call({
        action: "fail", jobId: claim.jobId, token: claim.leaseToken,
        body: { leaseId: claim.leaseId, errorCode }
      });
      if (!response || response.ok !== true || response.jobId !== claim.jobId || !["failed", "complete"].includes(response.status)) {
        throw codedError("CREDENTIAL_SERVICE_UNAVAILABLE");
      }
      return response;
    }
  };
}

async function start() {
  const inference = require("./inference");
  const allowedPhotoHosts = String(process.env.PHOTO_URL_HOSTS || "").split(",").map(value => value.trim()).filter(Boolean);
  const jobCoordinator = createJobCoordinator({ endpoint: process.env.CREDENTIAL_CONSUMER_URL });
  const app = createApp({ allowedPhotoHosts, jobCoordinator, ...inference });
  await inference.loadModels();
  app.listen(Number(process.env.PORT) || 8080, "0.0.0.0");
}

if (require.main === module) {
  start().catch(() => {
    process.stderr.write("face analysis service failed to start\n");
    process.exitCode = 1;
  });
}

module.exports = { createApp, createJobCoordinator, safeError, start };
