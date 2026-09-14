const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const test = require("node:test");

const {
  downloadPhoto,
  validateAnalyzeInput,
  validateResult
} = require("../../cloudrun/face-analysis/src/validate");

let serviceTest = test.skip;
try {
  require.resolve("express", { paths: [require("node:path").join(__dirname, "../../cloudrun/face-analysis")] });
  serviceTest = test;
} catch {}

function createApp(dependencies) {
  return require("../../cloudrun/face-analysis/src/server").createApp(dependencies);
}

const PHOTO = Buffer.from("fixture-photo");
const SHA256 = createHash("sha256").update(PHOTO).digest("hex");

function listen(app) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
    server.on("error", reject);
  });
}

test("analysis input requires a bearer credential, valid job id, HTTPS URL, configured host and SHA-256", () => {
  const valid = {
    authorization: `Bearer ${"a".repeat(32)}`,
    body: { jobId: "job-abc_123" }
  };

  assert.deepEqual(validateAnalyzeInput(valid), {
    credential: "a".repeat(32),
    jobId: "job-abc_123"
  });
  assert.throws(() => validateAnalyzeInput({ ...valid, authorization: "" }), /INVALID_CREDENTIAL/);
  assert.throws(() => validateAnalyzeInput({ ...valid, body: { jobId: "invalid" } }), /INVALID_JOB_ID/);
});

test("result validation rejects non-finite or out-of-range contract values", () => {
  const valid = {
    jobId: "job-a",
    detectionScore: 0.9,
    points: Array.from({ length: 68 }, () => ({ x: 1, y: 2 })),
    faceBox: { x: 1, y: 2, width: 3, height: 4 },
    imageSize: { width: 100, height: 100 },
    modelVersion: "test-model"
  };
  assert.equal(validateResult(valid), valid);
  assert.throws(() => validateResult({ ...valid, detectionScore: 2 }), /INVALID_DETECTION_SCORE/);
  assert.throws(() => validateResult({ ...valid, points: valid.points.map((point, index) => index ? point : { x: NaN, y: 2 }) }), /INVALID_LANDMARK_VALUE/);
  assert.throws(() => validateResult({ ...valid, faceBox: { ...valid.faceBox, width: Infinity } }), /INVALID_FACE_BOX/);
  assert.throws(() => validateResult({ ...valid, imageSize: { width: 0, height: 100 } }), /INVALID_IMAGE_SIZE/);
});

test("photo download rejects redirects, oversized bodies and SHA-256 mismatches", async () => {
  await assert.rejects(
    downloadPhoto("https://photo.example.test/x", SHA256, {
      fetchImpl: async () => new Response(null, { status: 302, headers: { location: "https://evil.test/x" } })
    }),
    /PHOTO_DOWNLOAD_FAILED/
  );

  await assert.rejects(
    downloadPhoto("https://photo.example.test/x", SHA256, {
      maxBytes: 4,
      fetchImpl: async () => new Response(PHOTO, { status: 200 })
    }),
    /PHOTO_TOO_LARGE/
  );

  await assert.rejects(
    downloadPhoto("https://photo.example.test/x", "0".repeat(64), {
      fetchImpl: async () => new Response(PHOTO, { status: 200 })
    }),
    /PHOTO_HASH_MISMATCH/
  );
});

test("photo download enforces its timeout", async () => {
  await assert.rejects(
    downloadPhoto("https://photo.example.test/x", SHA256, {
      timeoutMs: 5,
      fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      })
    }),
    /PHOTO_DOWNLOAD_TIMEOUT/
  );
});

serviceTest("job coordinator retries transient claim failures and strictly validates successful claims", async () => {
  const { createJobCoordinator } = require("../../cloudrun/face-analysis/src/server");
  assert.throws(
    () => createJobCoordinator({ endpoint: "http://credential.example.test/consume" }),
    /INVALID_CONFIGURATION/
  );
  for (const status of [429, 500]) {
    const coordinator = createJobCoordinator({
      endpoint: "https://credential.example.test/consume",
      fetchImpl: async () => new Response(JSON.stringify({ code: "CREDENTIAL_INVALID" }), { status })
    });
    await assert.rejects(coordinator.claim({ jobId: "job-a", credential: "a".repeat(32) }), /CREDENTIAL_SERVICE_UNAVAILABLE/);
  }
  const unavailable = createJobCoordinator({
    endpoint: "https://credential.example.test/consume",
    fetchImpl: async () => { throw new Error("private upstream details"); }
  });
  await assert.rejects(
    unavailable.claim({ jobId: "job-a", credential: "a".repeat(32) }),
    error => error.code === "CREDENTIAL_SERVICE_UNAVAILABLE" && !error.message.includes("private")
  );
  const malformed = createJobCoordinator({
    endpoint: "https://credential.example.test/consume",
    fetchImpl: async () => new Response(JSON.stringify({ ok: true }), { status: 200 })
  });
  await assert.rejects(malformed.claim({ jobId: "job-a", credential: "a".repeat(32) }), /CREDENTIAL_SERVICE_UNAVAILABLE/);
});

