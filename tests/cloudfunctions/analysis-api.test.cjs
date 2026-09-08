const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { execFileSync } = require("node:child_process");

const {
  createAnalysisApi,
  consumeContainerCredential,
  transitionAnalysisJob
} = require("../../cloudfunctions/analysisApi");

function createDatabase(seed = {}) {
  const records = Object.fromEntries(Object.entries(seed).map(([name, values]) => [name, values.map(value => ({ ...value }))]));
  const collection = name => ({
    doc(id) {
      return {
        async get() {
          const found = (records[name] || []).find(item => item._id === id);
          if (!found) {
            const error = new Error("not exist");
            error.code = "DATABASE_DOCUMENT_NOT_EXIST";
            throw error;
          }
          return { data: { ...found } };
        },
        async set(data) {
          const list = records[name] || (records[name] = []);
          const index = list.findIndex(item => item._id === id);
          const next = { _id: id, ...data };
          if (index < 0) list.push(next); else list[index] = next;
          return { _id: id };
        },
        async update(data) {
          const item = (records[name] || []).find(value => value._id === id);
          if (!item) throw new Error("not exist");
          Object.assign(item, data);
        }
      };
    },
    where(filters) {
      const matching = () => (records[name] || []).filter(item => Object.entries(filters).every(([key, value]) => item[key] === value));
      return {
        limit() { return this; },
        async get() { return { data: matching().map(item => ({ ...item })) }; }
      };
    }
  });
  return {
    collection,
    runTransaction: callback => callback({ collection }),
    serverDate: () => ({ $serverDate: true }),
    records
  };
}

function setup(openid = "openid-A", seed = {}, overrides = {}) {
  const database = createDatabase({
    analysis_uploads: [{
      _id: "reservation-A", _openid: openid, consentId: "consent-A", clientRequestId: "request-A",
      cloudPath: "analysis/server-random/photo.jpg", tempFileId: "cloud://env/analysis/random/photo.jpg",
      status: "attached", deleteBy: "2026-09-07T08:30:00.000Z"
    }],
    ...seed
  });
  let sequence = 0;
  const api = createAnalysisApi({
    database,
    getWXContext: () => ({ OPENID: openid }),
    now: () => new Date("2026-09-07T08:00:00.000Z"),
    createId: prefix => `${prefix}-${++sequence}`,
    createCredential: () => "container-secret",
    ...overrides
  });
  return { api, database };
}

const activeConsent = {
  _id: "consent-A",
  _openid: "openid-A",
  type: "face-analysis",
  version: "2026-09-03",
  acceptedAt: "2026-09-07T07:55:00.000Z",
  revokedAt: null
};

function analysisPayload(overrides = {}) {
  return {
    consentId: "consent-A", reservationId: "reservation-A",
    tempFileId: "cloud://env/analysis/random/photo.jpg",
    quality: { accepted: true, scope: "local-basic" }, clientRequestId: "request-A",
    ...overrides
  };
}

test("upload reservation is owned, server-named, attached, and retention-bounded", async () => {
  const { api, database } = setup("openid-A", { consents: [activeConsent], analysis_uploads: [] }, {
    createId: prefix => `${prefix}-server-random`
  });
  const reservation = await api({ action: "reserveUpload", payload: { consentId: "consent-A", clientRequestId: "request-A", uploadRequestId: "upload-A" } });
  assert.match(reservation.cloudPath, /^analysis\/reservation-[0-9a-f]{64}\/photo-server-random\.jpg$/);
  const stored = database.records.analysis_uploads[0];
  assert.equal(stored._openid, "openid-A");
  assert.equal(stored.deleteBy, "2026-09-07T08:30:00.000Z");
  const attached = await api({ action: "attachUpload", payload: {
    reservationId: reservation.reservationId,
    tempFileId: `cloud://env/${reservation.cloudPath}`
  }});
  assert.deepEqual(attached, { reservationId: reservation.reservationId, status: "attached" });
  assert.deepEqual(await api({ action: "attachUpload", payload: {
    reservationId: reservation.reservationId,
    tempFileId: `cloud://env/${reservation.cloudPath}`
  }}), attached);
});

