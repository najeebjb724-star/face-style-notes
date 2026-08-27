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

test("measurement engine returns finite normalized metrics", () => {
  const result = loadCore().computeMeasurements(makeFrontLandmarks(), "high");
  assert.equal(result.faceWidth, 160);
  assert.equal(result.eyeSpacing.value, 1.43);
  assert.equal(result.eyeSpacing.band, "spacious");
  assert.equal(result.noseFaceWidth.value, 0.18);
  assert.equal(result.mouthFaceWidth.value, 0.35);
  assert.equal(result.courts.reduce((sum, item) => sum + item.value, 0), 100);
  Object.values(result).flatMap((value) => Array.isArray(value) ? value : [value]).forEach((value) => {
    if (value && typeof value === "object" && "value" in value) assert.ok(Number.isFinite(value.value));
  });
});

test("asymmetry confidence is reduced for medium quality", () => {
  const result = loadCore().computeMeasurements(makeFrontLandmarks(), "medium");
  assert.equal(result.symmetry.confidence, "low");
  assert.match(result.symmetry.note, /拍摄角度/);
});

test("report conclusions are traceable and action plan has three items", () => {
  const core = loadCore();
  const quality = { accepted: true, level: "high", issues: [], metrics: {} };
  const measurements = core.computeMeasurements(makeFrontLandmarks(), "high");
  const profile = core.inferQuestionnaire({ postCleanse: "tzone", reactivity: "rarely", primaryGoal: "makeup", dailyMinutes: 15, hairMaintenance: "light", monthlyBudget: "moderate" });
  const report = core.composeReport({ quality, measurements, profile });
  assert.equal(report.actionPlan.length, 3);
  assert.ok(report.coreTraits.every((item) => item.evidenceType && item.metricIds.length));
  assert.ok(report.sources.some((source) => source.id === "southernChineseCanons"));
});

test("incomplete profile omits care and complete action plan", () => {
  const core = loadCore();
  const report = core.composeReport({ quality: { accepted: true, level: "high" }, measurements: core.computeMeasurements(makeFrontLandmarks(), "high"), profile: core.inferQuestionnaire({ postCleanse: "tight" }) });
  assert.equal(report.carePlan, null);
  assert.equal(report.actionPlan.length, 1);
});

test("page contains required accessible views and no prohibited claims", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  ["uploadView", "analysisView", "questionnaireView", "reportView", "qualityLevel", "coreTraits", "dataGroups", "carePlan", "actionPlan", "evidenceDrawer"].forEach((id) => {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  });
  ["美貌分", "颜值评分", "健康诊断", "性格推断", "完美比例"].forEach((phrase) => assert.equal(html.includes(phrase), false));
  assert.match(html, /aria-live=/);
  assert.match(html, /prefers-reduced-motion/);
});
