// analysisApi-build-fingerprint:ec0cad3e0362c2dd6cdc89948782cf0c21ff9dd66b63f4bb854b699cf6e8ec6b:fe570b19aa8ac7e4d08712efc5a60883d8f1c4cb3b97cf83abbc3ddaf9dab146
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
function validateDownloadDescriptor(value) {
  if (!value || typeof value.url !== "string" || !/^https:\/\//.test(value.url) || typeof value.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.sha256)) {
    throw codedError("INVALID_CONFIGURATION");
  }
  return { url: value.url, sha256: value.sha256 };
}
function validateAnalysisResult(result, jobId) {
  if (!result || result.jobId !== jobId || !Array.isArray(result.points) || result.points.length !== 68 || !result.points.every((point) => point && Number.isFinite(point.x) && Number.isFinite(point.y)) || !Number.isFinite(result.detectionScore) || result.detectionScore < 0 || result.detectionScore > 1 || !result.faceBox || !Number.isFinite(result.faceBox.x) || !Number.isFinite(result.faceBox.y) || !Number.isFinite(result.faceBox.width) || result.faceBox.width <= 0 || !Number.isFinite(result.faceBox.height) || result.faceBox.height <= 0 || !result.imageSize || !Number.isInteger(result.imageSize.width) || result.imageSize.width <= 0 || !Number.isInteger(result.imageSize.height) || result.imageSize.height <= 0 || typeof result.modelVersion !== "string" || !result.modelVersion) throw codedError("INVALID_RESULT");
  return result;
}
function assertLease(job, leaseId, leaseToken) {
  if (!job || typeof leaseId !== "string" || job.leaseId !== leaseId || typeof leaseToken !== "string" || typeof job.leaseHash !== "string") throw codedError("LEASE_INVALID");
  const expected = Buffer.from(job.leaseHash, "hex");
  const actual = Buffer.from(credentialDigest(leaseToken), "hex");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw codedError("LEASE_INVALID");
}
function stableJobId(openid, clientRequestId) {
  return `job-${createHash("sha256").update(JSON.stringify([openid, clientRequestId])).digest("hex")}`;
}
function stableReservationId(openid, uploadRequestId) {
  return `reservation-${createHash("sha256").update(JSON.stringify([openid, uploadRequestId])).digest("hex")}`;
}
function deadlineMillis(value) {
  const parsed = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : NaN;
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
  if (!ANALYSIS_STATUSES.has(job?.status)) throw codedError("INVALID_STATUS");
  const result = { status: job.status };
  if (job.status === "complete" && typeof job.reportId === "string") result.reportId = job.reportId;
  if (job.status === "failed") result.error = "ANALYSIS_FAILED";
  return result;
}
function cleanupTransition(job) {
  const changes = {};
  if (job.status === "queued" || job.status === "processing") changes.status = "failed";
  if (job.sourcePhotoStatus === "pending") changes.sourcePhotoStatus = "deleting";
  return transitionAnalysisJob(job, changes);
}
async function recoverAssignedJob({ transaction, database, uploadReference, upload, requestTime, expectedJobId }) {
  const jobId = requireId(upload.jobId);
  if (expectedJobId && jobId !== expectedJobId) throw codedError("INVALID_STATUS");
  const jobReference = transaction.collection("analysis_jobs").doc(jobId);
  const job = await readOptional(jobReference);
  assertOwnedRecord(job, upload._openid);
  let current = job;
  const deadline = deadlineMillis(upload.deleteBy);
  if (!Number.isFinite(deadline) || deadline <= requestTime.getTime()) {
    current = cleanupTransition(job);
    await uploadReference.update({ status: "deleting", abandonedAt: database.serverDate() });
    if (current.status !== job.status || current.sourcePhotoStatus !== job.sourcePhotoStatus) {
      const changes = { status: current.status, sourcePhotoStatus: current.sourcePhotoStatus };
      if (job.status !== current.status) changes.errorCode = "UPLOAD_EXPIRED";
      await jobReference.update(changes);
    }
  }
  return { jobId, ...minimalStatus(current) };
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
      const reservationId = stableReservationId(openid, uploadRequestId);
      const result = await database.runTransaction(async (transaction) => {
        const consent = await readOptional(transaction.collection("consents").doc(consentId));
        const acceptedAt = typeof consent?.acceptedAt === "string" ? Date.parse(consent.acceptedAt) : NaN;
        if (!consent || consent._openid !== openid || consent.type !== CONSENT_TYPE || consent.version !== CONSENT_VERSION || !Number.isFinite(acceptedAt) || acceptedAt > requestTime.getTime() || consent.revokedAt) throw codedError("CONSENT_REQUIRED");
        const reference = transaction.collection("analysis_uploads").doc(reservationId);
        const existing = await readOptional(reference);
        if (existing) {
          assertOwnedRecord(existing, openid);
          if (existing.consentId !== consentId || existing.clientRequestId !== clientRequestId || !["pending", "attached", "assigned"].includes(existing.status)) throw codedError("UPLOAD_REQUIRED");
          if (existing.status === "assigned") {
            const view = await recoverAssignedJob({ transaction, database, uploadReference: reference, upload: existing, requestTime });
            return { reservationId, cloudPath: existing.cloudPath, ...view };
          }
          const deadline = deadlineMillis(existing.deleteBy);
          if (!Number.isFinite(deadline) || deadline <= requestTime.getTime()) {
            await reference.update({ status: "deleting", abandonedAt: database.serverDate() });
            return { expired: true };
          }
          return { reservationId, cloudPath: existing.cloudPath };
        }
        const cloudPath = `analysis/${reservationId}/source.jpg`;
        await reference.set({
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
      });
      if (result.expired) throw codedError("UPLOAD_REQUIRED");
      return result;
    }
    if (event.action === "attachUpload") {
      const reservationId = requireId(payload.reservationId);
      const tempFileId = requireTempFileId(payload.tempFileId);
      const requestTime = now();
      const result = await database.runTransaction(async (transaction) => {
        const reference = transaction.collection("analysis_uploads").doc(reservationId);
        const upload = await readOptional(reference);
        assertOwnedRecord(upload, openid);
        const deadline = deadlineMillis(upload.deleteBy);
        if (!Number.isFinite(deadline) || deadline <= requestTime.getTime()) {
          if (upload.status !== "assigned") await reference.update({ status: "deleting", abandonedAt: database.serverDate() });
          return { expired: true };
        }
        if (upload.status === "attached" && upload.tempFileId === tempFileId) return { reservationId, status: "attached" };
        if (upload.status !== "pending" || !tempFileId.endsWith(`/${upload.cloudPath}`)) throw codedError("UPLOAD_REQUIRED");
        await reference.update({ tempFileId, status: "attached", attachedAt: database.serverDate() });
        return { reservationId, status: "attached" };
      });
      if (result.expired) throw codedError("UPLOAD_REQUIRED");
      return result;
    }
    if (event.action === "abandonUpload") {
      const reservationId = requireId(payload.reservationId);
      return database.runTransaction(async (transaction) => {
        const reference = transaction.collection("analysis_uploads").doc(reservationId);
        const upload = await readOptional(reference);
        assertOwnedRecord(upload, openid);
        if (upload.status === "deleting") return { reservationId, status: "deleting" };
        if (!["pending", "attached"].includes(upload.status)) throw codedError("INVALID_STATUS");
        await reference.update({ status: "deleting", abandonedAt: database.serverDate() });
        return { reservationId, status: "deleting" };
      });
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
          const existingUploadReference = transaction.collection("analysis_uploads").doc(requireId(existing.reservationId));
          const existingUpload = await readOptional(existingUploadReference);
          assertOwnedRecord(existingUpload, openid);
          return { view: await recoverAssignedJob({
            transaction,
            database,
            uploadReference: existingUploadReference,
            upload: existingUpload,
            requestTime,
            expectedJobId: existing._id || jobId
          }) };
        }
        const consent = await readOptional(transaction.collection("consents").doc(consentId));
        const consentAcceptedAt = typeof consent?.acceptedAt === "string" ? Date.parse(consent.acceptedAt) : NaN;
        if (!consent || consent._openid !== openid || consent.type !== CONSENT_TYPE || consent.version !== CONSENT_VERSION || !Number.isFinite(consentAcceptedAt) || consentAcceptedAt > requestTime.getTime() || consent.revokedAt) {
          throw codedError("CONSENT_REQUIRED");
        }
        const uploadReference = transaction.collection("analysis_uploads").doc(reservationId);
        const upload = await readOptional(uploadReference);
        assertOwnedRecord(upload, openid);
        if (upload.status !== "attached" || upload.tempFileId !== tempFileId || upload.consentId !== consentId || upload.clientRequestId !== clientRequestId) throw codedError("UPLOAD_REQUIRED");
        const uploadDeadline = deadlineMillis(upload.deleteBy);
        if (!Number.isFinite(uploadDeadline) || uploadDeadline <= requestTime.getTime()) {
          await uploadReference.update({ status: "deleting", abandonedAt: database.serverDate() });
          return { expired: true };
        }
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
          deleteBy: new Date(uploadDeadline).toISOString(),
          credentialHash: credentialDigest(credential),
          credentialPurpose: "face-analysis",
          credentialExpiresAt: new Date(Math.min(requestTime.getTime() + 5 * 60 * 1e3, uploadDeadline)).toISOString(),
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
      if (created.expired) throw codedError("UPLOAD_REQUIRED");
      if (created.dispatch) {
        try {
          await dispatchAnalysis(created.dispatch);
        } catch (_) {
          created.view = await database.runTransaction(async (transaction) => {
            const jobReference = transaction.collection("analysis_jobs").doc(created.view.jobId);
            const uploadReference = transaction.collection("analysis_uploads").doc(created.dispatch.reservationId);
            const job = await readOptional(jobReference);
            const upload = await readOptional(uploadReference);
            if (!job || !upload || job._openid !== openid || upload._openid !== openid) throw codedError("FORBIDDEN");
            if (job.status === "queued" && !job.credentialUsedAt && upload.status === "assigned" && job.reservationId === created.dispatch.reservationId && upload.jobId === created.view.jobId && upload.tempFileId === job.tempFileId) {
              const next = transitionAnalysisJob(job, { status: "failed", sourcePhotoStatus: "deleting" });
              await jobReference.update({
                status: next.status,
                sourcePhotoStatus: next.sourcePhotoStatus,
                errorCode: "DISPATCH_FAILED"
              });
              await uploadReference.update({ status: "deleting", abandonedAt: database.serverDate() });
              return { jobId: created.view.jobId, ...minimalStatus(next) };
            }
            return { jobId: created.view.jobId, ...minimalStatus(job) };
          });
        }
      }
      return created.view;
    }
    if (event.action === "getAnalysis") {
      const jobId = requireId(payload.jobId);
      let job = await readOptional(database.collection("analysis_jobs").doc(jobId));
      assertOwnedRecord(job, openid);
      if (job.status === "processing" && deadlineMillis(job.leaseExpiresAt) <= now().getTime()) {
        await recoverExpiredContainerLease({ database, jobId, now: now() });
        job = await readOptional(database.collection("analysis_jobs").doc(jobId));
      }
      if (!ANALYSIS_STATUSES.has(job.status)) throw codedError("INVALID_STATUS");
      return minimalStatus(job);
    }
    throw codedError("INVALID_ACTION");
  };
}
async function claimContainerJob({
  database,
  jobId,
  credential,
  now = /* @__PURE__ */ new Date(),
  createDownloadDescriptor,
  createLeaseCredential = () => ({ leaseId: `lease-${randomUUID()}`, leaseToken: randomBytes(32).toString("base64url") })
}) {
  if (typeof createDownloadDescriptor !== "function") throw codedError("INVALID_CONFIGURATION");
  return database.runTransaction(async (transaction) => {
    const reference = transaction.collection("analysis_jobs").doc(requireId(jobId));
    const job = await readOptional(reference);
    if (!job || typeof credential !== "string" || typeof job.credentialHash !== "string") throw codedError("CREDENTIAL_INVALID");
    if (job.credentialUsedAt) throw codedError("CREDENTIAL_USED");
    if (job.status !== "queued" || job.sourcePhotoStatus !== "pending") throw codedError("CREDENTIAL_INVALID");
    if (job.credentialPurpose !== "face-analysis") throw codedError("CREDENTIAL_INVALID");
    const upload = await readOptional(transaction.collection("analysis_uploads").doc(requireId(job.reservationId)));
    if (!upload || upload._openid !== job._openid || upload.jobId !== jobId || upload.status !== "assigned" || upload.tempFileId !== job.tempFileId) throw codedError("CREDENTIAL_INVALID");
    const expiresAt = Date.parse(job.credentialExpiresAt);
    if (!Number.isFinite(expiresAt)) throw codedError("CREDENTIAL_INVALID");
    const deleteBy = deadlineMillis(job.deleteBy);
    if (!Number.isFinite(deleteBy)) throw codedError("CREDENTIAL_INVALID");
    if (expiresAt <= now.getTime() || deleteBy <= now.getTime()) throw codedError("CREDENTIAL_EXPIRED");
    const expected = Buffer.from(job.credentialHash, "hex");
    const actual = Buffer.from(credentialDigest(credential), "hex");
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw codedError("CREDENTIAL_INVALID");
    const lease = createLeaseCredential();
    if (!lease || typeof lease.leaseId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(lease.leaseId) || typeof lease.leaseToken !== "string" || lease.leaseToken.length < 16) throw codedError("INVALID_CONFIGURATION");
    const download = validateDownloadDescriptor(await createDownloadDescriptor(job.tempFileId, jobId));
    const leaseExpiresAt = new Date(Math.min(now.getTime() + 2 * 60 * 1e3, deleteBy)).toISOString();
    const next = transitionAnalysisJob(job, { status: "processing" });
    await reference.update({
      status: next.status,
      sourcePhotoStatus: next.sourcePhotoStatus,
      credentialUsedAt: database.serverDate(),
      leaseId: lease.leaseId,
      leaseHash: credentialDigest(lease.leaseToken),
      leaseExpiresAt
    });
    return { jobId, leaseId: lease.leaseId, leaseToken: lease.leaseToken, download };
  });
}
async function settleContainerJob({ database, jobId, leaseId, leaseToken, now, status, errorCode, result }) {
  return database.runTransaction(async (transaction) => {
    const reference = transaction.collection("analysis_jobs").doc(requireId(jobId));
    const job = await readOptional(reference);
    assertLease(job, leaseId, leaseToken);
    if (job.status === "complete" || job.status === "failed") return { jobId, status: job.status };
    if (job.status !== "processing" || deadlineMillis(job.leaseExpiresAt) <= now.getTime()) throw codedError("LEASE_EXPIRED");
    const uploadReference = transaction.collection("analysis_uploads").doc(requireId(job.reservationId));
    const upload = await readOptional(uploadReference);
    if (!upload || upload._openid !== job._openid || upload.jobId !== jobId || upload.status !== "assigned") throw codedError("LEASE_INVALID");
    const next = transitionAnalysisJob(job, { status, sourcePhotoStatus: "deleting" });
    const changes = { status: next.status, sourcePhotoStatus: next.sourcePhotoStatus, settledAt: database.serverDate() };
    if (status === "complete") changes.analysisResult = validateAnalysisResult(result, jobId);
    else changes.errorCode = typeof errorCode === "string" && /^[A-Z0-9_]{1,64}$/.test(errorCode) ? errorCode : "ANALYSIS_FAILED";
    await reference.update(changes);
    await uploadReference.update({ status: "deleting", abandonedAt: database.serverDate() });
    return { jobId, status };
  });
}
function completeContainerJob({ database, jobId, leaseId, leaseToken, result, now = /* @__PURE__ */ new Date() }) {
  return settleContainerJob({ database, jobId, leaseId, leaseToken, result, now, status: "complete" });
}
function failContainerJob({ database, jobId, leaseId, leaseToken, errorCode, now = /* @__PURE__ */ new Date() }) {
  return settleContainerJob({ database, jobId, leaseId, leaseToken, errorCode, now, status: "failed" });
}
async function recoverExpiredContainerLease({ database, jobId, now = /* @__PURE__ */ new Date() }) {
  return database.runTransaction(async (transaction) => {
    const reference = transaction.collection("analysis_jobs").doc(requireId(jobId));
    const job = await readOptional(reference);
    if (!job) throw codedError("INVALID_STATUS");
    if (job.status !== "processing" || deadlineMillis(job.leaseExpiresAt) > now.getTime()) return { jobId, status: job.status };
    const next = transitionAnalysisJob(job, { status: "failed", sourcePhotoStatus: "deleting" });
    await reference.update({ status: next.status, sourcePhotoStatus: next.sourcePhotoStatus, errorCode: "LEASE_EXPIRED" });
    const uploadReference = transaction.collection("analysis_uploads").doc(requireId(job.reservationId));
    const upload = await readOptional(uploadReference);
    if (upload && upload._openid === job._openid && upload.jobId === jobId && upload.status === "assigned") {
      await uploadReference.update({ status: "deleting", abandonedAt: database.serverDate() });
    }
    return { jobId, status: "failed" };
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
  claimContainerJob,
  completeContainerJob,
  createAnalysisApi,
  createClientSafeMain,
  failContainerJob,
  recoverExpiredContainerLease,
  transitionAnalysisJob
};
