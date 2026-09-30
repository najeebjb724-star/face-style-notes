const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { makeFrontLandmarks } = require("../fixtures/landmarks.cjs");

function loadWebCore() {
  const html = fs.readFileSync(path.join(__dirname, "..", "..", "index.html"), "utf8");
  const match = html.match(/<script id="face-style-core">([\s\S]*?)<\/script>/);
  assert.ok(match, "index.html must contain #face-style-core");
  const context = { window: {}, console, URL };
  vm.createContext(context);
  vm.runInContext(match[1], context, { filename: "face-style-core.js" });
  return context.window.FaceStyleCore;
}

const plain = value => JSON.parse(JSON.stringify(value));

test("fixed landmarks produce the same readable report", () => {
  const web = loadWebCore();
  const mini = require("../../miniprogram/lib/face-style-core");
  const points = makeFrontLandmarks();
  const quality = { accepted: true, level: "high", issues: [], metrics: {} };
  const answers = { postCleanse: "tzone", reactivity: "rarely", primaryGoal: "makeup", dailyMinutes: 15, hairMaintenance: "light", monthlyBudget: "moderate" };
  const webMeasurements = web.computeMeasurements(points, "high");
  const miniMeasurements = mini.computeMeasurements(points, "high");

  assert.deepEqual(plain(miniMeasurements), plain(webMeasurements));
  const miniReadable = mini.deriveReadableProfile(miniMeasurements, quality);
  const webReadable = web.deriveReadableProfile(webMeasurements, quality);
  assert.deepEqual(plain(miniReadable), plain(webReadable));
  assert.deepEqual(
    plain(mini.buildIdentityPresentation(miniMeasurements, miniReadable, new Date("2026-09-03T12:00:00.000Z"))),
    plain(web.buildIdentityPresentation(webMeasurements, webReadable, new Date("2026-09-03T12:00:00.000Z")))
  );
  assert.deepEqual(
    plain(mini.composeReport({ quality, measurements: miniMeasurements, profile: mini.inferQuestionnaire(answers) })),
    plain(web.composeReport({ quality, measurements: webMeasurements, profile: web.inferQuestionnaire(answers) }))
  );
});
