# 可读结果与照片继续分析 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 允许用户在单人照片质量不足时继续分析，并把完整几何数据转换成脸型、三庭五眼、优势与注意方向组成的双层可读报告。

**Architecture:** 生产交付继续只有 `index.html`。在现有 `#face-style-core` 内增加质量越过和可读画像纯函数，DOM 脚本只负责状态、按钮与渲染；Node 测试继续从 HTML 提取核心脚本验证固定关键点输出。

**Tech Stack:** HTML5、内联 CSS、原生 JavaScript、Face-API.js 0.22.2、html2canvas 1.4.1、Node.js 内置 `node:test` 与 `vm`。

## Global Constraints

- 不新增后端、数据库、Cookie、localStorage 或远程照片处理。
- 没有人脸、多人脸或图片无法解码时不得提供继续分析。
- 不生成颜值、美貌或健康评分，不使用“缺点”“修正”“遮丑”等生产文案。
- 脸型、三庭五眼和五官量感必须称为二维照片中的造型术语或视觉参照。
- 用户越过质量门槛后，所有测量最高为中等置信度，角度、对称、嘴角和上庭为低置信度。
- 生产文件保持单个 `index.html`；测试文件不被网页加载。
- 支持 320px 宽度、键盘焦点、`aria-live` 和 `prefers-reduced-motion`。

---

## File Map

- Modify: `index.html` — 质量越过、可读画像核心、双层报告、状态和渲染。
- Modify: `tests/face-style-core.test.cjs` — 质量越过、术语翻译、追溯性和结构测试。
- Modify: `tests/fixtures/landmarks.cjs` — 增加用于脸型倾向测试的坐标变体构造器。
- Reference: `docs/superpowers/specs/2026-08-27-readable-results-and-photo-override-design.md` — 已批准产品边界和验收标准。

---

### Task 1: 允许单人低质量照片继续分析

**Files:**
- Modify: `index.html` core、质量卡、状态和分析流程。
- Modify: `tests/face-style-core.test.cjs`。

**Interfaces:**
- Consumes: `quality` from `evaluatePhotoQuality(signals)` and a detected single face.
- Produces: `overridePhotoQuality(quality): QualityResult`。
- Produces: `capMeasurementConfidence(measurements, cap): MeasurementResult`。
- State: `qualityFailureCount:number`、`qualityOverride:boolean`。

- [ ] **Step 1: 添加质量越过的失败测试**

Append to `tests/face-style-core.test.cjs`:

```js
test("photo quality override preserves issues and marks result as reference-only", () => {
  const core = loadCore();
  const rejected = core.evaluatePhotoQuality({
    ...goodSignals(),
    points: rotate(makeFrontLandmarks(), 8)
  });
  const overridden = core.overridePhotoQuality(rejected);
  assert.equal(overridden.accepted, true);
  assert.equal(overridden.level, "low");
  assert.equal(overridden.overridden, true);
  assert.equal(overridden.issues[0].id, "head_roll");
});

test("override confidence never exceeds medium and angle-sensitive metrics stay low", () => {
  const core = loadCore();
  const result = core.computeMeasurements(makeFrontLandmarks(), "low", "medium");
  assert.equal(result.faceLengthWidth.confidence, "medium");
  assert.equal(result.canthalTilt.confidence, "low");
  assert.equal(result.browTilt.confidence, "low");
  assert.equal(result.mouthTilt.confidence, "low");
  assert.equal(result.courts[0].confidence, "low");
  assert.equal(result.symmetry.confidence, "low");
});
```

- [ ] **Step 2: 运行测试确认接口缺失**

Run: `node --test tests/face-style-core.test.cjs`
Expected: FAIL with `overridePhotoQuality is not a function` and the confidence cap assertion.

- [ ] **Step 3: 实现越过对象和置信度上限**

Add to `#face-style-core` and export:

