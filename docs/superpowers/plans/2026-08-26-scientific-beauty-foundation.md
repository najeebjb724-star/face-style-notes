# 科学变美基础版 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把现有单文件“看脸找风格”网页升级为包含照片质量门槛、六问自评、可解释面部数据、内置依据、基础护肤路线和 30 天行动卡的科学变美入门工具。

**Architecture:** 生产交付仍只有 `index.html`。页面内增加一个纯函数核心脚本 `#face-style-core`，负责质量、测量、问卷和报告组合；DOM 脚本只负责模型、上传、状态切换与渲染。Node 测试从 HTML 中提取核心脚本，在 VM 中执行固定坐标样本，避免浏览器 UI 与公式耦合。

**Tech Stack:** HTML5、内联 CSS、原生 JavaScript、Tailwind CDN、Face-API.js 0.22.2、html2canvas 1.4.1、Node.js 内置 `node:test` 与 `vm`。

## Global Constraints

- 生产交付必须保持单个 `index.html`；测试文件不被网页加载。
- Face-API.js 继续使用 `https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/dist/face-api.min.js`。
- 模型继续使用已验证的 `https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@0.22.2/weights`。
- 照片、关键点和问卷只保存在浏览器内存，不使用 Cookie、localStorage、IndexedDB 或远程日志。
- 不生成美貌分、健康诊断、年龄/性格/族群推断或普适理想比例。
- 每条报告结论必须标记为“几何测量”“造型经验”或“通用护理”。
- 三庭五眼只称为视觉参照；产品阈值明确称为启发式解释带。
- 护肤只覆盖温和清洁、保湿、广谱 SPF 30+ 防晒和敏感倾向的停用/就医边界。
- 移动端优先，支持 320px 宽度、键盘焦点、`aria-live` 和 `prefers-reduced-motion`。

---

## File Map

- Modify: `index.html` — 唯一生产网页，包含界面、纯函数核心、模型与 DOM 集成。
- Create: `tests/fixtures/landmarks.cjs` — 可预测的 68 点正面脸、歪头和偏转输入。
- Create: `tests/face-style-core.test.cjs` — 使用 Node 内置测试运行器验证核心接口。
- Modify: `docs/superpowers/specs/2026-08-26-scientific-beauty-foundation-design.md` — 实现后只更新实际实现差异，不改变已批准范围。

---

### Task 1: 建立可测试的纯函数核心

**Files:**
- Modify: `index.html`，在当前应用脚本之前增加 `<script id="face-style-core">`。
- Create: `tests/fixtures/landmarks.cjs`。
- Create: `tests/face-style-core.test.cjs`。

**Interfaces:**
- Produces: `window.FaceStyleCore`。
- Produces: `distance(a,b): number`、`safeDivide(numerator,denominator,fallback): number|null`、`averagePoint(points,indexes): Point`、`angleDegrees(a,b): number`、`round(value,digits): number|null`。
- Consumes: 形如 `{x:number,y:number}` 的点对象。

- [ ] **Step 1: 创建固定关键点样本**

Create `tests/fixtures/landmarks.cjs` with this complete fixture builder:

```js
function makeFrontLandmarks() {
  const points = Array.from({ length: 68 }, () => ({ x: 100, y: 100 }));
  const set = (index, x, y) => { points[index] = { x, y }; };
  const values = {
    0:[20,100], 2:[28,120], 4:[42,142], 6:[68,158], 8:[100,170],
    10:[132,158], 12:[158,142], 14:[172,120], 16:[180,100],
    17:[48,72], 18:[60,68], 19:[72,67], 20:[84,69], 21:[94,72],
    22:[106,72], 23:[116,69], 24:[128,67], 25:[140,68], 26:[152,72],
    27:[100,78], 30:[100,112], 31:[86,118], 33:[100,122], 35:[114,118],
    36:[52,92], 37:[60,87], 38:[72,87], 39:[80,92], 40:[72,97], 41:[60,97],
    42:[120,92], 43:[128,87], 44:[140,87], 45:[148,92], 46:[140,97], 47:[128,97],
    48:[72,138], 51:[100,132], 54:[128,138], 57:[100,150],
    62:[100,137], 66:[100,144]
  };
  Object.entries(values).forEach(([index, value]) => set(Number(index), value[0], value[1]));
  return points;
}

function rotate(points, degrees, center = { x: 100, y: 110 }) {
  const radians = degrees * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return points.map((point) => ({
    x: center.x + (point.x - center.x) * cos - (point.y - center.y) * sin,
    y: center.y + (point.x - center.x) * sin + (point.y - center.y) * cos
  }));
}

module.exports = { makeFrontLandmarks, rotate };
```

