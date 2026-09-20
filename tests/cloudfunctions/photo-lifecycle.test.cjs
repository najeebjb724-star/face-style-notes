const test = require("node:test");
const assert = require("node:assert/strict");

test("analysis API exposes the physical-deletion cleanup hook", () => {
  const analysis = require("../../cloudfunctions/analysisApi/src/index");
  assert.equal(typeof analysis.createPhotoCleanup, "function");
});

const { createHash } = require("node:crypto");
const analysis = require("../../cloudfunctions/analysisApi/src/index");
const { createChallengeApi } = require("../../cloudfunctions/challengeApi/src/index");
const { createPhotoLifecycle } = require("../../cloudfunctions/lifecycleJobs");
const { makeFrontLandmarks } = require("../fixtures/landmarks.cjs");
const NOW = new Date("2026-09-07T08:00:00.000Z");

function database(seed = {}) {
  const records = structuredClone(seed);
  let inTransaction = false;
  const command = Object.fromEntries(["lte", "gt", "in", "neq"].map(op => [op, value => ({ op, value })]));
  const matches = (item, filter) => Object.entries(filter).every(([key, value]) => {
    if (!value?.op) return item[key] === value;
    if (value.op === "lte") return item[key] <= value.value;
    if (value.op === "gt") return item[key] > value.value;
    if (value.op === "in") return value.value.includes(item[key]);
    return item[key] !== value.value;
  });
  const collection = name => ({
    doc(id) { return {
      async get() { return { data: structuredClone((records[name] || []).find(x => x._id === id) || null) }; },
      async set(data) { const rows = records[name] ||= []; const index = rows.findIndex(x => x._id === id); const row = { _id: id, ...data }; if (index < 0) rows.push(row); else rows[index] = row; },
      async update(data) { Object.assign(records[name].find(x => x._id === id), data); },
      async remove() { records[name] = records[name].filter(x => x._id !== id); }
    }; },
    where(filter) { let limit = 100; let order; return {
      limit(value) { limit = value; return this; }, orderBy(key) { order = key; return this; },
      async get() { const rows = (records[name] || []).filter(x => matches(x, filter)); if (order) rows.sort((a, b) => String(a[order]).localeCompare(String(b[order]))); return { data: structuredClone(rows.slice(0, limit)) }; }
    }; }
  });
  return { records, command, collection, serverDate: () => NOW.toISOString(),
    get inTransaction() { return inTransaction; },
    async runTransaction(callback) { assert.equal(inTransaction, false); inTransaction = true; try { return await callback({ collection }); } finally { inTransaction = false; } }
  };
}

function setup(seed, overrides = {}) {
  const db = database(seed); const calls = [];
  const cloud = { async deleteFile({ fileList }) {
    assert.equal(db.inTransaction, false, "physical deletion must happen after commit");
    calls.push(fileList); return { fileList: fileList.map(fileID => ({ fileID, status: 0 })) };
  }, ...overrides };
  return { db, cloud, calls, lifecycle: createPhotoLifecycle({ database: db, cloud, now: () => NOW }) };
}

function seedJob() {
  return {
    analysis_jobs: [{ _id: "job-A", _openid: "owner", reservationId: "upload-A", status: "processing", sourcePhotoStatus: "pending",
      tempFileId: "cloud://env/analysis/upload-A/source.jpg", deleteBy: "2026-09-07T08:30:00.000Z",
      leaseId: "lease-A", leaseHash: createHash("sha256").update("lease-secret-value").digest("hex"), leaseExpiresAt: "2026-09-07T08:01:00.000Z", quality: { level: "high" } }],
    analysis_uploads: [{ _id: "upload-A", _openid: "owner", status: "assigned", jobId: "job-A", tempFileId: "cloud://env/analysis/upload-A/source.jpg", deleteBy: "2026-09-07T08:30:00.000Z" }]
  };
}

