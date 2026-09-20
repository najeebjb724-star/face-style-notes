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
    const initialCursor = (intent || challenge).photoScanAfter || "";
    let cursor = initialCursor; let wrapped = false; let processed = 0; let scanned = 0;
    while (processed < limit && scanned < batchSize) {
      const page = await list("challenge_photos", { ...filter, ...(cursor ? { _id: database.command.gt(cursor) } : {}) }, Math.min(batchSize - scanned, limit - processed), "_id");
      if (!page.length) {
        if (wrapped || !initialCursor) break;
        cursor = ""; wrapped = true; continue;
      }
      let reachedStart = false;
      for (const photo of page) {
        if (wrapped && photo._id > initialCursor) { reachedStart = true; break; }
        cursor = photo._id;
        scanned++;
        const attempt = await read(database.collection("deletion_jobs").doc(`challenge-photo-${photo._id}`));
        if (attempt?.dueAt > at.toISOString()) continue;
        processed++;
        await removePhoto("challenge-photo", photo, "challenge_photos", photo.fileId,
          { deletionState: "deleted", deletedAt: database.serverDate() }, at);
        if (processed >= limit) break;
      }
      if (reachedStart || (wrapped && cursor >= initialCursor)) break;
    }
    await database.runTransaction(tx => tx.collection(intent ? "deletion_jobs" : "challenges").doc(intent ? `challenge-${id}` : id).update({ photoScanAfter: cursor,
      ...(intent ? { dueAt: new Date(at.getTime() + 60000).toISOString() } : {}) }));
    if ((await list("challenge_photos", filter, 1)).length === 0) {
      if (intent) await write("deletion_jobs", `challenge-${id}`, { state: "deleted" });
      if (challenge) await write("challenges", id, { photosCleaned: true });
    }
    return { processed, scanned };
  }

  async function deleteExpiredPhotos(at = now()) {
    const cutoff = at.toISOString(); const cmd = database.command;
    let processed = 0; let scanned = 0;
    const seen = new Set();
    const scan = async (name, filter, key) => {
      if (scanned >= batchSize) return [];
      const cursorId = `scan-${key}`;
      const checkpoint = await read(database.collection("deletion_jobs").doc(cursorId));
      const after = checkpoint?.after || "";
      let rows = await list(name, { ...filter, ...(after ? { _id: cmd.gt(after) } : {}) }, batchSize - scanned, "_id");
      if (!rows.length && after) rows = await list(name, filter, batchSize - scanned, "_id");
      scanned += rows.length;
      if (rows.length) await database.collection("deletion_jobs").doc(cursorId).set({ after: rows.at(-1)._id });
      return rows;
    };
    const run = async (kind, id, fn) => {
      if (processed >= batchSize || seen.has(`${kind}-${id}`)) return;
      const intent = await read(database.collection("deletion_jobs").doc(`${kind}-${id}`));
      if (intent?.dueAt > cutoff) return;
      seen.add(`${kind}-${id}`); processed++;
      try { await fn(); } catch (_) { alert({ code: "LIFECYCLE_JOB_FAILED", kind, sourceId: id }); }
    };
    const intents = await list("deletion_jobs", { state: cmd.in(["pending", "retrying", "manual_review"]), dueAt: cmd.lte(cutoff) }, Math.max(1, Math.floor(batchSize / 2)), "dueAt");
    for (const intent of intents) {
      if (intent.kind === "analysis") await run("analysis", intent.sourceId, () => deleteAnalysisPhoto(intent.sourceId, at));
      if (intent.kind === "upload") await run("upload", intent.sourceId, () => deleteUploadPhoto(intent.sourceId, at));
    }
    const sources = [
      ["analysis_jobs", { sourcePhotoStatus: "pending", deleteBy: cmd.lte(cutoff) }],
      ["analysis_jobs", { sourcePhotoStatus: "pending", status: "processing", leaseExpiresAt: cmd.lte(cutoff) }],
      ["analysis_jobs", { sourcePhotoStatus: "pending", status: cmd.in(["complete", "failed"]) }],
      ["analysis_jobs", { sourcePhotoStatus: "deleting" }],
      ["analysis_uploads", { status: cmd.in(["pending", "attached"]), deleteBy: cmd.lte(cutoff) }],
      ["analysis_uploads", { status: "deleting" }]
    ];
    const sourceCheckpoint = await read(database.collection("deletion_jobs").doc("scan-source-filter"));
    const start = sourceCheckpoint?.next || 0;
    let next = start;
    for (let offset = 0; offset < sources.length && scanned < batchSize; offset++) {
      const index = (start + offset) % sources.length;
      const [name, filter] = sources[index];
      for (const row of await scan(name, filter, `source-${index}`)) {
        if (name === "analysis_jobs") await run("analysis", row._id, () => deleteAnalysisPhoto(row._id, at));
        else await run(row.jobId ? "analysis" : "upload", row.jobId || row._id, () => deleteUploadPhoto(row._id, at));
      }
      next = (index + 1) % sources.length;
    }
    await database.collection("deletion_jobs").doc("scan-source-filter").set({ next });
    for (const intent of intents) {
      if (processed >= batchSize) break;
      if (intent.kind === "challenge-photo") {
        const photo = await read(database.collection("challenge_photos").doc(intent.sourceId));
        if (photo) await run("challenge-photo", photo._id, () => removePhoto("challenge-photo", photo, "challenge_photos", photo.fileId, { deletionState: "deleted", deletedAt: database.serverDate() }, at));
      }
      if (intent.kind === "challenge" && scanned < batchSize) {
        const result = await deleteChallengePhotos(intent.sourceId, at, Math.min(batchSize - processed, batchSize - scanned));
        processed += result.processed;
        scanned += result.scanned;
      }
    }
    const completedFilter = { status: "completed", photosCleaned: cmd.neq(true), completedAt: cmd.lte(new Date(at.getTime() - WEEK_MS).toISOString()) };
    const completedCursor = await read(database.collection("deletion_jobs").doc("scan-completed-challenges"));
    let completedRows = await list("challenges", { ...completedFilter, ...(completedCursor?.after ? { _id: cmd.gt(completedCursor.after) } : {}) }, 1, "_id");
    if (!completedRows.length && completedCursor?.after) completedRows = await list("challenges", completedFilter, 1, "_id");
    for (const challenge of completedRows) {
      if (processed >= batchSize || scanned >= batchSize) break;
      await database.collection("deletion_jobs").doc("scan-completed-challenges").set({ after: challenge._id });
      if (challenge.photoDeleteBy && Date.parse(challenge.photoDeleteBy) > at.getTime()) continue;
      const result = await deleteChallengePhotos(challenge._id, at, Math.min(batchSize - processed, batchSize - scanned));
      processed += Math.max(1, result.processed);
      scanned += result.scanned;
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