- [ ] **Step 2: 编写核心加载与基础公式的失败测试**

Create the beginning of `tests/face-style-core.test.cjs`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

function loadCore() {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const match = html.match(/<script id="face-style-core">([\s\S]*?)<\/script>/);
  assert.ok(match, "index.html must contain #face-style-core");
  const context = { window: {}, console };
  vm.createContext(context);
  vm.runInContext(match[1], context, { filename: "face-style-core.js" });
  return context.window.FaceStyleCore;
}

test("safeDivide rejects invalid denominators", () => {
  const core = loadCore();
  assert.equal(core.safeDivide(4, 2), 2);
  assert.equal(core.safeDivide(4, 0), null);
  assert.equal(core.safeDivide(Infinity, 2), null);
});

test("angleDegrees returns a signed screen-space angle", () => {
  const core = loadCore();
  assert.equal(core.round(core.angleDegrees({x:0,y:0},{x:10,y:0}), 2), 0);
  assert.equal(core.round(core.angleDegrees({x:0,y:0},{x:10,y:10}), 2), 45);
});
```

- [ ] **Step 3: 运行测试确认失败**

Run:

```powershell
node --test tests/face-style-core.test.cjs
```

Expected: FAIL with `index.html must contain #face-style-core`.

- [ ] **Step 4: 添加纯函数核心并让测试通过**

Add before the current app script in `index.html`:

```html
<script id="face-style-core">
(() => {
  "use strict";
  const distance = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
  const safeDivide = (numerator, denominator, fallback = null) =>
    Number.isFinite(numerator) && Number.isFinite(denominator) && Math.abs(denominator) > 1e-9
      ? numerator / denominator
      : fallback;
  const averagePoint = (points, indexes) => ({
    x: indexes.reduce((sum, index) => sum + points[index].x, 0) / indexes.length,
    y: indexes.reduce((sum, index) => sum + points[index].y, 0) / indexes.length
  });
  const angleDegrees = (a, b) => Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
  const round = (value, digits = 2) => Number.isFinite(value)
    ? Number(value.toFixed(digits))
    : null;
  window.FaceStyleCore = { distance, safeDivide, averagePoint, angleDegrees, round };
})();
</script>
```

- [ ] **Step 5: 运行测试并提交**

Run: `node --test tests/face-style-core.test.cjs`  
Expected: 2 tests PASS, 0 FAIL.

Commit:

```powershell
git add index.html tests/fixtures/landmarks.cjs tests/face-style-core.test.cjs
git commit -m "test: add face analysis core harness"
```

---

### Task 2: 照片质量门槛与重拍反馈

**Files:**
- Modify: `index.html` quality UI, image preprocessing and core script.
- Modify: `tests/face-style-core.test.cjs`.

**Interfaces:**
- Consumes: `PhotoSignals` with `detectionScore`, `faceBox`, `imageSize`, `points`, `laplacianVariance`, `meanBrightness`.
- Produces: `evaluatePhotoQuality(signals): {accepted:boolean,level:"high"|"medium"|"low",issues:QualityIssue[],metrics:object}`.
- Produces: `QualityIssue` with `id`, `message`, `action`, `severity`.

- [ ] **Step 1: 添加质量规则的失败测试**

Append to `tests/face-style-core.test.cjs`:

