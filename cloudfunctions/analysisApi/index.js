// analysisApi-build-fingerprint:3c5a342dfa6b4954a3733088e0b41131ba0d8f065f65de62175785ed4fdeeb6b:d308ad2659668494a993e873df81cf911e683d86ca47f84cd38d05f072bd06d4
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
    var { createHash: createHash2 } = require("node:crypto");
    function accountDeletionId(openid) {
      return `account-delete-${createHash2("sha256").update(openid).digest("hex")}`;
    }
    async function assertAccountWritable2(source, openid) {
      let marker;
      try {
        marker = (await source.collection("deletion_jobs").doc(accountDeletionId(openid)).get())?.data || null;
      } catch (error) {
        if (error?.code !== "DATABASE_DOCUMENT_NOT_EXIST" && error?.errCode !== -502005 && !/not[ _-]?exist/i.test(error?.message || "")) throw error;
      }
      if (marker?.state === "deleting") {
        const error = new Error("ACCOUNT_DELETION_IN_PROGRESS");
        error.code = "ACCOUNT_DELETION_IN_PROGRESS";
        throw error;
      }
    }
    module2.exports = { accountDeletionId, assertAccountWritable: assertAccountWritable2, assertOwnedRecord: assertOwnedRecord2 };
  }
});

// ../lifecycleJobs/index.js
var require_lifecycleJobs = __commonJS({
  "../lifecycleJobs/index.js"(exports2, module2) {
    var MAX_BATCH_SIZE = 50;
    var RETRY_LIMIT = 3;
    var WEEK_MS = 7 * 24 * 60 * 60 * 1e3;
    var { randomUUID: randomUUID2, createHash: createHash2 } = require("node:crypto");
    function adaptCloudDatabase2(database) {
      const collections = (source) => (name) => {
        const collection = source.collection(name);
        return {
          where: (filter) => collection.where(filter),
          doc: (id) => {
            const reference = collection.doc(id);
            return {
              get: () => reference.get(),
              remove: () => reference.remove(),
              set: (data) => reference.set({ data }),
              update: (data) => reference.update({ data })
            };
          }
        };
      };
      return {
        collection: collections(database),
        command: database.command,
        serverDate: () => database.serverDate(),
        runTransaction: (callback) => database.runTransaction((tx) => callback({ collection: collections(tx) }))
      };
    }
    function codedError2(code) {
      return Object.assign(new Error(code), { code });
    }
    function requireId2(value) {
      if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw codedError2("INVALID_ARGUMENT");
      return value;
    }
    async function read(reference) {
      try {
        return (await reference.get())?.data || null;
      } catch (error) {
        if (error?.code === "DATABASE_DOCUMENT_NOT_EXIST" || error?.errCode === -502005 || /not[ _-]?exist/i.test(error?.message || "")) return null;
        throw error;
      }
    }
    async function queueChallengeDeletion(transaction, database, challenge, at) {
      await transaction.collection("deletion_jobs").doc(`challenge-${challenge._id}`).set({
        kind: "challenge",
        sourceId: challenge._id,
        _openid: challenge._openid,
        state: "pending",
        attempts: 0,
        dueAt: at.toISOString(),
        deleteAll: true,
        createdAt: database.serverDate()
      });
    }
    function createPhotoLifecycle({ database, cloud, now = () => /* @__PURE__ */ new Date(), alert = () => {
    }, maxBatchSize = MAX_BATCH_SIZE }) {
      if (!database || typeof cloud?.deleteFile !== "function") throw codedError2("INVALID_CONFIGURATION");
      const batchSize = Math.min(MAX_BATCH_SIZE, Math.max(1, maxBatchSize));
      const list = async (name, filter, limit = batchSize, order) => {
        if (limit <= 0) return [];
        let query = database.collection(name).where(filter);
        if (order) query = query.orderBy(order, "asc");
        return (await query.limit(limit).get()).data || [];
      };
      const write = (name, id, data) => database.runTransaction((tx) => tx.collection(name).doc(id).update(data));
      async function removePhoto(kind, source, collection, fileId, deletedChanges, at) {
        const id = `${kind}-${source._id}`;
        const existing = await read(database.collection("deletion_jobs").doc(id));
        if (existing?.state === "deleted") return { deleted: true };
        if (existing?.leaseUntil > at.toISOString()) return { deleted: false, state: existing.state };
        const claimed = await database.runTransaction(async (tx) => {
          const reference = tx.collection("deletion_jobs").doc(id);
          const current = await read(reference);
          if (current?.state === "deleted" || current?.leaseUntil > at.toISOString()) return null;
          const intent = {
            kind,
            sourceId: source._id,
            _openid: source._openid,
            state: current?.state || "pending",
            attempts: (current?.attempts || 0) + 1,
            dueAt: new Date(at.getTime() + 6e4).toISOString(),
            leaseUntil: new Date(at.getTime() + 6e4).toISOString(),
            updatedAt: database.serverDate()
          };
          await reference.set(intent);
          return intent;
        });
        if (!claimed) return { deleted: false };
        let success = false;
        try {
          if (typeof fileId !== "string" || !fileId.startsWith("cloud://")) throw codedError2("FILE_ID_MISSING");
          const result = await cloud.deleteFile({ fileList: [fileId] });
          success = result?.fileList?.length === 1 && result.fileList[0].fileID === fileId && result.fileList[0].status === 0;
        } catch (_) {
        }
        const state = success ? "deleted" : claimed.attempts >= RETRY_LIMIT ? "manual_review" : "retrying";
        await database.runTransaction(async (tx) => {
          await tx.collection("deletion_jobs").doc(id).update({
            state,
            leaseUntil: null,
            lastError: success ? null : "PHOTO_DELETE_FAILED",
            updatedAt: database.serverDate()
          });
          await tx.collection(collection).doc(source._id).update(success ? deletedChanges : {
            ...kind === "analysis" ? { sourcePhotoStatus: state === "manual_review" ? state : "deleting" } : { deletionState: state }
          });
        });
        if (!success) alert({ code: "PHOTO_DELETE_FAILED", kind, sourceId: source._id, state, attempts: claimed.attempts });
        return { deleted: success, state };
      }
      async function deleteAnalysisPhoto(jobId, at = now()) {
        const job = await database.runTransaction(async (tx) => {
          const reference = tx.collection("analysis_jobs").doc(requireId2(jobId));
          const current = await read(reference);
          if (!current) throw codedError2("INVALID_STATUS");
          if (current.sourcePhotoStatus === "deleted" || current.photoDeletedAt) return current;
          const expired = Date.parse(current.deleteBy) <= at.getTime();
          const leaseExpired = current.status === "processing" && Date.parse(current.leaseExpiresAt) <= at.getTime();
          if (!["complete", "failed"].includes(current.status)) {
            if (!expired && !leaseExpired) throw codedError2("NOT_DUE");
            await reference.update({ status: "failed", errorCode: leaseExpired ? "LEASE_EXPIRED" : "PHOTO_EXPIRED", sourcePhotoStatus: "deleting" });
          }
          return current;
        });
        if (job.sourcePhotoStatus === "deleted" || job.photoDeletedAt) return { deleted: true };
        const outcome = await removePhoto(
          "analysis",
          job,
          "analysis_jobs",
          job.tempFileId,
          { sourcePhotoStatus: "deleted", photoDeletedAt: database.serverDate() },
          at
        );
        if (outcome.deleted && job.reservationId) {
          const upload = await read(database.collection("analysis_uploads").doc(job.reservationId));
          if (upload && upload._openid === job._openid && upload.jobId === jobId && upload.tempFileId === job.tempFileId) {
            await write("analysis_uploads", upload._id, { status: "deleted", photoDeletedAt: database.serverDate() });
          }
        }
        return outcome;
      }
      async function deleteUploadPhoto(reservationId, at = now()) {
        const upload = await read(database.collection("analysis_uploads").doc(requireId2(reservationId)));
        if (!upload || upload.status === "deleted") return { deleted: true };
        if (upload.jobId) {
          const job = await read(database.collection("analysis_jobs").doc(requireId2(upload.jobId)));
          if (!job || job._openid !== upload._openid || job.reservationId !== reservationId || job.tempFileId !== upload.tempFileId) throw codedError2("INVALID_STATUS");
          return deleteAnalysisPhoto(upload.jobId, at);
        }
        if (upload.status !== "deleting" && !(Date.parse(upload.deleteBy) <= at.getTime())) throw codedError2("NOT_DUE");
        return removePhoto(
          "upload",
          upload,
          "analysis_uploads",
          upload.tempFileId,
          { status: "deleted", deletionState: "deleted", photoDeletedAt: database.serverDate() },
          at
        );
      }
      async function deleteChallengePhotos(challengeId, at = now(), limit = batchSize) {
        const id = requireId2(challengeId);
        const intent = await read(database.collection("deletion_jobs").doc(`challenge-${id}`));
        const challenge = await read(database.collection("challenges").doc(id));
        const owner = intent?._openid || challenge?._openid;
        if (!owner) return { processed: 0 };
        const deleteAll = intent?.deleteAll === true;
        const deadline = challenge?.photoDeleteBy ? Date.parse(challenge.photoDeleteBy) : Date.parse(challenge?.completedAt) + WEEK_MS;
        if (!deleteAll && (challenge?.status !== "completed" || !Number.isFinite(deadline) || deadline > at.getTime())) throw codedError2("NOT_DUE");
        const cursorCollection = intent ? "deletion_jobs" : "challenges";
        const cursorId = intent ? `challenge-${id}` : id;
        const token = randomUUID2();
        const acquired = await database.runTransaction(async (tx) => {
          const reference = tx.collection(cursorCollection).doc(cursorId);
          const current = await read(reference);
          if (current?.photoScanLeaseUntil > at.toISOString()) return false;
          await reference.update({ photoScanLeaseToken: token, photoScanLeaseUntil: new Date(at.getTime() + 6e4).toISOString() });
          return true;
        });
        if (!acquired) return { processed: 0, scanned: 0 };
        try {
          const filter = { challengeId: id, _openid: owner, deletionState: database.command.neq("deleted") };
          if (!deleteAll) filter.retentionPolicy = database.command.neq("keep");
          const initialCursor = (intent || challenge).photoScanAfter || "";
          let cursor = initialCursor;
          let wrapped = false;
          let processed = 0;
          let scanned = 0;
          while (processed < limit && scanned < batchSize) {
            const page = await list("challenge_photos", { ...filter, ...cursor ? { _id: database.command.gt(cursor) } : {} }, Math.min(batchSize - scanned, limit - processed), "_id");
            if (!page.length) {
              if (wrapped || !initialCursor) break;
              cursor = "";
              wrapped = true;
              continue;
            }
            let reachedStart = false;
            for (const photo of page) {
              if (wrapped && photo._id > initialCursor) {
                reachedStart = true;
                break;
              }
              cursor = photo._id;
              scanned++;
              const attempt = await read(database.collection("deletion_jobs").doc(`challenge-photo-${photo._id}`));
              if (attempt?.dueAt > at.toISOString()) continue;
              processed++;
              await removePhoto(
                "challenge-photo",
                photo,
                "challenge_photos",
                photo.fileId,
                { deletionState: "deleted", deletedAt: database.serverDate() },
                at
              );
              if (processed >= limit) break;
            }
            if (reachedStart || wrapped && cursor >= initialCursor) break;
          }
          await database.runTransaction((tx) => tx.collection(cursorCollection).doc(cursorId).update({
            photoScanAfter: cursor,
            ...intent ? { dueAt: new Date(at.getTime() + 6e4).toISOString() } : {}
          }));
          if ((await list("challenge_photos", filter, 1)).length === 0) {
            if (intent) await write("deletion_jobs", `challenge-${id}`, { state: "deleted" });
            if (challenge) await write("challenges", id, { photosCleaned: true });
          }
          return { processed, scanned };
        } finally {
          await database.runTransaction(async (tx) => {
            const reference = tx.collection(cursorCollection).doc(cursorId);
            if ((await read(reference))?.photoScanLeaseToken === token) await reference.update({ photoScanLeaseUntil: null, photoScanLeaseToken: null });
          });
        }
      }
      async function runExpiredPhotos(at) {
        const cutoff = at.toISOString();
        const cmd = database.command;
        let processed = 0;
        let scanned = 0;
        const seen = /* @__PURE__ */ new Set();
        for (const preview of await list("share_previews", { expiresAt: cmd.lte(cutoff) }, Math.max(1, Math.floor(batchSize / 4)), "expiresAt")) {
          await database.runTransaction(async (tx) => {
            const reference = tx.collection("share_previews").doc(preview._id);
            const current = await read(reference);
            if (!current || current.expiresAt > cutoff) return;
            for (const fileId of [...new Set(current.miniCodeFileIds || [])]) {
              const id = `account-file-${createHash2("sha256").update(JSON.stringify([current._openid, fileId])).digest("hex")}`;
              const intent = tx.collection("deletion_jobs").doc(id);
              if (!await read(intent)) await intent.set({ kind: "account-file", _openid: current._openid, fileId, state: "pending", attempts: 0, dueAt: cutoff, createdAt: cutoff });
            }
            await reference.remove();
          });
          scanned++;
        }
        const scan = async (name, filter, key) => {
          if (scanned >= batchSize) return [];
          const cursorId = `scan-${key}`;
          const checkpoint = await read(database.collection("deletion_jobs").doc(cursorId));
          const after = checkpoint?.after || "";
          let rows = await list(name, { ...filter, ...after ? { _id: cmd.gt(after) } : {} }, batchSize - scanned, "_id");
          if (!rows.length && after) rows = await list(name, filter, batchSize - scanned, "_id");
          scanned += rows.length;
          if (rows.length) await database.collection("deletion_jobs").doc(cursorId).set({ after: rows.at(-1)._id });
          return rows;
        };
        const run = async (kind, id, fn) => {
          if (processed >= batchSize || seen.has(`${kind}-${id}`)) return;
          const intent = await read(database.collection("deletion_jobs").doc(`${kind}-${id}`));
          if (intent?.dueAt > cutoff) return;
          seen.add(`${kind}-${id}`);
          processed++;
          try {
            await fn();
          } catch (_) {
            alert({ code: "LIFECYCLE_JOB_FAILED", kind, sourceId: id });
          }
        };
        const intentFilter = { state: cmd.in(["pending", "retrying", "manual_review"]), dueAt: cmd.lte(cutoff) };
        const accountIntents = await list("deletion_jobs", { ...intentFilter, kind: "account-file" }, Math.max(1, Math.floor(batchSize / 4)), "dueAt");
        const challengeIntents = await list("deletion_jobs", { ...intentFilter, kind: "challenge" }, Math.max(1, Math.floor(batchSize / 4)), "dueAt");
        const intentCursor = await read(database.collection("deletion_jobs").doc("scan-deletion-intents"));
        const afterIntent = intentCursor?.after || "";
        const otherFilter = { ...intentFilter, kind: cmd.neq("account-file"), ...afterIntent ? { _id: cmd.gt(afterIntent) } : {} };
        let otherIntents = await list("deletion_jobs", otherFilter, Math.max(1, Math.floor(batchSize / 2)), "_id");
        if (!otherIntents.length && afterIntent) otherIntents = await list("deletion_jobs", { ...intentFilter, kind: cmd.neq("account-file") }, Math.max(1, Math.floor(batchSize / 2)), "_id");
        if (otherIntents.length) await database.collection("deletion_jobs").doc("scan-deletion-intents").set({ after: otherIntents.at(-1)._id });
        const intents = [...new Map([...accountIntents, ...challengeIntents, ...otherIntents].map((intent) => [intent._id, intent])).values()];
        for (const intent of intents) {
          if (intent.kind === "account-file") {
            if (processed >= batchSize) break;
            processed++;
            const claimed = await database.runTransaction(async (tx) => {
              const reference = tx.collection("deletion_jobs").doc(intent._id);
              const current = await read(reference);
              if (!current || current.state === "deleted" || current.leaseUntil > cutoff) return null;
              const changes = { attempts: (current.attempts || 0) + 1, leaseUntil: new Date(at.getTime() + 6e4).toISOString(), dueAt: new Date(at.getTime() + 6e4).toISOString() };
              await reference.update(changes);
              return { ...current, ...changes };
            });
            if (!claimed) continue;
            let deleted = false;
            try {
              if (typeof claimed.fileId === "string" && claimed.fileId.startsWith("cloud://")) {
                const result = await cloud.deleteFile({ fileList: [claimed.fileId] });
                deleted = result?.fileList?.length === 1 && result.fileList[0].fileID === claimed.fileId && result.fileList[0].status === 0;
              }
            } catch (_) {
            }
            const state = deleted ? "deleted" : claimed.attempts >= RETRY_LIMIT ? "manual_review" : "retrying";
            await write("deletion_jobs", intent._id, { state, leaseUntil: null, lastError: deleted ? null : "PHOTO_DELETE_FAILED", updatedAt: cutoff });
            if (!deleted) alert({ code: "PHOTO_DELETE_FAILED", kind: "account-file", sourceId: intent._id, state, attempts: claimed.attempts });
          }
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
            else {
              processed++;
              await write("deletion_jobs", intent._id, { state: "manual_review", lastError: "SOURCE_MISSING", updatedAt: cutoff });
            }
          }
          if (intent.kind === "challenge" && scanned < batchSize) {
            const result = await deleteChallengePhotos(intent.sourceId, at, Math.min(batchSize - processed, batchSize - scanned));
            processed += result.processed;
            scanned += result.scanned;
          }
        }
        const completedFilter = { status: "completed", photosCleaned: cmd.neq(true), completedAt: cmd.lte(new Date(at.getTime() - WEEK_MS).toISOString()) };
        const completedCursor = await read(database.collection("deletion_jobs").doc("scan-completed-challenges"));
        let completedRows = await list("challenges", { ...completedFilter, ...completedCursor?.after ? { _id: cmd.gt(completedCursor.after) } : {} }, 1, "_id");
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
      async function deleteExpiredPhotos(at = now()) {
        const token = randomUUID2();
        const lockId = "lifecycle-scheduler";
        const acquired = await database.runTransaction(async (tx) => {
          const reference = tx.collection("deletion_jobs").doc(lockId);
          const current = await read(reference);
          if (current?.leaseUntil > at.toISOString()) return false;
          await reference.set({ token, leaseUntil: new Date(at.getTime() + 6e4).toISOString() });
          return true;
        });
        if (!acquired) return { processed: 0 };
        try {
          return await runExpiredPhotos(at);
        } finally {
          await database.runTransaction(async (tx) => {
            const reference = tx.collection("deletion_jobs").doc(lockId);
            if ((await read(reference))?.token === token) await reference.update({ leaseUntil: null });
          });
        }
      }
      return { deleteAnalysisPhoto, deleteUploadPhoto, deleteChallengePhotos, deleteExpiredPhotos };
    }
    async function main() {
      const cloud = require("wx-server-sdk");
      cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
      return createPhotoLifecycle({ database: adaptCloudDatabase2(cloud.database()), cloud, alert: (event) => console.error(JSON.stringify(event)) }).deleteExpiredPhotos();
    }
    module2.exports = { MAX_BATCH_SIZE, RETRY_LIMIT, adaptCloudDatabase: adaptCloudDatabase2, createPhotoLifecycle, queueChallengeDeletion, main };
  }
});

