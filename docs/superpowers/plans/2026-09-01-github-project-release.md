# GitHub Project Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the missing GitHub-facing release assets and deploy the existing single-file app to GitHub Pages without changing product behavior or overwriting remote `main`.

**Architecture:** Keep `index.html` as the only application source. Add static repository documentation, one privacy-safe mobile preview, a focused Node release-contract test, and an official GitHub Pages workflow that publishes the repository root from `codex/aesthetic-identity-card-ui`.

**Tech Stack:** Static HTML, Node.js built-in test runner, GitHub Actions, GitHub Pages, PNG

## Global Constraints

- Do not modify `index.html` or any existing product logic.
- Do not overwrite the remote `main` branch.
- Push only to `origin/codex/aesthetic-identity-card-ui`.
- Keep Face-API.js, Tailwind CSS, html2canvas, and model weights on their existing CDNs; do not vendor them.
- Do not add a backend, account system, database, analytics, secrets, or cloud photo storage.
- The preview must be exactly 390 × 844 pixels and contain no private face or user photo.
- The public target URL is `https://najeebjb724-star.github.io/face-style-notes/`.
- The license is MIT, copyright year 2026, owner `najeebjb724-star`.
- Preserve the user's unrelated untracked `.superpowers/` directory and the two untracked 2026-08-28 unified-challenge documents.

## File Map

- Create `README.md`: Chinese project landing document and entry point.
- Create `PRIVACY.md`: local-processing, local-storage, CDN, deletion, and disclaimer boundaries.
- Create `LICENSE`: standard MIT license text.
- Create `assets/preview.png`: privacy-safe 390 × 844 homepage preview.
- Create `.github/workflows/deploy-pages.yml`: official GitHub Pages deployment from the feature branch.
- Create `tests/release-assets.test.cjs`: executable contract for all new release assets.
- Do not modify `index.html` or `tests/face-style-core.test.cjs`.

---

### Task 1: Repository Documentation and License

**Files:**
- Create: `tests/release-assets.test.cjs`
- Create: `README.md`
- Create: `PRIVACY.md`
- Create: `LICENSE`

**Interfaces:**
- Consumes: the public app URL, branch name, privacy boundaries, and MIT owner from the approved design spec.
- Produces: stable repository-facing links and claims later checked together with preview and deployment assets.

- [ ] **Step 1: Write the failing documentation contract**

Create `tests/release-assets.test.cjs` with:

```js
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
```

- [ ] **Step 2: Run the contract and verify it fails**

Run: `node --test tests/release-assets.test.cjs`

Expected: FAIL because `README.md`, `PRIVACY.md`, and `LICENSE` do not exist.

- [ ] **Step 3: Create the Chinese README**

Create `README.md` with this complete structure and copy:

```markdown
# 美学身份卡 · Face Style Notes

一款面向年轻女性的移动端面部比例分析与变美行动网页。上传一张正面照后，页面会把面部轮廓与比例整理成可读、可收藏、可分享的“美学身份卡”，并可继续创建变美挑战、完成打卡和记录前后对比。

[在线体验](https://najeebjb724-star.github.io/face-style-notes/) · [查看当前源码分支](https://github.com/najeebjb724-star/face-style-notes/tree/codex/aesthetic-identity-card-ui)

![美学身份卡手机端首页预览](assets/preview.png)

## 目前可以体验什么

- 照片质量检查：提示角度、清晰度、亮度和人脸大小问题。
- 参考级继续分析：照片不完全合格时，用户仍可主动选择继续，并看到可信度提示。
- 可读面部数据：将三庭、眼距、轮廓和六维特征转成更容易理解的描述。
- 美学身份卡：以杂志与收藏卡风格呈现结果，可保存或通过系统分享。
- 变美挑战：模板优先、可选自定义，支持打卡、提醒日历文件、前后照片对比和挑战海报。

## 隐私与结果边界

用户选择的照片在浏览器本地处理，不会发送到本项目服务器。挑战记录和可选对比照片可能保存在当前浏览器的本地存储中。GitHub Pages 与第三方 CDN 会产生加载页面、脚本、字体或模型所需的常规网络请求，但不会上传用户选择的照片。完整说明见 [PRIVACY.md](PRIVACY.md)。

身份卡是基于照片与几何比例的风格参考，不评价美丑，不构成医疗、健康或人格判断。拍摄角度、光线、镜头畸变、表情和启发式规则都会影响结果。

## 本地运行

项目保持单文件应用结构，无需安装构建依赖。由于浏览器对 `file://` 页面和 CDN 的限制不同，推荐在项目目录启动本地静态服务器：

