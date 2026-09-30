const { spawnSync } = require("node:child_process");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const image = "face-style-analysis:release-check";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: "inherit",
    ...options
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const error = new Error(`Release check failed: ${command}`);
    error.exitCode = result.status || 1;
    throw error;
  }
}

function npmInvocation() {
  const cli = process.env.npm_execpath || path.join(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");
  if (!require("node:fs").existsSync(cli)) throw new Error("Run this check using npm run test:face-analysis-release");
  return { command: process.execPath, args: [cli] };
}

function main() {
const npm = npmInvocation();
run(npm.command, [...npm.args, "audit", "--package-lock-only", "--omit=dev", "--audit-level=critical"], {
  cwd: path.join(root, "cloudrun/face-analysis")
});
run("docker", ["build", "-t", image, "cloudrun/face-analysis"]);
run("docker", [
  "run", "--rm", image, "node", "-e",
  "if (typeof process.getuid !== 'function' || process.getuid() === 0) process.exit(1)"
]);
run("docker", [
  "run", "--rm",
  "-e", "RUN_FACE_MODEL_TESTS=1",
  "-e", "NODE_PATH=/app/node_modules",
  "-v", `${root}:/workspace:ro`,
  "-w", "/workspace",
  image,
  "node", "--test", "tests/cloudrun/inference-contract.test.cjs", "tests/cloudrun/service-contract.test.cjs"
]);
}

if (require.main === module) {
  try { main(); } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = error.exitCode || 1;
  }
}

module.exports = { npmInvocation };