for (const terminal of ["complete", "failed", "timeout", "cancelled"]) {
  test(`${terminal} deletes the server photo after committing the terminal transition`, async () => {
    const { db, cloud, calls } = setup(seedJob());
    const photoCleanup = analysis.createPhotoCleanup({ database: db, cloud, now: () => NOW });
    const args = { database: db, photoCleanup, jobId: "job-A", leaseId: "lease-A", leaseToken: "lease-secret-value", now: NOW };
    if (terminal === "complete") await analysis.completeContainerJob({ ...args, result: { jobId: "job-A", points: makeFrontLandmarks(), modelVersion: "face-api-0.22.2", detectionScore: .99, faceBox: { x: 0, y: 0, width: 100, height: 100 }, imageSize: { width: 500, height: 500 } } });
    if (terminal === "failed") await analysis.failContainerJob({ ...args, errorCode: "NO_FACE" });
    if (terminal === "timeout") await analysis.recoverExpiredContainerLease({ ...args, now: new Date("2026-09-07T08:02:00Z") });
    if (terminal === "cancelled") await analysis.createAnalysisApi({ database: db, getWXContext: () => ({ OPENID: "owner" }), photoCleanup, now: () => NOW })({ action: "cancelAnalysis", payload: { jobId: "job-A", tempFileId: "cloud://victim" } });
    assert.deepEqual(calls, [["cloud://env/analysis/upload-A/source.jpg"]]);
    assert.equal(db.records.analysis_jobs[0].sourcePhotoStatus, "deleted");
    assert.equal(db.records.deletion_jobs[0].state, "deleted");
  });
}

test("physical deletion is idempotent and cannot delete a live job early", async () => {
  const { db, lifecycle, calls } = setup(seedJob());
  await assert.rejects(lifecycle.deleteAnalysisPhoto("job-A"), /NOT_DUE/);
  db.records.analysis_jobs[0].status = "failed";
  await lifecycle.deleteAnalysisPhoto("job-A"); await lifecycle.deleteAnalysisPhoto("job-A");
  assert.equal(calls.length, 1);
});

test("per-file failures persist retries, sanitize errors and escalate without claiming deletion", async () => {
  const seed = seedJob(); seed.analysis_jobs[0].status = "failed";
  const { db, lifecycle } = setup(seed, { deleteFile: async () => ({ fileList: [{ status: -1, errMsg: "secret signed URL" }] }) });
  for (let attempt = 1; attempt <= 3; attempt++) {
    await lifecycle.deleteAnalysisPhoto("job-A");
    assert.equal(db.records.deletion_jobs[0].attempts, attempt);
    assert.equal(db.records.deletion_jobs[0].state, attempt === 3 ? "manual_review" : "retrying");
    assert.equal(db.records.analysis_jobs[0].photoDeletedAt, undefined);
  }
  assert.doesNotMatch(JSON.stringify(db.records.deletion_jobs), /secret/);
});

test("timer filters before limiting and expires originals at 30 minutes", async () => {
  const seed = seedJob();
  seed.analysis_jobs = Array.from({ length: 55 }, (_, i) => ({ ...seed.analysis_jobs[0], _id: `future-${i}` }));
  seed.analysis_jobs.push({ ...seed.analysis_jobs[0], _id: "expired", deleteBy: NOW.toISOString() });
  const { db, calls, lifecycle } = setup(seed);
  await lifecycle.deleteExpiredPhotos();
  assert.equal(calls.length, 1);
  assert.equal(db.records.analysis_jobs.at(-1).sourcePhotoStatus, "deleted");
});

test("abandoned uploads delete immediately without accepting payload file IDs", async () => {
  const seed = seedJob(); seed.analysis_uploads[0].status = "attached"; delete seed.analysis_uploads[0].jobId; seed.analysis_jobs = [];
  const { db, cloud, calls } = setup(seed);
  const photoCleanup = analysis.createPhotoCleanup({ database: db, cloud, now: () => NOW });
  const api = analysis.createAnalysisApi({ database: db, photoCleanup, getWXContext: () => ({ OPENID: "owner" }), now: () => NOW });
  await api({ action: "abandonUpload", payload: { reservationId: "upload-A", tempFileId: "cloud://victim" } });
  assert.deepEqual(calls, [["cloud://env/analysis/upload-A/source.jpg"]]);
});

