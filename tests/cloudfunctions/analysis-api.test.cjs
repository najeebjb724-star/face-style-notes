const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { execFileSync } = require("node:child_process");
const { makeFrontLandmarks } = require("../fixtures/landmarks.cjs");

const {
  claimContainerJob,
  completeContainerJob,
  createAnalysisApi,
  createContainerCoordinatorMain,
  createProductionDispatch,
  createProductionDownloadDescriptor,
  computeMeasurements,
  inferQuestionnaire,
  composeReport,
  buildIdentityPresentation,
  failContainerJob,
  recoverExpiredContainerLease,
  transitionAnalysisJob
} = require("../../cloudfunctions/analysisApi");

test("container HTTP adapter rejects missing bearer without touching jobs", async () => {
  const main = createContainerCoordinatorMain({
    database: { runTransaction() { throw new Error("must not read database"); } },
    createDownloadDescriptor: async () => { throw new Error("must not sign"); }
  });
  const response = await main({ httpMethod: "POST", headers: {}, body: JSON.stringify({ action: "claim", jobId: "job-A" }) });
  assert.equal(response.statusCode, 401);
  assert.equal(JSON.parse(response.body).code, "CREDENTIAL_INVALID");
});

test("container HTTP adapter claims the owned photo then settles failure with a lease", async () => {
  const { api, database } = setup("openid-A", { consents: [activeConsent] });
  await api({ action: "createAnalysis", payload: analysisPayload() });
  const job = database.records.analysis_jobs[0];
  const main = createContainerCoordinatorMain({ database, now: () => new Date("2026-09-07T08:01:00.000Z"),
    createDownloadDescriptor: async fileId => {
      assert.equal(fileId, job.tempFileId);
      return { url: "https://photo.example.test/server", sha256: "a".repeat(64) };
    }
  });
  const send = (token, body) => main({ httpMethod: "POST", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  const claimed = await send("container-secret", { action: "claim", jobId: job._id });
  assert.equal(claimed.statusCode, 200);
  const claim = JSON.parse(claimed.body);
  assert.equal(claim.download.url, "https://photo.example.test/server");
  assert.equal(job.status, "processing");
  const settled = await send(claim.leaseToken, { action: "fail", jobId: job._id,
    leaseId: claim.leaseId, errorCode: "NO_FACE" });
  assert.equal(JSON.parse(settled.body).status, "failed");
  assert.equal(job.sourcePhotoStatus, "deleting");
  assert.equal(database.records.analysis_uploads[0].status, "deleting");
});

test("production dispatch sends only job id and bearer to the configured HTTPS model", async () => {
  const calls = [];
  const dispatch = createProductionDispatch({
    endpoint: "https://model.example.test/analyze",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return { status: 200, ok: true, body: { cancel() {} } };
    }
  });
  await dispatch({ jobId: "job-A", credential: "secret-credential-value", tempFileId: "cloud://private.jpg" });
  assert.equal(calls[0].url, "https://model.example.test/analyze");
  assert.deepEqual(JSON.parse(calls[0].options.body), { jobId: "job-A" });
  assert.equal(calls[0].options.headers.authorization, "Bearer secret-credential-value");
  assert.throws(() => createProductionDispatch({ endpoint: "http://insecure.test" }), /INVALID_CONFIGURATION/);
});

test("production descriptor hashes only the server-selected cloud file and rejects oversized downloads", async () => {
  const photo = Buffer.from("photo-data");
  const cloud = { getTempFileURL: async ({ fileList }) => {
    assert.deepEqual(fileList, ["cloud://env/analysis/reservation-A/source.jpg"]);
    return { fileList: [{ fileID: fileList[0], status: 0, tempFileURL: "https://photo.example.test/signed" }] };
  } };
  const descriptor = createProductionDownloadDescriptor({ cloud, allowedPhotoHosts: ["photo.example.test"],
    fetchImpl: async () => new Response(photo, { status: 200 }) });
  assert.deepEqual(await descriptor("cloud://env/analysis/reservation-A/source.jpg"), {
    url: "https://photo.example.test/signed",
    sha256: require("node:crypto").createHash("sha256").update(photo).digest("hex")
  });
  const tooLarge = createProductionDownloadDescriptor({ cloud, allowedPhotoHosts: ["photo.example.test"],
    fetchImpl: async () => new Response(photo, { status: 200, headers: { "content-length": String(9 * 1024 * 1024) } }) });
  await assert.rejects(tooLarge("cloud://env/analysis/reservation-A/source.jpg"), /PHOTO_TOO_LARGE/);
});

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

function serializeTransactions(database) {
  let tail = Promise.resolve();
  database.runTransaction = callback => {
    const result = tail.then(() => callback({ collection: database.collection }));
    tail = result.catch(() => {});
    return result;
  };
  return database;
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
  assert.match(reservation.cloudPath, /^analysis\/reservation-[0-9a-f]{64}\/source\.jpg$/);
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

test("concurrent retries of one upload reservation always return one stable cloud path", async () => {
  const database = serializeTransactions(createDatabase({ consents: [activeConsent] }));
  let clockCalls = 0;
  const api = createAnalysisApi({
    database, getWXContext: () => ({ OPENID: "openid-A" }),
    now: () => new Date(clockCalls++ === 0 ? "2026-09-07T08:00:00.000Z" : "2026-09-07T08:10:00.000Z"),
    createId: (() => { let sequence = 0; return prefix => `${prefix}-${++sequence}`; })()
  });
  const payload = { consentId: "consent-A", clientRequestId: "request-A", uploadRequestId: "upload-A" };
  const [first, second] = await Promise.all([
    api({ action: "reserveUpload", payload }), api({ action: "reserveUpload", payload })
  ]);
  assert.equal(first.reservationId, second.reservationId);
  assert.equal(first.cloudPath, second.cloudPath);
  assert.equal(new Set(database.records.analysis_uploads.map(value => value.cloudPath)).size, 1);
  assert.equal(database.records.analysis_uploads.length, 1);
  assert.equal(database.records.analysis_uploads[0].deleteBy, "2026-09-07T08:30:00.000Z");
  assert.equal(database.records.analysis_uploads[0].status, "pending");
});

test("the original upload deadline caps delayed job creation and credential lifetime", async () => {
  let current = new Date("2026-09-07T08:00:00.000Z");
  const database = createDatabase({ consents: [activeConsent] });
  const api = createAnalysisApi({
    database, getWXContext: () => ({ OPENID: "openid-A" }), now: () => current,
    createId: prefix => `${prefix}-stable`, createCredential: () => "container-secret"
  });
  const reserved = await api({ action: "reserveUpload", payload: {
    consentId: "consent-A", clientRequestId: "request-A", uploadRequestId: "upload-A"
  }});
  const tempFileId = `cloud://env/${reserved.cloudPath}`;
  await api({ action: "attachUpload", payload: { reservationId: reserved.reservationId, tempFileId } });
  current = new Date("2026-09-07T08:29:00.000Z");
  await api({ action: "createAnalysis", payload: analysisPayload({ reservationId: reserved.reservationId, tempFileId }) });
  const job = database.records.analysis_jobs[0];
  assert.equal(job.deleteBy, "2026-09-07T08:30:00.000Z");
  assert.equal(job.credentialExpiresAt, "2026-09-07T08:30:00.000Z");
});

test("an expired reservation is rejected, marked deleting, and never creates a job", async () => {
  let current = new Date("2026-09-07T08:00:00.000Z");
  const database = createDatabase({ consents: [activeConsent] });
  const api = createAnalysisApi({
    database, getWXContext: () => ({ OPENID: "openid-A" }), now: () => current,
    createId: prefix => `${prefix}-stable`, createCredential: () => "container-secret"
  });
  const reserved = await api({ action: "reserveUpload", payload: {
    consentId: "consent-A", clientRequestId: "request-A", uploadRequestId: "upload-A"
  }});
  const tempFileId = `cloud://env/${reserved.cloudPath}`;
  await api({ action: "attachUpload", payload: { reservationId: reserved.reservationId, tempFileId } });
  current = new Date("2026-09-07T08:31:00.000Z");
  await assert.rejects(() => api({ action: "createAnalysis", payload: analysisPayload({
    reservationId: reserved.reservationId, tempFileId
  }) }), /UPLOAD_REQUIRED/);
  assert.equal(database.records.analysis_jobs?.length || 0, 0);
  assert.equal(database.records.analysis_uploads[0].status, "deleting");
  await assert.rejects(() => api({ action: "reserveUpload", payload: {
    consentId: "consent-A", clientRequestId: "request-A", uploadRequestId: "upload-A"
  }}), /UPLOAD_REQUIRED/);
});

test("an expired pending reservation cannot attach a file and is marked deleting", async () => {
  const upload = {
    _id: "reservation-A", _openid: "openid-A", consentId: "consent-A", clientRequestId: "request-A",
    cloudPath: "analysis/reservation-A/source.jpg", status: "pending", deleteBy: "2026-09-07T07:59:59.000Z"
  };
  const { api, database } = setup("openid-A", { analysis_uploads: [upload] });
  await assert.rejects(() => api({ action: "attachUpload", payload: {
    reservationId: "reservation-A", tempFileId: "cloud://env/analysis/reservation-A/source.jpg"
  }}), /UPLOAD_REQUIRED/);
  assert.equal(database.records.analysis_uploads[0].status, "deleting");
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

test("an idempotent analysis retry returns the complete or failed minimal view", async () => {
  for (const [status, fields, expected] of [
    ["complete", { reportId: "report-A" }, { status: "complete", reportId: "report-A" }],
    ["failed", { errorCode: "SECRET_INTERNAL_ERROR" }, { status: "failed", error: "ANALYSIS_FAILED" }]
  ]) {
    const { api, database } = setup("openid-A", { consents: [activeConsent] });
    const created = await api({ action: "createAnalysis", payload: analysisPayload() });
    Object.assign(database.records.analysis_jobs[0], { status, ...fields });
    assert.deepEqual(await api({ action: "createAnalysis", payload: analysisPayload() }), {
      jobId: created.jobId, ...expected
    });
  }
});

test("an expired active job retry converges to failed and deleting without losing recovery", async () => {
  let current = new Date("2026-09-07T08:00:00.000Z");
  const database = createDatabase({ consents: [activeConsent], analysis_uploads: [{
    _id: "reservation-A", _openid: "openid-A", consentId: "consent-A", clientRequestId: "request-A",
    cloudPath: "analysis/reservation-A/source.jpg", tempFileId: "cloud://env/analysis/random/photo.jpg",
    status: "attached", deleteBy: "2026-09-07T08:30:00.000Z"
  }] });
  const api = createAnalysisApi({
    database, getWXContext: () => ({ OPENID: "openid-A" }), now: () => current,
    createCredential: () => "container-secret"
  });
  await api({ action: "createAnalysis", payload: analysisPayload() });
  current = new Date("2026-09-07T08:31:00.000Z");
  assert.deepEqual(await api({ action: "createAnalysis", payload: analysisPayload() }), {
    jobId: database.records.analysis_jobs[0]._id, status: "failed", error: "ANALYSIS_FAILED"
  });
  assert.equal(database.records.analysis_jobs.length, 1);
  assert.equal(database.records.analysis_jobs[0].status, "failed");
  assert.equal(database.records.analysis_jobs[0].sourcePhotoStatus, "deleting");
  assert.equal(database.records.analysis_uploads[0].status, "deleting");
});

test("terminal job retries stay readable after the original photo deadline", async () => {
  for (const [status, extra, expected] of [
    ["complete", { reportId: "report-A" }, { status: "complete", reportId: "report-A" }],
    ["failed", { errorCode: "PRIVATE" }, { status: "failed", error: "ANALYSIS_FAILED" }]
  ]) {
    const { api, database } = setup("openid-A", {
      analysis_jobs: [{
        _id: "job-24502eda15ddb06402d474149c87fa6fa96e9086a9dfeb1aeb06f97f91ad9385",
        _openid: "openid-A", reservationId: "reservation-A", status, sourcePhotoStatus: "pending", ...extra
      }],
      analysis_uploads: [{
        _id: "reservation-A", _openid: "openid-A", status: "assigned", jobId: "job-24502eda15ddb06402d474149c87fa6fa96e9086a9dfeb1aeb06f97f91ad9385",
        deleteBy: "2026-09-07T07:59:00.000Z"
      }]
    });
    assert.deepEqual(await api({ action: "createAnalysis", payload: analysisPayload() }), {
      jobId: database.records.analysis_jobs[0]._id, ...expected
    });
    assert.equal(database.records.analysis_jobs[0].sourcePhotoStatus, "deleting");
    assert.equal(database.records.analysis_uploads[0].status, "deleting");
  }
});

test("reserving an expired assigned upload returns its terminal job view while scheduling cleanup", async () => {
  const jobId = "job-A";
  const uploadRequestId = "upload-A";
  const reservationId = `reservation-${require("node:crypto").createHash("sha256").update(JSON.stringify(["openid-A", uploadRequestId])).digest("hex")}`;
  const database = createDatabase({
    consents: [activeConsent],
    analysis_jobs: [{ _id: jobId, _openid: "openid-A", status: "complete", sourcePhotoStatus: "pending", reportId: "report-A" }],
    analysis_uploads: [{
      _id: reservationId, _openid: "openid-A", consentId: "consent-A", clientRequestId: "request-A",
      jobId, status: "assigned", cloudPath: `analysis/${reservationId}/source.jpg`, deleteBy: "2026-09-07T07:59:00.000Z"
    }]
  });
  const api = createAnalysisApi({ database, getWXContext: () => ({ OPENID: "openid-A" }), now: () => new Date("2026-09-07T08:00:00.000Z") });
  assert.deepEqual(await api({ action: "reserveUpload", payload: {
    consentId: "consent-A", clientRequestId: "request-A", uploadRequestId
  }}), {
    reservationId, cloudPath: `analysis/${reservationId}/source.jpg`, jobId, status: "complete", reportId: "report-A"
  });
  assert.equal(database.records.analysis_jobs[0].sourcePhotoStatus, "deleting");
  assert.equal(database.records.analysis_uploads[0].status, "deleting");
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

test("saved reports are owner-scoped and never return raw landmarks", async () => {
  const saved = { identity: { title: "结构参考" }, memorySentence: "照片内参考", coreTraits: [] };
  const { api } = setup("openid-A", { reports: [{ _id: "report-job-A", _openid: "openid-A", report: saved }] });
  assert.deepEqual(await api({ action: "getReport", payload: { reportId: "report-job-A" } }), saved);
  const { api: foreign } = setup("openid-B", { reports: [{ _id: "report-job-A", _openid: "openid-A", report: saved }] });
  await assert.rejects(foreign({ action: "getReport", payload: { reportId: "report-job-A" } }), /FORBIDDEN/);
});

test("server report functions remain byte-for-byte data equivalent to the web core", () => {
  const html = fs.readFileSync(path.join(__dirname, "../../index.html"), "utf8");
  const source = html.match(/<script id="face-style-core">([\s\S]*?)<\/script>/)[1];
  const context = { window: {}, URL };
  vm.createContext(context);
  vm.runInContext(source, context);
  const web = context.window.FaceStyleCore;
  const quality = { accepted: true, level: "high", issues: [], metrics: {} };
  const answers = { postCleanse: "tzone", reactivity: "rarely", primaryGoal: "makeup", dailyMinutes: 15, hairMaintenance: "light", monthlyBudget: "moderate" };
  const points = makeFrontLandmarks();
  const serverMeasurements = computeMeasurements(points, "high");
  const webMeasurements = web.computeMeasurements(points, "high");
  const plain = value => JSON.parse(JSON.stringify(value));
  assert.deepEqual(plain(serverMeasurements), plain(webMeasurements));
  const serverProfile = inferQuestionnaire(answers);
  const webProfile = web.inferQuestionnaire(answers);
  assert.deepEqual(plain(composeReport({ quality, measurements: serverMeasurements, profile: serverProfile })), plain(web.composeReport({ quality, measurements: webMeasurements, profile: webProfile })));
  assert.deepEqual(plain(buildIdentityPresentation(serverMeasurements, composeReport({ quality, measurements: serverMeasurements, profile: serverProfile }).readableProfile, new Date("2026-09-03T12:00:00.000Z"))), plain(web.buildIdentityPresentation(webMeasurements, web.composeReport({ quality, measurements: webMeasurements, profile: webProfile }).readableProfile, new Date("2026-09-03T12:00:00.000Z"))));
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

test("container claim binds a server-created download descriptor and can be claimed once", async () => {
  const { api, database } = setup("openid-A", { consents: [activeConsent] });
  await api({ action: "createAnalysis", payload: {
    ...analysisPayload({ quality: { accepted: true } })
  }});
  const job = database.records.analysis_jobs[0];
  assert.equal(job.credential, undefined);
  assert.notEqual(job.credentialHash, "container-secret");
  const claim = await claimContainerJob({
    database, jobId: job._id, credential: "container-secret", now: new Date("2026-09-07T08:01:00.000Z"),
    createLeaseCredential: () => ({ leaseId: "lease-A", leaseToken: "lease-secret-value" }),
    createDownloadDescriptor: async tempFileId => {
      assert.equal(tempFileId, job.tempFileId);
      return { url: "https://photo.example.test/server-signed", sha256: "a".repeat(64) };
    }
  });
  assert.deepEqual(claim, {
    jobId: job._id, leaseId: "lease-A", leaseToken: "lease-secret-value",
    download: { url: "https://photo.example.test/server-signed", sha256: "a".repeat(64) }
  });
  assert.equal(job.leaseToken, undefined);
  await assert.rejects(() => claimContainerJob({
    database, jobId: job._id, credential: "container-secret", now: new Date("2026-09-07T08:02:00.000Z"),
    createDownloadDescriptor: async () => ({ url: "https://photo.example.test/x", sha256: "a".repeat(64) })
  }), /CREDENTIAL_USED/);
});

test("container claim rejects wrong, expired, and wrong-purpose tokens", async () => {
  const makeJob = purpose => ({
    _id: "job-A", _openid: "openid-A", reservationId: "reservation-A", tempFileId: "cloud://env/analysis/reservation-A/source.jpg",
    credentialHash: require("node:crypto").createHash("sha256").update("container-secret").digest("hex"),
    status: "queued", sourcePhotoStatus: "pending", deleteBy: "2026-09-07T08:30:00.000Z",
    credentialPurpose: purpose, credentialExpiresAt: "2026-09-07T08:05:00.000Z", credentialUsedAt: null
  });
  const databaseFor = job => createDatabase({
    analysis_jobs: [job], analysis_uploads: [{
      _id: "reservation-A", _openid: "openid-A", jobId: "job-A", status: "assigned",
      tempFileId: "cloud://env/analysis/reservation-A/source.jpg", deleteBy: "2026-09-07T08:30:00.000Z"
    }]
  });
  const options = { createDownloadDescriptor: async () => ({ url: "https://photo.example.test/x", sha256: "a".repeat(64) }) };
  await assert.rejects(() => claimContainerJob({ ...options, database: databaseFor(makeJob("face-analysis")), jobId: "job-A", credential: "wrong-secret-value", now: new Date("2026-09-07T08:01:00Z") }), /CREDENTIAL_INVALID/);
  await assert.rejects(() => claimContainerJob({ ...options, database: databaseFor(makeJob("face-analysis")), jobId: "job-A", credential: "container-secret", now: new Date("2026-09-07T08:06:00Z") }), /CREDENTIAL_EXPIRED/);
  await assert.rejects(() => claimContainerJob({ ...options, database: databaseFor(makeJob("other")), jobId: "job-A", credential: "container-secret", now: new Date("2026-09-07T08:01:00Z") }), /CREDENTIAL_INVALID/);
  const invalidExpiry = makeJob("face-analysis");
  invalidExpiry.credentialExpiresAt = "not-a-date";
  await assert.rejects(() => claimContainerJob({ ...options, database: databaseFor(invalidExpiry), jobId: "job-A", credential: "container-secret", now: new Date("2026-09-07T08:01:00Z") }), /CREDENTIAL_INVALID/);
  for (const changes of [
    { status: "failed" }, { status: "complete" }, { sourcePhotoStatus: "deleting" }
  ]) {
    await assert.rejects(() => claimContainerJob({ ...options,
      database: databaseFor({ ...makeJob("face-analysis"), ...changes }),
      jobId: "job-A", credential: "container-secret", now: new Date("2026-09-07T08:01:00Z")
    }), /CREDENTIAL_INVALID/);
  }
  const retentionExpired = makeJob("face-analysis");
  retentionExpired.deleteBy = "2026-09-07T08:00:30.000Z";
  await assert.rejects(() => claimContainerJob({ ...options, database: databaseFor(retentionExpired), jobId: "job-A", credential: "container-secret", now: new Date("2026-09-07T08:01:00Z") }), /CREDENTIAL_EXPIRED/);
});

test("concurrent container claims have exactly one winner", async () => {
  const hash = require("node:crypto").createHash("sha256").update("container-secret").digest("hex");
  const database = createDatabase({ analysis_jobs: [{
    _id: "job-A", _openid: "openid-A", reservationId: "reservation-A", tempFileId: "cloud://env/analysis/reservation-A/source.jpg",
    status: "queued", sourcePhotoStatus: "pending", deleteBy: "2026-09-07T08:30:00.000Z",
    credentialHash: hash, credentialPurpose: "face-analysis", credentialExpiresAt: "2026-09-07T08:05:00.000Z", credentialUsedAt: null
  }], analysis_uploads: [{
    _id: "reservation-A", _openid: "openid-A", jobId: "job-A", status: "assigned",
    tempFileId: "cloud://env/analysis/reservation-A/source.jpg", deleteBy: "2026-09-07T08:30:00.000Z"
  }] });
  let tail = Promise.resolve();
  database.runTransaction = callback => {
    const result = tail.then(() => callback({ collection: database.collection }));
    tail = result.catch(() => {});
    return result;
  };
  const results = await Promise.allSettled([1, 2].map(() => claimContainerJob({
    database, jobId: "job-A", credential: "container-secret", now: new Date("2026-09-07T08:01:00Z"),
    createDownloadDescriptor: async () => ({ url: "https://photo.example.test/x", sha256: "a".repeat(64) })
  })));
  assert.equal(results.filter(value => value.status === "fulfilled").length, 1);
  assert.equal(results.filter(value => value.status === "rejected" && /CREDENTIAL_USED/.test(value.reason.message)).length, 1);
  assert.equal(database.records.analysis_jobs[0].status, "processing");
});

test("container lease completion and failure are idempotent and always schedule source deletion", async () => {
  const leaseHash = require("node:crypto").createHash("sha256").update("lease-secret-value").digest("hex");
  const result = {
    jobId: "job-A", detectionScore: 0.9,
    points: Array.from({ length: 68 }, () => ({ x: 1, y: 2 })),
    faceBox: { x: 1, y: 2, width: 3, height: 4 }, imageSize: { width: 100, height: 100 }, modelVersion: "model-A"
  };
  for (const action of ["complete", "fail"]) {
    const database = createDatabase({
      analysis_jobs: [{
        _id: "job-A", _openid: "openid-A", reservationId: "reservation-A", status: "processing", sourcePhotoStatus: "pending",
        leaseId: "lease-A", leaseHash, leaseExpiresAt: "2026-09-07T08:03:00.000Z"
      }],
      analysis_uploads: [{ _id: "reservation-A", _openid: "openid-A", jobId: "job-A", status: "assigned" }]
    });
    const args = { database, jobId: "job-A", leaseId: "lease-A", leaseToken: "lease-secret-value", now: new Date("2026-09-07T08:02:00.000Z") };
    if (action === "complete") {
      assert.deepEqual(await completeContainerJob({ ...args, result }), { jobId: "job-A", status: "complete" });
      assert.deepEqual(await completeContainerJob({ ...args, result }), { jobId: "job-A", status: "complete" });
      assert.equal(database.records.analysis_jobs[0].reportId, "report-job-A");
      assert.equal("analysisResult" in database.records.analysis_jobs[0], false);
      assert.equal(database.records.reports[0]._openid, "openid-A");
      assert.equal(database.records.reports[0].modelVersion, "model-A");
      assert.equal(database.records.reports[0].reportRulesVersion, "web-face-style-core-2026-09-03");
      assert.equal("analysisResult" in database.records.analysis_jobs[0], false);
    } else {
      assert.deepEqual(await failContainerJob({ ...args, errorCode: "NO_FACE" }), { jobId: "job-A", status: "failed" });
      assert.deepEqual(await failContainerJob({ ...args, errorCode: "NO_FACE" }), { jobId: "job-A", status: "failed" });
      assert.equal(database.records.analysis_jobs[0].errorCode, "NO_FACE");
    }
    assert.equal(database.records.analysis_jobs[0].sourcePhotoStatus, "deleting");
    assert.equal(database.records.analysis_uploads[0].status, "deleting");
  }
});

test("an expired processing lease converges to failed and deleting", async () => {
  const database = createDatabase({
    analysis_jobs: [{
      _id: "job-A", _openid: "openid-A", reservationId: "reservation-A", status: "processing", sourcePhotoStatus: "pending",
      leaseId: "lease-A", leaseHash: "a".repeat(64), leaseExpiresAt: "2026-09-07T08:03:00.000Z"
    }],
    analysis_uploads: [{ _id: "reservation-A", _openid: "openid-A", jobId: "job-A", status: "assigned" }]
  });
  assert.deepEqual(await recoverExpiredContainerLease({
    database, jobId: "job-A", now: new Date("2026-09-07T08:03:01.000Z")
  }), { jobId: "job-A", status: "failed" });
  assert.equal(database.records.analysis_jobs[0].errorCode, "LEASE_EXPIRED");
  assert.equal(database.records.analysis_jobs[0].sourcePhotoStatus, "deleting");
  assert.equal(database.records.analysis_uploads[0].status, "deleting");
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
  assert.deepEqual(first, { jobId: first.jobId, status: "failed", error: "ANALYSIS_FAILED" });
  assert.deepEqual(second, first);
  assert.equal(dispatches, 1);
  assert.equal(credentials, 1);
  assert.equal(database.records.analysis_jobs[0].deleteBy, "2026-09-07T08:30:00.000Z");
  assert.equal(database.records.analysis_jobs[0].sourcePhotoStatus, "deleting");
  assert.equal(database.records.analysis_uploads[0].status, "deleting");
});

test("a lost dispatch acknowledgement preserves a credential already consumed by the container", async () => {
  const database = serializeTransactions(createDatabase({
    consents: [activeConsent],
    analysis_uploads: [{
      _id: "reservation-A", _openid: "openid-A", consentId: "consent-A", clientRequestId: "request-A",
      cloudPath: "analysis/reservation-A/source.jpg", tempFileId: "cloud://env/analysis/random/photo.jpg",
      status: "attached", deleteBy: "2026-09-07T08:30:00.000Z"
    }]
  }));
  const api = createAnalysisApi({
    database, getWXContext: () => ({ OPENID: "openid-A" }),
    now: () => new Date("2026-09-07T08:00:00.000Z"), createCredential: () => "container-secret",
    dispatchAnalysis: async delivery => {
      await claimContainerJob({
        database, jobId: delivery.jobId, credential: delivery.credential,
        now: new Date("2026-09-07T08:01:00.000Z"),
        createDownloadDescriptor: async () => ({ url: "https://photo.example.test/x", sha256: "a".repeat(64) })
      });
      throw new Error("acknowledgement lost");
    }
  });
  const result = await api({ action: "createAnalysis", payload: analysisPayload() });
  assert.deepEqual(result, { jobId: result.jobId, status: "processing" });
  assert.equal(database.records.analysis_jobs[0].status, "processing");
  assert.notEqual(database.records.analysis_jobs[0].credentialUsedAt, null);
  assert.equal(database.records.analysis_uploads[0].status, "assigned");
});

test("a late dispatch rejection preserves a job already completed by the container", async () => {
  let database;
  const initialized = setup("openid-A", { consents: [activeConsent] }, {
    dispatchAnalysis: async delivery => {
      Object.assign(database.records.analysis_jobs[0], {
        status: "complete", sourcePhotoStatus: "deleting", reportId: "report-A", credentialUsedAt: { $serverDate: true }
      });
      Object.assign(database.records.analysis_uploads[0], { status: "deleting", jobId: delivery.jobId });
      throw new Error("late dispatch acknowledgement");
    }
  });
  database = initialized.database;
  const result = await initialized.api({ action: "createAnalysis", payload: analysisPayload() });
  assert.deepEqual(result, { jobId: result.jobId, status: "complete", reportId: "report-A" });
  assert.equal(database.records.analysis_jobs[0].status, "complete");
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

test("create assignment wins atomically over a concurrent abandon request", async () => {
  const database = serializeTransactions(createDatabase({
    consents: [activeConsent],
    analysis_uploads: [{
      _id: "reservation-A", _openid: "openid-A", consentId: "consent-A", clientRequestId: "request-A",
      cloudPath: "analysis/reservation-A/source.jpg", tempFileId: "cloud://env/analysis/random/photo.jpg",
      status: "attached", deleteBy: "2026-09-07T08:30:00.000Z"
    }]
  }));
  const api = createAnalysisApi({
    database, getWXContext: () => ({ OPENID: "openid-A" }),
    now: () => new Date("2026-09-07T08:00:00.000Z"), createCredential: () => "container-secret"
  });
  const creating = api({ action: "createAnalysis", payload: analysisPayload() });
  const abandoning = api({ action: "abandonUpload", payload: { reservationId: "reservation-A" } });
  const [created, abandoned] = await Promise.allSettled([creating, abandoning]);
  assert.equal(created.status, "fulfilled");
  assert.equal(abandoned.status, "rejected");
  assert.match(abandoned.reason.message, /INVALID_STATUS/);
  assert.equal(database.records.analysis_uploads[0].status, "assigned");
  assert.equal(database.records.analysis_jobs.length, 1);
});

test("attach and abandon transactions never revive a deleting reservation", async () => {
  for (const firstAction of ["attachUpload", "abandonUpload"]) {
    const database = serializeTransactions(createDatabase({ analysis_uploads: [{
      _id: "reservation-A", _openid: "openid-A", consentId: "consent-A", clientRequestId: "request-A",
      cloudPath: "analysis/reservation-A/source.jpg", status: "pending", deleteBy: "2026-09-07T08:30:00.000Z"
    }] }));
    const api = createAnalysisApi({
      database, getWXContext: () => ({ OPENID: "openid-A" }), now: () => new Date("2026-09-07T08:00:00.000Z")
    });
    const attach = () => api({ action: "attachUpload", payload: {
      reservationId: "reservation-A", tempFileId: "cloud://env/analysis/reservation-A/source.jpg"
    }});
    const abandon = () => api({ action: "abandonUpload", payload: { reservationId: "reservation-A" } });
    const operations = firstAction === "attachUpload" ? [attach(), abandon()] : [abandon(), attach()];
    const results = await Promise.allSettled(operations);
    assert.equal(database.records.analysis_uploads[0].status, "deleting");
    if (firstAction === "abandonUpload") assert.equal(results[1].status, "rejected");
  }
});

test("container claim refuses a job whose assigned upload has begun deleting", async () => {
  const hash = require("node:crypto").createHash("sha256").update("container-secret").digest("hex");
  const database = createDatabase({
    analysis_jobs: [{
      _id: "job-A", _openid: "openid-A", reservationId: "reservation-A", tempFileId: "cloud://env/analysis/reservation-A/source.jpg",
      status: "queued", sourcePhotoStatus: "pending", deleteBy: "2026-09-07T08:30:00.000Z",
      credentialHash: hash, credentialPurpose: "face-analysis", credentialExpiresAt: "2026-09-07T08:05:00.000Z", credentialUsedAt: null
    }],
    analysis_uploads: [{
      _id: "reservation-A", _openid: "openid-A", jobId: "job-A", tempFileId: "cloud://env/analysis/reservation-A/source.jpg",
      status: "deleting", deleteBy: "2026-09-07T08:30:00.000Z"
    }]
  });
  await assert.rejects(() => claimContainerJob({
    database, jobId: "job-A", credential: "container-secret", now: new Date("2026-09-07T08:01:00.000Z"),
    createDownloadDescriptor: async () => ({ url: "https://photo.example.test/x", sha256: "a".repeat(64) })
  }), /CREDENTIAL_INVALID/);
  assert.equal(database.records.analysis_jobs[0].status, "queued");
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
      return { jobId: "job-A", status: "complete", reportId: "report-A" };
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
  assert.equal(reloaded.data.status, "complete");
  assert.equal(reloaded.data.reportId, "report-A");
  reloadedDefinition.onUnload.call(reloaded);
});

test("a reloaded client recovers an assigned reservation without overwriting its photo", async () => {
  let uploads = 0;
  const calls = [];
  const saved = {
    consentId: "consent-A", clientRequestId: "request-A", uploadRequestId: "upload-A",
    reservationId: "reservation-A", cloudPath: "analysis/reservation-A/source.jpg"
  };
  const preflight = { photo: { path: "local.jpg", type: "jpeg" }, quality: { accepted: true, scope: "local-basic" }, consent: { type: "face-analysis" } };
  const wx = {
    getStorageSync: key => key === "face-analysis-upload-state" ? saved : preflight,
    setStorageSync() {}, showToast() {}, setTimeout, clearTimeout,
    cloud: { uploadFile() { uploads += 1; } }
  };
  const definition = loadPage("pages/analysis/analysis.js", {
    "../../lib/photo-preflight": { FACE_PREFLIGHT_STORAGE_KEY: "preflight", assertFaceConsent: value => value },
    "../../services/cloud-client": { callCloud: async (_name, data) => {
      calls.push(data.action);
      if (data.action === "reserveUpload") return {
        reservationId: "reservation-A", cloudPath: "analysis/reservation-A/source.jpg",
        jobId: "job-A", status: "complete", reportId: "report-A"
      };
      throw new Error("must recover before upload");
    } }
  }, wx);
  const page = { ...definition, data: { ...definition.data }, setData(value) { Object.assign(this.data, value); } };
  await definition.startAnalysis.call(page);
  assert.deepEqual(calls, ["reserveUpload"]);
  assert.equal(uploads, 0);
  assert.equal(page.data.status, "complete");
  assert.equal(page.data.reportId, "report-A");
});

test("an expired reservation on reload fails without uploading or creating a job", async () => {
  let uploads = 0;
  const calls = [];
  const saved = { consentId: "consent-A", clientRequestId: "request-A", uploadRequestId: "upload-A" };
  const preflight = { photo: { path: "local.jpg", type: "jpeg" }, quality: { accepted: true, scope: "local-basic" }, consent: { type: "face-analysis" } };
  const wx = {
    getStorageSync: key => key === "face-analysis-upload-state" ? saved : preflight,
    setStorageSync() {}, showToast() {}, setTimeout, clearTimeout,
    cloud: { uploadFile() { uploads += 1; } }
  };
  const definition = loadPage("pages/analysis/analysis.js", {
    "../../lib/photo-preflight": { FACE_PREFLIGHT_STORAGE_KEY: "preflight", assertFaceConsent: value => value },
    "../../services/cloud-client": { callCloud: async (_name, data) => {
      calls.push(data.action);
      if (data.action === "reserveUpload") throw new Error("UPLOAD_REQUIRED");
      throw new Error("unexpected call");
    } }
  }, wx);
  const page = { ...definition, data: { ...definition.data }, setData(value) { Object.assign(this.data, value); } };
  await definition.startAnalysis.call(page);
  assert.deepEqual(calls, ["reserveUpload"]);
  assert.equal(uploads, 0);
  assert.equal(page.data.status, "failed");
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

test("choosing another photo still navigates when local upload-state cleanup fails", async () => {
  let navigated = false;
  const wx = {
    getStorageSync: () => null, setStorageSync() {}, showToast() {}, setTimeout, clearTimeout,
    removeStorageSync() { throw new Error("storage unavailable"); },
    navigateBack() { navigated = true; }
  };
  const definition = loadPage("pages/analysis/analysis.js", {
    "../../lib/photo-preflight": { FACE_PREFLIGHT_STORAGE_KEY: "preflight", assertFaceConsent: value => value },
    "../../services/cloud-client": { callCloud: async () => ({}) }
  }, wx);
  const page = { ...definition, data: { ...definition.data }, stopPolling() {} };
  await definition.chooseAgain.call(page);
  assert.equal(navigated, true);
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
