const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");

const output = path.join(__dirname, "index.js");
const inputs = ["src/index.js", "build.js", "package.json"];
const hash = value => createHash("sha256").update(value).digest("hex");
const fingerprint = () => {
  const digest = createHash("sha256");
  for (const input of inputs) {
    digest.update(`${input}\0`);
    digest.update(fs.readFileSync(path.join(__dirname, input)));
    digest.update("\0");
  }
  return digest.digest("hex");
};
const sourceHash = fingerprint();

if (process.argv.includes("--check")) {
  const built = fs.existsSync(output) ? fs.readFileSync(output, "utf8") : "";
  const match = built.match(/^\/\/ analysisApi-build-fingerprint:([0-9a-f]{64}):([0-9a-f]{64})\r?\n/);
  const body = match ? built.slice(match[0].length) : "";
  if (!match || match[1] !== sourceHash || match[2] !== hash(body)) {
    process.stderr.write("analysisApi build is stale; run npm run build\n");
    process.exitCode = 1;
  }
} else {
  const body = fs.readFileSync(path.join(__dirname, "src/index.js"), "utf8");
  fs.writeFileSync(output, `// analysisApi-build-fingerprint:${sourceHash}:${hash(body)}\n${body}`);
}