test("an upload reservation cannot be reused for another analysis request or consent", async () => {
  const upload = {
    _id: "reservation-A", _openid: "openid-A", consentId: "consent-A", clientRequestId: "request-A",
    cloudPath: "analysis/server-random/photo.jpg", tempFileId: "cloud://env/analysis/random/photo.jpg", status: "attached"
  };
  for (const overrides of [{ clientRequestId: "request-B" }, { consentId: "consent-B" }]) {
    const consents = overrides.consentId ? [activeConsent, { ...activeConsent, _id: "consent-B" }] : [activeConsent];
    const { api } = setup("openid-A", { consents, analysis_uploads: [upload] });
    await assert.rejects(() => api({ action: "createAnalysis", payload: analysisPayload(overrides) }), /UPLOAD_REQUIRED/);
  }
});

test("recordConsent binds approved consent to trusted OPENID", async () => {
  const { api, database } = setup();
  const result = await api({ action: "recordConsent", payload: {
    type: "face-analysis", version: "2026-09-03", acceptedAt: "2026-09-07T07:55:00.000Z", _openid: "forged"
  }});
  assert.equal(result.consentId, "consent-1");
  assert.equal(database.records.consents[0]._openid, "openid-A");
  await assert.rejects(() => api({ action: "recordConsent", payload: {
    type: "challenge-photo", version: "2026-09-03", acceptedAt: "2026-09-07T07:55:00.000Z"
  }}), /INVALID_ARGUMENT/);
});

test("recordConsent rejects a client timestamp in the future", async () => {
  const { api } = setup();
  await assert.rejects(() => api({ action: "recordConsent", payload: {
    type: "face-analysis", version: "2026-09-03", acceptedAt: "2026-09-07T08:00:01.000Z"
  }}), /INVALID_ARGUMENT/);
});

test("analysis job requires an owned active consent", async () => {
  for (const consent of [
    { ...activeConsent, _openid: "openid-B" },
    { ...activeConsent, revokedAt: "2026-09-07T07:59:00.000Z" },
    { ...activeConsent, acceptedAt: "2026-09-07T08:00:01.000Z" }
  ]) {
    const { api } = setup("openid-A", { consents: [consent] });
    await assert.rejects(() => api({ action: "createAnalysis", payload: analysisPayload() }), /CONSENT_REQUIRED/);
  }
});

test("createAnalysis is per-user idempotent and uses trusted retention time", async () => {
  let credentials = 0;
  const { api, database } = setup("openid-A", { consents: [activeConsent] }, {
    createCredential: () => { credentials += 1; return "container-secret"; }
  });
  const payload = {
    ...analysisPayload({ quality: { accepted: true, scope: "local-basic", level: "medium" } }),
    createdAt: "2099-01-01T00:00:00.000Z",
    deleteBy: "2099-01-01T00:00:00.000Z"
  };
  const first = await api({ action: "createAnalysis", payload });
  const second = await api({ action: "createAnalysis", payload: { ...payload, tempFileId: "cloud://env/analysis/other.jpg" } });
  assert.deepEqual(second, first);
  assert.equal(database.records.analysis_jobs.length, 1);
  assert.equal(credentials, 1);
  assert.equal(database.records.analysis_jobs[0].deleteBy, "2026-09-07T08:30:00.000Z");
  assert.match(first.jobId, /^job-[0-9a-f]{64}$/);
  assert.equal(first.status, "queued");
});

test("one-time credential is handed only to the internal dispatcher", async () => {
  const deliveries = [];
  const { api, database } = setup("openid-A", { consents: [activeConsent] }, {
    dispatchAnalysis: async value => deliveries.push(value)
  });
  const result = await api({ action: "createAnalysis", payload: {
    ...analysisPayload({ quality: { accepted: true } })
  }});
  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0].credential, "container-secret");
  assert.equal(deliveries[0].jobId, result.jobId);
  assert.equal(database.records.analysis_jobs[0].credential, undefined);
  assert.equal(result.credential, undefined);
});