```js
const { makeFrontLandmarks, rotate } = require("./fixtures/landmarks.cjs");

function goodSignals(points = makeFrontLandmarks()) {
  return {
    detectionScore: 0.92,
    faceBox: { width: 320, height: 390 },
    imageSize: { width: 800, height: 1000 },
    points,
    laplacianVariance: 120,
    meanBrightness: 130
  };
}

test("quality gate accepts a clear frontal photo", () => {
  const result = loadCore().evaluatePhotoQuality(goodSignals());
  assert.equal(result.accepted, true);
  assert.equal(result.level, "high");
  assert.deepEqual(result.issues, []);
});

test("quality gate rejects excessive roll with one primary action", () => {
  const result = loadCore().evaluatePhotoQuality(goodSignals(rotate(makeFrontLandmarks(), 8)));
  assert.equal(result.accepted, false);
  assert.equal(result.issues[0].id, "head_roll");
  assert.match(result.issues[0].action, /保持水平/);
});

test("quality gate rejects small, dark and blurry photos deterministically", () => {
  const result = loadCore().evaluatePhotoQuality({
    ...goodSignals(),
    faceBox: { width: 140, height: 170 },
    laplacianVariance: 20,
    meanBrightness: 40
  });
  assert.equal(result.accepted, false);
  assert.deepEqual(result.issues.map((item) => item.id), ["face_too_small", "blurry", "too_dark"]);
});
```

- [ ] **Step 2: 运行测试确认缺少接口**

Run: `node --test tests/face-style-core.test.cjs`  
Expected: FAIL with `evaluatePhotoQuality is not a function`.

- [ ] **Step 3: 实现质量核心**

Add to `#face-style-core` and export:

```js
function evaluatePhotoQuality(signals) {
  const { detectionScore, faceBox, imageSize, points, laplacianVariance, meanBrightness } = signals;
  const leftEye = averagePoint(points, [36,37,38,39,40,41]);
  const rightEye = averagePoint(points, [42,43,44,45,46,47]);
  const roll = Math.abs(angleDegrees(leftEye, rightEye));
  const faceRatio = safeDivide(faceBox.width, imageSize.width, 0);
  const faceWidth = distance(points[0], points[16]);
  const leftNose = distance(points[30], points[0]);
  const rightNose = distance(points[30], points[16]);
  const yawProxy = safeDivide(Math.abs(leftNose - rightNose), faceWidth, 1);
  const issues = [];
  const push = (condition, id, message, action, severity = "reject") => {
    if (condition) issues.push({ id, message, action, severity });
  };
  push(detectionScore < 0.55, "low_detection", "面部细节不足", "换一张更清晰、无遮挡的照片");
  push(faceRatio < 0.28 || faceBox.width < 180, "face_too_small", "脸部在画面中太小", "靠近一些，并保留完整头部轮廓");
  push(faceRatio > 0.85, "face_too_large", "脸部离镜头太近", "手机后退到约一臂距离");
  push(roll > 5, "head_roll", "头部倾斜会影响比例", "让双眼连线保持水平");
  push(yawProxy > 0.12, "head_yaw", "脸部没有正对镜头", "鼻尖朝向镜头，左右脸颊露出接近");
  push(laplacianVariance < 45, "blurry", "照片可能模糊", "擦净镜头并保持手机稳定");
  push(meanBrightness < 55, "too_dark", "面部光线太暗", "面向窗户或增加均匀光线");
  push(meanBrightness > 215, "too_bright", "面部出现过曝", "避开直射强光并降低曝光");
  const medium = roll > 3 || yawProxy > 0.08;
  return {
    accepted: !issues.some((item) => item.severity === "reject"),
    level: issues.length ? "low" : medium ? "medium" : "high",
    issues,
    metrics: { roll: round(roll,1), yawProxy: round(yawProxy,3), faceRatio: round(faceRatio,3), laplacianVariance: round(laplacianVariance,1), meanBrightness: round(meanBrightness,1) }
  };
}
```

- [ ] **Step 4: 集成像素质量采样与质量界面**

In `index.html`, add `computeImageSignals(image, detection)` which draws the detected face crop into a 256×256 grayscale canvas, calculates mean brightness and a 4-neighbor Laplacian variance, then calls `FaceStyleCore.evaluatePhotoQuality`. Add a quality status card containing `#qualityLevel`, `#qualityMetrics`, `#qualityIssue`, and `#retakeButton`. On rejection, return to upload without calling measurement code. Show only `issues[0]` as the primary retake action, with other issue labels in a collapsed detail.

