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
  if (result.status !== 0) process.exit(result.status || 1);
}

run("npm", ["audit", "--package-lock-only", "--omit=dev", "--audit-level=critical"], {
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
