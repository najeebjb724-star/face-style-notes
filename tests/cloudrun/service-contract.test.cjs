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
    body: { jobId: "job-abc_123", photoUrl: "https://photo.example.test/signed", expectedSha256: SHA256 }
  };

  assert.deepEqual(validateAnalyzeInput(valid, ["photo.example.test"]), {
    credential: "a".repeat(32),
    jobId: "job-abc_123",
    photoUrl: "https://photo.example.test/signed",
    expectedSha256: SHA256
  });
  assert.throws(() => validateAnalyzeInput({ ...valid, authorization: "" }, ["photo.example.test"]), /INVALID_CREDENTIAL/);
  assert.throws(() => validateAnalyzeInput({ ...valid, body: { ...valid.body, photoUrl: "http:\/\/photo.example.test/x" } }, ["photo.example.test"]), /INVALID_PHOTO_URL/);
  assert.throws(() => validateAnalyzeInput(valid, []), /INVALID_CONFIGURATION/);
  assert.throws(() => validateAnalyzeInput(valid, ["other.example.test"]), /PHOTO_HOST_NOT_ALLOWED/);
  assert.throws(() => validateAnalyzeInput({ ...valid, body: { ...valid.body, expectedSha256: "bad" } }, ["photo.example.test"]), /INVALID_SHA256/);
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

serviceTest("credential delegation fails closed with a stable unavailable code", async () => {
  const { createCredentialConsumer } = require("../../cloudrun/face-analysis/src/server");
  assert.throws(
    () => createCredentialConsumer({ endpoint: "http://credential.example.test/consume" }),
    /INVALID_CONFIGURATION/
  );
  const consume = createCredentialConsumer({
    endpoint: "https://credential.example.test/consume",
    fetchImpl: async () => { throw new Error("private upstream details"); }
  });
  await assert.rejects(
    consume({ jobId: "job-a", credential: "a".repeat(32) }),
    error => error.code === "CREDENTIAL_SERVICE_UNAVAILABLE" && !error.message.includes("private")
  );
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

serviceTest("analyze consumes the credential before downloading and returns only the landmark contract", async t => {
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
    consumeCredential: async ({ jobId, credential }) => calls.push(["credential", jobId, credential]),
    downloadPhoto: async () => { calls.push(["download"]); return PHOTO; },
    inferBuffer: async (_buffer, jobId) => { calls.push(["infer", jobId]); return result; },
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
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), result);
  assert.deepEqual(calls.map(call => call[0]), ["credential", "download", "infer"]);
});

serviceTest("analyze exposes stable face error codes without leaking internal messages", async t => {
  const error = new Error("private tensor details");
  error.code = "NO_FACE";
  const app = createApp({
    allowedPhotoHosts: ["photo.example.test"],
    consumeCredential: async () => {},
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
