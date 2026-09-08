const { createHash, randomBytes, randomUUID, timingSafeEqual } = require("node:crypto");
const { assertOwnedRecord } = require("../../../shared/cloud-guards");

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

function deadlineMillis(value) {
  const parsed = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : NaN;
}

async function rejectExpiredUpload(reference, upload, requestTime, database) {
  const deadline = deadlineMillis(upload?.deleteBy);
  if (Number.isFinite(deadline) && deadline > requestTime.getTime()) return deadline;
  try {
    await reference.update({ status: "deleting", abandonedAt: database.serverDate() });
  } catch (_) {}
  throw codedError("UPLOAD_REQUIRED");
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
    queued: new Set(["queued", "processing", "failed"]),
    processing: new Set(["processing", "complete", "failed"]),
    complete: new Set(["complete"]),
    failed: new Set(["failed"])
  };
  const photoTransitions = {
    pending: new Set(["pending", "deleting", "deleted", "manual_review"]),
    deleting: new Set(["deleting", "deleted", "manual_review"]),
    deleted: new Set(["deleted"]),
    manual_review: new Set(["manual_review", "deleted"])
  };
  if (!statusTransitions[job.status]?.has(next.status) || !photoTransitions[job.sourcePhotoStatus]?.has(next.sourcePhotoStatus)) {
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

    if (event.action === "reserveUpload") {
      const consentId = requireId(payload.consentId);
      const clientRequestId = requireId(payload.clientRequestId);
      const uploadRequestId = requireId(payload.uploadRequestId);
      const requestTime = now();
      const consent = await readOptional(database.collection("consents").doc(consentId));
      const acceptedAt = typeof consent?.acceptedAt === "string" ? Date.parse(consent.acceptedAt) : NaN;
      if (!consent || consent._openid !== openid || consent.type !== CONSENT_TYPE || consent.version !== CONSENT_VERSION
        || !Number.isFinite(acceptedAt) || acceptedAt > requestTime.getTime() || consent.revokedAt) throw codedError("CONSENT_REQUIRED");
      const reservationId = stableReservationId(openid, uploadRequestId);
      const reference = database.collection("analysis_uploads").doc(reservationId);
      const existing = await readOptional(reference);
      if (existing) {
        assertOwnedRecord(existing, openid);
        await rejectExpiredUpload(reference, existing, requestTime, database);
        if (existing.consentId !== consentId || existing.clientRequestId !== clientRequestId
          || !["pending", "attached", "assigned"].includes(existing.status)) throw codedError("UPLOAD_REQUIRED");
        if (existing.status === "assigned") {
          const job = await readOptional(database.collection("analysis_jobs").doc(requireId(existing.jobId)));
          assertOwnedRecord(job, openid);
          return { reservationId, cloudPath: existing.cloudPath, jobId: existing.jobId, ...minimalStatus(job) };
        }
        return { reservationId, cloudPath: existing.cloudPath };
      }
      const cloudPath = `analysis/${reservationId}/source.jpg`;
      await reference.set({
        _openid: openid, consentId, clientRequestId, uploadRequestId, cloudPath, status: "pending",
        deleteBy: new Date(requestTime.getTime() + 30 * 60 * 1000).toISOString(), createdAt: database.serverDate()
      });
      return { reservationId, cloudPath };
    }

    if (event.action === "attachUpload") {
      const reservationId = requireId(payload.reservationId);
      const tempFileId = requireTempFileId(payload.tempFileId);
      const reference = database.collection("analysis_uploads").doc(reservationId);
      const upload = await readOptional(reference);
      assertOwnedRecord(upload, openid);
      await rejectExpiredUpload(reference, upload, now(), database);
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

      const created = await database.runTransaction(async transaction => {
        const existing = await readOptional(transaction.collection("analysis_jobs").doc(jobId));
        if (existing) {
          assertOwnedRecord(existing, openid);
          const existingUploadReference = transaction.collection("analysis_uploads").doc(requireId(existing.reservationId));
          const existingUpload = await readOptional(existingUploadReference);
          assertOwnedRecord(existingUpload, openid);
          const existingDeadline = deadlineMillis(existingUpload.deleteBy);
          if (!Number.isFinite(existingDeadline) || existingDeadline <= requestTime.getTime()) {
            await existingUploadReference.update({ status: "deleting", abandonedAt: database.serverDate() });
            return { expired: true };
          }
          return { view: { jobId: existing._id || jobId, ...minimalStatus(existing) } };
        }
        const consent = await readOptional(transaction.collection("consents").doc(consentId));
        const consentAcceptedAt = typeof consent?.acceptedAt === "string" ? Date.parse(consent.acceptedAt) : NaN;
        if (!consent || consent._openid !== openid || consent.type !== CONSENT_TYPE || consent.version !== CONSENT_VERSION
          || !Number.isFinite(consentAcceptedAt) || consentAcceptedAt > requestTime.getTime() || consent.revokedAt) {
          throw codedError("CONSENT_REQUIRED");
        }
        const uploadReference = transaction.collection("analysis_uploads").doc(reservationId);
        const upload = await readOptional(uploadReference);
        assertOwnedRecord(upload, openid);
        if (upload.status !== "attached" || upload.tempFileId !== tempFileId
          || upload.consentId !== consentId || upload.clientRequestId !== clientRequestId) throw codedError("UPLOAD_REQUIRED");
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
          credentialExpiresAt: new Date(Math.min(requestTime.getTime() + 5 * 60 * 1000, uploadDeadline)).toISOString(),
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
          await database.collection("analysis_jobs").doc(created.view.jobId).update({
            status: "failed", sourcePhotoStatus: "deleting", errorCode: "DISPATCH_FAILED"
          });
          await database.collection("analysis_uploads").doc(created.dispatch.reservationId).update({
            status: "deleting", abandonedAt: database.serverDate()
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

async function consumeContainerCredential({ database, jobId, credential, now = new Date() }) {
  return database.runTransaction(async transaction => {
    const reference = transaction.collection("analysis_jobs").doc(requireId(jobId));
    const job = await readOptional(reference);
    if (!job || typeof credential !== "string" || typeof job.credentialHash !== "string") throw codedError("CREDENTIAL_INVALID");
    if (job.credentialUsedAt) throw codedError("CREDENTIAL_USED");
    if (job.status !== "queued" || job.sourcePhotoStatus !== "pending") throw codedError("CREDENTIAL_INVALID");
    if (job.credentialPurpose !== "face-analysis") throw codedError("CREDENTIAL_INVALID");
    const expiresAt = Date.parse(job.credentialExpiresAt);
    if (!Number.isFinite(expiresAt)) throw codedError("CREDENTIAL_INVALID");
    const deleteBy = deadlineMillis(job.deleteBy);
    if (!Number.isFinite(deleteBy)) throw codedError("CREDENTIAL_INVALID");
    if (expiresAt <= now.getTime() || deleteBy <= now.getTime()) throw codedError("CREDENTIAL_EXPIRED");
    const expected = Buffer.from(job.credentialHash, "hex");
    const actual = Buffer.from(credentialDigest(credential), "hex");
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw codedError("CREDENTIAL_INVALID");
    const next = transitionAnalysisJob(job, { status: "processing" });
    await reference.update({
      status: next.status,
      sourcePhotoStatus: next.sourcePhotoStatus,
      credentialUsedAt: database.serverDate()
    });
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