test("challenge deletion retries survive removal of the challenge and respect ownership", async () => {
  const { db, cloud, calls, lifecycle } = setup({ challenges: [{ _id: "c", _openid: "owner", status: "active" }], challenge_photos: [
    { _id: "photo", challengeId: "c", _openid: "owner", fileId: "cloud://env/owned", retentionPolicy: "keep" },
    { _id: "other", challengeId: "c", _openid: "other", fileId: "cloud://env/other" }
  ] });
  let failed = true;
  cloud.deleteFile = async ({ fileList }) => { calls.push(fileList); return { fileList: fileList.map(fileID => ({ fileID, status: failed ? -1 : 0 })) }; };
  const api = createChallengeApi({ database: db, getWXContext: () => ({ OPENID: "owner" }), photoCleanup: lifecycle, now: () => NOW });
  await api({ action: "delete", payload: { challengeId: "c" } });
  assert.equal(calls.length, 1); assert.equal(db.records.challenges.length, 0);
  failed = false;
  await lifecycle.deleteExpiredPhotos(new Date(NOW.getTime() + 60000));
  assert.equal(db.records.challenge_photos[0].deletionState, "deleted");
  assert.deepEqual(calls, [["cloud://env/owned"], ["cloud://env/owned"]]);
});

test("completed challenges retain photos for seven days and preserve explicitly kept photos", async () => {
  const { db, lifecycle, calls } = setup({ challenges: [{ _id: "c", _openid: "owner", status: "completed", completedAt: "2026-08-31" }],
    challenge_photos: [{ _id: "photo", challengeId: "c", _openid: "owner", fileId: "cloud://env/owned" },
      { _id: "keep", challengeId: "c", _openid: "owner", fileId: "cloud://env/keep", retentionPolicy: "keep" }] });
  await lifecycle.deleteExpiredPhotos(new Date("2026-09-06T23:59:59Z")); assert.equal(calls.length, 0);
  await lifecycle.deleteExpiredPhotos(NOW);
  assert.deepEqual(calls, [["cloud://env/owned"]]); assert.equal(db.records.challenge_photos[0].deletionState, "deleted");
});

test("timer makes only one failed physical attempt per photo per invocation", async () => {
  const seed = seedJob(); seed.analysis_jobs[0].status = "failed"; seed.analysis_jobs[0].sourcePhotoStatus = "deleting";
  let attempts = 0;
  const { lifecycle } = setup(seed, { deleteFile: async () => { attempts++; throw new Error("offline"); } });
  await lifecycle.deleteAnalysisPhoto("job-A");
  await lifecycle.deleteExpiredPhotos(NOW);
  assert.equal(attempts, 1);
});

test("timer detects expired processing leases before the 30-minute deadline", async () => {
  const { lifecycle, calls } = setup(seedJob());
  await lifecycle.deleteExpiredPhotos(new Date("2026-09-07T08:02:00Z"));
  assert.equal(calls.length, 1);
});

test("timer does not throw or delete early between business-date completion and exact seven-day deadline", async () => {
  const { lifecycle, calls } = setup({ challenges: [{ _id: "c", _openid: "owner", status: "completed", completedAt: "2026-08-31", photoDeleteBy: "2026-09-07T10:00:00Z" }] });
  await lifecycle.deleteExpiredPhotos(NOW);
  assert.equal(calls.length, 0);
});

test("timer deletes no more than 50 photos in one invocation", async () => {
  const seed = seedJob();
  seed.analysis_jobs = Array.from({ length: 65 }, (_, i) => ({ ...seed.analysis_jobs[0], _id: `expired-${i}`, deleteBy: NOW.toISOString() }));
  const { lifecycle, calls } = setup(seed);
  await lifecycle.deleteExpiredPhotos(NOW); assert.equal(calls.length, 50);
  await lifecycle.deleteExpiredPhotos(NOW); assert.equal(calls.length, 65);
});

test("overdue analysis originals have priority over a large challenge deletion", async () => {
  const seed = { ...seedJob(), deletion_jobs: [{ _id: "challenge-c", kind: "challenge", sourceId: "c", _openid: "owner", state: "pending", dueAt: "2026-09-01", deleteAll: true }],
    challenge_photos: Array.from({ length: 60 }, (_, i) => ({ _id: `photo-${String(i).padStart(2, "0")}`, challengeId: "c", _openid: "owner", fileId: `cloud://env/photo-${i}` })) };
  seed.analysis_jobs[0].status = "failed";
  const { lifecycle, calls } = setup(seed);
  await lifecycle.deleteExpiredPhotos(NOW);
  assert.deepEqual(calls[0], ["cloud://env/analysis/upload-A/source.jpg"]);
  assert.equal(calls.length, 50);
});

