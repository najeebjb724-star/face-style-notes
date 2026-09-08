// analysisApi-build-fingerprint:0070babad0c85e88c731c6440873210842d1272f59019f0689367b66f228c2dc:1f6acd0ca495ea53d1dc71915e5792dac3d8d1f25fa93cd3fc2dce6c03b7e498
var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};

// ../../shared/cloud-guards.js
var require_cloud_guards = __commonJS({
  "../../shared/cloud-guards.js"(exports2, module2) {
    function assertOwnedRecord2(record, openid) {
      if (!openid || !record || record._openid !== openid) {
        const error = new Error("FORBIDDEN");
        error.code = "FORBIDDEN";
        throw error;
      }
    }
    module2.exports = { assertOwnedRecord: assertOwnedRecord2 };
  }
});

// src/index.js
var { createHash, randomBytes, randomUUID, timingSafeEqual } = require("node:crypto");
var { assertOwnedRecord } = require_cloud_guards();
var ANALYSIS_STATUSES = /* @__PURE__ */ new Set(["queued", "processing", "complete", "failed"]);
var SOURCE_PHOTO_STATUSES = /* @__PURE__ */ new Set(["pending", "deleting", "deleted", "manual_review"]);
var SAFE_ERRORS = /* @__PURE__ */ new Set(["CONSENT_REQUIRED", "FORBIDDEN", "INVALID_ACTION", "INVALID_ARGUMENT", "UNAUTHENTICATED"]);
var CONSENT_TYPE = "face-analysis";
var CONSENT_VERSION = "2026-09-03";
function codedError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
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
function stableReservationId(openid, uploadRequestId) {
  return `reservation-${createHash("sha256").update(JSON.stringify([openid, uploadRequestId])).digest("hex")}`;
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
  const statusTransitions = {
    queued: /* @__PURE__ */ new Set(["queued", "processing", "failed"]),
    processing: /* @__PURE__ */ new Set(["processing", "complete", "failed"]),
    complete: /* @__PURE__ */ new Set(["complete"]),
    failed: /* @__PURE__ */ new Set(["failed"])
  };
  const photoTransitions = {
    pending: /* @__PURE__ */ new Set(["pending", "deleting", "deleted", "manual_review"]),
    deleting: /* @__PURE__ */ new Set(["deleting", "deleted", "manual_review"]),
    deleted: /* @__PURE__ */ new Set(["deleted"]),
    manual_review: /* @__PURE__ */ new Set(["manual_review", "deleted"])
  };
  if (!statusTransitions[job.status]?.has(next.status) || !photoTransitions[job.sourcePhotoStatus]?.has(next.sourcePhotoStatus)) {
    throw codedError("INVALID_STATUS");
  }
  return next;
}
function createAnalysisApi({
  database,
  getWXContext,
  now = () => /* @__PURE__ */ new Date(),
  createId = (prefix) => `${prefix}-${randomUUID()}`,
  createCredential = () => randomBytes(32).toString("base64url"),
  dispatchAnalysis = async () => {
  }
}) {
  if (!database || typeof getWXContext !== "function") throw codedError("INVALID_CONFIGURATION");
  return async function handle(event = {}) {
    const openid = getWXContext()?.OPENID;
    if (!openid) throw codedError("UNAUTHENTICATED");
    const payload = event.payload === void 0 ? {} : requireObject(event.payload);
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
    if (event.action === "reserveUpload") {
      const consentId = requireId(payload.consentId);
      const clientRequestId = requireId(payload.clientRequestId);
      const uploadRequestId = requireId(payload.uploadRequestId);
      const requestTime = now();
      const consent = await readOptional(database.collection("consents").doc(consentId));
      const acceptedAt = typeof consent?.acceptedAt === "string" ? Date.parse(consent.acceptedAt) : NaN;
      if (!consent || consent._openid !== openid || consent.type !== CONSENT_TYPE || consent.version !== CONSENT_VERSION || !Number.isFinite(acceptedAt) || acceptedAt > requestTime.getTime() || consent.revokedAt) throw codedError("CONSENT_REQUIRED");
      const reservationId = stableReservationId(openid, uploadRequestId);
      const existing = await readOptional(database.collection("analysis_uploads").doc(reservationId));
      if (existing) {
        assertOwnedRecord(existing, openid);
        if (existing.consentId !== consentId || existing.clientRequestId !== clientRequestId || !["pending", "attached", "assigned"].includes(existing.status)) throw codedError("UPLOAD_REQUIRED");
        return { reservationId, cloudPath: existing.cloudPath };
      }
      const fileName = requireId(createId("photo"));
      const cloudPath = `analysis/${reservationId}/${fileName}.jpg`;
      await database.collection("analysis_uploads").doc(reservationId).set({
        _openid: openid,
        consentId,
        clientRequestId,
        uploadRequestId,
        cloudPath,
        status: "pending",
        deleteBy: new Date(requestTime.getTime() + 30 * 60 * 1e3).toISOString(),
        createdAt: database.serverDate()
      });
      return { reservationId, cloudPath };
    }
    if (event.action === "attachUpload") {
      const reservationId = requireId(payload.reservationId);
      const tempFileId = requireTempFileId(payload.tempFileId);
      const reference = database.collection("analysis_uploads").doc(reservationId);
      const upload = await readOptional(reference);
      assertOwnedRecord(upload, openid);
      if (upload.status === "attached" && upload.tempFileId === tempFileId) {
        return { reservationId, status: "attached" };
      }
      if (upload.status !== "pending" || !tempFileId.endsWith(`/${upload.cloudPath}`)) throw codedError("UPLOAD_REQUIRED");
      await reference.update({ tempFileId, status: "attached", attachedAt: database.serverDate() });
      return { reservationId, status: "attached" };
    }
    if (event.action === "abandonUpload") {
      const reservationId = requireId(payload.reservationId);
      const reference = database.collection("analysis_uploads").doc(reservationId);
      const upload = await readOptional(reference);
      assertOwnedRecord(upload, openid);
      if (!["pending", "attached", "deleting"].includes(upload.status)) throw codedError("INVALID_STATUS");
      await reference.update({ status: "deleting", abandonedAt: database.serverDate() });
      return { reservationId, status: "deleting" };
    }
    if (event.action === "createAnalysis") {
      const consentId = requireId(payload.consentId);
      const clientRequestId = requireId(payload.clientRequestId);
      const tempFileId = requireTempFileId(payload.tempFileId);
      const reservationId = requireId(payload.reservationId);
      const quality = sanitizeQuality(payload.quality);
      const requestTime = now();
      const jobId = stableJobId(openid, clientRequestId);
      const created = await database.runTransaction(async (transaction) => {
        const existing = await readOptional(transaction.collection("analysis_jobs").doc(jobId));
        if (existing) {
          assertOwnedRecord(existing, openid);
          return { view: { jobId: existing._id || jobId, status: existing.status } };
        }
        const consent = await readOptional(transaction.collection("consents").doc(consentId));
        const consentAcceptedAt = typeof consent?.acceptedAt === "string" ? Date.parse(consent.acceptedAt) : NaN;
        if (!consent || consent._openid !== openid || consent.type !== CONSENT_TYPE || consent.version !== CONSENT_VERSION || !Number.isFinite(consentAcceptedAt) || consentAcceptedAt > requestTime.getTime() || consent.revokedAt) {
          throw codedError("CONSENT_REQUIRED");
        }
        const upload = await readOptional(transaction.collection("analysis_uploads").doc(reservationId));
        assertOwnedRecord(upload, openid);
        if (upload.status !== "attached" || upload.tempFileId !== tempFileId || upload.consentId !== consentId || upload.clientRequestId !== clientRequestId) throw codedError("UPLOAD_REQUIRED");
        const credential = createCredential();
        if (typeof credential !== "string" || credential.length < 16) throw codedError("INVALID_CONFIGURATION");
        const record = {
          _openid: openid,
          consentId,
          reservationId,
          clientRequestId,
          tempFileId,
          quality,
          status: "queued",
          sourcePhotoStatus: "pending",
          deleteBy: new Date(requestTime.getTime() + 30 * 60 * 1e3).toISOString(),
          credentialHash: credentialDigest(credential),
          credentialPurpose: "face-analysis",
          credentialExpiresAt: new Date(requestTime.getTime() + 5 * 60 * 1e3).toISOString(),
          credentialUsedAt: null,
          createdAt: database.serverDate()
        };
        await transaction.collection("analysis_jobs").doc(jobId).set(record);
        await transaction.collection("analysis_uploads").doc(reservationId).update({ status: "assigned", jobId });
        return {
          view: { jobId, status: "queued" },
          dispatch: { jobId, reservationId, tempFileId, credential, credentialExpiresAt: record.credentialExpiresAt }
        };
      });
      if (created.dispatch) {
        try {
          await dispatchAnalysis(created.dispatch);
        } catch (_) {
          await database.collection("analysis_jobs").doc(created.view.jobId).update({
            status: "failed",
            sourcePhotoStatus: "deleting",
            errorCode: "DISPATCH_FAILED"
          });
          await database.collection("analysis_uploads").doc(created.dispatch.reservationId).update({
            status: "deleting",
            abandonedAt: database.serverDate()
          });
          created.view.status = "failed";
        }
      }
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
async function consumeContainerCredential({ database, jobId, credential, now = /* @__PURE__ */ new Date() }) {
  return database.runTransaction(async (transaction) => {
    const reference = transaction.collection("analysis_jobs").doc(requireId(jobId));
    const job = await readOptional(reference);
    if (!job || typeof credential !== "string" || typeof job.credentialHash !== "string") throw codedError("CREDENTIAL_INVALID");
    if (job.credentialUsedAt) throw codedError("CREDENTIAL_USED");
    if (job.credentialPurpose !== "face-analysis") throw codedError("CREDENTIAL_INVALID");
    const expiresAt = Date.parse(job.credentialExpiresAt);
    if (!Number.isFinite(expiresAt)) throw codedError("CREDENTIAL_INVALID");
    if (expiresAt <= now.getTime()) throw codedError("CREDENTIAL_EXPIRED");
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