```bash
python -m http.server 8000
```

然后访问 `http://127.0.0.1:8000/`。首次打开需要联网加载 Tailwind CSS、Face-API.js、html2canvas 和 Face-API.js 模型文件。

## 技术构成

- 单文件 HTML、CSS 与原生 JavaScript
- Tailwind CSS CDN
- Face-API.js 0.22.2 与 68 点关键点模型
- html2canvas 1.4.1
- 浏览器 localStorage、IndexedDB、Web Share 与日历 `.ics` 文件

## 测试

需要 Node.js 18 或更高版本：

```bash
node --test tests/*.test.cjs
```

## 当前限制

- 第一次打开必须联网加载 CDN 依赖和模型，弱网下等待时间会更长。
- 页面不是离线应用，也没有账号与云同步；清理浏览器数据或更换设备后，本地挑战记录可能消失。
- 面部分析结果依赖单张照片，不等同于真人动态观察或专业意见。
- 当前是验证核心链路的网页版 MVP，微信登录、云数据库、订阅消息和小程序码将在迁移到微信小程序时另行设计。

## License

本项目采用 [MIT License](LICENSE)。
```

- [ ] **Step 4: Create the privacy notice**

Create `PRIVACY.md` with:

```markdown
# 隐私说明

更新日期：2026-09-01

“美学身份卡”目前是一个静态网页版 MVP。我们希望用尽量清楚的方式说明照片、挑战记录和网络请求如何被处理。

## 1. 面部照片与分析

用户主动选择的照片只在当前浏览器中交给 Face-API.js 进行面部定位和关键点分析，不会发送到本项目服务器。页面没有用于接收照片的后端接口，也没有账号或云端照片库。

本次分析所需的页面状态通常只存在于当前页面会话中。用户保存或分享身份卡时，浏览器会在本地生成图片；是否保存到相册或分享给其他应用，由用户主动决定。

## 2. 挑战、打卡和对比照片

挑战设置、打卡进度、提醒时间和教程链接保存在当前设备的浏览器本地存储中。用户可选的开始与结束对比照片也只保存在浏览器本地数据空间，不会发送到本项目服务器。

这些数据不会自动跨设备同步。清理浏览器数据、使用无痕模式、更换浏览器或设备，都可能使记录无法恢复。

## 3. 网络请求与第三方资源

页面托管在 GitHub Pages。打开页面时，浏览器会向 GitHub Pages 和第三方 CDN 请求网页、Tailwind CSS、Face-API.js、html2canvas 以及 Face-API.js 模型文件。这些服务可能按照各自政策记录常规访问数据，例如 IP 地址、浏览器类型和请求时间。

第三方 CDN 请求用于加载程序资源，不会上传用户选择的照片。本项目不接入广告追踪、用户画像或自建分析服务。

## 4. 如何清除数据

用户可以删除当前挑战，或在浏览器设置中找到本网站并选择“清除网站数据”。清除后，本地挑战、打卡记录、提醒设置和对比照片可能无法恢复。

## 5. 结果与健康边界

页面结果来自单张照片、面部关键点和启发式比例规则，仅用于个人记录与风格启发，不评价美丑，不是医疗建议，不用于健康诊断，也不应替代医生、皮肤科专业人士或其他合格专业人员的意见。

拍摄角度、光线、表情、妆容、镜头畸变和模型误差都可能影响结果。请把身份卡视为可复盘的参考，而不是对个人价值或外貌的确定结论。

## 6. 联系与版本变化

本项目当前通过 GitHub 仓库公开维护。若未来加入微信登录、云数据库、订阅消息或云端存储，将在上线前更新本说明，并重新说明授权目的、保存期限和删除方式。
```

- [ ] **Step 5: Create the standard MIT license**

Create `LICENSE` with the standard MIT License text beginning with:

```text
MIT License

Copyright (c) 2026 najeebjb724-star

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 6: Run the documentation contract**

Run: `node --test tests/release-assets.test.cjs`

Expected: 3 tests PASS.

- [ ] **Step 7: Commit the documentation unit**

```bash
git add README.md PRIVACY.md LICENSE tests/release-assets.test.cjs
git commit -m "docs: add project release information"
```

### Task 2: Official GitHub Pages Workflow

**Files:**
- Modify: `tests/release-assets.test.cjs`
- Create: `.github/workflows/deploy-pages.yml`

