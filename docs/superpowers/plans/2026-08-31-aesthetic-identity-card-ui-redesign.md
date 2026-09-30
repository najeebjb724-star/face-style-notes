# Aesthetic Identity Card UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the existing single-file face-analysis MVP as a warm, tarot-inspired collectible aesthetic identity card without changing its validated analysis and challenge behavior.

**Architecture:** Keep `index.html` as the application and extend the existing `FaceStyleCore` pure-function boundary with one presentation-only identity model. Rebuild the HTML/CSS hierarchy around that model, render the radar and trait bars as inline SVG/HTML, and refactor report capture so save and system share reuse the same generated image. Preserve all current local-storage, IndexedDB, Face-API.js, questionnaire, challenge, calendar, and poster interfaces.

**Tech Stack:** Single-file HTML/CSS/vanilla JavaScript, Face-API.js 0.22.2, html2canvas 1.4.1, Tailwind CDN already present, Node.js built-in test runner.

## Global Constraints

- Keep the app in `index.html`; do not add a frontend framework or build step.
- Use `#F7F3EE`, `#FFFDF9`, `#C9A87C`, `#2C2420`, `#7A6B5A`, `#D4C4B0`, and `#EDE5D8` as the UI palette.
- Do not use technology blue, fluorescent green, pure black, or saturated gradients.
- Do not add a remote font dependency; use the approved local serif and sans-serif font stacks.
- Do not display beauty scores, golden-ratio scores, perfect-proportion claims, or rarity rankings.
- `SIGNATURE`, `UNIQUE`, and `CLASSIC` are non-ranked presentation types.
- A higher radar value means “more pronounced,” never “better.” Show that explanation next to the chart.
- Preserve photo-quality override, analysis, questionnaire, report, unified challenge, check-in, comparison-photo, calendar, poster, local-storage, and IndexedDB behavior.
- Keep touch targets at least 44px and preserve keyboard focus, modal isolation, live-region announcements, and `prefers-reduced-motion` behavior.
- Primary responsive widths are 375–430px; 320px must remain usable without horizontal overflow.
- Preserve unrelated untracked files and `.superpowers/` mockups. Stage only files listed by each task.

---

### Task 1: Establish a Clean, Tested Functional Baseline

**Files:**
- Modify: `index.html` (existing completed report-to-challenge consolidation only)
- Test: `tests/face-style-core.test.cjs` (existing completed consolidation tests only)

**Interfaces:**
- Consumes: current `FaceStyleCore`, `openReportChallengeSetup(actionId, trigger)`, and challenge V2 state.
- Produces: a clean commit whose report recommendations and home entry use one challenge state before visual work begins.

- [ ] **Step 1: Verify the current dirty diff contains only the completed challenge-entry consolidation**

Run:

```powershell
git diff -- index.html tests/face-style-core.test.cjs
git status --short
```

Expected: only the already-reviewed removal of `faceStyleActionStateV1`, the report recommendation integration, and matching tests appear in the two tracked files. Do not stage `.superpowers/` or unrelated older documents.

- [ ] **Step 2: Run the baseline test suite**

Run:

```powershell
node --test tests/*.test.cjs
```

Expected: 62 tests pass, 0 fail.

- [ ] **Step 3: Commit the completed baseline separately**

```powershell
git add -- index.html tests/face-style-core.test.cjs
git commit -m "fix: connect report recommendations to challenges"
```

- [ ] **Step 4: Confirm the UI redesign starts from a clean tracked diff**

Run:

```powershell
git status --short
```

Expected: no tracked modifications; unrelated untracked files may remain.

### Task 2: Lock the Identity-Card Contract with Failing Tests

**Files:**
- Modify: `tests/face-style-core.test.cjs`
- Modify: `index.html:15-590`

**Interfaces:**
- Consumes: `loadCore()` and static HTML inspection already used by the test suite.
- Produces: required element IDs and prohibited-copy assertions used by Tasks 3–7.

- [ ] **Step 1: Add a failing structural test for the new page hierarchy**

Add to `tests/face-style-core.test.cjs`:

```js
test("page exposes the aesthetic identity card hierarchy", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  [
    "identitySerial", "identityType", "identityTitle", "identityPoem",
    "identityPortrait", "identityPortraitTags", "identityRadar",
    "identityTraitBars", "identityMemories", "identityDirections",
    "identityCollection", "shareIdentityButton"
  ].forEach((id) => assert.match(html, new RegExp(`id=["']${id}["']`)));
});