test("ordinary status query is owned and exposes only the minimum view", async () => {
  const secretFields = {
    _id: "job-A", _openid: "openid-A", status: "processing", reportId: null,
    tempFileId: "cloud://secret", credentialHash: "hash", quality: { metrics: { private: true } }, sourcePhotoStatus: "pending"
  };
  const owner = setup("openid-A", { analysis_jobs: [secretFields] }).api;
  assert.deepEqual(await owner({ action: "getAnalysis", payload: { jobId: "job-A" } }), { status: "processing" });
  const other = setup("openid-B", { analysis_jobs: [secretFields] }).api;
  await assert.rejects(() => other({ action: "getAnalysis", payload: { jobId: "job-A" } }), /FORBIDDEN/);
});

test("failed status never exposes an internal error message", async () => {
  const api = setup("openid-A", { analysis_jobs: [{
    _id: "job-A", _openid: "openid-A", status: "failed", sourcePhotoStatus: "manual_review",
    error: "storage URL and internal stack trace"
  }] }).api;
  assert.deepEqual(await api({ action: "getAnalysis", payload: { jobId: "job-A" } }), {
    status: "failed", error: "ANALYSIS_FAILED"
  });
});

test("container credential is stored only as hash and can be consumed once", async () => {
  const { api, database } = setup("openid-A", { consents: [activeConsent] });
  await api({ action: "createAnalysis", payload: {
    ...analysisPayload({ quality: { accepted: true } })
  }});
  const job = database.records.analysis_jobs[0];
  assert.equal(job.credential, undefined);
  assert.notEqual(job.credentialHash, "container-secret");
  assert.equal(await consumeContainerCredential({ database, jobId: job._id, credential: "container-secret", now: new Date("2026-09-07T08:01:00.000Z") }), true);
  await assert.rejects(() => consumeContainerCredential({ database, jobId: job._id, credential: "container-secret", now: new Date("2026-09-07T08:02:00.000Z") }), /CREDENTIAL_USED/);
});

test("container credential rejects wrong, expired, and wrong-purpose tokens", async () => {
  const makeJob = purpose => ({
    _id: "job-A", credentialHash: require("node:crypto").createHash("sha256").update("container-secret").digest("hex"),
    credentialPurpose: purpose, credentialExpiresAt: "2026-09-07T08:05:00.000Z", credentialUsedAt: null
  });
  await assert.rejects(() => consumeContainerCredential({ database: createDatabase({ analysis_jobs: [makeJob("face-analysis")] }), jobId: "job-A", credential: "wrong-secret-value", now: new Date("2026-09-07T08:01:00Z") }), /CREDENTIAL_INVALID/);
  await assert.rejects(() => consumeContainerCredential({ database: createDatabase({ analysis_jobs: [makeJob("face-analysis")] }), jobId: "job-A", credential: "container-secret", now: new Date("2026-09-07T08:06:00Z") }), /CREDENTIAL_EXPIRED/);
  await assert.rejects(() => consumeContainerCredential({ database: createDatabase({ analysis_jobs: [makeJob("other")] }), jobId: "job-A", credential: "container-secret", now: new Date("2026-09-07T08:01:00Z") }), /CREDENTIAL_INVALID/);
  const invalidExpiry = makeJob("face-analysis");
  invalidExpiry.credentialExpiresAt = "not-a-date";
  await assert.rejects(() => consumeContainerCredential({ database: createDatabase({ analysis_jobs: [invalidExpiry] }), jobId: "job-A", credential: "container-secret", now: new Date("2026-09-07T08:01:00Z") }), /CREDENTIAL_INVALID/);
});

