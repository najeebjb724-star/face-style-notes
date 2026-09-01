const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");

test("repository documentation presents the product and its boundaries", () => {
  const readme = read("README.md");
  [
    "美学身份卡",
    "https://najeebjb724-star.github.io/face-style-notes/",
    "assets/preview.png",
    "codex/aesthetic-identity-card-ui",
    "照片质量检查",
    "浏览器本地处理",
    "node --test tests/*.test.cjs",
    "PRIVACY.md",
    "MIT"
  ].forEach((text) => assert.ok(readme.includes(text), `README missing: ${text}`));
  assert.ok(!readme.includes("医疗诊断"), "README must not present the app as medical diagnosis");
});

test("privacy notice explains storage, network requests, deletion, and limits", () => {
  const privacy = read("PRIVACY.md");
  [
    "不会发送到本项目服务器",
    "浏览器本地存储",
    "清除网站数据",
    "第三方 CDN",
    "不会上传用户选择的照片",
    "不是医疗建议",
    "不评价美丑"
  ].forEach((text) => assert.ok(privacy.includes(text), `PRIVACY missing: ${text}`));
});

test("repository uses the approved MIT license", () => {
  const license = read("LICENSE");
  assert.match(license, /^MIT License/);
  assert.ok(license.includes("Copyright (c) 2026 najeebjb724-star"));
  assert.ok(license.includes("THE SOFTWARE IS PROVIDED \"AS IS\""));
});

test("Pages workflow deploys only the approved branch with official actions", () => {
  const workflow = read(".github/workflows/deploy-pages.yml");
  assert.match(
    workflow,
    /on:\r?\n  push:\r?\n    branches:\r?\n      - codex\/aesthetic-identity-card-ui\r?\n  workflow_dispatch:/,
    "workflow push trigger must contain only the approved branch"
  );
  [
    "workflow_dispatch:",
    "contents: read",
    "pages: write",
    "id-token: write",
    "actions/checkout@v4",
    "actions/configure-pages@v5",
    "actions/upload-pages-artifact@v3",
    "actions/deploy-pages@v4",
    "environment:",
    "name: github-pages"
  ].forEach((text) => assert.ok(workflow.includes(text), `workflow missing: ${text}`));
  assert.ok(!/uses:\s+(?!actions\/)/.test(workflow), "workflow must use only official actions");
});

test("homepage preview is a 390 by 844 PNG", () => {
  const previewPath = path.join(root, "assets", "preview.png");
  const png = fs.readFileSync(previewPath);
  assert.deepEqual(Array.from(png.subarray(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(png.readUInt32BE(16), 390);
  assert.equal(png.readUInt32BE(20), 844);
});