test("challenge cleanup advances past retry-not-due photos and reaches later pages", async () => {
  const photos = Array.from({ length: 60 }, (_, i) => ({ _id: `photo-${String(i).padStart(2, "0")}`, challengeId: "c", _openid: "owner", fileId: `cloud://env/photo-${i}` }));
  const seed = { deletion_jobs: [{ _id: "challenge-c", kind: "challenge", sourceId: "c", _openid: "owner", state: "pending", dueAt: "2026-09-01", deleteAll: true },
    ...photos.slice(0, 50).map(photo => ({ _id: `challenge-photo-${photo._id}`, kind: "challenge-photo", sourceId: photo._id, _openid: "owner", state: "retrying", dueAt: "2026-09-08" }))], challenge_photos: photos };
  const { lifecycle, calls } = setup(seed);
  await lifecycle.deleteExpiredPhotos(NOW);
  assert.equal(calls.length, 0);
  await lifecycle.deleteExpiredPhotos(new Date(NOW.getTime() + 60000));
  assert.equal(calls.length, 10);
  assert.deepEqual(calls.map(x => x[0]), photos.slice(50).map(x => x.fileId));
});

test("repeated challenge failures rotate the scan so photos beyond fifty get an attempt", async () => {
  const photos = Array.from({ length: 60 }, (_, i) => ({ _id: `photo-${String(i).padStart(2, "0")}`, challengeId: "c", _openid: "owner", fileId: `cloud://env/photo-${i}` }));
  const { db, lifecycle, calls } = setup({ deletion_jobs: [{ _id: "challenge-c", kind: "challenge", sourceId: "c", _openid: "owner", state: "pending", dueAt: "2026-09-01", deleteAll: true }], challenge_photos: photos },
    { deleteFile: async ({ fileList }) => { calls.push(fileList); return { fileList: fileList.map(fileID => ({ fileID, status: -1 })) }; } });
  await lifecycle.deleteExpiredPhotos(NOW);
  await lifecycle.deleteExpiredPhotos(new Date(NOW.getTime() + 60000));
  assert.equal(new Set(calls.map(x => x[0])).size, 60);
  assert.equal(db.records.deletion_jobs.find(x => x._id === "challenge-c").photoScanAfter !== undefined, true);
});

test("retry-waiting analysis rows cannot permanently hide a later due original", async () => {
  const base = seedJob().analysis_jobs[0];
  const jobs = Array.from({ length: 51 }, (_, i) => ({ ...base, _id: `job-${String(i).padStart(2, "0")}`, status: "failed", sourcePhotoStatus: "deleting", tempFileId: `cloud://env/job-${i}` }));
  const intents = jobs.slice(0, 50).map(job => ({ _id: `analysis-${job._id}`, kind: "analysis", sourceId: job._id, state: "retrying", dueAt: "2026-09-08" }));
  const { lifecycle, calls } = setup({ analysis_jobs: jobs, deletion_jobs: intents });
  await lifecycle.deleteExpiredPhotos(NOW);
  assert.equal(calls.length, 0);
  await lifecycle.deleteExpiredPhotos(new Date(NOW.getTime() + 60000));
  assert.deepEqual(calls, [["cloud://env/job-50"]]);
});

test("retry-waiting uploads cannot permanently hide a later due reservation", async () => {
  const uploads = Array.from({ length: 51 }, (_, i) => ({ _id: `upload-${String(i).padStart(2, "0")}`, _openid: "owner", status: "deleting", tempFileId: `cloud://env/upload-${i}` }));
  const intents = uploads.slice(0, 50).map(upload => ({ _id: `upload-${upload._id}`, kind: "upload", sourceId: upload._id, state: "retrying", dueAt: "2026-09-08" }));
  const { lifecycle, calls } = setup({ analysis_uploads: uploads, deletion_jobs: intents });
  await lifecycle.deleteExpiredPhotos(NOW);
  assert.equal(calls.length, 0);
  await lifecycle.deleteExpiredPhotos(new Date(NOW.getTime() + 60000));
  assert.deepEqual(calls, [["cloud://env/upload-50"]]);
});

