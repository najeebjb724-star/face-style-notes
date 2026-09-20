const MAX_BATCH_SIZE = 50;
const RETRY_LIMIT = 3;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// Business handlers use flat records; wx-server-sdk requires { data } even in transactions.
function adaptCloudDatabase(database) {
  const collections = source => name => {
    const collection = source.collection(name);
    return {
      where: filter => collection.where(filter),
      doc: id => {
        const reference = collection.doc(id);
        return {
          get: () => reference.get(), remove: () => reference.remove(),
          set: data => reference.set({ data }), update: data => reference.update({ data })
        };
      }
    };
  };
  return {
    collection: collections(database), command: database.command,
    serverDate: () => database.serverDate(),
    runTransaction: callback => database.runTransaction(tx => callback({ collection: collections(tx) }))
  };
}

function codedError(code) { return Object.assign(new Error(code), { code }); }
function requireId(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw codedError("INVALID_ARGUMENT");
  return value;
}
async function read(reference) {
  try { return (await reference.get())?.data || null; }
  catch (error) {
    if (error?.code === "DATABASE_DOCUMENT_NOT_EXIST" || error?.errCode === -502005 || /not[ _-]?exist/i.test(error?.message || "")) return null;
    throw error;
  }
}

// Called inside the challenge deletion transaction, before the parent disappears.
async function queueChallengeDeletion(transaction, database, challenge, at) {
  await transaction.collection("deletion_jobs").doc(`challenge-${challenge._id}`).set({
    kind: "challenge", sourceId: challenge._id, _openid: challenge._openid,
    state: "pending", attempts: 0, dueAt: at.toISOString(), deleteAll: true,
    createdAt: database.serverDate()
  });
}

