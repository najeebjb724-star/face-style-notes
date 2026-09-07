// analysisApi-build-fingerprint:385ada8dfae02667c2fd6c356ecf11ac26d7971a556e0f528dec962712cc4915:44546864da4c6cc03d6faf5a0cd55204fc161a9c229a7e401e5ffea3dd3aa83f
const { createHash, randomBytes, randomUUID, timingSafeEqual } = require("node:crypto");

const ANALYSIS_STATUSES = new Set(["queued", "processing", "complete", "failed"]);
const SOURCE_PHOTO_STATUSES = new Set(["pending", "deleting", "deleted", "manual_review"]);
const SAFE_ERRORS = new Set(["CONSENT_REQUIRED", "FORBIDDEN", "INVALID_ACTION", "INVALID_ARGUMENT", "UNAUTHENTICATED"]);
const CONSENT_TYPE = "face-analysis";
const CONSENT_VERSION = "2026-09-03";

function codedError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function assertOwnedRecord(record, openid) {
  if (!record || record._openid !== openid) throw codedError("FORBIDDEN");
  return record;
}

function requireObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw codedError("INVALID_ARGUMENT");
  return value;
}

function requireId(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw codedError("INVALID_ARGUMENT");
  return value;
}

function requireTempFileId(value) {
  if (typeof value !== "string" || value.length > 512 || !/^cloud:\/\/[A-Za-z0-9._~:/-]+\.jpg$/i.test(value)) {
    throw codedError("INVALID_ARGUMENT");
  }
  return value;
}

function sanitizeQuality(value) {
  const quality = requireObject(value);
  if (quality.accepted !== true) throw codedError("INVALID_ARGUMENT");
  const result = { accepted: true };
  if (["low", "medium", "high"].includes(quality.level)) result.level = quality.level;
  if (["local-basic", "landmark"].includes(quality.scope)) result.scope = quality.scope;
  if (quality.referenceOnly === true) result.referenceOnly = true;
  return result;
}

function isMissingDocument(error) {
  return error?.code === "DATABASE_DOCUMENT_NOT_EXIST" || error?.errCode === -502005 || /not[ _-]?exist/i.test(error?.message || "");
}

async function readOptional(reference) {
  try {
    const result = await reference.get();
    return result?.data || null;
  } catch (error) {
    if (isMissingDocument(error)) return null;
    throw error;
  }
}

function credentialDigest(credential) {
  return createHash("sha256").update(credential).digest("hex");
}

function stableJobId(openid, clientRequestId) {
  return `job-${createHash("sha256").update(JSON.stringify([openid, clientRequestId])).digest("hex")}`;
}

function createClientSafeMain(handle) {
  return async function main(event, context) {
    try {
      return await handle(event, context);
    } catch (error) {
      if (SAFE_ERRORS.has(error?.code) && error.message === error.code) {
        return { error: { code: error.code, message: error.message } };
      }
      throw error;
    }
  };
}

function minimalStatus(job) {
  const result = { status: job.status };
  if (job.status === "complete" && typeof job.reportId === "string") result.reportId = job.reportId;
  if (job.status === "failed") result.error = "ANALYSIS_FAILED";
  return result;
}

function transitionAnalysisJob(job, changes) {
  const next = { ...job, ...changes };
  if (!ANALYSIS_STATUSES.has(next.status) || !SOURCE_PHOTO_STATUSES.has(next.sourcePhotoStatus)) {
    throw codedError("INVALID_STATUS");
  }
  return next;
}