test("concurrent credential consumption has exactly one winner", async () => {
  const hash = require("node:crypto").createHash("sha256").update("container-secret").digest("hex");
  const database = createDatabase({ analysis_jobs: [{ _id: "job-A", credentialHash: hash, credentialPurpose: "face-analysis", credentialExpiresAt: "2026-09-07T08:05:00.000Z", credentialUsedAt: null }] });
  let tail = Promise.resolve();
  database.runTransaction = callback => {
    const result = tail.then(() => callback({ collection: database.collection }));
    tail = result.catch(() => {});
    return result;
  };
  const results = await Promise.allSettled([1, 2].map(() => consumeContainerCredential({ database, jobId: "job-A", credential: "container-secret", now: new Date("2026-09-07T08:01:00Z") })));
  assert.equal(results.filter(value => value.status === "fulfilled").length, 1);
  assert.equal(results.filter(value => value.status === "rejected" && /CREDENTIAL_USED/.test(value.reason.message)).length, 1);
});

test("internal transitions enforce the documented status enums", () => {
  assert.deepEqual(transitionAnalysisJob({ status: "queued", sourcePhotoStatus: "pending" }, { status: "processing" }), { status: "processing", sourcePhotoStatus: "pending" });
  assert.throws(() => transitionAnalysisJob({ status: "queued", sourcePhotoStatus: "pending" }, { status: "invented" }), /INVALID_STATUS/);
  assert.throws(() => transitionAnalysisJob({ status: "queued", sourcePhotoStatus: "pending" }, { sourcePhotoStatus: "kept" }), /INVALID_STATUS/);
  assert.throws(() => transitionAnalysisJob({ status: "complete", sourcePhotoStatus: "deleted" }, { status: "processing" }), /INVALID_STATUS/);
  assert.throws(() => transitionAnalysisJob({ status: "processing", sourcePhotoStatus: "manual_review" }, { sourcePhotoStatus: "pending" }), /INVALID_STATUS/);
});

test("dispatch rejection makes the job failed without redispatch or retention extension", async () => {
  let dispatches = 0;
  let credentials = 0;
  const { api, database } = setup("openid-A", { consents: [activeConsent] }, {
    dispatchAnalysis: async () => { dispatches += 1; throw new Error("down"); },
    createCredential: () => { credentials += 1; return "container-secret"; }
  });
  const first = await api({ action: "createAnalysis", payload: analysisPayload() });
  const second = await api({ action: "createAnalysis", payload: analysisPayload() });
  assert.deepEqual(first, { jobId: first.jobId, status: "failed" });
  assert.deepEqual(second, first);
  assert.equal(dispatches, 1);
  assert.equal(credentials, 1);
  assert.equal(database.records.analysis_jobs[0].deleteBy, "2026-09-07T08:30:00.000Z");
  assert.equal(database.records.analysis_jobs[0].sourcePhotoStatus, "deleting");
  assert.equal(database.records.analysis_uploads[0].status, "deleting");
});

test("createAnalysis rejects an unattached, foreign, or mismatched reservation", async () => {
  for (const upload of [
    { _id: "reservation-A", _openid: "openid-A", status: "pending", cloudPath: "analysis/a/photo.jpg" },
    { _id: "reservation-A", _openid: "openid-B", status: "attached", tempFileId: "cloud://env/analysis/random/photo.jpg", cloudPath: "analysis/a/photo.jpg" },
    { _id: "reservation-A", _openid: "openid-A", status: "attached", tempFileId: "cloud://env/analysis/other.jpg", cloudPath: "analysis/a/photo.jpg" }
  ]) {
    const { api } = setup("openid-A", { consents: [activeConsent], analysis_uploads: [upload] });
    await assert.rejects(() => api({ action: "createAnalysis", payload: analysisPayload() }), /UPLOAD_REQUIRED|FORBIDDEN/);
  }
});

function loadPage(relativePath, dependencies, wx) {
  let definition;
  const source = fs.readFileSync(path.join(__dirname, "../../miniprogram", relativePath), "utf8");
  vm.runInNewContext(source, {
    Page(value) { definition = value; }, wx, Promise, Uint8Array, setTimeout: wx.setTimeout, clearTimeout: wx.clearTimeout,
    require(name) { if (!(name in dependencies)) throw new Error(`unexpected require: ${name}`); return dependencies[name]; }
  });
  return definition;
}