- [ ] **Step 5: 运行测试并提交**

Run: `node --test tests/face-style-core.test.cjs`  
Expected: 5 tests PASS, 0 FAIL.

Commit:

```powershell
git add index.html tests/face-style-core.test.cjs
git commit -m "feat: add photo quality gate"
```

---

### Task 3: 六问自评与约束画像

**Files:**
- Modify: `index.html` questionnaire view, state and core.
- Modify: `tests/face-style-core.test.cjs`.

**Interfaces:**
- Consumes: `QuestionnaireAnswers` with `postCleanse`, `reactivity`, `primaryGoal`, `dailyMinutes`, `hairMaintenance`, `monthlyBudget`.
- Produces: `inferQuestionnaire(answers): {complete,skinTendency,sensitivityTendency,primaryGoal,dailyMinutes,hairMaintenance,monthlyBudget}`.

- [ ] **Step 1: 添加问卷推导失败测试**

Append:

```js
test("questionnaire keeps skin and sensitivity as separate tendencies", () => {
  const profile = loadCore().inferQuestionnaire({
    postCleanse: "tight",
    reactivity: "often",
    primaryGoal: "skin",
    dailyMinutes: 5,
    hairMaintenance: "minimal",
    monthlyBudget: "basic"
  });
  assert.equal(profile.complete, true);
  assert.equal(profile.skinTendency, "dry");
  assert.equal(profile.sensitivityTendency, "sensitive");
});

test("incomplete questionnaire disables care plan", () => {
  const profile = loadCore().inferQuestionnaire({ postCleanse: "tzone" });
  assert.equal(profile.complete, false);
  assert.equal(profile.skinTendency, "combination");
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/face-style-core.test.cjs`  
Expected: FAIL with `inferQuestionnaire is not a function`.

- [ ] **Step 3: 实现问卷推导**

Add and export:

```js
function inferQuestionnaire(answers = {}) {
  const skinMap = { tight:"dry", comfortable:"normal", tzone:"combination", allOver:"oily" };
  const required = ["postCleanse","reactivity","primaryGoal","dailyMinutes","hairMaintenance","monthlyBudget"];
  return {
    complete: required.every((key) => answers[key] !== undefined && answers[key] !== ""),
    skinTendency: skinMap[answers.postCleanse] || null,
    sensitivityTendency: answers.reactivity === "often" ? "sensitive" : answers.reactivity === "sometimes" ? "possible" : answers.reactivity === "rarely" ? "low" : null,
    primaryGoal: answers.primaryGoal || null,
    dailyMinutes: Number(answers.dailyMinutes) || null,
    hairMaintenance: answers.hairMaintenance || null,
    monthlyBudget: answers.monthlyBudget || null
  };
}
```

- [ ] **Step 4: 实现六问移动端界面**

Add `#questionnaireView` between analysis and report. Render one fieldset per question, progress `第 N / 6 题`, previous/next buttons, visible selected state, and a final “生成我的基础报告” button. Store answers only in `state.questionnaire`. Back navigation retains answers; `resetApp()` replaces it with `{}`. Use native radio inputs so keyboard and screen readers work without custom ARIA roles.

- [ ] **Step 5: 运行测试并提交**

Run: `node --test tests/face-style-core.test.cjs`  
Expected: 7 tests PASS, 0 FAIL.

Commit:

```powershell
git add index.html tests/face-style-core.test.cjs
git commit -m "feat: add beginner beauty questionnaire"
```

---

### Task 4: 扩展测量引擎与内置知识表

**Files:**
- Modify: `index.html` core measurement and knowledge constants.
- Modify: `tests/face-style-core.test.cjs`.

**Interfaces:**
- Consumes: `Point[68]` and `quality.level`.
- Produces: `computeMeasurements(points, qualityLevel): MeasurementResult`.
- Produces: `KNOWLEDGE_BASE.metrics`, `.styleRules`, `.careRules`, `.sources`.
- `Measurement` shape: `{id,value,unit,label,band,evidenceType,confidence,formulaText,referenceType,sourceIds}`.

