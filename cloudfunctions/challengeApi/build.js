const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");

const output = path.join(__dirname, "index.js");
const inputs = [
  "src/index.js",
  "../lifecycleJobs/index.js",
  "../../shared/cloud-guards.js",
  "../../miniprogram/lib/face-style-core.js",
  "build.js",
  "package.json"
];

function hashContent(content) {
  return createHash("sha256").update(content).digest("hex");
}

function fingerprint() {
  const hash = createHash("sha256");
  for (const input of inputs) {
    hash.update(`${input}\0`);
    hash.update(fs.readFileSync(path.join(__dirname, input)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

const buildFingerprint = fingerprint();
const options = {
  absWorkingDir: __dirname,
  entryPoints: [path.join(__dirname, "src/index.js")],
  bundle: true,
  external: ["wx-server-sdk"],
  format: "cjs",
  legalComments: "none",
  outfile: output,
  platform: "node",
  target: "node20"
};

if (process.argv.includes("--check")) {
  const built = fs.existsSync(output) ? fs.readFileSync(output, "utf8") : "";
  const match = built.match(/^\/\/ challengeApi-build-fingerprint:([0-9a-f]{64}):([0-9a-f]{64})\r?\n/);
  const body = match ? built.slice(match[0].length) : "";
  if (!match || match[1] !== buildFingerprint || match[2] !== hashContent(body)) {
    process.stderr.write("challengeApi build is stale; run npm run build\n");
    process.exitCode = 1;
  }
} else {
  const esbuild = require("esbuild");
  const body = esbuild.buildSync({ ...options, write: false }).outputFiles[0].text;
  const banner = `// challengeApi-build-fingerprint:${buildFingerprint}:${hashContent(body)}\n`;
  fs.writeFileSync(output, `${banner}${body}`);
}
