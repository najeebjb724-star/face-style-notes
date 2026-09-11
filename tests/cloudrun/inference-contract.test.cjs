const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const fixturePath = path.join(__dirname, "fixtures", "front-face.jpg");
const realModelTest = process.env.RUN_FACE_MODEL_TESTS === "1" ? test : test.skip;

realModelTest("modelLoaded becomes true only after weights finish loading", async () => {
  const { isModelLoaded, loadModels } = require("../../cloudrun/face-analysis/src/inference");
  const loading = loadModels();
  assert.equal(isModelLoaded(), false);
  await loading;
  assert.equal(isModelLoaded(), true);
});

realModelTest("real inference returns exactly 68 finite landmarks", async () => {
  const { inferFixture } = require("../../cloudrun/face-analysis/src/inference");
  const result = await inferFixture(fixturePath);

  assert.equal(result.points.length, 68);
  result.points.forEach(point => {
    assert.ok(Number.isFinite(point.x));
    assert.ok(Number.isFinite(point.y));
  });
  assert.ok(result.detectionScore >= 0 && result.detectionScore <= 1);
});

realModelTest("real inference returns NO_FACE for an image with no face", async () => {
  const { inferBuffer } = require("../../cloudrun/face-analysis/src/inference");
  const faceapi = require("@vladmandic/face-api");
  const blank = faceapi.tf.fill([320, 320, 3], 255, "int32");
  try {
    const jpeg = await faceapi.tf.node.encodeJpeg(blank);
    await assert.rejects(inferBuffer(jpeg, "job-no-face"), error => error.code === "NO_FACE");
  } finally {
    blank.dispose();
  }
});

realModelTest("real inference returns MULTIPLE_FACES for a two-face image", async () => {
  const { inferBuffer } = require("../../cloudrun/face-analysis/src/inference");
  const faceapi = require("@vladmandic/face-api");
  const fs = require("node:fs/promises");
  const source = faceapi.tf.node.decodeImage(await fs.readFile(fixturePath), 3);
  const resized = faceapi.tf.image.resizeBilinear(source, [627, 627]).cast("int32");
  const pair = faceapi.tf.concat([resized, resized], 1);
  try {
    const jpeg = await faceapi.tf.node.encodeJpeg(pair);
    await assert.rejects(inferBuffer(jpeg, "job-multiple-faces"), error => error.code === "MULTIPLE_FACES");
  } finally {
    source.dispose();
    resized.dispose();
    pair.dispose();
  }
});