- [ ] **Step 1: 添加测量失败测试**

Append:

```js
test("measurement engine returns finite normalized metrics", () => {
  const result = loadCore().computeMeasurements(makeFrontLandmarks(), "high");
  assert.equal(result.faceWidth, 160);
  assert.equal(result.eyeSpacing.value, 1.43);
  assert.equal(result.eyeSpacing.band, "spacious");
  assert.equal(result.noseFaceWidth.value, 0.18);
  assert.equal(result.mouthFaceWidth.value, 0.35);
  assert.equal(result.courts.reduce((sum, item) => sum + item.value, 0), 100);
  Object.values(result).flatMap((value) => Array.isArray(value) ? value : [value]).forEach((value) => {
    if (value && typeof value === "object" && "value" in value) assert.ok(Number.isFinite(value.value));
  });
});

test("asymmetry confidence is reduced for medium quality", () => {
  const result = loadCore().computeMeasurements(makeFrontLandmarks(), "medium");
  assert.equal(result.symmetry.confidence, "low");
  assert.match(result.symmetry.note, /拍摄角度/);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/face-style-core.test.cjs`  
Expected: FAIL with `computeMeasurements is not a function`.

- [ ] **Step 3: 实现完整测量结果**

Implement `computeMeasurements` using the exact formulas in the approved spec:

```js
const metric = (id, value, unit, extra = {}) => ({ id, value: round(value, extra.digits ?? 2), unit, evidenceType:"geometry", confidence:extra.confidence || "high", ...extra });

function computeMeasurements(points, qualityLevel = "high") {
  const faceWidth = distance(points[0], points[16]);
  const visibleLength = Math.abs(points[8].y - points[27].y);
  const estimatedFaceLength = visibleLength * 1.8;
  const leftEyeWidth = distance(points[36], points[39]);
  const rightEyeWidth = distance(points[42], points[45]);
  const averageEyeWidth = (leftEyeWidth + rightEyeWidth) / 2;
  const innerEyeDistance = distance(points[39], points[42]);
  const noseWidth = distance(points[31], points[35]);
  const mouthWidth = distance(points[48], points[54]);
  const hairlineY = points[27].y - (points[33].y - points[27].y) * 1.2;
  const rawCourts = [Math.abs(points[27].y - hairlineY), Math.abs(points[33].y - points[27].y), Math.abs(points[8].y - points[33].y)];
  const courtTotal = rawCourts.reduce((sum, value) => sum + value, 0);
  const roundedCourts = rawCourts.map((value) => round(safeDivide(value * 100, courtTotal, 0), 0));
  roundedCourts[2] += 100 - roundedCourts.reduce((sum, value) => sum + value, 0);
  const eyeSpacingValue = safeDivide(innerEyeDistance, averageEyeWidth, 0);
  return {
    faceWidth: round(faceWidth, 2),
    faceLengthWidth: metric("face_length_width", safeDivide(estimatedFaceLength, faceWidth, 0), "ratio", { label:"估算脸长宽比", referenceType:"product_heuristic" }),
    cheekFaceWidth: metric("cheek_face_width", safeDivide(distance(points[2], points[14]), faceWidth, 0), "ratio"),
    jawFaceWidth: metric("jaw_face_width", safeDivide(distance(points[4], points[12]), faceWidth, 0), "ratio"),
    chinFaceWidth: metric("chin_face_width", safeDivide(distance(points[6], points[10]), faceWidth, 0), "ratio"),
    eyeSpacing: metric("eye_spacing", eyeSpacingValue, "eye_width", { band:eyeSpacingValue < .85 ? "concentrated" : eyeSpacingValue <= 1.15 ? "reference" : "spacious", referenceType:"classical_canon" }),
    noseFaceWidth: metric("nose_face_width", safeDivide(noseWidth, faceWidth, 0), "ratio"),
    mouthFaceWidth: metric("mouth_face_width", safeDivide(mouthWidth, faceWidth, 0), "ratio"),
    lipRatio: metric("upper_lower_lip", safeDivide(distance(points[51], points[62]), distance(points[66], points[57]), 0), "ratio"),
    courts: ["upper","middle","lower"].map((id,index) => metric(`court_${id}`, roundedCourts[index], "%", { confidence:index === 0 ? "low" : qualityLevel, referenceType:"classical_canon" })),
    symmetry: computeRegionalSymmetry(points, faceWidth, qualityLevel)
  };
}
```