test("the existing choose-again abandon action cancels an assigned job and rejects other owners", async () => {
  const { db, cloud, calls } = setup(seedJob());
  const photoCleanup = analysis.createPhotoCleanup({ database: db, cloud, now: () => NOW });
  const stranger = analysis.createAnalysisApi({ database: db, photoCleanup, getWXContext: () => ({ OPENID: "stranger" }), now: () => NOW });
  await assert.rejects(stranger({ action: "abandonUpload", payload: { reservationId: "upload-A" } }), /FORBIDDEN/);
  assert.equal(calls.length, 0);
  const api = analysis.createAnalysisApi({ database: db, photoCleanup, getWXContext: () => ({ OPENID: "owner" }), now: () => NOW });
  await api({ action: "abandonUpload", payload: { reservationId: "upload-A" } });
  assert.equal(db.records.analysis_jobs[0].status, "failed");
  assert.deepEqual(calls, [["cloud://env/analysis/upload-A/source.jpg"]]);
});

test("unattached reservations without a server-stored file ID escalate without inventing deletion targets", async () => {
  const { db, lifecycle, calls } = setup({ analysis_uploads: [{ _id: "upload-A", _openid: "owner", cloudPath: "analysis/upload-A/source.jpg", status: "pending", deleteBy: NOW.toISOString() }] });
  for (let n = 0; n < 3; n++) await lifecycle.deleteExpiredPhotos(new Date(NOW.getTime() + n * 60000));
  assert.equal(calls.length, 0);
  assert.equal(db.records.deletion_jobs.find(x => x._id === "upload-upload-A").state, "manual_review");
  assert.equal(db.records.analysis_uploads[0].photoDeletedAt, undefined);
});

test("production database boundary passes SDK data envelopes for ordinary and transaction writes", async () => {
  const { adaptCloudDatabase } = require("../../cloudfunctions/lifecycleJobs");
  assert.equal(typeof adaptCloudDatabase, "function");
  const writes = [];
  const collection = name => ({ doc: id => ({
    set: async options => { assert.deepEqual(Object.keys(options), ["data"]); writes.push([name, id, options.data]); },
    update: async options => { assert.deepEqual(Object.keys(options), ["data"]); writes.push([name, id, options.data]); },
    get: async () => ({ data: { _id: id } }), remove: async () => {}
  }), where: filter => ({ get: async () => ({ data: [filter] }) }) });
  const adapted = adaptCloudDatabase({ collection, runTransaction: callback => callback({ collection }), command: {}, serverDate: () => "server-time" });
  await adapted.collection("analysis_jobs").doc("a").set({ status: "queued" });
  await adapted.runTransaction(async tx => tx.collection("analysis_jobs").doc("a").update({ status: "failed" }));
  assert.deepEqual(writes, [["analysis_jobs", "a", { status: "queued" }], ["analysis_jobs", "a", { status: "failed" }]]);
  assert.deepEqual(await adapted.collection("analysis_jobs").doc("a").get(), { data: { _id: "a" } });
});

test("deadline cleanup does not overwrite a concurrently completed report", async () => {
  const seed = seedJob(); seed.analysis_jobs[0].deleteBy = NOW.toISOString();
  const { db, lifecycle } = setup(seed);
  const transact = db.runTransaction;
  let first = true;
  db.runTransaction = async callback => {
    if (first) { first = false; Object.assign(db.records.analysis_jobs[0], { status: "complete", reportId: "report-A" }); }
    return transact(callback);
  };
  await lifecycle.deleteAnalysisPhoto("job-A");
  assert.equal(db.records.analysis_jobs[0].status, "complete");
  assert.equal(db.records.analysis_jobs[0].reportId, "report-A");
});

test("failed terminal cleanup does not retry the same file through its upload reservation", async () => {
  let attempts = 0;
  const { db, cloud, lifecycle } = setup(seedJob(), { deleteFile: async () => { attempts++; throw new Error("offline"); } });
  await analysis.failContainerJob({ database: db, photoCleanup: lifecycle, jobId: "job-A", leaseId: "lease-A", leaseToken: "lease-secret-value", now: NOW });
  await lifecycle.deleteExpiredPhotos(new Date(NOW.getTime() + 60000));
  assert.equal(attempts, 2);
  assert.equal(db.records.deletion_jobs.filter(x => x.kind === "analysis").length, 1);
});