serviceTest("health stays unavailable until model loading has completed", async t => {
  let loaded = false;
  let finishLoading;
  const loadModels = () => new Promise(resolve => { finishLoading = () => { loaded = true; resolve(); }; });
  const app = createApp({
    allowedPhotoHosts: ["photo.example.test"],
    consumeCredential: async () => {},
    downloadPhoto: async () => PHOTO,
    inferBuffer: async () => ({}),
    isModelLoaded: () => loaded,
    loadModels
  });
  const server = await listen(app);
  t.after(() => server.close());
  const base = `http:\/\/127.0.0.1:${server.address().port}`;

  const loading = loadModels();
  let response = await fetch(`${base}/health`);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { ok: false, modelLoaded: false });

  finishLoading();
  await loading;
  response = await fetch(`${base}/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, modelLoaded: true });
});

serviceTest("analyze downloads only the server-bound descriptor then completes its lease", async t => {
  const calls = [];
  const result = {
    jobId: "job-abc_123",
    detectionScore: 0.9,
    points: Array.from({ length: 68 }, (_, index) => ({ x: index, y: index })),
    faceBox: { x: 1, y: 2, width: 3, height: 4 },
    imageSize: { width: 100, height: 100 },
    modelVersion: "test-model"
  };
  const app = createApp({
    allowedPhotoHosts: ["photo.example.test"],
    jobCoordinator: {
      async claim({ jobId, credential }) {
        calls.push(["claim", jobId, credential]);
        return { jobId, leaseId: "lease-A", leaseToken: "l".repeat(32), download: { url: "https://photo.example.test/server-bound", sha256: SHA256 } };
      },
      async complete({ claim, result: completed }) { calls.push(["complete", claim.leaseId, completed.jobId]); },
      async fail() { calls.push(["fail"]); }
    },
    downloadPhoto: async (url, sha256) => { calls.push(["download", url, sha256]); return PHOTO; },
    inferBuffer: async (_buffer, jobId) => { calls.push(["infer", jobId]); return result; },
    isModelLoaded: () => true,
    loadModels: async () => {}
  });
  const server = await listen(app);
  t.after(() => server.close());

  const response = await fetch(`http:\/\/127.0.0.1:${server.address().port}/analyze`, {
    method: "POST",
    headers: { authorization: `Bearer ${"a".repeat(32)}`, "content-type": "application/json" },
    body: JSON.stringify({ jobId: "job-abc_123", photoUrl: "https://evil.test/client", expectedSha256: "0".repeat(64) })
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), result);
  assert.deepEqual(calls.map(call => call[0]), ["claim", "download", "infer", "complete"]);
  assert.deepEqual(calls[1], ["download", "https://photo.example.test/server-bound", SHA256]);
});

serviceTest("analyze reports a claimed job failure and serializes inference", async t => {
  let active = 0;
  let maxActive = 0;
  let releaseFirst;
  const failures = [];
  const app = createApp({
    allowedPhotoHosts: ["photo.example.test"],
    jobCoordinator: {
      async claim({ jobId }) { return { jobId, leaseId: `lease-${jobId}`, leaseToken: "l".repeat(32), download: { url: "https://photo.example.test/server", sha256: SHA256 } }; },
      async complete() {},
      async fail(value) { failures.push(value); }
    },
    downloadPhoto: async () => PHOTO,
    inferBuffer: async (_photo, jobId) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      if (jobId === "job-first") await new Promise(resolve => { releaseFirst = resolve; });
      active -= 1;
      if (jobId === "job-fail") { const error = new Error("private"); error.code = "NO_FACE"; throw error; }
      return { jobId };
    },
    isModelLoaded: () => true,
    loadModels: async () => {}
  });
  const server = await listen(app);
  t.after(() => server.close());
  const base = `http:\/\/127.0.0.1:${server.address().port}`;
  const request = jobId => fetch(`${base}/analyze`, {
    method: "POST", headers: { authorization: `Bearer ${"a".repeat(32)}`, "content-type": "application/json" },
    body: JSON.stringify({ jobId })
  });
  const first = request("job-first");
  while (!releaseFirst) await new Promise(resolve => setImmediate(resolve));
  const second = request("job-second");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(maxActive, 1);
  releaseFirst();
  assert.equal((await first).status, 200);
  assert.equal((await second).status, 200);
  const failed = await request("job-fail");
  assert.equal(failed.status, 422);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].errorCode, "NO_FACE");
});

serviceTest("analyze exposes stable face error codes without leaking internal messages", async t => {
  const error = new Error("private tensor details");
  error.code = "NO_FACE";
  const app = createApp({
    allowedPhotoHosts: ["photo.example.test"],
    jobCoordinator: {
      async claim({ jobId }) { return { jobId, leaseId: "lease-A", leaseToken: "l".repeat(32), download: { url: "https://photo.example.test/signed", sha256: SHA256 } }; },
      async complete() {},
      async fail() {}
    },
    downloadPhoto: async () => PHOTO,
    inferBuffer: async () => { throw error; },
    isModelLoaded: () => true,
    loadModels: async () => {}
  });
  const server = await listen(app);
  t.after(() => server.close());

  const response = await fetch(`http:\/\/127.0.0.1:${server.address().port}/analyze`, {
    method: "POST",
    headers: { authorization: `Bearer ${"a".repeat(32)}`, "content-type": "application/json" },
    body: JSON.stringify({ jobId: "job-abc_123", photoUrl: "https://photo.example.test/signed", expectedSha256: SHA256 })
  });
  assert.equal(response.status, 422);
  assert.deepEqual(await response.json(), { ok: false, code: "NO_FACE" });
});