Also implement and include in the returned object: left/right eye aspect ratios, canthal tilt, brow tilt, brow-eye distance, eye size difference, nose/eye-spacing ratio, upper/lower lip proxies, mouth tilt, jaw curve and the four visual-weight submetrics. `computeRegionalSymmetry` reflects paired landmarks across the midline through `p27` and `p8`, averages normalized residuals for eye, brow, mouth and jaw regions, and sets confidence to `low` unless `qualityLevel === "high"`.

- [ ] **Step 4: 添加完整知识表**

Add an immutable `KNOWLEDGE_BASE` containing:

```js
const KNOWLEDGE_BASE = Object.freeze({
  sources: {
    interEthnicReview:{ title:"跨族群面部尺寸系统综述", url:"https://pmc.ncbi.nlm.nih.gov/articles/PMC3074358/", type:"research" },
    southernChineseCanons:{ title:"华南成人新古典面部比例研究", url:"https://pmc.ncbi.nlm.nih.gov/articles/PMC3532441/", type:"research" },
    photoStandard:{ title:"标准化面部摄影指南", url:"https://www.imi.org.uk/wp-content/uploads/2022/03/NG_Dental_Photo_2_0_S.pdf", type:"guideline" },
    aadBasics:{ title:"美国皮肤科学会基础护肤建议", url:"https://www.aad.org/public/everyday-care/skin-care-basics/care/skin-care-budget", type:"guideline" },
    faceApi:{ title:"Face-API.js 68 点说明", url:"https://github.com/justadudewhohacks/face-api.js/", type:"implementation" }
  },
  metrics: {
    eye_spacing:{ formulaText:"内眼角距离 ÷ 平均眼宽", evidenceType:"geometry", referenceType:"古典五眼视觉参照", sourceIds:["southernChineseCanons"] },
    court_upper:{ formulaText:"估算发际线至鼻根 ÷ 三庭总长", evidenceType:"geometry", referenceType:"低可信度估算", sourceIds:["interEthnicReview","southernChineseCanons"] },
    court_middle:{ formulaText:"鼻根至鼻底 ÷ 三庭总长", evidenceType:"geometry", referenceType:"古典三庭视觉参照", sourceIds:["interEthnicReview","southernChineseCanons"] },
    court_lower:{ formulaText:"鼻底至下巴 ÷ 三庭总长", evidenceType:"geometry", referenceType:"古典三庭视觉参照", sourceIds:["interEthnicReview","southernChineseCanons"] }
  },
  styleRules: {
    eye_concentrated:{ evidenceType:"styling", advice:"眉头减淡，眼尾可适度向外延伸 2–3 毫米", avoid:"不要同时加重眉头与眼头" },
    eye_spacious:{ evidenceType:"styling", advice:"眉头可自然前移，眼头增加少量亮度和线条", avoid:"避免继续拉长外眼线" },
    middle_long:{ evidenceType:"styling", advice:"腮红横向轻扫，卧蚕适度提亮，眉毛避免过度高挑", avoid:"避免把鼻影拉得过长" }
  },
  careRules: {
    base:{ evidenceType:"care", morning:["按出油感受选择清水或温和清洁","保湿","广谱 SPF 30+ 防晒"], evening:["温和清洁","保湿"], sourceIds:["aadBasics"] },
    sensitive:{ evidenceType:"care", advice:"一次只新增一种产品，先做小范围试用；持续刺痛、红肿或皮疹时停止并咨询皮肤科医生", sourceIds:["aadBasics"] }
  }
});
```