// src/index.js
var { createHash, randomBytes, randomUUID, timingSafeEqual } = require("node:crypto");
var { assertAccountWritable, assertOwnedRecord } = require_cloud_guards();
var { createPhotoLifecycle: createPhotoCleanup, adaptCloudDatabase } = require_lifecycleJobs();
function distance(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}
function safeDivide(numerator, denominator, fallback = 0) {
  return Number.isFinite(numerator) && Number.isFinite(denominator) && denominator !== 0 ? numerator / denominator : fallback;
}
function averagePoint(points, indexes) {
  return { x: indexes.reduce((sum, index) => sum + points[index].x, 0) / indexes.length, y: indexes.reduce((sum, index) => sum + points[index].y, 0) / indexes.length };
}
function angleDegrees(a, b) {
  return Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
}
function round(value, digits = 2) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round((value + Math.sign(value || 1) * Number.EPSILON) * factor) / factor;
}
var confidenceRank = { low: 0, medium: 1, high: 2 };
var capConfidence = (value, cap) => confidenceRank[value] > confidenceRank[cap] ? cap : value;
function capMeasurementConfidence(value, cap) {
  if (Array.isArray(value)) return value.map((item) => capMeasurementConfidence(item, cap));
  if (!value || typeof value !== "object") return value;
  const next = { ...value };
  if (next.confidence) next.confidence = capConfidence(next.confidence, cap);
  Object.keys(next).forEach((key) => {
    if (key !== "confidence") next[key] = capMeasurementConfidence(next[key], cap);
  });
  return next;
}
function inferQuestionnaire(answers = {}) {
  const skinMap = { tight: "dry", comfortable: "normal", tzone: "combination", allOver: "oily" };
  const required = ["postCleanse", "reactivity", "primaryGoal", "dailyMinutes", "hairMaintenance", "monthlyBudget"];
  return {
    complete: required.every((key) => answers[key] !== void 0 && answers[key] !== ""),
    skinTendency: skinMap[answers.postCleanse] || null,
    sensitivityTendency: answers.reactivity === "often" ? "sensitive" : answers.reactivity === "sometimes" ? "possible" : answers.reactivity === "rarely" ? "low" : null,
    primaryGoal: answers.primaryGoal || null,
    dailyMinutes: Number(answers.dailyMinutes) || null,
    hairMaintenance: answers.hairMaintenance || null,
    monthlyBudget: answers.monthlyBudget || null
  };
}
var KNOWLEDGE_BASE = Object.freeze({
  sources: {
    interEthnicReview: { title: "\u8DE8\u65CF\u7FA4\u9762\u90E8\u5C3A\u5BF8\u7CFB\u7EDF\u7EFC\u8FF0", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC3074358/", type: "research" },
    southernChineseCanons: { title: "\u534E\u5357\u6210\u4EBA\u65B0\u53E4\u5178\u9762\u90E8\u6BD4\u4F8B\u7814\u7A76", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC3532441/", type: "research" },
    photoStandard: { title: "\u6807\u51C6\u5316\u9762\u90E8\u6444\u5F71\u6307\u5357", url: "https://www.imi.org.uk/wp-content/uploads/2022/03/NG_Dental_Photo_2_0_S.pdf", type: "guideline" },
    aadBasics: { title: "\u7F8E\u56FD\u76AE\u80A4\u79D1\u5B66\u4F1A\u57FA\u7840\u62A4\u80A4\u5EFA\u8BAE", url: "https://www.aad.org/public/everyday-care/skin-care-basics/care/skin-care-budget", type: "guideline" },
    faceApi: { title: "Face-API.js 68 \u70B9\u8BF4\u660E", url: "https://github.com/justadudewhohacks/face-api.js/", type: "implementation" }
  },
  metrics: {
    face_length_width: { formulaText: "\u4F30\u7B97\u53D1\u9645\u7EBF\u81F3\u4E0B\u5DF4\u957F\u5EA6 \xF7 \u9762\u5BBD", referenceType: "\u4EA7\u54C1\u542F\u53D1\u5F0F\u89E3\u91CA\u5E26", sourceIds: ["interEthnicReview", "faceApi"] },
    cheek_face_width: { formulaText: "\u98A7\u533A\u53EF\u89C1\u5BBD\u5EA6 \xF7 \u9762\u5BBD", referenceType: "\u7167\u7247\u5185\u5F52\u4E00\u5316\u51E0\u4F55", sourceIds: ["faceApi"] },
    jaw_face_width: { formulaText: "\u4E0B\u988C\u8F6C\u6298\u5BBD\u5EA6 \xF7 \u9762\u5BBD", referenceType: "\u7167\u7247\u5185\u5F52\u4E00\u5316\u51E0\u4F55", sourceIds: ["faceApi"] },
    chin_face_width: { formulaText: "\u4E0B\u5DF4\u4E24\u4FA7\u5BBD\u5EA6 \xF7 \u9762\u5BBD", referenceType: "\u7167\u7247\u5185\u5F52\u4E00\u5316\u51E0\u4F55", sourceIds: ["faceApi"] },
    eye_spacing: { formulaText: "\u5185\u773C\u89D2\u8DDD\u79BB \xF7 \u5E73\u5747\u773C\u5BBD", referenceType: "\u53E4\u5178\u4E94\u773C\u89C6\u89C9\u53C2\u7167", sourceIds: ["southernChineseCanons"] },
    left_eye_side_space: { formulaText: "\u5916\u773C\u89D2\u81F3\u53EF\u89C1\u8138\u7F18\u8DDD\u79BB \xF7 \u5E73\u5747\u773C\u5BBD", referenceType: "\u7167\u7247\u5185\u4E94\u773C\u7559\u767D\u4EE3\u7406", sourceIds: ["southernChineseCanons", "faceApi"] },
    right_eye_side_space: { formulaText: "\u5916\u773C\u89D2\u81F3\u53EF\u89C1\u8138\u7F18\u8DDD\u79BB \xF7 \u5E73\u5747\u773C\u5BBD", referenceType: "\u7167\u7247\u5185\u4E94\u773C\u7559\u767D\u4EE3\u7406", sourceIds: ["southernChineseCanons", "faceApi"] },
    eye_aspect_left: { formulaText: "\u5DE6\u773C\u5782\u76F4\u5F00\u5408 \xF7 \u5DE6\u773C\u5BBD", referenceType: "\u7167\u7247\u5185\u5F52\u4E00\u5316\u51E0\u4F55", sourceIds: ["faceApi"] },
    eye_aspect_right: { formulaText: "\u53F3\u773C\u5782\u76F4\u5F00\u5408 \xF7 \u53F3\u773C\u5BBD", referenceType: "\u7167\u7247\u5185\u5F52\u4E00\u5316\u51E0\u4F55", sourceIds: ["faceApi"] },
    canthal_tilt: { formulaText: "\u53CC\u773C\u5185\u5916\u773C\u89D2\u8FDE\u7EBF\u7684\u5E73\u5747\u89D2\u5EA6", referenceType: "\u9020\u578B\u65B9\u5411\u53C2\u8003", sourceIds: ["faceApi", "photoStandard"] },
    brow_tilt: { formulaText: "\u5DE6\u53F3\u7709\u9996\u5C3E\u8FDE\u7EBF\u7684\u5E73\u5747\u89D2\u5EA6", referenceType: "\u9020\u578B\u65B9\u5411\u53C2\u8003", sourceIds: ["faceApi"] },
    brow_eye_distance: { formulaText: "\u7709\u773C\u4E2D\u5FC3\u8DDD\u79BB \xF7 \u5E73\u5747\u773C\u5BBD", referenceType: "\u7167\u7247\u5185\u5F52\u4E00\u5316\u51E0\u4F55", sourceIds: ["faceApi"] },
    eye_size_difference: { formulaText: "\u5DE6\u53F3\u773C\u5BBD\u5DEE \xF7 \u5E73\u5747\u773C\u5BBD", referenceType: "\u62CD\u6444\u654F\u611F\u6307\u6807", sourceIds: ["photoStandard"] },
    nose_face_width: { formulaText: "\u9F3B\u7FFC\u5BBD\u5EA6 \xF7 \u9762\u5BBD", referenceType: "\u7167\u7247\u5185\u5F52\u4E00\u5316\u51E0\u4F55", sourceIds: ["interEthnicReview", "faceApi"] },
    nose_eye_spacing: { formulaText: "\u9F3B\u7FFC\u5BBD\u5EA6 \xF7 \u5185\u773C\u89D2\u8DDD\u79BB", referenceType: "\u7167\u7247\u5185\u5F52\u4E00\u5316\u51E0\u4F55", sourceIds: ["faceApi"] },
    mouth_face_width: { formulaText: "\u5634\u89D2\u5BBD\u5EA6 \xF7 \u9762\u5BBD", referenceType: "\u7167\u7247\u5185\u5F52\u4E00\u5316\u51E0\u4F55", sourceIds: ["interEthnicReview", "faceApi"] },
    upper_lower_lip: { formulaText: "\u4E0A\u5507\u53EF\u89C1\u9AD8\u5EA6 \xF7 \u4E0B\u5507\u53EF\u89C1\u9AD8\u5EA6", referenceType: "\u8868\u60C5\u654F\u611F\u6307\u6807", sourceIds: ["faceApi"] },
    mouth_tilt: { formulaText: "\u4E24\u4FA7\u5634\u89D2\u8FDE\u7EBF\u89D2\u5EA6", referenceType: "\u8868\u60C5\u4E0E\u62CD\u6444\u654F\u611F\u6307\u6807", sourceIds: ["photoStandard"] },
    jaw_curve: { formulaText: "\u4E0B\u988C\u6298\u7EBF\u8DEF\u5F84 \xF7 \u4E24\u4FA7\u4E0B\u988C\u76F4\u7EBF\u8DDD\u79BB", referenceType: "\u8F6E\u5ED3\u66F2\u7EBF\u4EE3\u7406", sourceIds: ["faceApi"] },
    symmetry: { formulaText: "\u6210\u5BF9\u5173\u952E\u70B9\u955C\u50CF\u6B8B\u5DEE\u7684\u5E73\u5747\u503C", referenceType: "\u62CD\u6444\u654F\u611F\u7684\u4E8C\u7EF4\u4EE3\u7406", sourceIds: ["photoStandard", "faceApi"] },
    court_upper: { formulaText: "\u4F30\u7B97\u53D1\u9645\u7EBF\u81F3\u9F3B\u6839 \xF7 \u4E09\u5EAD\u603B\u957F", referenceType: "\u4F4E\u53EF\u4FE1\u5EA6\u4F30\u7B97", sourceIds: ["interEthnicReview", "southernChineseCanons"] },
    court_middle: { formulaText: "\u9F3B\u6839\u81F3\u9F3B\u5E95 \xF7 \u4E09\u5EAD\u603B\u957F", referenceType: "\u53E4\u5178\u4E09\u5EAD\u89C6\u89C9\u53C2\u7167", sourceIds: ["interEthnicReview", "southernChineseCanons"] },
    court_lower: { formulaText: "\u9F3B\u5E95\u81F3\u4E0B\u5DF4 \xF7 \u4E09\u5EAD\u603B\u957F", referenceType: "\u53E4\u5178\u4E09\u5EAD\u89C6\u89C9\u53C2\u7167", sourceIds: ["interEthnicReview", "southernChineseCanons"] }
  },
  styleRules: {
    eye_concentrated: { evidenceType: "styling", advice: "\u7709\u5934\u51CF\u6DE1\uFF0C\u773C\u5C3E\u53EF\u9002\u5EA6\u5411\u5916\u5EF6\u4F38 2\u20133 \u6BEB\u7C73", avoid: "\u4E0D\u8981\u540C\u65F6\u52A0\u91CD\u7709\u5934\u4E0E\u773C\u5934", sourceIds: [] },
    eye_spacious: { evidenceType: "styling", advice: "\u7709\u5934\u53EF\u81EA\u7136\u524D\u79FB\uFF0C\u773C\u5934\u589E\u52A0\u5C11\u91CF\u4EAE\u5EA6\u548C\u7EBF\u6761", avoid: "\u907F\u514D\u7EE7\u7EED\u62C9\u957F\u5916\u773C\u7EBF", sourceIds: [] },
    eye_reference: { evidenceType: "styling", advice: "\u4FDD\u6301\u773C\u7EBF\u4E0E\u7709\u5F62\u7684\u81EA\u7136\u957F\u5EA6\uFF0C\u5148\u7528\u660E\u6697\u6D4B\u8BD5\u91CD\u5FC3", limitation: "\u5C5E\u4E8E\u9020\u578B\u7ECF\u9A8C\uFF0C\u4E0D\u4EE3\u8868\u4F18\u52A3", sourceIds: [] },
    middle_long: { evidenceType: "styling", advice: "\u816E\u7EA2\u6A2A\u5411\u8F7B\u626B\uFF0C\u5367\u8695\u9002\u5EA6\u63D0\u4EAE\uFF0C\u7709\u6BDB\u907F\u514D\u8FC7\u5EA6\u9AD8\u6311", avoid: "\u907F\u514D\u628A\u9F3B\u5F71\u62C9\u5F97\u8FC7\u957F", sourceIds: [] },
    face_long: { evidenceType: "styling", advice: "\u7528\u5218\u6D77\u3001\u8138\u4FA7\u5C42\u6B21\u6216\u6A2A\u5411\u816E\u7EA2\u5206\u6BB5\u7EB5\u5411\u89C6\u89C9", avoid: "\u907F\u514D\u5934\u9876\u548C\u7EB5\u5411\u7EBF\u6761\u540C\u65F6\u8FC7\u5EA6\u62C9\u9AD8", sourceIds: [] },
    face_wide: { evidenceType: "styling", advice: "\u7528\u9501\u9AA8\u3001\u9886\u53E3\u548C\u8138\u4FA7\u7EB5\u5411\u5C42\u6B21\u589E\u52A0\u65B9\u5411\u611F", avoid: "\u907F\u514D\u4E24\u4FA7\u540C\u65F6\u5806\u79EF\u539A\u91CD\u4F53\u79EF", sourceIds: [] },
    canthal_up: { evidenceType: "styling", advice: "\u773C\u7EBF\u6CBF\u539F\u751F\u8D70\u5411\u8F7B\u6536\u5C3E\uFF0C\u5507\u988A\u4FDD\u6301\u67D4\u548C", limitation: "\u773C\u89D2\u65B9\u5411\u4F1A\u53D7\u8868\u60C5\u548C\u62CD\u6444\u89D2\u5EA6\u5F71\u54CD", sourceIds: [] },
    canthal_down: { evidenceType: "styling", advice: "\u5916\u773C\u89D2\u4E0A\u65B9\u589E\u52A0\u5C11\u91CF\u776B\u6BDB\u4E0E\u9634\u5F71\uFF0C\u4E0D\u5FC5\u5F3A\u884C\u4E0A\u6311", limitation: "\u773C\u89D2\u65B9\u5411\u4F1A\u53D7\u8868\u60C5\u548C\u62CD\u6444\u89D2\u5EA6\u5F71\u54CD", sourceIds: [] },
    brow_direction: { evidenceType: "styling", advice: "\u987A\u7740\u7709\u9AA8\u65B9\u5411\u6574\u7406\u7709\u5CF0\uFF0C\u5148\u51CF\u5C11\u800C\u975E\u65B0\u589E\u7EBF\u6761", limitation: "\u7709\u6BDB\u53EF\u5851\u6027\u9AD8\uFF0C\u5EFA\u8BAE\u9010\u6B65\u8BD5\u9A8C", sourceIds: [] },
    nose_contour: { evidenceType: "styling", advice: "\u9F3B\u5F71\u63A7\u5236\u5728\u773C\u7A9D\u81F3\u9F3B\u7FFC\u7684\u81EA\u7136\u8F6C\u6298\u5185\uFF0C\u5C11\u91CF\u591A\u6B21", avoid: "\u907F\u514D\u4E00\u6761\u6DF1\u8272\u76F4\u7EBF\u8D2F\u7A7F\u9F3B\u6881", sourceIds: [] },
    lip_emphasis: { evidenceType: "styling", advice: "\u5728\u773C\u5986\u8F83\u8F7B\u65F6\u7528\u5507\u8272\u5EFA\u7ACB\u4E00\u4E2A\u6E05\u6670\u91CD\u70B9", avoid: "\u907F\u514D\u773C\u5507\u540C\u65F6\u4F7F\u7528\u6700\u9AD8\u5BF9\u6BD4", sourceIds: [] },
    jaw_framing: { evidenceType: "styling", advice: "\u7528\u8138\u4FA7\u788E\u53D1\u3001\u8033\u9970\u548C\u9886\u53E3\u63A7\u5236\u4E0B\u534A\u8138\u7684\u7EBF\u6761\u5BC6\u5EA6", limitation: "\u8F6E\u5ED3\u5EFA\u8BAE\u53D6\u51B3\u4E8E\u53D1\u91CF\u548C\u5B9E\u9645\u4FA7\u9762\u7ED3\u6784", sourceIds: [] },
    feature_light: { evidenceType: "styling", advice: "\u4F7F\u7528\u4F4E\u5BF9\u6BD4\u3001\u8FB9\u7F18\u67D4\u548C\u7684\u989C\u8272\uFF0C\u4FDD\u7559\u76AE\u80A4\u7559\u767D", avoid: "\u907F\u514D\u6BCF\u4E2A\u4E94\u5B98\u540C\u65F6\u52A0\u6DF1\u8F6E\u5ED3", sourceIds: [] },
    feature_strong: { evidenceType: "styling", advice: "\u53EF\u627F\u63A5\u66F4\u6E05\u6670\u7684\u7709\u773C\u6216\u5507\u90E8\u91CD\u70B9\uFF0C\u4F46\u4E00\u6B21\u53EA\u9009\u4E00\u4E2A", avoid: "\u907F\u514D\u591A\u4E2A\u9AD8\u5BF9\u6BD4\u91CD\u70B9\u4E92\u76F8\u7ADE\u4E89", sourceIds: [] }
  },
  careRules: {
    base: { evidenceType: "care", morning: ["\u6309\u51FA\u6CB9\u611F\u53D7\u9009\u62E9\u6E05\u6C34\u6216\u6E29\u548C\u6E05\u6D01", "\u4FDD\u6E7F", "\u5E7F\u8C31 SPF 30+ \u9632\u6652"], evening: ["\u6E29\u548C\u6E05\u6D01", "\u4FDD\u6E7F"], sourceIds: ["aadBasics"] },
    sensitive: { evidenceType: "care", advice: "\u4E00\u6B21\u53EA\u65B0\u589E\u4E00\u79CD\u4EA7\u54C1\uFF0C\u5148\u505A\u5C0F\u8303\u56F4\u8BD5\u7528\uFF1B\u6301\u7EED\u523A\u75DB\u3001\u7EA2\u80BF\u6216\u76AE\u75B9\u65F6\u505C\u6B62\u5E76\u54A8\u8BE2\u76AE\u80A4\u79D1\u533B\u751F", sourceIds: ["aadBasics"] }
  }
});
var metric = (id, value, unit, extra = {}) => {
  const knowledge = KNOWLEDGE_BASE.metrics[id] || {};
  return {
    id,
    value: round(value, extra.digits ?? 2),
    unit,
    evidenceType: "geometry",
    confidence: extra.confidence || "high",
    ...knowledge,
    ...extra
  };
};
function computeRegionalSymmetry(points, faceWidth, qualityLevel) {
  const midX = (points[27].x + points[8].x) / 2;
  const regions = {
    eyes: [[36, 45], [37, 44], [38, 43], [39, 42], [40, 47], [41, 46]],
    brows: [[17, 26], [18, 25], [19, 24], [20, 23], [21, 22]],
    mouth: [[48, 54], [49, 53], [50, 52], [59, 55], [58, 56]],
    jaw: [[0, 16], [2, 14], [4, 12], [6, 10]]
  };
  const regionValues = {};
  Object.entries(regions).forEach(([name, pairs]) => {
    regionValues[name] = pairs.reduce((sum, [left, right]) => {
      const horizontal = points[left].x + points[right].x - 2 * midX;
      const vertical = points[left].y - points[right].y;
      return sum + Math.hypot(horizontal, vertical) / faceWidth;
    }, 0) / pairs.length;
  });
  const average = Object.values(regionValues).reduce((sum, value) => sum + value, 0) / Object.keys(regionValues).length;
  return metric("symmetry", average * 100, "% residual", {
    label: "\u4E8C\u7EF4\u955C\u50CF\u6B8B\u5DEE",
    confidence: qualityLevel === "high" ? "medium" : "low",
    note: "\u8BE5\u6570\u503C\u5BB9\u6613\u53D7\u62CD\u6444\u89D2\u5EA6\u3001\u8868\u60C5\u4E0E\u5149\u7EBF\u5F71\u54CD\uFF0C\u53EA\u7528\u4E8E\u68C0\u67E5\u7167\u7247\u5185\u5DE6\u53F3\u5DEE\u5F02\u3002",
    regions: Object.fromEntries(Object.entries(regionValues).map(([name, value]) => [name, round(value * 100, 1)]))
  });
}
function computeMeasurements(points, qualityLevel = "high", confidenceCap = null) {
  const faceWidth = distance(points[0], points[16]);
  const visibleLength = Math.abs(points[8].y - points[27].y);
  const estimatedFaceLength = visibleLength * 1.8;
  const leftEyeWidth = distance(points[36], points[39]);
  const rightEyeWidth = distance(points[42], points[45]);
  const averageEyeWidth = (leftEyeWidth + rightEyeWidth) / 2;
  const innerEyeDistance = distance(points[39], points[42]);
  const noseWidth = distance(points[31], points[35]);
  const mouthWidth = distance(points[48], points[54]);
  const hairlineY = points[27].y - (points[33].y - points[27].y) * 1.2;
  const rawCourts = [Math.abs(points[27].y - hairlineY), Math.abs(points[33].y - points[27].y), Math.abs(points[8].y - points[33].y)];
  const courtTotal = rawCourts.reduce((sum, value) => sum + value, 0);
  const roundedCourts = rawCourts.map((value) => round(safeDivide(value * 100, courtTotal, 0), 0));
  roundedCourts[2] += 100 - roundedCourts.reduce((sum, value) => sum + value, 0);
  const eyeSpacingValue = safeDivide(innerEyeDistance, averageEyeWidth, 0);
  const leftEyeCenter = averagePoint(points, [36, 37, 38, 39, 40, 41]);
  const rightEyeCenter = averagePoint(points, [42, 43, 44, 45, 46, 47]);
  const leftBrowCenter = averagePoint(points, [17, 18, 19, 20, 21]);
  const rightBrowCenter = averagePoint(points, [22, 23, 24, 25, 26]);
  const jawPath = [0, 2, 4, 6, 8, 10, 12, 14, 16].reduce((sum, index, position, indexes) => position ? sum + distance(points[indexes[position - 1]], points[index]) : 0, 0);
  const eyeAspectLeft = safeDivide((distance(points[37], points[41]) + distance(points[38], points[40])) / 2, leftEyeWidth, 0);
  const eyeAspectRight = safeDivide((distance(points[43], points[47]) + distance(points[44], points[46])) / 2, rightEyeWidth, 0);
  const canthalTilt = (angleDegrees(points[36], points[39]) + angleDegrees(points[42], points[45])) / 2;
  const browTilt = (angleDegrees(points[17], points[21]) + angleDegrees(points[22], points[26])) / 2;
  const result = {
    faceWidth: round(faceWidth, 2),
    faceLengthWidth: metric("face_length_width", safeDivide(estimatedFaceLength, faceWidth, 0), "ratio", { label: "\u4F30\u7B97\u8138\u957F\u5BBD\u6BD4", referenceType: "\u4EA7\u54C1\u542F\u53D1\u5F0F\u89E3\u91CA\u5E26" }),
    cheekFaceWidth: metric("cheek_face_width", safeDivide(distance(points[2], points[14]), faceWidth, 0), "ratio", { label: "\u98A7\u533A/\u9762\u5BBD" }),
    jawFaceWidth: metric("jaw_face_width", safeDivide(distance(points[4], points[12]), faceWidth, 0), "ratio", { label: "\u4E0B\u988C/\u9762\u5BBD" }),
    chinFaceWidth: metric("chin_face_width", safeDivide(distance(points[6], points[10]), faceWidth, 0), "ratio", { label: "\u4E0B\u5DF4/\u9762\u5BBD" }),
    eyeSpacing: metric("eye_spacing", eyeSpacingValue, "eye_width", { label: "\u773C\u8DDD/\u773C\u5BBD", band: eyeSpacingValue < 0.85 ? "concentrated" : eyeSpacingValue <= 1.15 ? "reference" : "spacious", referenceType: "\u53E4\u5178\u4E94\u773C\u89C6\u89C9\u53C2\u7167" }),
    leftEyeSideSpace: metric("left_eye_side_space", safeDivide(Math.abs(points[36].x - points[0].x), averageEyeWidth, 0), "eye_width", { label: "\u5DE6\u4FA7\u773C\u5916\u7559\u767D", confidence: qualityLevel === "high" ? "medium" : "low" }),
    rightEyeSideSpace: metric("right_eye_side_space", safeDivide(Math.abs(points[16].x - points[45].x), averageEyeWidth, 0), "eye_width", { label: "\u53F3\u4FA7\u773C\u5916\u7559\u767D", confidence: qualityLevel === "high" ? "medium" : "low" }),
    eyeAspectLeft: metric("eye_aspect_left", eyeAspectLeft, "ratio", { label: "\u5DE6\u773C\u5F00\u5408" }),
    eyeAspectRight: metric("eye_aspect_right", eyeAspectRight, "ratio", { label: "\u53F3\u773C\u5F00\u5408" }),
    canthalTilt: metric("canthal_tilt", canthalTilt, "\xB0", { label: "\u773C\u89D2\u65B9\u5411", confidence: qualityLevel }),
    browTilt: metric("brow_tilt", browTilt, "\xB0", { label: "\u7709\u6BDB\u65B9\u5411", confidence: qualityLevel }),
    browEyeDistance: metric("brow_eye_distance", safeDivide((distance(leftBrowCenter, leftEyeCenter) + distance(rightBrowCenter, rightEyeCenter)) / 2, averageEyeWidth, 0), "eye_width", { label: "\u7709\u773C\u8DDD\u79BB" }),
    eyeSizeDifference: metric("eye_size_difference", safeDivide(Math.abs(leftEyeWidth - rightEyeWidth), averageEyeWidth, 0), "ratio", { label: "\u5DE6\u53F3\u773C\u5BBD\u5DEE", confidence: qualityLevel === "high" ? "medium" : "low" }),
    noseFaceWidth: metric("nose_face_width", safeDivide(noseWidth, faceWidth, 0), "ratio", { label: "\u9F3B\u7FFC/\u9762\u5BBD" }),
    noseEyeSpacing: metric("nose_eye_spacing", safeDivide(noseWidth, innerEyeDistance, 0), "ratio", { label: "\u9F3B\u7FFC/\u5185\u773C\u8DDD" }),
    mouthFaceWidth: metric("mouth_face_width", safeDivide(mouthWidth, faceWidth, 0), "ratio", { label: "\u5634\u5BBD/\u9762\u5BBD" }),
    lipRatio: metric("upper_lower_lip", safeDivide(distance(points[51], points[62]), distance(points[66], points[57]), 0), "ratio", { label: "\u4E0A\u4E0B\u5507\u9AD8\u5EA6\u4EE3\u7406", confidence: "low" }),
    mouthTilt: metric("mouth_tilt", angleDegrees(points[48], points[54]), "\xB0", { label: "\u5634\u89D2\u8FDE\u7EBF", confidence: "low" }),
    jawCurve: metric("jaw_curve", safeDivide(jawPath, distance(points[0], points[16]), 0), "ratio", { label: "\u4E0B\u988C\u66F2\u7EBF\u4EE3\u7406" }),
    visualWeight: {
      eyes: round(safeDivide(averageEyeWidth * 2, faceWidth, 0), 2),
      brows: round(safeDivide((distance(points[17], points[21]) + distance(points[22], points[26])) / 2, faceWidth, 0), 2),
      nose: round(safeDivide(noseWidth, faceWidth, 0), 2),
      lips: round(safeDivide(mouthWidth, faceWidth, 0), 2)
    },
    courts: ["upper", "middle", "lower"].map((id, index) => metric(`court_${id}`, roundedCourts[index], "%", { label: ["\u4E0A\u5EAD", "\u4E2D\u5EAD", "\u4E0B\u5EAD"][index], confidence: index === 0 ? "low" : qualityLevel, referenceType: index === 0 ? "\u4F4E\u53EF\u4FE1\u5EA6\u4F30\u7B97" : "\u53E4\u5178\u4E09\u5EAD\u89C6\u89C9\u53C2\u7167" })),
    symmetry: computeRegionalSymmetry(points, faceWidth, qualityLevel)
  };
  return confidenceCap ? capMeasurementConfidence(result, confidenceCap) : result;
}
function rankFaceShapes(measurements) {
  const ratio = measurements.faceLengthWidth.value;
  const jaw = measurements.jawFaceWidth.value;
  const chin = measurements.chinFaceWidth.value;
  const cheek = measurements.cheekFaceWidth.value;
  const curve = measurements.jawCurve.value;
  const scores = {
    "\u957F\u8138": Math.max(0, (ratio - 1.08) * 5),
    "\u5706\u8138": Math.max(0, 1.15 - ratio) + Math.max(0, curve - 1.18),
    "\u65B9\u8138": Math.max(0, jaw - 0.68) * 4 + Math.max(0, 1.22 - curve),
    "\u83F1\u5F62\u8138": Math.max(0, cheek - jaw) * 5 + Math.max(0, 0.48 - chin),
    "\u5FC3\u5F62\u8138": Math.max(0, cheek - jaw) * 3 + Math.max(0, 0.44 - chin),
    "\u692D\u5706\u8138": Math.max(0, 0.18 - Math.abs(ratio - 1.05)) + Math.max(0, 0.12 - Math.abs(cheek - jaw))
  };
  return Object.entries(scores).sort((a, b) => b[1] - a[1]);
}
function deriveReadableProfile(measurements, quality = { level: "high" }) {
  const ranked = rankFaceShapes(measurements);
  const primary = ranked[0][0];
  const secondary = ranked[1][1] >= ranked[0][1] * 0.72 ? ranked[1][0] : null;
  const courtValues = measurements.courts.map((item) => item.value);
  const courtLabels = measurements.courts.map((item) => item.value > 36 ? "\u76F8\u5BF9\u7A81\u51FA" : item.value < 30 ? "\u76F8\u5BF9\u6536\u655B" : "\u63A5\u8FD1\u4E09\u7B49\u5206\u53C2\u7167");
  const eyeTerm = measurements.eyeSpacing.band === "spacious" ? "\u773C\u8DDD\u76F8\u5BF9\u8212\u5C55" : measurements.eyeSpacing.band === "concentrated" ? "\u773C\u8DDD\u76F8\u5BF9\u96C6\u4E2D" : "\u63A5\u8FD1\u4E00\u773C\u5BBD\u53C2\u7167";
  const weightScore = (measurements.visualWeight.eyes + measurements.visualWeight.brows + measurements.visualWeight.nose + measurements.visualWeight.lips) / 4;
  const featureWeight = weightScore < 0.2 ? "\u4E94\u5B98\u91CF\u611F\u504F\u8F7B" : weightScore > 0.28 ? "\u4E94\u5B98\u91CF\u611F\u504F\u5F3A" : "\u4E94\u5B98\u91CF\u611F\u9002\u4E2D";
  const lineTendency = measurements.jawCurve.value > 1.22 ? "\u66F2\u7EBF\u611F\u8F83\u660E\u663E" : measurements.jawCurve.value < 1.14 ? "\u76F4\u7EBF\u611F\u8F83\u660E\u663E" : "\u76F4\u66F2\u6DF7\u5408";
  const shapeExplanations = {
    "\u957F\u8138": "\u7EB5\u5411\u6BD4\u4F8B\u76F8\u5BF9\u7A81\u51FA\uFF0C\u8138\u4FA7\u7EBF\u6761\u66F4\u5BB9\u6613\u5F62\u6210\u5411\u4E0B\u5EF6\u4F38\u611F\u3002",
    "\u5706\u8138": "\u957F\u5BBD\u8F83\u63A5\u8FD1\uFF0C\u4E0B\u988C\u8DEF\u5F84\u5448\u73B0\u8F83\u660E\u663E\u7684\u67D4\u548C\u66F2\u7EBF\u3002",
    "\u65B9\u8138": "\u4E0B\u988C\u5BBD\u5EA6\u5B58\u5728\u611F\u8F83\u660E\u663E\uFF0C\u8F6E\u5ED3\u65B9\u5411\u76F8\u5BF9\u6E05\u6670\u3002",
    "\u83F1\u5F62\u8138": "\u98A7\u533A\u76F8\u5BF9\u7A81\u51FA\uFF0C\u4E0B\u988C\u4E0E\u4E0B\u5DF4\u7684\u6A2A\u5411\u5BBD\u5EA6\u8F83\u6536\u3002",
    "\u5FC3\u5F62\u8138": "\u98A7\u533A\u76F8\u5BF9\u8212\u5C55\uFF0C\u4E0B\u5DF4\u6A2A\u5411\u5BBD\u5EA6\u8F83\u6536\u3002",
    "\u692D\u5706\u8138": "\u957F\u5BBD\u5904\u4E8E\u4E2D\u95F4\u5E26\uFF0C\u98A7\u533A\u4E0E\u4E0B\u988C\u5BBD\u5EA6\u8FC7\u6E21\u8F83\u8FDE\u7EED\u3002"
  };
  const strengths = [
    measurements.eyeSpacing.band === "spacious" ? "\u773C\u90E8\u7559\u767D\u8212\u5C55\uFF0C\u9002\u5408\u6E05\u6670\u4F46\u4E0D\u8FC7\u5EA6\u5916\u6269\u7684\u7709\u773C\u91CD\u70B9\u3002" : "\u7709\u773C\u805A\u7126\u611F\u6E05\u695A\uFF0C\u9002\u5408\u628A\u89C6\u89C9\u91CD\u70B9\u653E\u5728\u773C\u5C3E\u4E0E\u776B\u6BDB\u3002",
    lineTendency.includes("\u66F2\u7EBF") ? "\u8F6E\u5ED3\u8FC7\u6E21\u67D4\u548C\uFF0C\u5BB9\u6613\u627F\u63A5\u81EA\u7136\u5C42\u6B21\u548C\u67D4\u548C\u8FB9\u7F18\u3002" : "\u8F6E\u5ED3\u65B9\u5411\u6E05\u6670\uFF0C\u5BB9\u6613\u627F\u63A5\u5229\u843D\u7EBF\u6761\u548C\u660E\u786E\u914D\u9970\u3002"
  ].slice(0, 2);
  const attention = [measurements.eyeSpacing.band === "spacious" ? "\u7709\u5934\u548C\u773C\u5C3E\u82E5\u540C\u65F6\u5916\u6269\uFF0C\u773C\u90E8\u6A2A\u5411\u7559\u767D\u4F1A\u8FDB\u4E00\u6B65\u589E\u52A0\u3002" : "\u7709\u5934\u82E5\u540C\u65F6\u52A0\u6DF1\u5E76\u5411\u5185\u5EF6\u4F38\uFF0C\u7709\u773C\u91CD\u5FC3\u4F1A\u66F4\u96C6\u4E2D\u3002"];
  return {
    faceShape: { primary, secondary, explanation: shapeExplanations[primary], confidence: quality.level === "low" || quality.overridden ? "low" : "medium", metricIds: [measurements.faceLengthWidth.id, measurements.cheekFaceWidth.id, measurements.jawFaceWidth.id, measurements.chinFaceWidth.id, measurements.jawCurve.id] },
    threeCourts: { values: courtValues, labels: courtLabels, summary: `\u4E0A\u5EAD ${courtValues[0]}%\u3001\u4E2D\u5EAD ${courtValues[1]}%\u3001\u4E0B\u5EAD ${courtValues[2]}%\uFF1B\u4E0A\u5EAD\u4E3A\u4F30\u7B97\uFF0C\u4E09\u5EAD\u4EC5\u4F5C\u89C6\u89C9\u53C2\u7167\u3002`, metricIds: measurements.courts.map((item) => item.id), confidence: "low" },
    fiveEyes: { term: eyeTerm, summary: `\u773C\u8DDD\u7EA6 ${measurements.eyeSpacing.value} \u4E2A\u773C\u5BBD\uFF0C\u5DE6\u4FA7\u53EF\u89C1\u7559\u767D\u7EA6 ${measurements.leftEyeSideSpace.value} \u4E2A\u773C\u5BBD\uFF0C\u53F3\u4FA7\u7EA6 ${measurements.rightEyeSideSpace.value} \u4E2A\u773C\u5BBD\uFF1B\u4E94\u773C\u4E3A\u53E4\u5178\u89C6\u89C9\u53C2\u7167\uFF0C\u4E0D\u4EE3\u8868\u5BA1\u7F8E\u7B49\u7EA7\u3002`, metricIds: [measurements.eyeSpacing.id, measurements.leftEyeSideSpace.id, measurements.rightEyeSideSpace.id], confidence: quality.level === "high" ? "medium" : "low" },
    featureWeight: { term: featureWeight, metricIds: [measurements.eyeAspectLeft.id, measurements.browEyeDistance.id, measurements.noseFaceWidth.id, measurements.mouthFaceWidth.id], confidence: quality.level === "high" ? "medium" : "low" },
    lineTendency: { term: lineTendency, metricIds: [measurements.jawCurve.id], confidence: measurements.jawCurve.confidence },
    strengths,
    attention,
    memorySentence: `${secondary ? `${primary}\u504F${secondary}` : `${primary}\u503E\u5411`}\uFF0C${eyeTerm}\uFF0C${courtLabels[1] === "\u63A5\u8FD1\u4E09\u7B49\u5206\u53C2\u7167" ? "\u4E2D\u5EAD\u63A5\u8FD1\u4E09\u7B49\u5206\u53C2\u7167" : `\u4E2D\u5EAD${courtLabels[1]}`}\u3002`
  };
}
var clamp = (value, min, max) => Math.min(max, Math.max(min, value));
var finiteValue = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
var scaleIdentityValue = (value, min, max) => round(clamp((finiteValue(value) - min) / (max - min), 0, 1) * 100, 0);
function buildIdentityPresentation(measurements, readableProfile, generatedAt = /* @__PURE__ */ new Date()) {
  const requiredMetrics = ["faceLengthWidth", "cheekFaceWidth", "jawFaceWidth", "symmetry", "eyeSpacing"];
  requiredMetrics.forEach((id) => {
    if (!Number.isFinite(measurements?.[id]?.value)) throw new TypeError(`Identity presentation requires finite measurement: ${id}.value`);
  });
  ["eyes", "brows", "nose", "lips"].forEach((id) => {
    if (!Number.isFinite(measurements?.visualWeight?.[id])) throw new TypeError(`Identity presentation requires finite measurement: visualWeight.${id}`);
  });
  if (!Array.isArray(measurements?.courts) || measurements.courts.length < 3) throw new TypeError("Identity presentation requires three finite court measurements");
  measurements.courts.slice(0, 3).forEach((item, index) => {
    if (!Number.isFinite(item?.value)) throw new TypeError(`Identity presentation requires finite measurement: courts[${index}].value`);
  });
  const courts = measurements.courts.slice(0, 3).map((item) => item.value);
  const courtDrift = Math.max(...courts.map((value) => Math.abs(value - 33.33)));
  const visualWeight = ["eyes", "brows", "nose", "lips"].reduce((sum, id) => sum + measurements.visualWeight[id], 0) / 4;
  const metricValue = (id) => measurements[id].value;
  const axes = [
    { id: "lengthWidth", label: "\u8F6E\u5ED3\u7EB5\u6A2A\u5DEE\u5F02", value: scaleIdentityValue(Math.abs(metricValue("faceLengthWidth") - 1.04), 0, 0.24) },
    { id: "cheekJaw", label: "\u98A7\u988C\u5BBD\u5EA6\u5DEE\u5F02", value: scaleIdentityValue(Math.abs(metricValue("cheekFaceWidth") - metricValue("jawFaceWidth")), 0, 0.22) },
    { id: "features", label: "\u4E94\u5B98\u91CF\u611F\u5DEE\u5F02", value: scaleIdentityValue(Math.abs(visualWeight - 0.24), 0, 0.1) },
    { id: "courts", label: "\u4E09\u5EAD\u5206\u5E03\u5DEE\u5F02", value: scaleIdentityValue(courtDrift, 0, 10) },
    { id: "mirror", label: "\u5DE6\u53F3\u5BF9\u7167\u5DEE\u5F02", value: scaleIdentityValue(metricValue("symmetry"), 0, 8) },
    { id: "eyeSpace", label: "\u773C\u8DDD\u53C2\u7167\u5DEE\u5F02", value: scaleIdentityValue(Math.abs(metricValue("eyeSpacing") - 1), 0, 0.45) }
  ];
  const pronounced = axes.filter((axis) => axis.value >= 68).length;
  const type = pronounced >= 3 ? "UNIQUE" : pronounced >= 1 ? "SIGNATURE" : "CLASSIC";
  const parsedDate = generatedAt instanceof Date ? generatedAt.getTime() : new Date(generatedAt).getTime();
  const minuteIndex = Number.isFinite(parsedDate) ? Math.abs(Math.trunc(parsedDate / 6e4)) % 1e4 : 0;
  const serial = `NO.${String(Math.trunc(minuteIndex)).padStart(4, "0")}`;
  const line = readableProfile?.lineTendency?.term || "\u76F4\u66F2\u6DF7\u5408";
  const style = line.includes("\u76F4\u7EBF") ? "\u51B7\u611F\u53D9\u4E8B\u578B" : line.includes("\u66F2\u7EBF") ? "\u67D4\u548C\u6C1B\u56F4\u578B" : "\u6E05\u6670\u5E73\u8861\u578B";
  return {
    serial,
    type,
    title: `${readableProfile?.faceShape?.primary || "\u8F6E\u5ED3"} \xB7 ${style}`,
    poem: line.includes("\u76F4\u7EBF") ? "\u4F60\u7684\u8F6E\u5ED3\u65B9\u5411\u6E05\u6670\uFF0C\u50CF\u4E00\u5E27\u88AB\u8BA4\u771F\u6536\u85CF\u7684\u65E7\u7535\u5F71\u3002" : "\u4F60\u7684\u7EBF\u6761\u7559\u6709\u67D4\u548C\u4F59\u97F5\uFF0C\u9002\u5408\u8BA9\u7EC6\u8282\u6162\u6162\u88AB\u770B\u89C1\u3002",
    portraitTags: [readableProfile?.threeCourts?.labels?.[1], readableProfile?.fiveEyes?.term, readableProfile?.featureWeight?.term].filter(Boolean).slice(0, 3),
    axes
  };
}
function conclusion({ title, value, explanation, action, evidenceType, metricIds = [], confidence = "high" }) {
  if (!evidenceType || evidenceType !== "care" && metricIds.length === 0) throw new Error("Untraceable conclusion");
  return { title, value, explanation, action, evidenceType, metricIds, confidence };
}
function composeReport({ quality, measurements, profile }) {
  const readableProfile = deriveReadableProfile(measurements, quality);
  const ratio = measurements.faceLengthWidth;
  const eye = measurements.eyeSpacing;
  const middle = measurements.courts[1];
  const ratioBand = ratio.value > 1.12 ? "\u7EB5\u5411\u76F8\u5BF9\u7A81\u51FA" : ratio.value < 0.95 ? "\u6A2A\u5411\u76F8\u5BF9\u7A81\u51FA" : "\u957F\u5BBD\u63A5\u8FD1\u4E2D\u95F4\u5E26";
  const eyeLabel = eye.band === "spacious" ? "\u773C\u8DDD\u76F8\u5BF9\u8212\u5C55" : eye.band === "concentrated" ? "\u773C\u8DDD\u76F8\u5BF9\u96C6\u4E2D" : "\u63A5\u8FD1\u4E00\u773C\u5BBD\u53C2\u7167";
  const middleLabel = middle.value > 36 ? "\u4E2D\u5EAD\u5360\u6BD4\u76F8\u5BF9\u9AD8" : middle.value < 30 ? "\u4E2D\u5EAD\u5360\u6BD4\u76F8\u5BF9\u4F4E" : "\u4E2D\u5EAD\u63A5\u8FD1\u4E09\u7B49\u5206\u53C2\u7167";
  const traitMap = {
    face: conclusion({ title: "\u6574\u4F53\u8F6E\u5ED3", value: `${ratio.value.toFixed(2)} : 1`, explanation: `${ratioBand}\u3002\u8138\u957F\u5305\u542B\u53D1\u9645\u7EBF\u4F30\u7B97\uFF0C\u56E0\u6B64\u7F6E\u4FE1\u5EA6\u4F4E\u4E8E\u9762\u5BBD\u3002`, action: "\u7528\u53D1\u578B\u548C\u9886\u53E3\u505A\u4E00\u6B21\u6A2A\u5411/\u7EB5\u5411\u7EBF\u6761\u5BF9\u7167\u3002", evidenceType: "geometry", metricIds: [ratio.id], confidence: ratio.confidence }),
    eye: conclusion({ title: "\u773C\u90E8\u95F4\u8DDD", value: `${eye.value.toFixed(2)} \u4E2A\u773C\u5BBD`, explanation: `${eyeLabel}\uFF1B\u4E00\u773C\u5BBD\u53EA\u4F5C\u4E3A\u53E4\u5178\u89C6\u89C9\u53C2\u7167\uFF0C\u4E0D\u662F\u7406\u60F3\u6807\u51C6\u3002`, action: eye.band === "spacious" ? "\u7709\u5934\u53EF\u81EA\u7136\u524D\u79FB\uFF0C\u5148\u8BD5\u4E0D\u5916\u62C9\u7684\u773C\u7EBF\u3002" : eye.band === "concentrated" ? "\u7709\u5934\u51CF\u6DE1\uFF0C\u773C\u5C3E\u53EF\u8F7B\u5FAE\u5916\u5EF6\u3002" : "\u4FDD\u6301\u81EA\u7136\u957F\u5EA6\uFF0C\u6BD4\u8F83\u67D4\u548C\u4E0E\u6E05\u6670\u4E24\u79CD\u8FB9\u7F18\u3002", evidenceType: "geometry", metricIds: [eye.id], confidence: eye.confidence }),
    middle: conclusion({ title: "\u4E09\u5EAD\u89C6\u89C9\u53C2\u7167", value: `${measurements.courts.map((item) => item.value).join(" / ")}%`, explanation: `${middleLabel}\uFF1B\u4E0A\u5EAD\u6765\u81EA\u53D1\u9645\u7EBF\u4F30\u7B97\uFF0C\u6574\u7EC4\u4EC5\u7528\u4E8E\u6784\u56FE\u53C2\u8003\u3002`, action: "\u5728\u540C\u4E00\u5149\u7EBF\u4E0B\u6BD4\u8F83\u4E0D\u540C\u7709\u5F62\u4E0E\u816E\u7EA2\u4F4D\u7F6E\u3002", evidenceType: "geometry", metricIds: measurements.courts.map((item) => item.id), confidence: "low" })
  };
  const priority = profile?.primaryGoal === "makeup" ? ["eye", "middle", "face"] : profile?.primaryGoal === "hair" ? ["face", "middle", "eye"] : ["face", "eye", "middle"];
  const coreTraits = priority.map((id) => traitMap[id]);
  const eyeRuleId = eye.band === "spacious" ? "eye_spacious" : eye.band === "concentrated" ? "eye_concentrated" : "eye_reference";
  const eyeRule = KNOWLEDGE_BASE.styleRules[eyeRuleId];
  const faceRule = KNOWLEDGE_BASE.styleRules[ratio.value > 1.06 ? "face_long" : "face_wide"];
  const jawRule = KNOWLEDGE_BASE.styleRules.jaw_framing;
  const timeNote = profile?.dailyMinutes <= 5 ? "\u63A7\u5236\u4E3A\u4E00\u6B65\u53D8\u5316\uFF0C\u7EA6 2 \u5206\u949F\u5B8C\u6210\u3002" : "\u53EF\u5206\u522B\u62CD\u7167\u6BD4\u8F83\u4E24\u79CD\u5F3A\u5EA6\u3002";
  const hairNote = profile?.hairMaintenance === "minimal" ? "\u4F18\u5148\u9009\u62E9\u81EA\u7136\u843D\u4F4D\u3001\u65E0\u9700\u6BCF\u65E5\u5939\u5377\u7684\u8138\u4FA7\u5C42\u6B21\u3002" : faceRule.advice;
  const styleAdvice = [
    conclusion({ title: "\u5986\u5BB9", value: eyeLabel, explanation: `${eyeRule.advice}\u3002${timeNote}`, action: eyeRule.avoid || eyeRule.limitation, evidenceType: "styling", metricIds: [eye.id], confidence: "medium" }),
    conclusion({ title: "\u53D1\u578B", value: ratioBand, explanation: hairNote, action: faceRule.avoid || faceRule.limitation, evidenceType: "styling", metricIds: [ratio.id], confidence: "medium" }),
    conclusion({ title: "\u7A7F\u642D\u4E0E\u914D\u9970", value: `\u4E0B\u988C\u66F2\u7EBF ${measurements.jawCurve.value.toFixed(2)}`, explanation: jawRule.advice, action: jawRule.limitation, evidenceType: "styling", metricIds: [measurements.jawCurve.id], confidence: "medium" })
  ];
  const dataGroups = [
    { id: "overall", title: "\u6574\u4F53\u6BD4\u4F8B", items: [measurements.faceLengthWidth, measurements.cheekFaceWidth, measurements.jawFaceWidth, measurements.chinFaceWidth, ...measurements.courts] },
    { id: "eye_brow", title: "\u773C\u90E8\u4E0E\u7709\u90E8", items: [measurements.eyeSpacing, measurements.leftEyeSideSpace, measurements.rightEyeSideSpace, measurements.eyeAspectLeft, measurements.eyeAspectRight, measurements.canthalTilt, measurements.browTilt, measurements.browEyeDistance, measurements.eyeSizeDifference] },
    { id: "nose_lip", title: "\u9F3B\u90E8\u4E0E\u5507\u90E8", items: [measurements.noseFaceWidth, measurements.noseEyeSpacing, measurements.mouthFaceWidth, measurements.lipRatio, measurements.mouthTilt] },
    { id: "jaw_symmetry", title: "\u4E0B\u988C\u4E0E\u5DE6\u53F3\u5DEE\u5F02", items: [measurements.jawCurve, measurements.symmetry] }
  ];
  const skinLabels = { dry: "\u504F\u5E72\u80A4\u611F", normal: "\u8F83\u8212\u9002\u80A4\u611F", combination: "\u6DF7\u5408\u80A4\u611F", oily: "\u504F\u6CB9\u80A4\u611F" };
  const sensitivityLabels = { sensitive: "\u8F83\u6613\u53CD\u5E94", possible: "\u5076\u6709\u53CD\u5E94", low: "\u8F83\u5C11\u53CD\u5E94" };
  const carePlan = profile?.complete ? {
    tendency: `${skinLabels[profile.skinTendency]} \xB7 ${sensitivityLabels[profile.sensitivityTendency]}`,
    morning: KNOWLEDGE_BASE.careRules.base.morning,
    evening: KNOWLEDGE_BASE.careRules.base.evening,
    boundary: profile.sensitivityTendency === "sensitive" || profile.sensitivityTendency === "possible" ? KNOWLEDGE_BASE.careRules.sensitive.advice : "\u82E5\u6301\u7EED\u51FA\u73B0\u523A\u75DB\u3001\u7EA2\u80BF\u6216\u76AE\u75B9\uFF0C\u505C\u6B62\u65B0\u589E\u4EA7\u54C1\u5E76\u54A8\u8BE2\u76AE\u80A4\u79D1\u533B\u751F\u3002",
    evidenceType: "care",
    sourceIds: ["aadBasics"]
  } : null;
  const goalLabels = { skin: "\u7A33\u5B9A\u57FA\u7840\u62A4\u7406", makeup: "\u8C03\u6574\u4E00\u4E2A\u5986\u5BB9\u53D8\u91CF", hair: "\u8C03\u6574\u4E00\u4E2A\u53D1\u578B\u53D8\u91CF", overall: "\u8C03\u6574\u4E00\u4E2A\u9020\u578B\u53D8\u91CF" };
  const styleAction = profile?.primaryGoal === "hair" ? hairNote : eyeRule.advice;
  const styleKeyword = profile?.primaryGoal === "hair" ? `${readableProfile.faceShape.primary} \u4F4E\u7EF4\u62A4 \u53D1\u578B \u5BF9\u7167` : `${readableProfile.fiveEyes.term} \u7709\u5F62 \u773C\u7EBF \u5BF9\u7167`;
  const actionCards = profile?.complete ? [
    {
      id: "style-focus",
      title: goalLabels[profile.primaryGoal] || goalLabels.overall,
      reason: `\u4E0E\u4F60\u7684\u201C${readableProfile.faceShape.primary}\u503E\u5411\u3001${readableProfile.fiveEyes.term}\u201D\u89C2\u5BDF\u76F4\u63A5\u76F8\u5173\uFF0C\u5148\u53EA\u6BD4\u8F83\u4E00\u4E2A\u53D8\u91CF\u3002`,
      action: styleAction,
      duration: profile.dailyMinutes <= 5 ? "\u6BCF\u5929\u7EA6 2\u20135 \u5206\u949F" : "\u6BCF\u6B21\u7EA6 10\u201315 \u5206\u949F",
      cost: profile.monthlyBudget === "basic" ? "\u4F18\u5148\u4F7F\u7528\u73B0\u6709\u7269\u54C1" : "\u65E0\u9700\u7ACB\u5373\u8D2D\u4E70\u65B0\u54C1",
      successSignal: "\u4F60\u80FD\u6E05\u695A\u8BF4\u51FA\u54EA\u4E00\u79CD\u66F4\u534F\u8C03\u3001\u66F4\u5BB9\u6613\u6267\u884C\u3002",
      stopRule: "\u5982\u679C\u8FDE\u7EED\u4E09\u6B21\u90FD\u89C9\u5F97\u6B65\u9AA4\u8D1F\u62C5\u5927\uFF0C\u5C31\u964D\u4F4E\u5F3A\u5EA6\u6216\u6362\u5361\u3002",
      searchKeyword: styleKeyword
    },
    {
      id: "foundation",
      title: "\u5148\u7A33\u5B9A\u57FA\u7840\u72B6\u6001",
      reason: `\u4F60\u7684\u81EA\u8BC4\u4E3A\u201C${skinLabels[profile.skinTendency]} \xB7 ${sensitivityLabels[profile.sensitivityTendency]}\u201D\uFF0C\u5148\u51CF\u5C11\u53D8\u91CF\u66F4\u5BB9\u6613\u89C2\u5BDF\u3002`,
      action: "\u8FDE\u7EED 7 \u5929\u53EA\u7A33\u5B9A\u6E05\u6D01\u3001\u4FDD\u6E7F\u548C\u767D\u5929\u5E7F\u8C31 SPF 30+ \u9632\u6652\uFF0C\u4E0D\u540C\u65F6\u65B0\u589E\u591A\u4EF6\u4EA7\u54C1\u3002",
      duration: "\u65E9\u665A\u5404\u7EA6 3 \u5206\u949F",
      cost: "\u4E0D\u8981\u6C42\u65B0\u589E\u9884\u7B97",
      successSignal: "\u80FD\u591F\u7A33\u5B9A\u6267\u884C\uFF0C\u5E76\u77E5\u9053\u54EA\u4E00\u6B65\u8BA9\u81EA\u5DF1\u66F4\u8212\u9002\u3002",
      stopRule: "\u51FA\u73B0\u6301\u7EED\u523A\u75DB\u3001\u7EA2\u80BF\u6216\u76AE\u75B9\u65F6\u505C\u6B62\u65B0\u589E\u4EA7\u54C1\u5E76\u54A8\u8BE2\u76AE\u80A4\u79D1\u533B\u751F\u3002",
      searchKeyword: "\u79D1\u5B66\u62A4\u80A4 \u57FA\u7840\u4E09\u4EF6\u5957 \u654F\u611F\u808C \u7CBE\u7B80"
    },
    {
      id: "photo-review",
      title: "\u505A\u4E00\u6B21\u540C\u6761\u4EF6\u590D\u76D8",
      reason: "\u5355\u6B21\u7167\u7247\u5BB9\u6613\u53D7\u89D2\u5EA6\u548C\u5149\u7EBF\u5F71\u54CD\uFF0C\u540C\u6761\u4EF6\u8BB0\u5F55\u6BD4\u8FFD\u6C42\u67D0\u4E2A\u6570\u5B57\u66F4\u53EF\u9760\u3002",
      action: "\u4ECA\u5929\u4FDD\u5B58\u4E00\u5F20\u57FA\u7EBF\u7167\uFF0C\u7B2C 7 \u5929\u548C\u7B2C 30 \u5929\u5728\u76F8\u540C\u8DDD\u79BB\u3001\u5149\u7EBF\u548C\u8868\u60C5\u4E0B\u590D\u62CD\uFF0C\u53EA\u6BD4\u8F83\u8212\u9002\u5EA6\u4E0E\u6267\u884C\u96BE\u5EA6\u3002",
      duration: "\u6BCF\u6B21\u7EA6 3 \u5206\u949F",
      cost: "\u96F6\u6210\u672C",
      successSignal: "\u4E09\u5F20\u7167\u7247\u6761\u4EF6\u63A5\u8FD1\uFF0C\u80FD\u770B\u51FA\u6240\u9009\u52A8\u4F5C\u662F\u5426\u503C\u5F97\u4FDD\u7559\u3002",
      stopRule: "\u5982\u679C\u62CD\u6444\u6761\u4EF6\u5DEE\u5F02\u660E\u663E\uFF0C\u4E0D\u505A\u524D\u540E\u7ED3\u8BBA\uFF0C\u53EA\u91CD\u65B0\u5EFA\u7ACB\u57FA\u7EBF\u3002",
      searchKeyword: "\u5986\u524D\u5986\u540E \u540C\u5149\u7EBF \u5BF9\u6BD4\u8BB0\u5F55 \u65B9\u6CD5"
    }
  ] : [{
    id: "geometry-compare",
    title: "\u5148\u505A\u4E00\u6B21\u51E0\u4F55\u5BF9\u7167",
    reason: "\u95EE\u5377\u4FE1\u606F\u4E0D\u5B8C\u6574\uFF0C\u5148\u4ECE\u7167\u7247\u5185\u53EF\u89C2\u5BDF\u7684\u9020\u578B\u53D8\u91CF\u5F00\u59CB\u3002",
    action: eyeRule.advice,
    duration: "\u7EA6 5 \u5206\u949F",
    cost: "\u96F6\u6210\u672C",
    successSignal: "\u80FD\u5206\u8FA8\u4E24\u79CD\u65B9\u6848\u5E26\u6765\u7684\u89C6\u89C9\u5DEE\u5F02\u3002",
    stopRule: "\u5982\u679C\u7167\u7247\u89D2\u5EA6\u4E0D\u540C\uFF0C\u4E0D\u6BD4\u8F83\u7ED3\u679C\u3002",
    searchKeyword: "\u7709\u5F62 \u773C\u7EBF \u540C\u89D2\u5EA6 \u5BF9\u7167"
  }];
  const sourceIds = /* @__PURE__ */ new Set(["southernChineseCanons", "interEthnicReview", "faceApi", "photoStandard"]);
  if (carePlan) sourceIds.add("aadBasics");
  const sources = Array.from(sourceIds, (id) => ({ id, ...KNOWLEDGE_BASE.sources[id] }));
  return {
    quality,
    readableProfile,
    coreTraits,
    dataGroups,
    styleAdvice,
    carePlan,
    actionCards,
    sources,
    limitations: [
      "\u7ED3\u679C\u4F9D\u8D56\u5355\u5F20\u7167\u7247\u7684\u89D2\u5EA6\u3001\u955C\u5934\u8DDD\u79BB\u3001\u5149\u7EBF\u548C\u8868\u60C5\u3002",
      "\u4E0A\u5EAD\u4F7F\u7528\u5173\u952E\u70B9\u5916\u63A8\u4F30\u7B97\uFF0C\u7F6E\u4FE1\u5EA6\u8F83\u4F4E\u3002",
      "\u8138\u578B\u503E\u5411\u4E0E\u672F\u8BED\u9608\u503C\u5C5E\u4E8E\u4EA7\u54C1\u542F\u53D1\u5F0F\u89E3\u91CA\u5E26\uFF0C\u4E0D\u662F\u666E\u9002\u5206\u7C7B\u6807\u51C6\u3002",
      "\u672C\u5DE5\u5177\u53EA\u505A\u4E8C\u7EF4\u51E0\u4F55\u4E0E\u901A\u7528\u62A4\u7406\u6574\u7406\uFF0C\u4E0D\u66FF\u4EE3\u4E13\u4E1A\u8BCA\u7597\u6216\u4E2A\u4F53\u5BA1\u7F8E\u5224\u65AD\u3002"
    ]
  };
}
var ANALYSIS_STATUSES = /* @__PURE__ */ new Set(["queued", "processing", "complete", "failed"]);
var SOURCE_PHOTO_STATUSES = /* @__PURE__ */ new Set(["pending", "deleting", "deleted", "manual_review"]);
var SAFE_ERRORS = /* @__PURE__ */ new Set(["ACCOUNT_DELETION_IN_PROGRESS", "CONSENT_REQUIRED", "FORBIDDEN", "INVALID_ACTION", "INVALID_ARGUMENT", "UNAUTHENTICATED"]);
var CONSENT_TYPE = "face-analysis";
var CONSENT_VERSION = "2026-09-03";
var REPORT_RULES_VERSION = "web-face-style-core-2026-09-03";
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
  photoCleanup,
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
      await database.runTransaction(async (transaction) => {
        await assertAccountWritable(transaction, openid);
        await transaction.collection("consents").doc(consentId).set({
          _openid: openid,
          type: CONSENT_TYPE,
          version: CONSENT_VERSION,
          acceptedAt: new Date(acceptedAt).toISOString(),
          revokedAt: null,
          createdAt: database.serverDate()
        });
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
        await assertAccountWritable(transaction, openid);
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
      if (result.expired) {
        await photoCleanup?.deleteUploadPhoto(reservationId);
        throw codedError("UPLOAD_REQUIRED");
      }
      if (result.jobId && ["complete", "failed"].includes(result.status)) await photoCleanup?.deleteAnalysisPhoto(result.jobId);
      return result;
    }
    if (event.action === "attachUpload") {
      const reservationId = requireId(payload.reservationId);
      const tempFileId = requireTempFileId(payload.tempFileId);
      const requestTime = now();
      const result = await database.runTransaction(async (transaction) => {
        await assertAccountWritable(transaction, openid);
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
      if (result.expired) {
        await photoCleanup?.deleteUploadPhoto(reservationId);
        throw codedError("UPLOAD_REQUIRED");
      }
      return result;
    }
    if (event.action === "abandonUpload") {
      const reservationId = requireId(payload.reservationId);
      const result = await database.runTransaction(async (transaction) => {
        await assertAccountWritable(transaction, openid);
        const reference = transaction.collection("analysis_uploads").doc(reservationId);
        const upload = await readOptional(reference);
        assertOwnedRecord(upload, openid);
        if (upload.status === "deleted") return { reservationId, status: "deleted" };
        if (upload.status === "deleting") return { reservationId, status: "deleting", ...upload.jobId ? { jobId: upload.jobId } : {} };
        if (upload.status === "assigned") {
          const jobReference = transaction.collection("analysis_jobs").doc(requireId(upload.jobId));
          const job = await readOptional(jobReference);
          assertOwnedRecord(job, openid);
          if (job.reservationId !== reservationId || job.tempFileId !== upload.tempFileId) throw codedError("INVALID_STATUS");
          const next = cleanupTransition(job);
          await jobReference.update({
            status: next.status,
            sourcePhotoStatus: next.sourcePhotoStatus,
            ...["queued", "processing"].includes(job.status) ? { errorCode: "CANCELLED" } : {}
          });
          await reference.update({ status: "deleting", abandonedAt: database.serverDate() });
          return { reservationId, status: "deleting", jobId: upload.jobId };
        }
        if (!["pending", "attached"].includes(upload.status)) throw codedError("INVALID_STATUS");
        await reference.update({ status: "deleting", abandonedAt: database.serverDate() });
        return { reservationId, status: "deleting" };
      });
      if (result.jobId) await photoCleanup?.deleteAnalysisPhoto(result.jobId);
      else await photoCleanup?.deleteUploadPhoto(reservationId);
      return result;
    }
    if (event.action === "cancelAnalysis") {
      const jobId = requireId(payload.jobId);
      const result = await database.runTransaction(async (transaction) => {
        await assertAccountWritable(transaction, openid);
        const reference = transaction.collection("analysis_jobs").doc(jobId);
        const job = await readOptional(reference);
        assertOwnedRecord(job, openid);
        const next = cleanupTransition(job);
        await reference.update({ status: next.status, sourcePhotoStatus: next.sourcePhotoStatus, errorCode: "CANCELLED" });
        if (job.reservationId) {
          const uploadReference = transaction.collection("analysis_uploads").doc(requireId(job.reservationId));
          const upload = await readOptional(uploadReference);
          if (upload && upload._openid === openid && upload.jobId === jobId && upload.tempFileId === job.tempFileId && upload.status === "assigned") {
            await uploadReference.update({ status: "deleting", abandonedAt: database.serverDate() });
          }
        }
        return { jobId, ...minimalStatus(next) };
      });
      await photoCleanup?.deleteAnalysisPhoto(jobId);
      return result;
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
        await assertAccountWritable(transaction, openid);
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
      if (created.expired) {
        await photoCleanup?.deleteUploadPhoto(reservationId);
        throw codedError("UPLOAD_REQUIRED");
      }
      if (created.dispatch) {
        try {
          await dispatchAnalysis(created.dispatch);
        } catch (_) {
          created.view = await database.runTransaction(async (transaction) => {
            await assertAccountWritable(transaction, openid);
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
      if (["complete", "failed"].includes(created.view.status)) await photoCleanup?.deleteAnalysisPhoto(created.view.jobId);
      return created.view;
    }
    if (event.action === "getAnalysis") {
      const jobId = requireId(payload.jobId);
      let job = await readOptional(database.collection("analysis_jobs").doc(jobId));
      assertOwnedRecord(job, openid);
      if (job.status === "processing" && deadlineMillis(job.leaseExpiresAt) <= now().getTime()) {
        await recoverExpiredContainerLease({ database, jobId, now: now(), photoCleanup });
        job = await readOptional(database.collection("analysis_jobs").doc(jobId));
      }
      if (!ANALYSIS_STATUSES.has(job.status)) throw codedError("INVALID_STATUS");
      return minimalStatus(job);
    }
    if (event.action === "getReport") {
      const reportId = requireId(payload.reportId);
      const report = await readOptional(database.collection("reports").doc(reportId));
      assertOwnedRecord(report, openid);
      return report.report;
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
    if (job?._openid) await assertAccountWritable(transaction, job._openid);
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
async function settleContainerJob({ database, jobId, leaseId, leaseToken, now, status, errorCode, result, photoCleanup }) {
  const settled = await database.runTransaction(async (transaction) => {
    const reference = transaction.collection("analysis_jobs").doc(requireId(jobId));
    const job = await readOptional(reference);
    if (job?._openid) await assertAccountWritable(transaction, job._openid);
    assertLease(job, leaseId, leaseToken);
    if (job.status === "complete" || job.status === "failed") return { jobId, status: job.status };
    if (job.status !== "processing" || deadlineMillis(job.leaseExpiresAt) <= now.getTime()) throw codedError("LEASE_EXPIRED");
    const uploadReference = transaction.collection("analysis_uploads").doc(requireId(job.reservationId));
    const upload = await readOptional(uploadReference);
    if (!upload || upload._openid !== job._openid || upload.jobId !== jobId || upload.status !== "assigned") throw codedError("LEASE_INVALID");
    const next = transitionAnalysisJob(job, { status, sourcePhotoStatus: "deleting" });
    const changes = { status: next.status, sourcePhotoStatus: next.sourcePhotoStatus, settledAt: database.serverDate() };
    if (status === "complete") {
      if (job.consentId) {
        const consent = await readOptional(transaction.collection("consents").doc(requireId(job.consentId)));
        if (!consent || consent._openid !== job._openid || consent.revokedAt) throw codedError("CONSENT_REQUIRED");
      }
      const analysisResult = validateAnalysisResult(result, jobId);
      const measurements = computeMeasurements(analysisResult.points, job.quality?.level || "high");
      const profile = inferQuestionnaire(job.questionnaire || {});
      const report = composeReport({ quality: job.quality, measurements, profile });
      const reportId = `report-${jobId}`;
      const identityMeasurements = Number.isFinite(measurements.symmetry?.value) ? measurements : { ...measurements, symmetry: { ...measurements.symmetry, value: 0 } };
      const identity = buildIdentityPresentation(identityMeasurements, report.readableProfile, now);
      await transaction.collection("reports").doc(reportId).set({
        _openid: job._openid,
        jobId,
        modelVersion: analysisResult.modelVersion,
        reportRulesVersion: REPORT_RULES_VERSION,
        report: {
          ...report,
          identity,
          memorySentence: report.readableProfile.memorySentence,
          generatedAt: now.toISOString()
        },
        createdAt: database.serverDate()
      });
      changes.reportId = reportId;
    } else changes.errorCode = typeof errorCode === "string" && /^[A-Z0-9_]{1,64}$/.test(errorCode) ? errorCode : "ANALYSIS_FAILED";
    await reference.update(changes);
    await uploadReference.update({ status: "deleting", abandonedAt: database.serverDate() });
    return { jobId, status };
  });
  await photoCleanup?.deleteAnalysisPhoto(jobId);
  return settled;
}
function completeContainerJob({ database, jobId, leaseId, leaseToken, result, now = /* @__PURE__ */ new Date(), photoCleanup }) {
  return settleContainerJob({ database, jobId, leaseId, leaseToken, result, now, status: "complete", photoCleanup });
}
function failContainerJob({ database, jobId, leaseId, leaseToken, errorCode, now = /* @__PURE__ */ new Date(), photoCleanup }) {
  return settleContainerJob({ database, jobId, leaseId, leaseToken, errorCode, now, status: "failed", photoCleanup });
}
async function recoverExpiredContainerLease({ database, jobId, now = /* @__PURE__ */ new Date(), photoCleanup }) {
  const result = await database.runTransaction(async (transaction) => {
    const reference = transaction.collection("analysis_jobs").doc(requireId(jobId));
    const job = await readOptional(reference);
    if (job?._openid) await assertAccountWritable(transaction, job._openid);
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
  if (["complete", "failed"].includes(result.status)) await photoCleanup?.deleteAnalysisPhoto(jobId);
  return result;
}
function requireHttpsUrl(value, hosts) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw codedError("INVALID_CONFIGURATION");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port && url.port !== "443" || hosts && !hosts.includes(url.hostname.toLowerCase())) throw codedError("INVALID_CONFIGURATION");
  return url.toString();
}
function createProductionDownloadDescriptor({ cloud, allowedPhotoHosts, fetchImpl = globalThis.fetch }) {
  if (!cloud || !Array.isArray(allowedPhotoHosts) || !allowedPhotoHosts.length) throw codedError("INVALID_CONFIGURATION");
  const hosts = allowedPhotoHosts.map((host) => String(host).toLowerCase());
  return async (tempFileId) => {
    requireTempFileId(tempFileId);
    const signed = await cloud.getTempFileURL({ fileList: [tempFileId] });
    const item = signed?.fileList?.[0];
    if (item?.fileID !== tempFileId || item.status !== 0) throw codedError("INVALID_CONFIGURATION");
    const url = requireHttpsUrl(item.tempFileURL, hosts);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1e4);
    try {
      const response = await fetchImpl(url, { redirect: "manual", signal: controller.signal });
      if (response?.status !== 200 || !response.body?.getReader) {
        try {
          await response?.body?.cancel?.();
        } catch {
        }
        throw codedError("PHOTO_DOWNLOAD_FAILED");
      }
      if (Number(response.headers.get("content-length")) > 8 * 1024 * 1024) {
        try {
          await response.body.cancel();
        } catch {
        }
        throw codedError("PHOTO_TOO_LARGE");
      }
      const reader = response.body.getReader();
      const digest = createHash("sha256");
      let size = 0;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 8 * 1024 * 1024) {
          await reader.cancel();
          throw codedError("PHOTO_TOO_LARGE");
        }
        digest.update(value);
      }
      return { url, sha256: digest.digest("hex") };
    } catch (error) {
      if (controller.signal.aborted) throw codedError("PHOTO_DOWNLOAD_TIMEOUT");
      throw error;
    } finally {
      clearTimeout(timer);
    }
  };
}
function createProductionDispatch({ endpoint, fetchImpl = globalThis.fetch }) {
  const url = requireHttpsUrl(endpoint);
  return async ({ jobId, credential }) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 115e3);
    try {
      const response = await fetchImpl(url, {
        method: "POST",
        redirect: "manual",
        signal: controller.signal,
        headers: { authorization: `Bearer ${credential}`, "content-type": "application/json" },
        body: JSON.stringify({ jobId })
      });
      try {
        await response?.body?.cancel?.();
      } catch {
      }
      if (response?.status !== 200) throw codedError("DISPATCH_FAILED");
    } finally {
      clearTimeout(timer);
    }
  };
}
function createContainerCoordinatorMain({ database, createDownloadDescriptor, now = () => /* @__PURE__ */ new Date(), photoCleanup }) {
  if (!database || typeof createDownloadDescriptor !== "function") throw codedError("INVALID_CONFIGURATION");
  return async (event) => {
    const reply = (statusCode, value) => ({ statusCode, headers: { "content-type": "application/json" }, body: JSON.stringify(value) });
    if (event?.httpMethod !== "POST") return reply(405, { ok: false, code: "INVALID_METHOD" });
    const auth = event.headers?.authorization || event.headers?.Authorization;
    const match = typeof auth === "string" && auth.match(/^Bearer ([^\s]{16,512})$/);
    if (!match) return reply(401, { ok: false, code: "CREDENTIAL_INVALID" });
    let input;
    try {
      input = typeof event.body === "string" ? JSON.parse(event.body) : event.body;
    } catch {
      return reply(400, { ok: false, code: "INVALID_REQUEST" });
    }
    if (!input || typeof input !== "object" || Array.isArray(input)) return reply(400, { ok: false, code: "INVALID_REQUEST" });
    try {
      const jobId = requireId(input.jobId);
      let result;
      if (input.action === "claim") result = await claimContainerJob({ database, jobId, credential: match[1], now: now(), createDownloadDescriptor });
      else if (input.action === "complete") result = await completeContainerJob({ database, jobId, leaseId: input.leaseId, leaseToken: match[1], result: input.result, now: now(), photoCleanup });
      else if (input.action === "fail") result = await failContainerJob({ database, jobId, leaseId: input.leaseId, leaseToken: match[1], errorCode: input.errorCode, now: now(), photoCleanup });
      else return reply(400, { ok: false, code: "INVALID_ACTION" });
      return reply(200, { ok: true, ...result });
    } catch (error) {
      if (["CREDENTIAL_INVALID", "CREDENTIAL_EXPIRED", "CREDENTIAL_USED", "LEASE_INVALID", "LEASE_EXPIRED"].includes(error?.code)) {
        return reply(401, { ok: false, code: "CREDENTIAL_INVALID" });
      }
      return reply(503, { ok: false, code: "CREDENTIAL_SERVICE_UNAVAILABLE" });
    }
  };
}
async function analysisApi(event, context) {
  const cloud = require("wx-server-sdk");
  cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
  const database = adaptCloudDatabase(cloud.database());
  const photoCleanup = createPhotoCleanup({ database, cloud, alert: (event2) => console.error(JSON.stringify(event2)) });
  if (event?.httpMethod) {
    const createDownloadDescriptor = createProductionDownloadDescriptor({
      cloud,
      allowedPhotoHosts: String(process.env.PHOTO_URL_HOSTS || "").split(",").map((host) => host.trim()).filter(Boolean)
    });
    return createContainerCoordinatorMain({ database, createDownloadDescriptor, photoCleanup })(event);
  }
  const dispatchAnalysis = (delivery) => createProductionDispatch({ endpoint: process.env.FACE_ANALYSIS_URL })(delivery);
  return createAnalysisApi({ database, getWXContext: () => cloud.getWXContext(), dispatchAnalysis, photoCleanup })(event, context);
}
module.exports = {
  main: createClientSafeMain(analysisApi),
  analysisApi,
  claimContainerJob,
  completeContainerJob,
  createAnalysisApi,
  createPhotoCleanup,
  createClientSafeMain,
  createContainerCoordinatorMain,
  createProductionDispatch,
  createProductionDownloadDescriptor,
  failContainerJob,
  recoverExpiredContainerLease,
  transitionAnalysisJob,
  computeMeasurements,
  inferQuestionnaire,
  composeReport,
  buildIdentityPresentation
};