test("analysis page never uploads without valid JPEG consent and quality", async () => {
  let uploads = 0;
  const calls = [];
  const wx = { getStorageSync: () => null, uploadFile() { uploads += 1; }, showToast() {}, navigateBack() {}, setTimeout, clearTimeout };
  const definition = loadPage("pages/analysis/analysis.js", {
    "../../lib/photo-preflight": { FACE_PREFLIGHT_STORAGE_KEY: "preflight", assertFaceConsent() { throw new Error("CONSENT_REQUIRED"); } },
    "../../services/cloud-client": { callCloud: async (...args) => calls.push(args) }
  }, wx);
  const page = { ...definition, data: { ...definition.data }, setData(value) { Object.assign(this.data, value); } };
  await definition.startAnalysis.call(page);
  assert.equal(uploads, 0);
  assert.equal(calls.length, 0);
});

test("upload failure keeps preflight retryable and never creates a job", async () => {
  const calls = [];
  const preflight = { photo: { path: "local.jpg", type: "jpeg" }, quality: { accepted: true, scope: "local-basic" }, consent: { type: "face-analysis" } };
  const wx = {
    getStorageSync: key => key === "preflight" ? preflight : null,
    setStorageSync() {},
    getRandomValues({ length, success }) { success({ randomValues: new Uint8Array(length).fill(7).buffer }); },
    cloud: { uploadFile({ fail }) { fail(new Error("offline")); } },
    showToast() {}, setTimeout, clearTimeout
  };
  const definition = loadPage("pages/analysis/analysis.js", {
    "../../lib/photo-preflight": { FACE_PREFLIGHT_STORAGE_KEY: "preflight", assertFaceConsent: value => value },
    "../../services/cloud-client": { callCloud: async (name, data) => {
      calls.push([name, data]);
      if (data.action === "recordConsent") return { consentId: "consent-A" };
      return { reservationId: "reservation-A", cloudPath: "analysis/server/photo.jpg" };
    } }
  }, wx);
  const page = { ...definition, data: { ...definition.data }, setData(value) { Object.assign(this.data, value); } };
  await definition.startAnalysis.call(page);
  assert.equal(calls.filter(([, data]) => data.action === "createAnalysis").length, 0);
  assert.equal(page.data.canRetryUpload, true);
  assert.equal(wx.getStorageSync("preflight"), preflight);
});

test("a local persistence failure after upload still leaves a server cleanup reservation", async () => {
  const calls = [];
  let writes = 0;
  let uploads = 0;
  const preflight = { photo: { path: "local.jpg", type: "jpeg" }, quality: { accepted: true, scope: "local-basic" }, consent: { type: "face-analysis" } };
  const wx = {
    getStorageSync: key => key === "preflight" ? preflight : null,
    setStorageSync() { writes += 1; if (writes === 3) throw new Error("storage full"); },
    getRandomValues({ length, success }) { success({ randomValues: new Uint8Array(length).fill(9).buffer }); },
    cloud: { uploadFile({ success }) { uploads += 1; success({ fileID: "cloud://env/analysis/server/photo.jpg" }); } },
    showToast() {}, setTimeout, clearTimeout
  };
  const definition = loadPage("pages/analysis/analysis.js", {
    "../../lib/photo-preflight": { FACE_PREFLIGHT_STORAGE_KEY: "preflight", assertFaceConsent: value => value },
    "../../services/cloud-client": { callCloud: async (_name, data) => {
      calls.push(data.action);
      if (data.action === "recordConsent") return { consentId: "consent-A" };
      if (data.action === "reserveUpload") return { reservationId: "reservation-A", cloudPath: "analysis/server/photo.jpg" };
      throw new Error("must not attach or create");
    } }
  }, wx);
  const page = { ...definition, data: { ...definition.data }, setData(value) { Object.assign(this.data, value); } };
  await definition.startAnalysis.call(page);
  assert.equal(uploads, 1);
  assert.ok(calls.includes("reserveUpload"));
  assert.ok(!calls.includes("createAnalysis"));
  assert.equal(page.data.status, "failed");
});