Expand `metrics` for every rendered measurement and `styleRules` for face proportion, eye tilt, brow direction, nose contour range, lip emphasis, jaw framing and feature weight. Every rule must include `evidenceType`, advice, and either `avoid` or a limitation note.

- [ ] **Step 5: 运行测试并提交**

Run: `node --test tests/face-style-core.test.cjs`  
Expected: 9 tests PASS, 0 FAIL.

Commit:

```powershell
git add index.html tests/face-style-core.test.cjs
git commit -m "feat: add explainable facial measurements"
```

---

### Task 5: 报告组合、护肤路线与 30 天行动卡

**Files:**
- Modify: `index.html` core composer and report markup/styles.
- Modify: `tests/face-style-core.test.cjs`.

**Interfaces:**
- Consumes: `{quality, measurements, profile, knowledgeBase}`.
- Produces: `composeReport(input): {coreTraits,dataGroups,styleAdvice,carePlan,actionPlan,sources,limitations}`.
- Produces: every conclusion as `{title,value,explanation,action,evidenceType,metricIds,confidence}`.

- [ ] **Step 1: 添加报告组合失败测试**

Append:

```js
test("report conclusions are traceable and action plan has three items", () => {
  const core = loadCore();
  const quality = { accepted:true, level:"high", issues:[], metrics:{} };
  const measurements = core.computeMeasurements(makeFrontLandmarks(), "high");
  const profile = core.inferQuestionnaire({ postCleanse:"tzone", reactivity:"rarely", primaryGoal:"makeup", dailyMinutes:15, hairMaintenance:"light", monthlyBudget:"moderate" });
  const report = core.composeReport({ quality, measurements, profile });
  assert.equal(report.actionPlan.length, 3);
  assert.ok(report.coreTraits.every((item) => item.evidenceType && item.metricIds.length));
  assert.ok(report.sources.some((source) => source.id === "southernChineseCanons"));
});

test("incomplete profile omits care and complete action plan", () => {
  const core = loadCore();
  const report = core.composeReport({ quality:{accepted:true,level:"high"}, measurements:core.computeMeasurements(makeFrontLandmarks(), "high"), profile:core.inferQuestionnaire({postCleanse:"tight"}) });
  assert.equal(report.carePlan, null);
  assert.equal(report.actionPlan.length, 1);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/face-style-core.test.cjs`  
Expected: FAIL with `composeReport is not a function`.

- [ ] **Step 3: 实现可追溯报告组合**

Implement `composeReport` so that:

```js
function conclusion({ title, value, explanation, action, evidenceType, metricIds = [], confidence = "high" }) {
  if (!evidenceType || (evidenceType !== "care" && metricIds.length === 0)) throw new Error("Untraceable conclusion");
  return { title, value, explanation, action, evidenceType, metricIds, confidence };
}
```

- Core traits select at most three high-information measurements, prioritizing the questionnaire goal.
- Styling advice is selected by rule IDs and constrained by daily time and hair maintenance.
- Care plan is `null` unless `profile.complete`.
- Complete action plan has exactly three items: foundation, one styling experiment, and consistent-condition reflection.
- Incomplete profile produces one geometry-only experiment and a prompt to finish the questionnaire.
- Sources are deduplicated from all metric and rule `sourceIds`.
- Limitations always include photo dependence, upper-third estimation and non-medical scope.

- [ ] **Step 4: 重构报告 UI**

Replace the current single-layer report with:

1. `#coreTraits` — three summary cards.
2. `#dataGroups` — native `<details>` groups for overall, eye/brow, nose/lip and jaw.
3. `#styleAdviceGrid` — makeup, hair and outfit cards with “造型经验” badge and linked metric names.
4. `#carePlan` — self-reported tendency, morning/evening basics and sensitivity boundary; hidden when incomplete.
5. `#actionPlan` — three numbered actions.
6. `#evidenceDrawer` — sources and limitations using native `<details>`.

Each data card shows value, formula text, reference type and confidence. Replace “偏长/偏短” alarm styling with neutral “相对长/相对短” language. Preserve keyword copy, PNG export and retry buttons.

- [ ] **Step 5: 运行测试并提交**