```js
function overridePhotoQuality(quality) {
  return { ...quality, accepted: true, level: "low", overridden: true };
}

const confidenceRank = { low: 0, medium: 1, high: 2 };
const capConfidence = (value, cap) => confidenceRank[value] > confidenceRank[cap] ? cap : value;

function capMeasurementConfidence(value, cap) {
  if (Array.isArray(value)) return value.map((item) => capMeasurementConfidence(item, cap));
  if (!value || typeof value !== "object") return value;
  const next = { ...value };
  if (next.confidence) next.confidence = capConfidence(next.confidence, cap);
  Object.keys(next).forEach((key) => {
    if (key !== "confidence") next[key] = capMeasurementConfidence(next[key], cap);
  });
  return next;
}
```

Make these three exact mechanical edits to the existing measurement function without changing or removing any measurement field:

```js
function computeMeasurements(points, qualityLevel = "high", confidenceCap = null) {
```

Replace the current object opening:

```js
const result = {
```

After the existing `symmetry` field closes the object with `};`, add:

```js
return confidenceCap ? capMeasurementConfidence(result, confidenceCap) : result;
```

- [ ] **Step 4: 添加质量卡第二操作与状态流**

Add beside `#retakeButton`:

```html
<button id="useAnywayButton" class="text-btn" type="button">仍用这张照片分析</button>
```

Extend state and events:

```js
const state = { modelsReady: false, photo: "", detection: null, quality: null, measurements: null, questionnaire: {}, profile: null, report: null, questionIndex: 0, qualityFailureCount: 0, qualityOverride: false };

$("useAnywayButton").addEventListener("click", continueWithCurrentPhoto);

function continueWithCurrentPhoto() {
  if (!state.detection || !state.quality || state.quality.accepted) return;
  state.quality = FaceStyleCore.overridePhotoQuality(state.quality);
  state.qualityOverride = true;
  state.measurements = FaceStyleCore.computeMeasurements(
    state.detection.landmarks.positions,
    "low",
    "medium"
  );
  $("qualityCard").classList.add("hidden");
  state.questionIndex = 0;
  renderQuestion();
  showView("questionnaire");
  window.scrollTo({ top: 0, behavior: "smooth" });
}
```

In `renderQualityFailure` increment `qualityFailureCount`, use “仍用这张照片分析” for the first rejection and “继续分析（结果仅供参考）” from the second rejection. Do not render the button in the zero-face or multiple-face error path because those errors occur before the quality card.

- [ ] **Step 5: 重置、验证并提交**

Add to `resetApp()`:

```js
state.qualityFailureCount = 0;
state.qualityOverride = false;
```

Run:

```powershell
node --test tests/face-style-core.test.cjs
node work/verify.cjs index.html
```

Expected: all tests PASS; syntax, DOM references and model URL PASS.

Commit:

```powershell
git add index.html tests/face-style-core.test.cjs
git commit -m "feat: allow reference-only photo analysis"
```

---

### Task 2: 生成脸型、三庭五眼与可读画像

**Files:**
- Modify: `index.html` core terminology functions.
- Modify: `tests/fixtures/landmarks.cjs`.
- Modify: `tests/face-style-core.test.cjs`.

**Interfaces:**
- Consumes: `MeasurementResult` and `QualityResult`。
- Produces: `deriveReadableProfile(measurements, quality): ReadableProfile`。
- `ReadableProfile`: `{faceShape,threeCourts,fiveEyes,featureWeight,lineTendency,strengths,attention,memorySentence}`。

- [ ] **Step 1: 添加关键点变体和失败测试**

Append to `tests/fixtures/landmarks.cjs`:

```js
function scaleVertical(points, factor, centerY = 110) {
  return points.map((point) => ({ x: point.x, y: centerY + (point.y - centerY) * factor }));
}

module.exports = { makeFrontLandmarks, rotate, scaleVertical };
```

Update the fixture import and append tests:

```js
const { makeFrontLandmarks, rotate, scaleVertical } = require("./fixtures/landmarks.cjs");

test("readable profile returns traceable terminology and bounded takeaways", () => {
  const core = loadCore();
  const measurements = core.computeMeasurements(makeFrontLandmarks(), "high");
  const profile = core.deriveReadableProfile(measurements, { level: "high", overridden: false });
  assert.ok(profile.faceShape.primary);
  assert.ok(profile.faceShape.explanation.length > 10);
  assert.ok(profile.faceShape.metricIds.length >= 3);
  assert.match(profile.threeCourts.summary, /上庭|中庭|下庭/);
  assert.match(profile.fiveEyes.summary, /眼宽|五眼/);
  assert.match(profile.fiveEyes.summary, /左侧|右侧/);
  assert.ok(profile.strengths.length <= 2);
  assert.ok(profile.attention.length <= 1);
  assert.ok(profile.memorySentence.length > 10);
});

test("longer landmark fixture changes the primary face-shape tendency", () => {
  const core = loadCore();
  const regular = core.deriveReadableProfile(core.computeMeasurements(makeFrontLandmarks(), "high"), { level: "high" });
  const longer = core.deriveReadableProfile(core.computeMeasurements(scaleVertical(makeFrontLandmarks(), 1.3), "high"), { level: "high" });
  assert.notEqual(longer.faceShape.primary, regular.faceShape.primary);
  assert.match(longer.faceShape.primary, /长|椭圆/);
});

test("overridden quality lowers readable face-shape confidence", () => {
  const core = loadCore();
  const profile = core.deriveReadableProfile(core.computeMeasurements(makeFrontLandmarks(), "low", "medium"), { level: "low", overridden: true });
  assert.equal(profile.faceShape.confidence, "low");
});
```

- [ ] **Step 2: 运行测试确认缺少翻译接口**

Run: `node --test tests/face-style-core.test.cjs`
Expected: FAIL with `deriveReadableProfile is not a function`.

- [ ] **Step 3: 实现脸型倾向与术语映射**

First add two photo-edge proxies to `computeMeasurements` after `eyeSpacing`, and add matching `KNOWLEDGE_BASE.metrics` entries whose `formulaText` is “外眼角至可见脸缘距离 ÷ 平均眼宽”, `referenceType` is “照片内五眼留白代理”, and `sourceIds` is `["southernChineseCanons", "faceApi"]`:

```js
leftEyeSideSpace: metric("left_eye_side_space", safeDivide(Math.abs(points[36].x - points[0].x), averageEyeWidth, 0), "eye_width", { label: "左侧眼外留白", confidence: qualityLevel === "high" ? "medium" : "low" }),
rightEyeSideSpace: metric("right_eye_side_space", safeDivide(Math.abs(points[16].x - points[45].x), averageEyeWidth, 0), "eye_width", { label: "右侧眼外留白", confidence: qualityLevel === "high" ? "medium" : "low" }),
```

Include both fields in the existing `eye_brow` data group.

Add and export these pure helpers in `#face-style-core`:

```js
function rankFaceShapes(m) {
  const ratio = m.faceLengthWidth.value;
  const jaw = m.jawFaceWidth.value;
  const chin = m.chinFaceWidth.value;
  const cheek = m.cheekFaceWidth.value;
  const curve = m.jawCurve.value;
  const scores = {
    "长脸": Math.max(0, (ratio - 1.08) * 5),
    "圆脸": Math.max(0, 1.15 - ratio) + Math.max(0, curve - 1.18),
    "方脸": Math.max(0, jaw - .68) * 4 + Math.max(0, 1.22 - curve),
    "菱形脸": Math.max(0, cheek - jaw) * 5 + Math.max(0, .48 - chin),
    "心形脸": Math.max(0, cheek - jaw) * 3 + Math.max(0, .44 - chin),
    "椭圆脸": Math.max(0, .18 - Math.abs(ratio - 1.05)) + Math.max(0, .12 - Math.abs(cheek - jaw))
  };
  return Object.entries(scores).sort((a, b) => b[1] - a[1]);
}

function deriveReadableProfile(m, quality = { level: "high" }) {
  const ranked = rankFaceShapes(m);
  const primary = ranked[0][0];
  const secondary = ranked[1][1] >= ranked[0][1] * .72 ? ranked[1][0] : null;
  const courtValues = m.courts.map((item) => item.value);
  const courtLabels = m.courts.map((item) => item.value > 36 ? "相对突出" : item.value < 30 ? "相对收敛" : "接近三等分参照");
  const eyeTerm = m.eyeSpacing.band === "spacious" ? "眼距相对舒展" : m.eyeSpacing.band === "concentrated" ? "眼距相对集中" : "接近一眼宽参照";
  const weightScore = (m.visualWeight.eyes + m.visualWeight.brows + m.visualWeight.nose + m.visualWeight.lips) / 4;
  const featureWeight = weightScore < .2 ? "五官量感偏轻" : weightScore > .28 ? "五官量感偏强" : "五官量感适中";
  const lineTendency = m.jawCurve.value > 1.22 ? "曲线感较明显" : m.jawCurve.value < 1.14 ? "直线感较明显" : "直曲混合";
  const shapeExplanations = {
    "长脸": "纵向比例相对突出，脸侧线条更容易形成向下延伸感。",
    "圆脸": "长宽较接近，下颌路径呈现较明显的柔和曲线。",
    "方脸": "下颌宽度存在感较明显，轮廓方向相对清晰。",
    "菱形脸": "颧区相对突出，下颌与下巴的横向宽度较收。",
    "心形脸": "颧区相对舒展，下巴横向宽度较收。",
    "椭圆脸": "长宽处于中间带，颧区与下颌宽度过渡较连续。"
  };
  const strengths = [
    m.eyeSpacing.band === "spacious" ? "眼部留白舒展，适合清晰但不过度外扩的眉眼重点。" : "眉眼聚焦感清楚，适合把视觉重点放在眼尾与睫毛。",
    lineTendency.includes("曲线") ? "轮廓过渡柔和，容易承接自然层次和柔和边缘。" : "轮廓方向清晰，容易承接利落线条和明确配饰。"
  ].slice(0, 2);
  const attention = [m.eyeSpacing.band === "spacious" ? "眉头和眼尾若同时外扩，眼部横向留白会进一步增加。" : "眉头若同时加深并向内延伸，眉眼重心会更集中。"];
  return {
    faceShape: { primary, secondary, explanation: shapeExplanations[primary], confidence: quality.level === "low" || quality.overridden ? "low" : "medium", metricIds: [m.faceLengthWidth.id, m.cheekFaceWidth.id, m.jawFaceWidth.id, m.chinFaceWidth.id, m.jawCurve.id] },
    threeCourts: { values: courtValues, labels: courtLabels, summary: `上庭 ${courtValues[0]}%、中庭 ${courtValues[1]}%、下庭 ${courtValues[2]}%；上庭为估算，三庭仅作视觉参照。`, metricIds: m.courts.map((item) => item.id), confidence: "low" },
    fiveEyes: { term: eyeTerm, summary: `眼距约 ${m.eyeSpacing.value} 个眼宽，左侧可见留白约 ${m.leftEyeSideSpace.value} 个眼宽，右侧约 ${m.rightEyeSideSpace.value} 个眼宽；五眼为古典视觉参照，不代表审美等级。`, metricIds: [m.eyeSpacing.id, m.leftEyeSideSpace.id, m.rightEyeSideSpace.id], confidence: quality.level === "high" ? "medium" : "low" },
    featureWeight: { term: featureWeight, metricIds: [m.eyeAspectLeft.id, m.browEyeDistance.id, m.noseFaceWidth.id, m.mouthFaceWidth.id], confidence: quality.level === "high" ? "medium" : "low" },
    lineTendency: { term: lineTendency, metricIds: [m.jawCurve.id], confidence: m.jawCurve.confidence },
    strengths,
    attention,
    memorySentence: `${secondary ? `${primary}偏${secondary}` : `${primary}倾向`}，${eyeTerm}，${courtLabels[1] === "接近三等分参照" ? "中庭接近三等分参照" : `中庭${courtLabels[1]}`}。`
  };
}
```

During implementation, retain the exact output shape and neutral copy; numerical thresholds are product heuristic bands and must be labeled as such in the evidence drawer.

- [ ] **Step 4: 把可读画像接入报告组合**

At the start of `composeReport`:

```js
const readableProfile = deriveReadableProfile(measurements, quality);
```