test("successful page flow uploads to random path, creates job, and stops bounded polling on unload", async () => {
  const calls = [];
  const timers = new Map();
  let timerId = 0;
  let randomCalls = 0;
  const preflight = { photo: { path: "local.jpg", type: "jpeg" }, quality: { accepted: true, scope: "local-basic" }, consent: { type: "face-analysis", version: "2026-09-03", acceptedAt: "2026-09-07T07:55:00.000Z" } };
  const wx = {
    getStorageSync: key => key === "preflight" ? preflight : null,
    setStorageSync() {},
    getRandomValues({ length, success }) { randomCalls += 1; success({ randomValues: new Uint8Array(length).fill(randomCalls).buffer }); },
    cloud: { uploadFile(options) { assert.equal(options.cloudPath, "analysis/server/photo.jpg"); options.success({ fileID: "cloud://env/analysis/server/photo.jpg" }); } },
    showToast() {},
    setTimeout(fn) { const id = ++timerId; timers.set(id, fn); return id; },
    clearTimeout(id) { timers.delete(id); }
  };
  const callCloud = async (name, data) => {
    calls.push([name, data]);
    if (data.action === "recordConsent") return { consentId: "consent-A" };
    if (data.action === "reserveUpload") return { reservationId: "reservation-A", cloudPath: "analysis/server/photo.jpg" };
    if (data.action === "attachUpload") return { reservationId: "reservation-A", status: "attached" };
    if (data.action === "createAnalysis") return { jobId: "job-A", status: "queued" };
    return { status: "processing" };
  };
  const definition = loadPage("pages/analysis/analysis.js", {
    "../../lib/photo-preflight": { FACE_PREFLIGHT_STORAGE_KEY: "preflight", assertFaceConsent: value => value },
    "../../services/cloud-client": { callCloud }
  }, wx);
  const page = { ...definition, data: { ...definition.data }, setData(value) { Object.assign(this.data, value); } };
  await definition.startAnalysis.call(page);
  assert.equal(page.data.status, "queued");
  assert.equal(calls.filter(([, data]) => data.action === "createAnalysis").length, 1);
  const reservation = calls.find(([, data]) => data.action === "reserveUpload")[1].payload;
  assert.notEqual(reservation.clientRequestId, reservation.uploadRequestId);
  assert.doesNotMatch(reservation.clientRequestId, /^0+$/);
  assert.equal(randomCalls, 2);
  assert.ok(timers.size <= 1);
  definition.onUnload.call(page);
  assert.equal(timers.size, 0);
});

test("retry after a lost create response reuses the uploaded file and request id", async () => {
  const storage = new Map();
  let uploads = 0;
  let creates = 0;
  const createPayloads = [];
  const preflight = { photo: { path: "local.jpg", type: "jpeg" }, quality: { accepted: true, scope: "local-basic" }, consent: { type: "face-analysis", version: "2026-09-03", acceptedAt: "2026-09-07T07:55:00.000Z" } };
  storage.set("preflight", preflight);
  const wx = {
    getStorageSync: key => storage.get(key), setStorageSync: (key, value) => storage.set(key, value),
    getRandomValues({ length, success }) { success({ randomValues: new Uint8Array(length).fill(8).buffer }); },
    cloud: { uploadFile({ success }) { uploads += 1; success({ fileID: "cloud://env/analysis/server/photo.jpg" }); } },
    showToast() {}, navigateBack() {}, setTimeout, clearTimeout
  };
  const callCloud = async (_name, data) => {
    if (data.action === "recordConsent") return { consentId: "consent-A" };
    if (data.action === "reserveUpload") return { reservationId: "reservation-A", cloudPath: "analysis/server/photo.jpg" };
    if (data.action === "attachUpload") return { reservationId: "reservation-A", status: "attached" };
    if (data.action === "createAnalysis") {
      creates += 1;
      createPayloads.push(data.payload);
      if (creates === 1) throw new Error("response lost");
      return { jobId: "job-A", status: "queued" };
    }
    return { status: "processing" };
  };
  const dependencies = {
    "../../lib/photo-preflight": { FACE_PREFLIGHT_STORAGE_KEY: "preflight", assertFaceConsent: value => value },
    "../../services/cloud-client": { callCloud }
  };
  const definition = loadPage("pages/analysis/analysis.js", dependencies, wx);
  const first = { ...definition, data: { ...definition.data }, setData(value) { Object.assign(this.data, value); } };
  await definition.startAnalysis.call(first);
  const reloadedDefinition = loadPage("pages/analysis/analysis.js", dependencies, wx);
  const reloaded = { ...reloadedDefinition, data: { ...reloadedDefinition.data }, setData(value) { Object.assign(this.data, value); } };
  await reloadedDefinition.startAnalysis.call(reloaded);
  assert.equal(uploads, 1);
  assert.equal(creates, 2);
  assert.equal(createPayloads[0].tempFileId, createPayloads[1].tempFileId);
  assert.equal(createPayloads[0].clientRequestId, createPayloads[1].clientRequestId);
  reloadedDefinition.onUnload.call(reloaded);
});