function createAnalysisApi({
  database,
  getWXContext,
  now = () => new Date(),
  createId = prefix => `${prefix}-${randomUUID()}`,
  createCredential = () => randomBytes(32).toString("base64url"),
  dispatchAnalysis = async () => {}
}) {
  if (!database || typeof getWXContext !== "function") throw codedError("INVALID_CONFIGURATION");

  return async function handle(event = {}) {
    const openid = getWXContext()?.OPENID;
    if (!openid) throw codedError("UNAUTHENTICATED");
    const payload = event.payload === undefined ? {} : requireObject(event.payload);

    if (event.action === "recordConsent") {
      const acceptedAt = typeof payload.acceptedAt === "string" ? Date.parse(payload.acceptedAt) : NaN;
      const requestTime = now();
      if (payload.type !== CONSENT_TYPE || payload.version !== CONSENT_VERSION || !Number.isFinite(acceptedAt) || acceptedAt > requestTime.getTime() || payload.revokedAt) {
        throw codedError("INVALID_ARGUMENT");
      }
      const consentId = requireId(createId("consent"));
      await database.collection("consents").doc(consentId).set({
        _openid: openid,
        type: CONSENT_TYPE,
        version: CONSENT_VERSION,
        acceptedAt: new Date(acceptedAt).toISOString(),
        revokedAt: null,
        createdAt: database.serverDate()
      });
      return { consentId };
    }

    if (event.action === "createAnalysis") {
      const consentId = requireId(payload.consentId);
      const clientRequestId = requireId(payload.clientRequestId);
      const tempFileId = requireTempFileId(payload.tempFileId);
      const quality = sanitizeQuality(payload.quality);
      const requestTime = now();
      const jobId = stableJobId(openid, clientRequestId);

      const created = await database.runTransaction(async transaction => {
        const existing = await readOptional(transaction.collection("analysis_jobs").doc(jobId));
        if (existing) {
          assertOwnedRecord(existing, openid);
          return { view: { jobId: existing._id || jobId, status: existing.status } };
        }
        const consent = await readOptional(transaction.collection("consents").doc(consentId));
        const consentAcceptedAt = typeof consent?.acceptedAt === "string" ? Date.parse(consent.acceptedAt) : NaN;
        if (!consent || consent._openid !== openid || consent.type !== CONSENT_TYPE || consent.version !== CONSENT_VERSION
          || !Number.isFinite(consentAcceptedAt) || consentAcceptedAt > requestTime.getTime() || consent.revokedAt) {
          throw codedError("CONSENT_REQUIRED");
        }
        const credential = createCredential();
        if (typeof credential !== "string" || credential.length < 16) throw codedError("INVALID_CONFIGURATION");
        const record = {
          _openid: openid,
          consentId,
          clientRequestId,
          tempFileId,
          quality,
          status: "queued",
          sourcePhotoStatus: "pending",
          deleteBy: new Date(requestTime.getTime() + 30 * 60 * 1000).toISOString(),
          credentialHash: credentialDigest(credential),
          credentialPurpose: "face-analysis",
          credentialExpiresAt: new Date(requestTime.getTime() + 5 * 60 * 1000).toISOString(),
          credentialUsedAt: null,
          createdAt: database.serverDate()
        };
        await transaction.collection("analysis_jobs").doc(jobId).set(record);
        return {
          view: { jobId, status: "queued" },
          dispatch: { jobId, tempFileId, credential, credentialExpiresAt: record.credentialExpiresAt }
        };
      });
      if (created.dispatch) await dispatchAnalysis(created.dispatch);
      return created.view;
    }

    if (event.action === "getAnalysis") {
      const jobId = requireId(payload.jobId);
      const job = await readOptional(database.collection("analysis_jobs").doc(jobId));
      assertOwnedRecord(job, openid);
      if (!ANALYSIS_STATUSES.has(job.status)) throw codedError("INVALID_STATUS");
      return minimalStatus(job);
    }

    throw codedError("INVALID_ACTION");
  };
}

async function consumeContainerCredential({ database, jobId, credential, now = new Date() }) {
  return database.runTransaction(async transaction => {
    const reference = transaction.collection("analysis_jobs").doc(requireId(jobId));
    const job = await readOptional(reference);
    if (!job || typeof credential !== "string" || typeof job.credentialHash !== "string") throw codedError("CREDENTIAL_INVALID");
    if (job.credentialUsedAt) throw codedError("CREDENTIAL_USED");
    if (Date.parse(job.credentialExpiresAt) <= now.getTime()) throw codedError("CREDENTIAL_EXPIRED");
    const expected = Buffer.from(job.credentialHash, "hex");
    const actual = Buffer.from(credentialDigest(credential), "hex");
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw codedError("CREDENTIAL_INVALID");
    await reference.update({ credentialUsedAt: database.serverDate() });
    return true;
  });
}

async function analysisApi(event, context) {
  const cloud = require("wx-server-sdk");
  cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
  return createAnalysisApi({ database: cloud.database(), getWXContext: () => cloud.getWXContext() })(event, context);
}

module.exports = {
  main: createClientSafeMain(analysisApi),
  analysisApi,
  createAnalysisApi,
  createClientSafeMain,
  consumeContainerCredential,
  transitionAnalysisJob
};