Include `readableProfile` in the returned report. Add its metric IDs to the existing source collection and append the limitation “脸型倾向与术语阈值属于产品启发式解释带，不是普适分类标准。” Do not remove existing `coreTraits`, `dataGroups`, `styleAdvice`, `carePlan`, `actionPlan`, `sources` or `limitations`.

- [ ] **Step 5: 运行测试并提交**

Run: `node --test tests/face-style-core.test.cjs`
Expected: all tests PASS, including three readable-profile tests.

Commit:

```powershell
git add index.html tests/fixtures/landmarks.cjs tests/face-style-core.test.cjs
git commit -m "feat: translate measurements into readable profile"
```

---

### Task 3: 重构为双层可读报告

**Files:**
- Modify: `index.html` report markup, styles and renderer.
- Modify: `tests/face-style-core.test.cjs` structural test.

**Interfaces:**
- Consumes: `report.readableProfile` and existing report sections.
- Produces DOM IDs: `qualityBanner`, `memorySentence`, `terminologyGrid`, `strengthList`, `attentionDirection`, `monthlyFocus`.

- [ ] **Step 1: 添加报告结构失败测试**

Extend the existing structural test:

```js
["qualityBanner", "memorySentence", "terminologyGrid", "strengthList", "attentionDirection", "monthlyFocus"].forEach((id) => {
  assert.match(html, new RegExp(`id=["']${id}["']`));
});
["缺点", "修正", "遮丑"].forEach((phrase) => assert.equal(html.includes(phrase), false));
```

Run: `node --test tests/face-style-core.test.cjs`
Expected: FAIL because the six report IDs do not exist.

- [ ] **Step 2: 添加第一层报告结构和样式**

Before the existing `#coreTraits` section, add:

```html
<section id="qualityBanner" class="report-quality hidden" aria-live="polite"></section>
<section class="readable-summary" aria-labelledby="readableTitle">
  <div class="section-label">60 秒看懂 / READABLE PROFILE</div>
  <h3 id="readableTitle">我的脸部语言</h3>
  <p id="memorySentence" class="memory-sentence"></p>
  <div id="terminologyGrid" class="terminology-grid"></div>
  <div class="takeaway-grid">
    <article><h4>我的优势</h4><div id="strengthList"></div></article>
    <article><h4>注意方向</h4><div id="attentionDirection"></div></article>
  </div>
  <article class="monthly-focus"><span>本月先做这一件事</span><strong id="monthlyFocus"></strong></article>
</section>
```

Add mobile-first styles with one column at 320px and two terminology columns above 28rem. Keep all long text wrapping with `overflow-wrap:anywhere`.

- [ ] **Step 3: 渲染可读画像和低质量横幅**

At the beginning of `renderReport(report, photo)`:

```js
const readable = report.readableProfile;
const terminology = [
  ["脸型倾向", `${readable.faceShape.secondary ? `${readable.faceShape.primary} · 次倾向 ${readable.faceShape.secondary}` : `${readable.faceShape.primary}倾向`}。${readable.faceShape.explanation}`],
  ["三庭", readable.threeCourts.summary],
  ["五眼", readable.fiveEyes.summary],
  ["五官量感", readable.featureWeight.term],
  ["线条倾向", readable.lineTendency.term]
];
$("memorySentence").textContent = readable.memorySentence;
$("terminologyGrid").innerHTML = terminology.map(([label, value]) => `<article class="term-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></article>`).join("");
$("strengthList").innerHTML = readable.strengths.map((item) => `<p>${escapeHtml(item)}</p>`).join("");
$("attentionDirection").innerHTML = readable.attention.map((item) => `<p>${escapeHtml(item)}</p>`).join("");
$("monthlyFocus").textContent = report.actionPlan[1]?.text || report.actionPlan[0]?.text || "在相同条件下记录一次造型对照。";
if (report.quality.overridden || report.quality.level === "low") {
  $("qualityBanner").textContent = `参考级照片：${report.quality.issues.map((item) => item.message).join("、")}。部分数据已降低置信度。`;
  $("qualityBanner").classList.remove("hidden");
} else {
  $("qualityBanner").classList.add("hidden");
}
```

- [ ] **Step 4: 调整第二层折叠与清理逻辑**

Wrap the existing detailed data, styling, care, action and evidence sections under a visible heading “完整数据与依据”. Remove `open` from the first `data-details` element so formulas default collapsed. Add the six new IDs to `clearRenderedReport()` and hide `qualityBanner` on reset.

- [ ] **Step 5: 运行结构与静态验证并提交**

Run:

```powershell
node --test tests/face-style-core.test.cjs
node work/verify.cjs index.html
git diff --check
```

Expected: all tests PASS; JavaScript syntax, DOM references and model URL PASS; no whitespace errors.

Commit:

```powershell
git add index.html tests/face-style-core.test.cjs
git commit -m "feat: add readable two-layer report"
```

---

### Task 4: 完整回归与浏览器验收

**Files:**
- Modify: `index.html` only for defects found during acceptance.
- Modify: `tests/face-style-core.test.cjs` only for regressions found during acceptance.

**Interfaces:**
- Final flow: `upload → analysis → quality rejection → retake | reference-only questionnaire → report`。
- Reset: fresh upload state while retaining loaded models.

- [ ] **Step 1: 添加重置和可追溯性断言**

Extend structural tests to assert the production script contains:

```js
assert.match(html, /qualityFailureCount\s*=\s*0/);
assert.match(html, /qualityOverride\s*=\s*false/);
```

Add a core test:

```js
test("readable report remains traceable after quality override", () => {
  const core = loadCore();
  const quality = core.overridePhotoQuality(core.evaluatePhotoQuality({ ...goodSignals(), points: rotate(makeFrontLandmarks(), 8) }));
  const measurements = core.computeMeasurements(makeFrontLandmarks(), "low", "medium");
  const profile = core.inferQuestionnaire({ postCleanse:"tzone", reactivity:"rarely", primaryGoal:"overall", dailyMinutes:5, hairMaintenance:"minimal", monthlyBudget:"basic" });
  const report = core.composeReport({ quality, measurements, profile });
  assert.equal(report.quality.overridden, true);
  assert.ok(report.readableProfile.faceShape.metricIds.length >= 3);
  assert.ok(report.readableProfile.memorySentence);
});
```

- [ ] **Step 2: 运行完整自动验证**

Run:

```powershell
node --test tests/face-style-core.test.cjs
node work/verify.cjs index.html
git diff --check
```

Expected: 0 failures; syntax, all DOM references and corrected model URL PASS.

- [ ] **Step 3: 浏览器验收**

Serve the page locally and verify:

1. Model reaches `2 / 2`.
2. A quality-rejected single-face photo shows both “重新选择照片” and “仍用这张照片分析”.
3. Continuing enters the six-question flow without another upload.
4. Report shows a persistent “参考级照片” banner.
5. First report screen states face-shape tendency, three courts, five eyes, strengths, attention and one monthly action without opening details.
6. Complete data and evidence remain available below and default collapsed.
7. Retry clears answers, quality failure count, override flag and rendered report.
8. 320px width has no horizontal scroll; keyboard reaches both quality actions and all question controls.

- [ ] **Step 4: 最终验证和提交**

After any browser fixes, rerun Step 2 exactly. Commit only if acceptance produced changes:

```powershell
git add index.html tests/face-style-core.test.cjs
git commit -m "fix: complete readable report acceptance"
```

---

## Final Verification Checklist

- [ ] 单人质量不合格照片具有继续分析出口。
- [ ] 无人脸、多人脸和图片解码失败仍然硬性阻断。
- [ ] 越过质量后报告持续显示参考级说明并降低置信度。
- [ ] 第一层可以回答脸型倾向、三庭五眼、优势和注意方向。
- [ ] 第二层保留全部数字、公式、来源、护理与行动卡。
- [ ] 生产文案不存在评分和缺陷化表达。
- [ ] 重置不保留照片、问卷、失败次数或越过状态。
- [ ] 自动测试、静态验证、320px 和键盘验收全部通过。
