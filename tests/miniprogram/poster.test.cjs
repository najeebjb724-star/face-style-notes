const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildChallengePosterModel,
  buildIdentityPosterModel,
  drawChallengePoster
} = require("../../miniprogram/lib/poster");

test("default challenge poster excludes facial measurements", () => {
  const challenge = {
    title: "七日练习",
    completed: 7,
    total: 7,
    completionRate: 100,
    streak: 7,
    measurements: { faceRatio: 1.2 },
    landmarks: [{ x: 1, y: 2 }]
  };
  const model = buildChallengePosterModel(challenge, { includePhotos: false });

  assert.equal("measurements" in model, false);
  assert.equal("landmarks" in model, false);
  assert.equal(model.includePhotos, false);
});

test("identity poster uses presentation copy instead of measurement data", () => {
  const model = buildIdentityPosterModel({
    identity: { title: "温和表达者", subtitle: "自然清透" },
    memorySentence: "轻盈且有层次",
    measurements: { faceRatio: 1.2 },
    readableProfile: { landmarks: [{ x: 1, y: 2 }] }
  });

  assert.equal(model.title, "温和表达者");
  assert.equal(model.memorySentence, "轻盈且有层次");
  assert.equal("measurements" in model, false);
  assert.equal("landmarks" in model, false);
});

test("challenge drawing does not draw photos unless explicitly opted in", () => {
  const calls = [];
  const context = {
    fillRect() {},
    fillText(value) { calls.push(value); },
    drawImage() { calls.push("image"); },
    set fillStyle(_) {},
    set font(_) {},
    set textAlign(_) {}
  };

  drawChallengePoster(context, { title: "七日练习", completed: 7, total: 7 }, ["photo-a"], null);

  assert.equal(calls.includes("image"), false);
});