Run: `node --test tests/face-style-core.test.cjs`  
Expected: 11 tests PASS, 0 FAIL.

Commit:

```powershell
git add index.html tests/face-style-core.test.cjs
git commit -m "feat: add scientific beauty foundation report"
```

---

### Task 6: 集成恢复、可访问性与发布验证

**Files:**
- Modify: `index.html` state flow, reset, export and accessibility.
- Modify: `tests/face-style-core.test.cjs` structural tests.
- Modify: `docs/superpowers/specs/2026-08-26-scientific-beauty-foundation-design.md` only if implementation differs, with a dated “实现说明” section.

**Interfaces:**
- Final state flow: `loading → upload → analysis → questionnaire → report`.
- Recovery flow: any rejected photo → `upload`; model retry → `loading`; reset → fresh `upload` with models retained.

- [ ] **Step 1: 添加结构与禁用词测试**

Append:

```js
test("page contains required accessible views and no prohibited claims", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  ["uploadView","analysisView","questionnaireView","reportView","qualityLevel","coreTraits","dataGroups","carePlan","actionPlan","evidenceDrawer"].forEach((id) => {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  });
  ["美貌分","颜值评分","健康诊断","性格推断","完美比例"].forEach((phrase) => assert.equal(html.includes(phrase), false));
  assert.match(html, /aria-live=/);
  assert.match(html, /prefers-reduced-motion/);
});
```

- [ ] **Step 2: 完成状态与恢复集成**

Update `showView` to accept `loading`, `upload`, `analysis`, `questionnaire`, and `report`. Ensure:

```js
function resetApp() {
  state.photo = "";
  state.detection = null;
  state.quality = null;
  state.measurements = null;
  state.questionnaire = {};
  state.profile = null;
  state.report = null;
  $("fileInput").value = "";
  clearRenderedReport();
  showView("upload");
}
```

Do not clear loaded models on reset. Model retry unhides progress and clears stale error copy. Export catches html2canvas errors and keeps the report visible. All dynamic status text uses an `aria-live` container.

- [ ] **Step 3: 运行完整自动验证**

Run:

```powershell
node --test tests/face-style-core.test.cjs
node work/verify.cjs index.html
```

Expected:

- All Node tests PASS, 0 FAIL.
- Inline JavaScript syntax PASS.
- All `$()` DOM references resolve.
- Correct Face-API model URL present and broken npm weights URL absent.

- [ ] **Step 4: 手动浏览器验收**

Open `index.html` in the in-app browser and verify:

1. Model reaches `2 / 2`.
2. Uploading a valid single-face photo reaches the six-question flow.
3. Previous/next retains selections.
4. Report expands data formulas and source links.
5. Copy keyword and save PNG work.
6. Retry clears photo and answers.
7. At 320px width there is no horizontal scroll.
8. Keyboard Tab reaches every control with visible focus.

Expected: all eight checks succeed; any failure is fixed and the complete automated + manual set is rerun.

- [ ] **Step 5: 提交并同步远程**

Commit:

```powershell
git add index.html tests/face-style-core.test.cjs tests/fixtures/landmarks.cjs docs/superpowers/specs/2026-08-26-scientific-beauty-foundation-design.md
git commit -m "feat: complete scientific beauty foundation upgrade"
```

Attempt `git push origin main`. If the Git data channel remains unavailable, update the same GitHub repository through the authenticated GitHub API and verify every remote blob SHA equals `git hash-object` for the local file, as done for the initial publication.

---

## Final Verification Checklist

- [ ] `node --test tests/face-style-core.test.cjs` reports 0 failures.
- [ ] Existing static verifier reports valid JavaScript and no missing DOM IDs.
- [ ] All approved spec sections map to Tasks 2–6.
- [ ] No placeholder or prohibited claim exists in production copy.
- [ ] Valid photo flow works through questionnaire to report.
- [ ] Invalid photo produces one clear retake action.
- [ ] Every displayed conclusion has evidence type, confidence and traceable metric or care source.
- [ ] Refresh and reset leave no user photo or questionnaire data.
- [ ] Remote repository content hashes match local committed files.