test("analysis page uses runtime global timers rather than wx timer methods", () => {
  const source = fs.readFileSync(path.join(__dirname, "../../miniprogram/pages/analysis/analysis.js"), "utf8");
  assert.doesNotMatch(source, /wx\.(?:setTimeout|clearTimeout)/);
});

test("random request ids use the asynchronous WeChat random API and reject failures", async () => {
  const source = fs.readFileSync(path.join(__dirname, "../../miniprogram/pages/analysis/analysis.js"), "utf8");
  assert.match(source, /getRandomValues\(\{[\s\S]*length:[\s\S]*success:[\s\S]*fail:/);
  const preflight = { photo: { path: "local.jpg", type: "jpeg" }, quality: { accepted: true, scope: "local-basic" }, consent: { type: "face-analysis" } };
  const wx = { getStorageSync: key => key === "preflight" ? preflight : null, setStorageSync() {}, getRandomValues({ fail }) { fail(new Error("random failed")); }, showToast() {}, setTimeout, clearTimeout };
  const definition = loadPage("pages/analysis/analysis.js", {
    "../../lib/photo-preflight": { FACE_PREFLIGHT_STORAGE_KEY: "preflight", assertFaceConsent: value => value },
    "../../services/cloud-client": { callCloud: async () => ({ consentId: "consent-A" }) }
  }, wx);
  const page = { ...definition, data: { ...definition.data }, setData(value) { Object.assign(this.data, value); } };
  await definition.startAnalysis.call(page);
  assert.equal(page.data.status, "failed");
});

test("a restored processing job stops after the bounded retry schedule", async () => {
  const timers = new Map();
  let timerId = 0;
  let statusCalls = 0;
  const wx = {
    getStorageSync: key => key === "face-analysis-upload-state" ? { jobId: "job-A" } : null,
    setStorageSync() {}, showToast() {},
    setTimeout(fn) { const id = ++timerId; timers.set(id, fn); return id; },
    clearTimeout(id) { timers.delete(id); }
  };
  const definition = loadPage("pages/analysis/analysis.js", {
    "../../lib/photo-preflight": { FACE_PREFLIGHT_STORAGE_KEY: "preflight", assertFaceConsent: value => value },
    "../../services/cloud-client": { callCloud: async () => { statusCalls += 1; return { status: "processing" }; } }
  }, wx);
  const page = { ...definition, data: { ...definition.data }, setData(value) { Object.assign(this.data, value); } };
  await definition.startAnalysis.call(page);
  while (timers.size) {
    const [id, callback] = timers.entries().next().value;
    timers.delete(id);
    await callback();
  }
  assert.equal(statusCalls, 5);
  assert.equal(timers.size, 0);
  definition.onUnload.call(page);
});

test("unload during a status request prevents late rendering and polling", async () => {
  let resolveStatus;
  const status = new Promise(resolve => { resolveStatus = resolve; });
  const timers = new Map();
  const wx = { getStorageSync: key => key === "face-analysis-upload-state" ? { jobId: "job-A" } : null, setStorageSync() {}, showToast() {}, setTimeout(fn) { timers.set(1, fn); return 1; }, clearTimeout(id) { timers.delete(id); } };
  const definition = loadPage("pages/analysis/analysis.js", {
    "../../lib/photo-preflight": { FACE_PREFLIGHT_STORAGE_KEY: "preflight", assertFaceConsent: value => value },
    "../../services/cloud-client": { callCloud: async () => status }
  }, wx);
  let renders = 0;
  const page = { ...definition, data: { ...definition.data }, setData(value) { renders += 1; Object.assign(this.data, value); } };
  const pending = definition.startAnalysis.call(page);
  definition.onUnload.call(page);
  const before = renders;
  resolveStatus({ status: "processing" });
  await pending;
  assert.equal(renders, before);
  assert.equal(timers.size, 0);
});

test("manual refresh accepts a WeChat tap event and applies the latest status", async () => {
  const wx = { getStorageSync: () => null, setStorageSync() {}, showToast() {}, setTimeout, clearTimeout };
  const definition = loadPage("pages/analysis/analysis.js", {
    "../../lib/photo-preflight": { FACE_PREFLIGHT_STORAGE_KEY: "preflight", assertFaceConsent: value => value },
    "../../services/cloud-client": { callCloud: async () => ({ status: "failed" }) }
  }, wx);
  const page = {
    ...definition, data: { ...definition.data }, _jobId: "job-A", _generation: 3, _disposed: false,
    setData(value) { Object.assign(this.data, value); }
  };
  await definition.refreshStatus.call(page, { type: "tap" });
  assert.equal(page.data.status, "failed");
});

test("a reloaded page can resume an owned job after local preflight cleanup", async () => {
  const timers = new Map();
  const wx = {
    getStorageSync: key => key === "face-analysis-upload-state" ? { jobId: "job-A" } : null,
    setStorageSync() {}, showToast() {},
    setTimeout(fn) { timers.set(1, fn); return 1; }, clearTimeout(id) { timers.delete(id); }
  };
  const calls = [];
  const definition = loadPage("pages/analysis/analysis.js", {
    "../../lib/photo-preflight": { FACE_PREFLIGHT_STORAGE_KEY: "preflight", assertFaceConsent() { throw new Error("CONSENT_REQUIRED"); } },
    "../../services/cloud-client": { callCloud: async (_name, data) => { calls.push(data); return { status: "processing" }; } }
  }, wx);
  const page = { ...definition, data: { ...definition.data }, setData(value) { Object.assign(this.data, value); } };
  await definition.startAnalysis.call(page);
  assert.equal(page.data.status, "processing");
  assert.equal(calls[0].action, "getAnalysis");
  definition.onUnload.call(page);
});

test("analysis UI uses safe copy and is registered", () => {
  const root = path.join(__dirname, "../../miniprogram");
  const app = JSON.parse(fs.readFileSync(path.join(root, "app.json"), "utf8"));
  const markup = fs.readFileSync(path.join(root, "pages/analysis/analysis.wxml"), "utf8");
  assert.ok(app.pages.includes("pages/analysis/analysis"));
  assert.match(markup, /正在准备你的结构参考/);
  assert.match(markup, /手动刷新/);
  assert.match(markup, /重新选择照片/);
  assert.doesNotMatch(markup, /AI分析中|扫描中/);
});

test("deployment package is self-contained and generated entry can be checked without esbuild", () => {
  const root = path.join(__dirname, "../../cloudfunctions/analysisApi");
  execFileSync(process.execPath, [path.join(root, "build.js"), "--check"]);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "analysis-api-"));
  for (const name of ["index.js", "package.json"]) fs.copyFileSync(path.join(root, name), path.join(temp, name));
  assert.doesNotThrow(() => require(temp));
  const source = fs.readFileSync(path.join(root, "index.js"), "utf8");
  assert.doesNotMatch(source, /require\(["']\.\.\//);
});
