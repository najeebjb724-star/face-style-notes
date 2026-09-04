const fs = require("node:fs");
const path = require("node:path");
const esbuild = require("esbuild");

process.chdir(__dirname);

const output = path.join(__dirname, "index.js");
const options = {
  entryPoints: ["./src/index.js"],
  bundle: true,
  external: ["wx-server-sdk"],
  format: "cjs",
  legalComments: "none",
  outfile: output,
  platform: "node",
  target: "node20"
};

if (process.argv.includes("--check")) {
  const built = esbuild.buildSync({ ...options, write: false }).outputFiles[0].text;
  if (!fs.existsSync(output) || fs.readFileSync(output, "utf8") !== built) {
    process.stderr.write("challengeApi build is stale; run npm run build\n");
    process.exitCode = 1;
  }
} else {
  esbuild.buildSync(options);
}