**Interfaces:**
- Consumes: repository root static assets and branch `codex/aesthetic-identity-card-ui`.
- Produces: a GitHub Actions `github-pages` deployment targeting the repository Pages environment.

- [ ] **Step 1: Add a failing workflow contract**

Append to `tests/release-assets.test.cjs`:

```js
test("Pages workflow deploys only the approved branch with official actions", () => {
  const workflow = read(".github/workflows/deploy-pages.yml");
  [
    "codex/aesthetic-identity-card-ui",
    "workflow_dispatch:",
    "contents: read",
    "pages: write",
    "id-token: write",
    "actions/configure-pages@v5",
    "actions/upload-pages-artifact@v3",
    "actions/deploy-pages@v4",
    "environment:",
    "name: github-pages"
  ].forEach((text) => assert.ok(workflow.includes(text), `workflow missing: ${text}`));
  assert.ok(!/uses:\s+(?!actions\/)/.test(workflow), "workflow must use only official actions");
});
```

- [ ] **Step 2: Run the workflow contract and verify it fails**

Run: `node --test tests/release-assets.test.cjs`

Expected: the new workflow test FAILS with `ENOENT` for `.github/workflows/deploy-pages.yml`; the first 3 tests PASS.

- [ ] **Step 3: Create the Pages workflow**

Create `.github/workflows/deploy-pages.yml`:

```yaml
name: Deploy static site to Pages

on:
  push:
    branches:
      - codex/aesthetic-identity-card-ui
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  deploy:
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4
      - name: Configure Pages
        uses: actions/configure-pages@v5
      - name: Upload static site
        uses: actions/upload-pages-artifact@v3
        with:
          path: .
      - name: Deploy to Pages
        id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 4: Run the workflow contract**

Run: `node --test tests/release-assets.test.cjs`

Expected: 4 tests PASS.

- [ ] **Step 5: Commit the deployment unit**

```bash
git add .github/workflows/deploy-pages.yml tests/release-assets.test.cjs
git commit -m "ci: deploy app with GitHub Pages"
```

### Task 3: Privacy-Safe Mobile Preview

**Files:**
- Modify: `tests/release-assets.test.cjs`
- Create: `assets/preview.png`

**Interfaces:**
- Consumes: the unchanged homepage in `index.html` at a 390 × 844 viewport.
- Produces: the screenshot path already referenced by `README.md` and a binary dimension contract.

- [ ] **Step 1: Add a failing PNG contract**

Append to `tests/release-assets.test.cjs`:

```js
test("homepage preview is a 390 by 844 PNG", () => {
  const previewPath = path.join(root, "assets", "preview.png");
  const png = fs.readFileSync(previewPath);
  assert.deepEqual(Array.from(png.subarray(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(png.readUInt32BE(16), 390);
  assert.equal(png.readUInt32BE(20), 844);
});
```

- [ ] **Step 2: Run the preview contract and verify it fails**

Run: `node --test tests/release-assets.test.cjs`

Expected: the preview test FAILS with `ENOENT` for `assets/preview.png`; the first 4 tests PASS.

- [ ] **Step 3: Start the unchanged app locally**

Run in a dedicated terminal from the repository root:

```bash
python -m http.server 8000 --bind 127.0.0.1
```

Expected: the server listens at `http://127.0.0.1:8000/` without changing repository files.

- [ ] **Step 4: Capture the privacy-safe preview**

Use the browser-control skill to open `http://127.0.0.1:8000/`, set the viewport to exactly 390 × 844, wait for the homepage layout and fonts to settle, and save a PNG screenshot as `assets/preview.png`.

The captured frame must show the brand/title, model status area, photo upload entry, privacy copy, and challenge secondary entry. Do not upload or select any photo. Do not include browser chrome, a face, private data, or a test fixture.

- [ ] **Step 5: Run the preview contract**

Run: `node --test tests/release-assets.test.cjs`

Expected: 5 tests PASS, including exact PNG width 390 and height 844.

- [ ] **Step 6: Visually inspect the preview**

Open `assets/preview.png` with the local image viewer and confirm:

- warm paper, cream card, champagne-gold, and deep-brown visual system is intact;
- text is not clipped at 390 pixels wide;
- the page contains no selected photo or personal information;
- the screenshot ends at 844 pixels without added browser controls.

- [ ] **Step 7: Commit the preview unit**

```bash
git add assets/preview.png tests/release-assets.test.cjs
git commit -m "docs: add mobile project preview"
```

### Task 4: Full Local Release Verification

**Files:**
- Verify only: `index.html`, `README.md`, `PRIVACY.md`, `LICENSE`, `assets/preview.png`, `.github/workflows/deploy-pages.yml`, `tests/*.test.cjs`

**Interfaces:**
- Consumes: all three implementation commits.
- Produces: evidence that the release layer is complete and the app behavior is unchanged.

- [ ] **Step 1: Run the complete test suite**

Run: `node --test tests/*.test.cjs`

Expected: all existing 76 application tests plus all 5 release tests PASS; total 81 tests PASS, 0 FAIL.

- [ ] **Step 2: Parse both inline application scripts**

Run this PowerShell check:

```powershell
$html = Get-Content -LiteralPath index.html -Raw
$matches = [regex]::Matches($html, '<script(?:\s+id="[^"]+")?>([\s\S]*?)</script>')
$matches.Count
```

Expected: output `2`. Then use Node `vm.Script` in a one-off read-only command to compile each captured inline script; expected exit code 0 and no syntax error.

Run:

```powershell
node -e "const fs=require('node:fs'),vm=require('node:vm');const h=fs.readFileSync('index.html','utf8');const s=[...h.matchAll(/<script(?:\s+id=\"[^\"]+\")?>([\s\S]*?)<\/script>/g)].map(x=>x[1]);if(s.length!==2)throw Error('expected 2 inline scripts');s.forEach((x,i)=>new vm.Script(x,{filename:'inline-'+(i+1)+'.js'}));console.log('2 inline scripts parsed')"
```

Expected: output `2 inline scripts parsed` and exit code 0.

- [ ] **Step 3: Confirm application source is untouched**

Run: `git diff b8beec5 -- index.html tests/face-style-core.test.cjs`

Expected: no output.

- [ ] **Step 4: Confirm only intended release files were added**

Run: `git diff --name-status b8beec5..HEAD`

Expected tracked paths:

```text
A	.github/workflows/deploy-pages.yml
A	LICENSE
A	PRIVACY.md
A	README.md
A	assets/preview.png
A	tests/release-assets.test.cjs
```

The pre-existing untracked `.superpowers/` and two 2026-08-28 unified-challenge documents may still appear in `git status --short`; they must remain untracked and unchanged.

- [ ] **Step 5: Check for accidental secrets or private image files**

Run: `rg -n "BEGIN (RSA|OPENSSH|EC) PRIVATE KEY|api[_-]?key|client[_-]?secret|access[_-]?token" README.md PRIVACY.md .github tests assets`

Expected: no matches. Run `Get-ChildItem -LiteralPath assets -File` and confirm the only new asset is `preview.png`.

### Task 5: Push and Verify the GitHub Release

**Files:**
- No local file changes.

**Interfaces:**
- Consumes: verified local `HEAD` containing all release assets.
- Produces: updated remote feature branch, Actions run, and GitHub Pages public URL.

- [ ] **Step 1: Push without touching remote main**

Run:

```bash
git push origin HEAD:codex/aesthetic-identity-card-ui
```

Expected: push succeeds and does not update `origin/main`.

- [ ] **Step 2: Verify the remote branch points at local HEAD**

Run:

```bash
git rev-parse HEAD
git ls-remote origin refs/heads/codex/aesthetic-identity-card-ui
```

Expected: both commands report the same commit hash. If GitHub connectivity times out, retry the read-only remote check once; do not repeat the push unless the first push was not accepted.

- [ ] **Step 3: Verify the Pages workflow**

Open:

`https://github.com/najeebjb724-star/face-style-notes/actions/workflows/deploy-pages.yml`

Expected: the newest run for `codex/aesthetic-identity-card-ui` completes successfully. If GitHub reports that Pages is not enabled, open repository `Settings → Pages`, choose `GitHub Actions` as Source, and rerun the existing workflow; do not change the workflow or remote `main`.

- [ ] **Step 4: Verify the public experience**

Open `https://najeebjb724-star.github.io/face-style-notes/` in a 390-pixel-wide browser viewport.

Expected: the homepage loads over HTTPS, the upload and challenge entries are visible, and the browser console shows no new release-related errors. Model readiness may take several seconds because CDN model files load on first visit.

- [ ] **Step 5: Report the release links**

Return all three links to the user:

- Source branch: `https://github.com/najeebjb724-star/face-style-notes/tree/codex/aesthetic-identity-card-ui`
- Actions: `https://github.com/najeebjb724-star/face-style-notes/actions/workflows/deploy-pages.yml`
- Online demo: `https://najeebjb724-star.github.io/face-style-notes/`

Also report the final passing test count and whether GitHub Pages required one-time repository enablement.
