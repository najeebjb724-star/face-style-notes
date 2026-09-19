const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

test("release gate invokes npm through Node and stops after a failed audit", () => {
  const calls = [];
  const script = path.resolve(__dirname, "../../scripts/verify-face-analysis-release.cjs");
  const fakeModule = { exports: {} };
  const fakeRequire = name => name === "node:child_process" ? {
    spawnSync(command, args, options) {
      calls.push({ command, args, options });
      return { status: 7 };
    }
  } : require(name);
  fakeRequire.main = fakeModule;
  const fakeProcess = {
    execPath: process.execPath,
    env: { npm_execpath: path.join(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js") },
    stderr: { write() {} }, exitCode: 0
  };
  vm.runInNewContext(fs.readFileSync(script, "utf8"), {
    require: fakeRequire, module: fakeModule, __dirname: path.dirname(script), process: fakeProcess
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, process.execPath);
  assert.equal(calls[0].args[0], fakeProcess.env.npm_execpath);
  assert.equal(calls[0].args[1], "audit");
  assert.equal(fakeProcess.exitCode, 7);
});

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
