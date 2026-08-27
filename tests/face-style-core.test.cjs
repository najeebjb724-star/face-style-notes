const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const { makeFrontLandmarks, rotate } = require("./fixtures/landmarks.cjs");

function loadCore() {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const match = html.match(/<script id="face-style-core">([\s\S]*?)<\/script>/);
  assert.ok(match, "index.html must contain #face-style-core");
  const context = { window: {}, console };
  vm.createContext(context);
  vm.runInContext(match[1], context, { filename: "face-style-core.js" });
  return context.window.FaceStyleCore;
}

test("safeDivide rejects invalid denominators", () => {
  const core = loadCore();
  assert.equal(core.safeDivide(4, 2), 2);
  assert.equal(core.safeDivide(4, 0), null);
  assert.equal(core.safeDivide(Infinity, 2), null);
});

test("angleDegrees returns a signed screen-space angle", () => {
  const core = loadCore();
  assert.equal(core.round(core.angleDegrees({ x: 0, y: 0 }, { x: 10, y: 0 }), 2), 0);
  assert.equal(core.round(core.angleDegrees({ x: 0, y: 0 }, { x: 10, y: 10 }), 2), 45);
});

function goodSignals(points = makeFrontLandmarks()) {
  return {
    detectionScore: 0.92,
    faceBox: { width: 320, height: 390 },
    imageSize: { width: 800, height: 1000 },
    points,
    laplacianVariance: 120,
    meanBrightness: 130
  };
}

test("quality gate accepts a clear frontal photo", () => {
  const result = loadCore().evaluatePhotoQuality(goodSignals());
  assert.equal(result.accepted, true);
  assert.equal(result.level, "high");
  assert.equal(result.issues.length, 0);
});

test("quality gate rejects excessive roll with one primary action", () => {
  const result = loadCore().evaluatePhotoQuality(goodSignals(rotate(makeFrontLandmarks(), 8)));
  assert.equal(result.accepted, false);
  assert.equal(result.issues[0].id, "head_roll");
  assert.match(result.issues[0].action, /保持水平/);
});

test("quality gate rejects small, dark and blurry photos deterministically", () => {
  const result = loadCore().evaluatePhotoQuality({
    ...goodSignals(),
    faceBox: { width: 140, height: 170 },
    laplacianVariance: 20,
    meanBrightness: 40
  });
  assert.equal(result.accepted, false);
  assert.deepEqual(Array.from(result.issues, (item) => item.id), ["face_too_small", "blurry", "too_dark"]);
});

test("questionnaire keeps skin and sensitivity as separate tendencies", () => {
  const profile = loadCore().inferQuestionnaire({
    postCleanse: "tight",
    reactivity: "often",
    primaryGoal: "skin",
    dailyMinutes: 5,
    hairMaintenance: "minimal",
    monthlyBudget: "basic"
  });
  assert.equal(profile.complete, true);
  assert.equal(profile.skinTendency, "dry");
  assert.equal(profile.sensitivityTendency, "sensitive");
});

test("incomplete questionnaire disables care plan", () => {
  const profile = loadCore().inferQuestionnaire({ postCleanse: "tzone" });
  assert.equal(profile.complete, false);
  assert.equal(profile.skinTendency, "combination");
});