test("identity card copy avoids ranked beauty language", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  ["黄金比例评分", "颜值评分", "完美比例", "稀有度", ">RARE<", ">COMMON<"]
    .forEach((phrase) => assert.equal(html.includes(phrase), false));
  assert.match(html, /越高代表特征越明显，不代表越好/);
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```powershell
node --test --test-name-pattern="aesthetic identity|ranked beauty" tests/face-style-core.test.cjs
```

Expected: FAIL because the new identity-card IDs and explanatory copy do not exist.

- [ ] **Step 3: Add the minimum semantic skeleton**

Replace the current report header/summary wrappers in `index.html` with the following IDs while leaving the old rendering containers temporarily present below them:

```html
<header class="identity-cover">
  <span id="identitySerial" class="identity-seal"></span>
  <span id="identityType" class="identity-type"></span>
  <h2 id="identityTitle"></h2>
  <p id="identityPoem"></p>
</header>
<figure id="identityPortrait" class="identity-portrait">
  <img id="reportPhoto" alt="本次分析使用的照片">
  <div class="tarot-corner corner-tl" aria-hidden="true"></div>
  <div class="tarot-corner corner-tr" aria-hidden="true"></div>
  <div class="tarot-corner corner-bl" aria-hidden="true"></div>
  <div class="tarot-corner corner-br" aria-hidden="true"></div>
  <figcaption id="identityPortraitTags"></figcaption>
</figure>
<section aria-labelledby="identityRadarTitle">
  <h3 id="identityRadarTitle">六维特征图谱</h3>
  <div id="identityRadar"></div>
  <p>越高代表特征越明显，不代表越好。</p>
  <div id="identityTraitBars"></div>
</section>
<section id="identityMemories"></section>
<section id="identityDirections"></section>
<footer id="identityCollection"></footer>
<button id="shareIdentityButton" type="button">分享身份卡</button>
```

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run:

```powershell
node --test --test-name-pattern="aesthetic identity|ranked beauty" tests/face-style-core.test.cjs
```

Expected: 2 tests pass.

- [ ] **Step 5: Commit the contract**

```powershell
git add -- index.html tests/face-style-core.test.cjs
git commit -m "test: define aesthetic identity card structure"
```

### Task 3: Build the Global Visual System and Restrained Operation Pages

**Files:**
- Modify: `index.html:15-420`
- Test: `tests/face-style-core.test.cjs`

**Interfaces:**
- Consumes: existing view IDs, form IDs, quality controls, and event handlers.
- Produces: CSS tokens/classes shared by the upload, quality, analysis, questionnaire, report, and challenge views.

- [ ] **Step 1: Add a failing design-token and accessibility test**

```js
test("identity redesign uses the approved warm token system", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  ["#F7F3EE", "#FFFDF9", "#C9A87C", "#2C2420", "#7A6B5A", "#D4C4B0", "#EDE5D8"]
    .forEach((color) => assert.match(html.toUpperCase(), new RegExp(color.toUpperCase())));
  assert.match(html, /--font-display:/);
  assert.match(html, /min-height:\s*2\.75rem/);
  assert.match(html, /prefers-reduced-motion/);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
node --test --test-name-pattern="warm token" tests/face-style-core.test.cjs
```

Expected: FAIL because the approved tokens and display font variable are absent.

- [ ] **Step 3: Replace global tokens and typography**

At the start of the existing `<style>` block, use:

```css
:root {
  --paper: #F7F3EE;
  --card: #FFFDF9;
  --gold: #C9A87C;
  --ink: #2C2420;
  --muted: #7A6B5A;
  --line: #D4C4B0;
  --line-soft: #EDE5D8;
  --font-display: "Songti SC", "STSong", "Noto Serif SC", "Source Han Serif SC", Georgia, serif;
  --font-body: "PingFang SC", "Microsoft YaHei", -apple-system, BlinkMacSystemFont, sans-serif;
}
body { background: var(--paper); color: var(--ink); font-family: var(--font-body); }
h1, h2, h3, .display-type { font-family: var(--font-display); font-weight: 600; }
.identity-label { letter-spacing: .16rem; text-transform: uppercase; }
button, [role="button"], input, select { min-height: 2.75rem; }
```

Remove the old rose/sand gradients and repeated generic white-card shadows. Keep one subtle paper shadow for elevated sheets and one stronger shadow for modal sheets.

- [ ] **Step 4: Restyle the homepage, upload, and quality states without changing IDs**

Use a restrained operation-page structure:

```html
<header class="masthead operation-header">
  <p class="identity-label">AESTHETIC IDENTITY ARCHIVE</p>
  <h1>看见轮廓，<br>收藏自己的美学语言。</h1>
  <p class="intro">上传一张正面照，得到可读、可保存的面部比例与风格记录。</p>
</header>
```

Keep `dropZone`, `fileInput`, `modelStatus`, `modelProgress`, `qualityCard`, `retakeButton`, and `useAnywayButton` unchanged so existing handlers continue to work. Present `qualityCard` as an editorial annotation with a thin gold rule and one primary correction.

- [ ] **Step 5: Render an active challenge as a compact journal entry on the homepage**

Keep `homeChallengeButton` as the event target, but style its content/state using existing challenge state:

```js
function renderHomeChallengeEntry() {
  const active = state.challengeState?.active;
  $("homeChallengeButton").innerHTML = active
    ? `<span class="journal-day">${FaceStyleCore.getChallengeDay(active, localDateString())}</span><span><b>今天的变美记录</b><small>${escapeHtml(active.title)}</small></span><i>去打卡 →</i>`
    : `<span><b>开始一个变美挑战</b><small>把一次建议变成可坚持的记录</small></span><i>查看 →</i>`;
}
```

Call `renderHomeChallengeEntry()` in `init()` immediately after `loadChallengeState()`, after `startChallenge()` saves a new active challenge, after `deleteActiveChallenge()` clears the active challenge, and after `completeActiveChallenge()` moves the active challenge to history.

- [ ] **Step 6: Run tests and verify GREEN**

Run:

```powershell
node --test tests/*.test.cjs
```

Expected: all tests pass.

- [ ] **Step 7: Commit the global shell**

```powershell
git add -- index.html tests/face-style-core.test.cjs
git commit -m "feat: add collectible identity visual system"
```

### Task 4: Redesign Questionnaire and Analysis as an Editorial Ritual

**Files:**
- Modify: `index.html:340-420, 1680-1850, 2940-2960`
- Test: `tests/face-style-core.test.cjs`

**Interfaces:**
- Consumes: `renderQuestion()`, `setAnalysisStep(activeStep)`, question radio names, and existing next/back controls.
- Produces: unchanged questionnaire data and analysis sequencing with new copy and presentation.

- [ ] **Step 1: Add failing copy and structure tests**

```js
test("analysis uses warm identity-card generation copy", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  ["正在读取你的面部轮廓", "正在整理你的比例特征", "正在制作专属美学身份卡"]
    .forEach((copy) => assert.match(html, new RegExp(copy)));
  ["正在计算三庭五眼", "正在生成风格报告", "AI分析中", "扫描中"]
    .forEach((copy) => assert.equal(html.includes(copy), false));
  assert.match(html, /analysis-contour-orbit/);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
node --test --test-name-pattern="warm identity-card generation" tests/face-style-core.test.cjs
```

Expected: FAIL on the old mechanical copy.

- [ ] **Step 3: Replace analysis markup and keep step IDs**

```html
<div class="analysis-portrait-stage">
  <img id="analysisPhoto" alt="正在解读的照片">
  <svg class="analysis-contour-orbit" viewBox="0 0 240 300" aria-hidden="true">
    <path d="M120 24C62 24 40 84 46 151c6 72 37 123 74 134 37-11 68-62 74-134 6-67-16-127-74-127Z"></path>
    <circle r="3"><animateMotion dur="3.6s" repeatCount="indefinite" path="M120 24C62 24 40 84 46 151c6 72 37 123 74 134 37-11 68-62 74-134 6-67-16-127-74-127Z"></animateMotion></circle>
  </svg>
</div>
<div class="analysis-copy" aria-live="polite">
  <p id="analyzeStep1">正在读取你的面部轮廓</p>
  <p id="analyzeStep2">正在整理你的比例特征</p>
  <p id="analyzeStep3">正在制作专属美学身份卡</p>
</div>
```

Update `setAnalysisStep` so it toggles only `active` and `done`; remove assumptions about `.step-icon`.

- [ ] **Step 4: Restyle questionnaire selection without changing form values**

Use a thin progress rule and radio-backed rows:

```css
.question-progress-track { height: 1px; background: var(--line-soft); }
.question-progress-track > i { display:block; height:1px; background:var(--gold); transition:width .35s ease; }
.question-option { border: 0; border-bottom: 1px solid var(--line-soft); border-radius: 0; background: transparent; }
.question-option:has(input:checked) { color: var(--ink); border-color: var(--gold); box-shadow: none; }
```

In `renderQuestion()`, set the track width with:

```js
$("questionProgressTrack").style.width = `${((state.questionIndex + 1) / steps.length) * 100}%`;
```

Add the track immediately after `questionProgress`:

```html
<div class="question-progress-track" aria-hidden="true"><i id="questionProgressTrack"></i></div>
```

- [ ] **Step 5: Add reduced-motion fallbacks for the ritual animation**

```css
@media (prefers-reduced-motion: reduce) {
  .analysis-contour-orbit circle { display: none; }
  .analysis-contour-orbit, .identity-sheet { animation: none !important; transform: none !important; }
}
```

- [ ] **Step 6: Run the full suite and commit**

Run:

```powershell
node --test tests/*.test.cjs
```

Expected: all tests pass.

```powershell
git add -- index.html tests/face-style-core.test.cjs
git commit -m "feat: turn analysis into an identity-card ritual"
```

### Task 5: Create the Pure Identity Presentation Model

**Files:**
- Modify: `index.html:610-1330`
- Test: `tests/face-style-core.test.cjs`

**Interfaces:**
- Consumes: `measurements`, `deriveReadableProfile()`, and report quality.
- Produces: `FaceStyleCore.buildIdentityPresentation(measurements, readableProfile, generatedAt)` returning `{serial, type, title, poem, portraitTags, axes}`.

- [ ] **Step 1: Add failing deterministic model tests**

```js
test("identity presentation is deterministic, non-ranked, and bounded", () => {
  const core = loadCore();
  const measurements = core.computeMeasurements(makeFrontLandmarks(), "high");
  const readable = core.deriveReadableProfile(measurements, { level: "high" });
  const identity = core.buildIdentityPresentation(measurements, readable, new Date("2026-08-31T12:00:00Z"));
  assert.match(identity.serial, /^NO\.\d{4}$/);
  assert.ok(["SIGNATURE", "UNIQUE", "CLASSIC"].includes(identity.type));
  assert.equal(identity.axes.length, 6);
  identity.axes.forEach((axis) => {
    assert.ok(axis.id && axis.label);
    assert.ok(axis.value >= 0 && axis.value <= 100);
  });
  assert.equal(identity.title.includes("评分"), false);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
node --test --test-name-pattern="identity presentation" tests/face-style-core.test.cjs
```

Expected: FAIL because `buildIdentityPresentation` is not exported.

- [ ] **Step 3: Implement bounded presentation helpers inside `#face-style-core`**

```js
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const scaleIdentityValue = (value, min, max) => round(clamp((value - min) / (max - min), 0, 1) * 100, 0);

function buildIdentityPresentation(measurements, readableProfile, generatedAt = new Date()) {
  const courts = measurements.courts.map((item) => item.value);
  const courtDrift = Math.max(...courts.map((value) => Math.abs(value - 33.33)));
  const visualWeight = Object.values(measurements.visualWeight).reduce((sum, value) => sum + value, 0) / 4;
  const axes = [
    { id: "lengthWidth", label: "轮廓纵横差异", value: scaleIdentityValue(Math.abs(measurements.faceLengthWidth.value - 1.04), 0, .24) },
    { id: "cheekJaw", label: "颧颌宽度差异", value: scaleIdentityValue(Math.abs(measurements.cheekFaceWidth.value - measurements.jawFaceWidth.value), 0, .22) },
    { id: "features", label: "五官量感特征", value: scaleIdentityValue(Math.abs(visualWeight - .24), 0, .10) },
    { id: "courts", label: "三庭分布差异", value: scaleIdentityValue(courtDrift, 0, 10) },
    { id: "mirror", label: "左右对照差异", value: scaleIdentityValue(measurements.symmetry.value, 0, 8) },
    { id: "eyeSpace", label: "眼距参照差异", value: scaleIdentityValue(Math.abs(measurements.eyeSpacing.value - 1), 0, .45) }
  ];
  const pronounced = axes.filter((axis) => axis.value >= 68).length;
  const type = pronounced >= 3 ? "UNIQUE" : pronounced >= 1 ? "SIGNATURE" : "CLASSIC";
  const minuteIndex = Math.abs(Math.trunc(generatedAt.getTime() / 60000)) % 10000;
  const serial = `NO.${String(minuteIndex).padStart(4, "0")}`;
  const line = readableProfile.lineTendency.term;
  const style = line.includes("直线") ? "冷感叙事型" : line.includes("曲线") ? "柔和氛围型" : "清晰平衡型";
  return {
    serial,
    type,
    title: `${readableProfile.faceShape.primary} · ${style}`,
    poem: line.includes("直线") ? "你的轮廓方向清晰，像一帧被认真收藏的旧电影。" : "你的线条留有柔和余韵，适合让细节慢慢被看见。",
    portraitTags: [readableProfile.threeCourts.labels[1], readableProfile.fiveEyes.term, readableProfile.featureWeight.term].slice(0, 3),
    axes
  };
}
```

Export `deriveReadableProfile` and `buildIdentityPresentation` on `window.FaceStyleCore`.

- [ ] **Step 4: Run focused and full tests**

Run:

```powershell
node --test --test-name-pattern="identity presentation" tests/face-style-core.test.cjs
node --test tests/*.test.cjs
```

Expected: focused test passes; full suite passes.

- [ ] **Step 5: Commit the presentation model**

```powershell
git add -- index.html tests/face-style-core.test.cjs
git commit -m "feat: derive non-ranked identity card presentation"
```

### Task 6: Render the Tarot-Scroll Identity Report

**Files:**
- Modify: `index.html:421-502, 2786-2870, 2965-2995`
- Test: `tests/face-style-core.test.cjs`

**Interfaces:**
- Consumes: `FaceStyleCore.buildIdentityPresentation()`, `report.readableProfile`, `report.coreTraits`, `report.dataGroups`, and `report.styleAdvice`.
- Produces: `renderIdentityRadar(axes)`, `renderIdentityTraitBars(report, identity)`, and the final collectible report DOM.

- [ ] **Step 1: Add failing report-renderer tests**

```js
test("report renders the identity model as svg and readable trait bars", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  assert.match(html, /function renderIdentityRadar\(axes\)/);
  assert.match(html, /<svg[^>]+identity-radar-svg/);
  assert.match(html, /function renderIdentityTraitBars\(report, identity\)/);
  assert.match(html, /FaceStyleCore\.buildIdentityPresentation/);
  assert.match(html, /查看解读依据/);
});
```

- [ ] **Step 2: Run focused test and verify RED**

Run:

```powershell
node --test --test-name-pattern="svg and readable trait bars" tests/face-style-core.test.cjs
```

Expected: FAIL because the new renderers do not exist.

- [ ] **Step 3: Implement an inline SVG radar with six axes**

```js
function renderIdentityRadar(axes) {
  const center = 120;
  const radius = 82;
  const point = (index, value = 100) => {
    const angle = -Math.PI / 2 + index * Math.PI * 2 / axes.length;
    const distance = radius * value / 100;
    return [FaceStyleCore.round(center + Math.cos(angle) * distance, 1), FaceStyleCore.round(center + Math.sin(angle) * distance, 1)];
  };
  const grid = [33, 66, 100].map((level) => axes.map((_, index) => point(index, level).join(",")).join(" "));
  const values = axes.map((axis, index) => point(index, axis.value).join(",")).join(" ");
  const labels = axes.map((axis, index) => {
    const [x, y] = point(index, 122);
    return `<text x="${x}" y="${y}" text-anchor="middle">${escapeHtml(axis.label)}</text>`;
  }).join("");
  $("identityRadar").innerHTML = `<svg class="identity-radar-svg" viewBox="0 0 240 240" role="img" aria-label="六维特征图谱">${grid.map((points) => `<polygon class="radar-grid" points="${points}"></polygon>`).join("")}<polygon class="radar-value" points="${values}"></polygon>${labels}</svg>`;
}
```

- [ ] **Step 4: Render readable three-court and feature bars**

```js
function renderIdentityTraitBars(report, identity) {
  const court = report.readableProfile.threeCourts;
  $("identityTraitBars").innerHTML = `
    <article class="trait-bar-card">
      <div class="trait-heading"><span>三庭视觉参照</span><b>${court.values.join(" · ")}%</b></div>
      <div class="court-bar">${court.values.map((value, index) => `<i style="--segment:${value}" aria-label="${["上庭", "中庭", "下庭"][index]} ${value}%"></i>`).join("")}</div>
      <p>${escapeHtml(court.summary)}</p>
    </article>
    ${identity.axes.slice(0, 3).map((axis) => `<article class="trait-row"><span>${escapeHtml(axis.label)}</span><div><i style="--value:${axis.value}"></i></div><b>${axis.value >= 68 ? "明显" : axis.value >= 34 ? "中间" : "轻微"}</b></article>`).join("")}`;
}
```

The visible labels describe tendencies; detailed formulas stay in the existing `dataGroups` drawer.

- [ ] **Step 5: Rewrite `renderReport(report, photo)` around the identity model**

At the beginning of `renderReport`:

```js
const identity = FaceStyleCore.buildIdentityPresentation(state.measurements, report.readableProfile, new Date());
$("identitySerial").textContent = `美学身份卡 · ${identity.serial}`;
$("identityType").textContent = identity.type;
$("identityTitle").textContent = identity.title;
$("identityPoem").textContent = identity.poem;
$("reportPhoto").src = photo;
$("identityPortraitTags").innerHTML = identity.portraitTags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("");
renderIdentityRadar(identity.axes);
renderIdentityTraitBars(report, identity);
```

Map `readable.strengths` to `identityMemories` under “最有记忆点的地方” and `readable.attention` to `identityDirections` under “可以尝试的方向.” Keep `coreTraits`, `dataGroups`, `styleAdviceGrid`, `carePlan`, `reportChallengeSection`, `sourceList`, and `limitations` IDs for existing behavior and tests.

- [ ] **Step 6: Add the tarot-scroll visual CSS**

Use the approved structure:

```css
.identity-sheet { background: var(--ink); padding: .75rem; }
.identity-scroll { position:relative; background:var(--paper); border:1px solid var(--gold); padding:1.1rem; }
.identity-scroll::before, .identity-scroll::after { content:"✦"; position:absolute; left:50%; transform:translateX(-50%); color:var(--gold); background:var(--paper); padding:0 .55rem; }
.identity-cover { text-align:center; padding:1.5rem .75rem 1.1rem; }
.identity-portrait { position:relative; min-height:28rem; overflow:hidden; border-radius:50% 50% .5rem .5rem; }
.identity-portrait img { width:100%; height:100%; object-fit:cover; }
.tarot-corner { position:absolute; width:1.5rem; height:1.5rem; border-color:var(--gold); }
.identity-radar-svg .radar-grid { fill:none; stroke:var(--line); stroke-width:1; }
.identity-radar-svg .radar-value { fill:rgba(201,168,124,.2); stroke:var(--gold); stroke-width:2; transform-origin:center; animation:radarReveal .75s ease both; }
```

- [ ] **Step 7: Run full tests and commit**

Run:

```powershell
node --test tests/*.test.cjs
```

Expected: all tests pass.

```powershell
git add -- index.html tests/face-style-core.test.cjs
git commit -m "feat: render the tarot-scroll identity report"
```

### Task 7: Complete Editorial Advice, Collection Actions, and Sharing

**Files:**
- Modify: `index.html:450-502, 2769-2910`
- Test: `tests/face-style-core.test.cjs`

**Interfaces:**
- Consumes: current `renderReportChallengeRecommendations(report)`, `html2canvas`, `showToast()`, and `reportCapture`.
- Produces: `captureIdentityCanvas()`, `saveIdentityCard()`, and `shareIdentityCard()`.

- [ ] **Step 1: Add failing tests for collection actions and share fallback**

```js
test("identity collection reuses one capture path for save and share", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  assert.match(html, /async function captureIdentityCanvas\(\)/);
  assert.match(html, /async function saveIdentityCard\(\)/);
  assert.match(html, /async function shareIdentityCard\(\)/);
  assert.match(html, /navigator\.canShare\(\{ files: \[file\] \}\)/);
  assert.match(html, /当前浏览器暂不支持直接分享，请先保存身份卡/);
});
```

- [ ] **Step 2: Run focused test and verify RED**

Run:

```powershell
node --test --test-name-pattern="one capture path" tests/face-style-core.test.cjs
```

Expected: FAIL because `saveReport` is still the only capture path.

- [ ] **Step 3: Refactor report capture and implement save/share**

```js
async function captureIdentityCanvas() {
  if (!window.html2canvas) throw new Error("身份卡生成组件未加载，请检查网络后重试。");
  return html2canvas($("reportCapture"), {
    scale: Math.min(3, Math.max(2, window.devicePixelRatio || 2)),
    backgroundColor: "#F7F3EE",
    useCORS: true,
    logging: false
  });
}

const canvasToBlob = (canvas) => new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("身份卡图片生成失败。")), "image/png"));

async function saveIdentityCard() {
  const canvas = await captureIdentityCanvas();
  const link = document.createElement("a");
  link.download = `美学身份卡-${localDateString()}.png`;
  link.href = canvas.toDataURL("image/png");
  link.click();
}

async function shareIdentityCard() {
  try {
    const canvas = await captureIdentityCanvas();
    const blob = await canvasToBlob(canvas);
    const file = new File([blob], `美学身份卡-${localDateString()}.png`, { type: "image/png" });
    if (!navigator.share || !navigator.canShare?.({ files: [file] })) throw new Error("share-unavailable");
    await navigator.share({ files: [file], title: "我的美学身份卡" });
  } catch (error) {
    if (error?.name === "AbortError") return;
    $("reportMessage").textContent = "当前浏览器暂不支持直接分享，请先保存身份卡，再从相册分享。";
    $("reportMessage").classList.remove("hidden");
  }
}
```

Bind `saveButton` to `saveIdentityCard` and `shareIdentityButton` to `shareIdentityCard`. Preserve button disabled/loading restoration around both flows.

- [ ] **Step 4: Restyle advice and report challenge cards as editorial sections**

Keep all event data attributes. Replace repeated rounded boxes with alternating image/color fields and text:

```html
<article class="editorial-advice">
  <div class="advice-art" aria-hidden="true"><span>${escapeHtml(item.title.slice(0, 1))}</span></div>
  <div class="advice-copy"><small>造型经验 · ${item.metricIds.length} 项关联数据</small><h4>${escapeHtml(item.title)}</h4><p>${escapeHtml(item.explanation)}</p></div>
</article>
```

`data-report-challenge-id` and `data-open-active-challenge` must remain on the interactive challenge elements.

- [ ] **Step 5: Build the deep collection footer**

```html
<footer id="identityCollection" class="identity-collection">
  <div class="collection-orbit" aria-hidden="true"></div>
  <p class="identity-label">COLLECTED AESTHETIC PROFILE</p>
  <strong id="collectionSerial"></strong>
  <time id="reportDate"></time>
  <p>照片仅在当前浏览器处理；身份卡是个人风格参考，不是美貌或健康评价。</p>
  <div class="collection-actions">
    <button id="saveButton" class="collection-save" type="button">保存身份卡</button>
    <button id="shareIdentityButton" class="collection-share" type="button">分享身份卡</button>
  </div>
</footer>
```

- [ ] **Step 6: Run focused/full tests and commit**

Run:

```powershell
node --test --test-name-pattern="one capture path" tests/face-style-core.test.cjs
node --test tests/*.test.cjs
```

Expected: all tests pass.

```powershell
git add -- index.html tests/face-style-core.test.cjs
git commit -m "feat: add editorial collection and identity sharing"
```

### Task 8: Carry the Identity Language into Challenges and Posters

**Files:**
- Modify: `index.html:224-300, 503-590, 2545-2750`
- Test: `tests/face-style-core.test.cjs`

**Interfaces:**
- Consumes: all existing challenge IDs, event handlers, `renderChallengeCenter()`, and `buildChallengePoster()`.
- Produces: lighter journal-style challenge UI and a matching collectible completion poster without changing challenge state.

- [ ] **Step 1: Add a failing visual-contract test for challenge continuity**

```js
test("challenge center keeps identity styling without tarot-page density", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  assert.match(html, /challenge-journal/);
  assert.match(html, /TODAY'S ENTRY/);
  assert.match(html, /#C9A87C/i);
  ["checkInButton", "undoCheckInButton", "newChallengeButton", "downloadPosterButton"]
    .forEach((id) => assert.match(html, new RegExp(`id=["']${id}["']`)));
});
```

- [ ] **Step 2: Run focused test and verify RED**

Run:

```powershell
node --test --test-name-pattern="without tarot-page density" tests/face-style-core.test.cjs
```

Expected: FAIL because the journal styling/copy is absent.

- [ ] **Step 3: Restyle the challenge shell without changing interaction IDs**

Add `challenge-journal` to `challengeView`; use a quiet paper page, date/serial eyebrow, one dark today card, gold progress markers, and flat history rows. In `renderChallengeCenter()` replace only the visible kicker:

```js
const entryKicker = `<p class="identity-label">TODAY'S ENTRY · ${escapeHtml(localDateString())}</p>`;
```

Prepend `entryKicker` to empty and active today markup. Keep `todayTaskTitle`, tutorial controls, check-in controls, calendar control, photo inputs, comparison IDs, and delete controls unchanged.

- [ ] **Step 4: Update poster colors and typography only**

In `buildChallengePoster()`, replace hard-coded rose/cream colors with:

```js
const posterColors = { paper: "#F7F3EE", card: "#FFFDF9", gold: "#C9A87C", ink: "#2C2420", muted: "#7A6B5A" };
```

Add a thin gold border, the challenge identifier, and `COLLECTED BEAUTY PRACTICE` label. Preserve all privacy-safe text, completion values, optional local photos, and the existing PNG download behavior.

- [ ] **Step 5: Run full tests and commit**

Run:

```powershell
node --test tests/*.test.cjs
```

Expected: all tests pass.

```powershell
git add -- index.html tests/face-style-core.test.cjs
git commit -m "feat: align challenges with the identity archive"
```

### Task 9: Responsive, Export, Accessibility, and Regression Verification

**Files:**
- Modify: `index.html`
- Modify: `tests/face-style-core.test.cjs`

**Interfaces:**
- Consumes: completed UI and all current public functions.
- Produces: release-ready single-file MVP with verified behavior and no layout regressions.

- [ ] **Step 1: Add final static regression checks**

```js
test("identity card remains mobile-first and export-safe", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  assert.match(html, /@media\s*\(max-width:\s*22rem\)/);
  assert.match(html, /env\(safe-area-inset-bottom\)/);
  assert.match(html, /overflow-wrap:\s*anywhere/);
  assert.match(html, /backgroundColor:\s*["']#F7F3EE["']/i);
  assert.match(html, /prefers-reduced-motion/);
});
```

- [ ] **Step 2: Run the new test and fix only observed gaps**

Run:

```powershell
node --test --test-name-pattern="mobile-first and export-safe" tests/face-style-core.test.cjs
```

Expected before any needed fix: FAIL on each missing responsive/export guard. Add only the rules required by the failures:

```css
@media (max-width: 22rem) {
  .shell { padding-inline: .75rem; }
  .identity-scroll { padding: .75rem; }
  .identity-cover h2 { font-size: 2rem; }
  .identity-portrait { min-height: 23rem; }
  .collection-actions { grid-template-columns: 1fr; }
}
.identity-sheet, .identity-scroll, .editorial-advice { min-width: 0; }
.identity-sheet p, .identity-sheet a, .identity-sheet strong { overflow-wrap: anywhere; }
```

- [ ] **Step 3: Parse both inline scripts without executing the DOM runtime**

Run:

```powershell
node -e "const fs=require('fs'),vm=require('vm'),h=fs.readFileSync('index.html','utf8');const s=h.split('<script').slice(1).map(p=>p.slice(p.indexOf('>')+1,p.indexOf('</script>'))).filter(x=>x.trim());s.forEach((x,i)=>new vm.Script(x,{filename:'inline-'+i+'.js'}));console.log('inline scripts parsed:',s.length)"
```

Expected: `inline scripts parsed: 2`.

- [ ] **Step 4: Run all automated tests and whitespace validation**

Run:

```powershell
node --test tests/*.test.cjs
git diff --check
```

Expected: all tests pass, 0 fail; `git diff --check` produces no errors.

- [ ] **Step 5: Manually verify the five critical user journeys at 320, 375, 390, and 430px**

Use the browser responsive viewport and execute:

1. Upload a clear photo → quality accepted → questionnaire → identity card.
2. Upload a poor photo → fail twice → choose “仍用这张分析” → reference-level identity card.
3. Expand formulas/sources → collapse them → save the full identity card PNG.
4. Select a report challenge → create it → return → see the same active challenge → complete today.
5. Press “分享身份卡” on an unsupported local/file context → see the save-first fallback; on a supported secure context → see the system share sheet.

Expected: no horizontal overflow, no clipped collection footer, no trapped focus, one clear primary action per view, and no loss of challenge state.

- [ ] **Step 6: Inspect the final diff for scope discipline**

Run:

```powershell
git diff --stat 036d46a..HEAD
git status --short
```

Expected: production/test changes are limited to `index.html` and `tests/face-style-core.test.cjs`; approved spec/plan commits are separate; unrelated untracked files remain untouched.

- [ ] **Step 7: Commit final responsive fixes**

```powershell
git add -- index.html tests/face-style-core.test.cjs
git commit -m "fix: harden identity card mobile rendering"
```
