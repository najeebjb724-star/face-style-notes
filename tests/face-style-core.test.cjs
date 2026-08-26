const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

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
