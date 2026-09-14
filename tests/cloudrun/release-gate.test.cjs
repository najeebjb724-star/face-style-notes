const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("release verification cannot silently skip real model and container checks", () => {
  const root = path.join(__dirname, "../..");
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const gate = fs.readFileSync(path.join(root, "scripts/verify-face-analysis-release.cjs"), "utf8");
  const dockerfile = fs.readFileSync(path.join(root, "cloudrun/face-analysis/Dockerfile"), "utf8");
  assert.equal(packageJson.scripts["test:face-analysis-release"], "node scripts/verify-face-analysis-release.cjs");
  assert.match(gate, /RUN_FACE_MODEL_TESTS/);
  assert.match(gate, /npm[\s\S]*audit[\s\S]*audit-level[\s\S]*critical/);
  assert.match(gate, /docker/);
  assert.match(dockerfile, /USER node/);
  assert.match(dockerfile, /org\.opencontainers\.image\.base\.digest/);
});