function createPhotoLifecycle({ database, cloud, now = () => new Date(), alert = () => {}, maxBatchSize = MAX_BATCH_SIZE }) {
  if (!database || typeof cloud?.deleteFile !== "function") throw codedError("INVALID_CONFIGURATION");
  const batchSize = Math.min(MAX_BATCH_SIZE, Math.max(1, maxBatchSize));
  const list = async (name, filter, limit = batchSize, order) => {
    if (limit <= 0) return [];
    let query = database.collection(name).where(filter);
    if (order) query = query.orderBy(order, "asc");
    return (await query.limit(limit).get()).data || [];
  };
  const write = (name, id, data) => database.runTransaction(tx => tx.collection(name).doc(id).update(data));

  async function removePhoto(kind, source, collection, fileId, deletedChanges, at) {
    const id = `${kind}-${source._id}`;
    const existing = await read(database.collection("deletion_jobs").doc(id));
    if (existing?.state === "deleted") return { deleted: true };
    if (existing?.leaseUntil > at.toISOString()) return { deleted: false, state: existing.state };
    // A short persisted lease prevents concurrent workers from charging duplicate attempts.
    const claimed = await database.runTransaction(async tx => {
      const reference = tx.collection("deletion_jobs").doc(id);
      const current = await read(reference);
      if (current?.state === "deleted" || current?.leaseUntil > at.toISOString()) return null;
      const intent = { kind, sourceId: source._id, _openid: source._openid, state: current?.state || "pending",
        attempts: (current?.attempts || 0) + 1, dueAt: new Date(at.getTime() + 60000).toISOString(),
        leaseUntil: new Date(at.getTime() + 60000).toISOString(), updatedAt: database.serverDate() };
      await reference.set(intent);
      return intent;
    });
    if (!claimed) return { deleted: false };
    let success = false;
    try {
      if (typeof fileId !== "string" || !fileId.startsWith("cloud://")) throw codedError("FILE_ID_MISSING");
      const result = await cloud.deleteFile({ fileList: [fileId] });
      success = result?.fileList?.length === 1 && result.fileList[0].fileID === fileId && result.fileList[0].status === 0;
    } catch (_) { /* Only a fixed code is persisted: SDK errors can contain private URLs. */ }
    const state = success ? "deleted" : claimed.attempts >= RETRY_LIMIT ? "manual_review" : "retrying";
    await database.runTransaction(async tx => {
      await tx.collection("deletion_jobs").doc(id).update({ state, leaseUntil: null,
        lastError: success ? null : "PHOTO_DELETE_FAILED", updatedAt: database.serverDate() });
      await tx.collection(collection).doc(source._id).update(success ? deletedChanges : {
        ...(kind === "analysis" ? { sourcePhotoStatus: state === "manual_review" ? state : "deleting" } : { deletionState: state })
      });
    });
    if (!success) alert({ code: "PHOTO_DELETE_FAILED", kind, sourceId: source._id, state, attempts: claimed.attempts });
    return { deleted: success, state };
  }

  async function deleteAnalysisPhoto(jobId, at = now()) {
    const job = await database.runTransaction(async tx => {
      const reference = tx.collection("analysis_jobs").doc(requireId(jobId));
      const current = await read(reference);
      if (!current) throw codedError("INVALID_STATUS");
      if (current.sourcePhotoStatus === "deleted" || current.photoDeletedAt) return current;
      const expired = Date.parse(current.deleteBy) <= at.getTime();
      const leaseExpired = current.status === "processing" && Date.parse(current.leaseExpiresAt) <= at.getTime();
      if (!["complete", "failed"].includes(current.status)) {
        if (!expired && !leaseExpired) throw codedError("NOT_DUE");
        await reference.update({ status: "failed", errorCode: leaseExpired ? "LEASE_EXPIRED" : "PHOTO_EXPIRED", sourcePhotoStatus: "deleting" });
      }
      return current;
    });
    if (job.sourcePhotoStatus === "deleted" || job.photoDeletedAt) return { deleted: true };
    const outcome = await removePhoto("analysis", job, "analysis_jobs", job.tempFileId,
      { sourcePhotoStatus: "deleted", photoDeletedAt: database.serverDate() }, at);
    if (outcome.deleted && job.reservationId) {
      const upload = await read(database.collection("analysis_uploads").doc(job.reservationId));
      if (upload && upload._openid === job._openid && upload.jobId === jobId && upload.tempFileId === job.tempFileId) {
        await write("analysis_uploads", upload._id, { status: "deleted", photoDeletedAt: database.serverDate() });
      }
    }
    return outcome;
  }

  async function deleteUploadPhoto(reservationId, at = now()) {
    const upload = await read(database.collection("analysis_uploads").doc(requireId(reservationId)));
    if (!upload || upload.status === "deleted") return { deleted: true };
    if (upload.jobId) {
      const job = await read(database.collection("analysis_jobs").doc(requireId(upload.jobId)));
      if (!job || job._openid !== upload._openid || job.reservationId !== reservationId || job.tempFileId !== upload.tempFileId) throw codedError("INVALID_STATUS");
      return deleteAnalysisPhoto(upload.jobId, at);
    }
    if (upload.status !== "deleting" && !(Date.parse(upload.deleteBy) <= at.getTime())) throw codedError("NOT_DUE");
    return removePhoto("upload", upload, "analysis_uploads", upload.tempFileId,
      { status: "deleted", deletionState: "deleted", photoDeletedAt: database.serverDate() }, at);
  }

  async function deleteChallengePhotos(challengeId, at = now(), limit = batchSize) {
    const id = requireId(challengeId);
    const intent = await read(database.collection("deletion_jobs").doc(`challenge-${id}`));
    const challenge = await read(database.collection("challenges").doc(id));
    const owner = intent?._openid || challenge?._openid;
    if (!owner) return { processed: 0 };
    const deleteAll = intent?.deleteAll === true;
    const deadline = challenge?.photoDeleteBy ? Date.parse(challenge.photoDeleteBy) : Date.parse(challenge?.completedAt) + WEEK_MS;
    if (!deleteAll && (challenge?.status !== "completed" || !Number.isFinite(deadline) || deadline > at.getTime())) throw codedError("NOT_DUE");
    const filter = { challengeId: id, _openid: owner, deletionState: database.command.neq("deleted") };
    if (!deleteAll) filter.retentionPolicy = database.command.neq("keep");
    const photos = await list("challenge_photos", filter, limit);
    for (const photo of photos) {
      const attempt = await read(database.collection("deletion_jobs").doc(`challenge-photo-${photo._id}`));
      if (attempt?.dueAt > at.toISOString()) continue;
      await removePhoto("challenge-photo", photo, "challenge_photos", photo.fileId,
        { deletionState: "deleted", deletedAt: database.serverDate() }, at);
    }
    if ((await list("challenge_photos", filter, 1)).length === 0) {
      if (intent) await write("deletion_jobs", `challenge-${id}`, { state: "deleted" });
      if (challenge) await write("challenges", id, { photosCleaned: true });
    }
    return { processed: photos.length };
  }

  async function deleteExpiredPhotos(at = now()) {
    const cutoff = at.toISOString(); const cmd = database.command;
    let processed = 0;
    const seen = new Set();
    const run = async (kind, id, fn) => {
      if (processed >= batchSize || seen.has(`${kind}-${id}`)) return;
      const intent = await read(database.collection("deletion_jobs").doc(`${kind}-${id}`));
      if (intent?.dueAt > cutoff) return;
      seen.add(`${kind}-${id}`); processed++;
      try { await fn(); } catch (_) { alert({ code: "LIFECYCLE_JOB_FAILED", kind, sourceId: id }); }
    };
    for (const intent of await list("deletion_jobs", { state: cmd.in(["pending", "retrying", "manual_review"]), dueAt: cmd.lte(cutoff) }, Math.max(1, Math.floor(batchSize / 2)), "dueAt")) {
      if (intent.kind === "analysis") await run("analysis", intent.sourceId, () => deleteAnalysisPhoto(intent.sourceId, at));
      if (intent.kind === "upload") await run("upload", intent.sourceId, () => deleteUploadPhoto(intent.sourceId, at));
      if (intent.kind === "challenge-photo") {
        const photo = await read(database.collection("challenge_photos").doc(intent.sourceId));
        if (photo) await run("challenge-photo", photo._id, () => removePhoto("challenge-photo", photo, "challenge_photos", photo.fileId, { deletionState: "deleted", deletedAt: database.serverDate() }, at));
      }
      if (intent.kind === "challenge" && processed < batchSize) {
        const result = await deleteChallengePhotos(intent.sourceId, at, batchSize - processed);
        processed += result.processed;
      }
    }
    for (const filter of [
      { sourcePhotoStatus: "deleting" },
      { sourcePhotoStatus: "pending", status: "processing", leaseExpiresAt: cmd.lte(cutoff) },
      { sourcePhotoStatus: "pending", deleteBy: cmd.lte(cutoff) }
    ]) for (const job of await list("analysis_jobs", filter, batchSize - processed)) await run("analysis", job._id, () => deleteAnalysisPhoto(job._id, at));
    for (const filter of [
      { status: "deleting" },
      { status: cmd.in(["pending", "attached"]), deleteBy: cmd.lte(cutoff) }
    ]) for (const upload of await list("analysis_uploads", filter, batchSize - processed)) {
      await run(upload.jobId ? "analysis" : "upload", upload.jobId || upload._id, () => deleteUploadPhoto(upload._id, at));
    }
    for (const challenge of await list("challenges", { status: "completed", photosCleaned: cmd.neq(true), completedAt: cmd.lte(new Date(at.getTime() - WEEK_MS).toISOString()) }, batchSize - processed)) {
      if (processed >= batchSize) break;
      if (challenge.photoDeleteBy && Date.parse(challenge.photoDeleteBy) > at.getTime()) continue;
      const result = await deleteChallengePhotos(challenge._id, at, batchSize - processed);
      processed += Math.max(1, result.processed);
    }
    return { processed };
  }
  return { deleteAnalysisPhoto, deleteUploadPhoto, deleteChallengePhotos, deleteExpiredPhotos };
}

async function main() {
  const cloud = require("wx-server-sdk");
  cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
  // Event payload deliberately ignored: callers cannot select files or advance the clock.
  return createPhotoLifecycle({ database: adaptCloudDatabase(cloud.database()), cloud, alert: event => console.error(JSON.stringify(event)) }).deleteExpiredPhotos();
}
module.exports = { MAX_BATCH_SIZE, RETRY_LIMIT, adaptCloudDatabase, createPhotoLifecycle, queueChallengeDeletion, main };
