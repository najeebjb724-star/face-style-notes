const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const { makeFrontLandmarks, rotate, scaleVertical } = require("./fixtures/landmarks.cjs");

function loadCore() {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const match = html.match(/<script id="face-style-core">([\s\S]*?)<\/script>/);
  assert.ok(match, "index.html must contain #face-style-core");
  const context = { window: {}, console, URL };
  vm.createContext(context);
  vm.runInContext(match[1], context, { filename: "face-style-core.js" });
  return context.window.FaceStyleCore;
}

function unfoldIcs(value) {
  return value.replace(/\r\n[ \t]/g, "");
}

test("safeDivide rejects invalid denominators", () => {
  const core = loadCore();
  assert.equal(core.safeDivide(4, 2), 2);
  assert.equal(core.safeDivide(4, 0), null);
  assert.equal(core.safeDivide(Infinity, 2), null);
});

test("angleDegrees returns a signed screen-space angle", () => {
  const core = loadCore();
  assert.equal(core.round(core.angleDegrees({ x: 0, y: 0 }, { x: 10, y: 0 }), 2), 0);
  assert.equal(core.round(core.angleDegrees({ x: 0, y: 0 }, { x: 10, y: 10 }), 2), 45);
});

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
  assert.equal(result.issues.length, 0);
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
  assert.deepEqual(Array.from(result.issues, (item) => item.id), ["face_too_small", "blurry", "too_dark"]);
});

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

test("report conclusions are traceable and complete profile gets three action cards", () => {
  const core = loadCore();
  const quality = { accepted: true, level: "high", issues: [], metrics: {} };
  const measurements = core.computeMeasurements(makeFrontLandmarks(), "high");
  const profile = core.inferQuestionnaire({ postCleanse: "tzone", reactivity: "rarely", primaryGoal: "makeup", dailyMinutes: 15, hairMaintenance: "light", monthlyBudget: "moderate" });
  const report = core.composeReport({ quality, measurements, profile });
  assert.equal(report.actionCards.length, 3);
  assert.equal(new Set(report.actionCards.map((item) => item.id)).size, 3);
  report.actionCards.forEach((item) => {
    ["title", "reason", "action", "duration", "cost", "successSignal", "stopRule", "searchKeyword"].forEach((key) => assert.ok(item[key], `${item.id}.${key} must be present`));
  });
  assert.ok(report.coreTraits.every((item) => item.evidenceType && item.metricIds.length));
  assert.ok(report.sources.some((source) => source.id === "southernChineseCanons"));
});

test("incomplete profile omits care and keeps one safe action card", () => {
  const core = loadCore();
  const report = core.composeReport({ quality: { accepted: true, level: "high" }, measurements: core.computeMeasurements(makeFrontLandmarks(), "high"), profile: core.inferQuestionnaire({ postCleanse: "tight" }) });
  assert.equal(report.carePlan, null);
  assert.equal(report.actionCards.length, 1);
  assert.equal(report.actionCards[0].id, "geometry-compare");
});

test("page contains required accessible views and no prohibited claims", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  ["uploadView", "analysisView", "questionnaireView", "reportView", "qualityLevel", "coreTraits", "dataGroups", "carePlan", "reportChallengeCards", "reportActiveChallenge", "evidenceDrawer"].forEach((id) => {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  });
  ["qualityBanner", "memorySentence", "terminologyGrid", "strengthList", "attentionDirection", "monthlyFocus"].forEach((id) => {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  });
  ["美貌分", "颜值评分", "健康诊断", "性格推断", "完美比例"].forEach((phrase) => assert.equal(html.includes(phrase), false));
  ["缺点", "修正", "遮丑"].forEach((phrase) => assert.equal(html.includes(phrase), false));
  assert.match(html, /aria-live=/);
  assert.match(html, /prefers-reduced-motion/);
  assert.match(html, /qualityFailureCount\s*=\s*0/);
  assert.match(html, /qualityOverride\s*=\s*false/);
  assert.doesNotMatch(html, /faceStyleActionStateV1/);
  assert.doesNotMatch(html, /id=["']actionSetup["']/);
  assert.doesNotMatch(html, /id=["']reportChallengeButton["']/);
  assert.match(html, /renderReportChallengeRecommendations/);
  assert.match(html, /openReportChallengeSetup/);
});

test("analysis uses warm identity-card generation copy", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  ["正在读取你的面部轮廓", "正在整理你的比例特征", "正在制作专属美学身份卡"]
    .forEach((copy) => assert.match(html, new RegExp(copy)));
  ["正在计算三庭五眼", "正在生成风格报告", "AI分析中", "扫描中"]
    .forEach((copy) => assert.equal(html.includes(copy), false));
  assert.match(html, /analysis-contour-orbit/);
});

test("identity redesign uses the approved warm token system", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const approved = ["#F7F3EE", "#FFFDF9", "#C9A87C", "#2C2420", "#7A6B5A", "#D4C4B0", "#EDE5D8"];
  approved
    .forEach((color) => assert.match(html.toUpperCase(), new RegExp(color.toUpperCase())));
  ["#fffbf7", "#f4e7da", "#ad6267", "#3e2723", "#7b6762", "#e5989b", "#8b704b", "#9c8b86", "#5d765f", "#6f9b7a", "#9b3e47", "rgba(139,112,75", "rgba(212,163,115", "rgba(229,152,155", "rgba(173,98,103"].forEach((color) => {
    assert.equal(html.toLowerCase().includes(color.toLowerCase()), false, `legacy palette remains: ${color}`);
  });
  assert.match(html, /--font-display:/);
  assert.match(html, /min-height:\s*2\.75rem/);
  assert.match(html, /prefers-reduced-motion/);
  ["#F7F3EE", "#EDE5D8", "#C9A87C", "#2C2420", "#7A6B5A", "#FFFDF9"].forEach((color) => {
    assert.match(html, new RegExp(`(?:context\\.fillStyle\\s*=|backgroundColor\\s*:)\\s*[\"']${color}[\"']`));
  });
});

test("homepage challenge entry reflects the active journal state", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  assert.match(html, /function renderHomeChallengeEntry\(\)/);
  assert.match(html, /class=["']journal-day["']/);
  assert.match(html, /renderHomeChallengeEntry\(\);/);
});

test("page exposes the aesthetic identity card hierarchy", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  [
    "identitySerial", "identityType", "identityTitle", "identityPoem",
    "identityPortrait", "identityPortraitTags", "identityRadar",
    "identityTraitBars", "identityMemories", "identityDirections",
    "identityCollection", "shareIdentityButton"
  ].forEach((id) => assert.match(html, new RegExp(`id=["']${id}["']`)));
  assert.match(html, /id=["']reportView["'][^>]*aria-labelledby=["']reportTitle["']/);
  assert.match(html, /\.identity-share-button\s*\{\s*min-height:\s*2\.75rem;/s);
});

test("identity card copy avoids ranked beauty language", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  ["黄金比例评分", "颜值评分", "完美比例", "稀有度", ">RARE<", ">COMMON<"]
    .forEach((phrase) => assert.equal(html.includes(phrase), false));
  assert.match(html, /越高代表特征越明显，不代表越好/);
});

test("challenge MVP keeps privacy copy and avoids prohibited promises", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  assert.match(html, /照片仅保存在当前浏览器|不会上传/);
  assert.match(html, /删除挑战与照片|删除挑战/);
  ["保证变美", "治疗", "疗效", "颜值提升分", "缺点排行"].forEach((phrase) => assert.equal(html.includes(phrase), false));
});

test("text-only challenge controls retain a 44px touch target", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  assert.match(html, /\.text-btn\s*\{\s*width:\s*100%;\s*min-height:\s*2\.75rem;/s);
});

test("challenge photo controls retain a 44px touch target", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  assert.match(html, /\.photo-capture-controls label\s*\{\s*display:\s*grid;\s*min-height:\s*2\.75rem;/s);
});

test("core exposes only the unified challenge calendar helper", () => {
  const core = loadCore();
  assert.equal(core.buildCalendarText, undefined);
  assert.equal(typeof core.buildChallengeCalendarText, "function");
});

test("challenge templates cover habits and makeup camps", () => {
  const templates = loadCore().getChallengeTemplates();
  assert.ok(templates.some((item) => item.kind === "habit"));
  assert.ok(templates.some((item) => item.kind === "training"));
  assert.ok(templates.some((item) => item.id === "body-lotion-30" && item.durationDays === 30));
  assert.ok(templates.some((item) => item.id === "makeup-3-in-7" && item.durationDays === 7));
  templates.forEach((item) => assert.ok(item.id && item.title && item.taskLabel));
});

test("page exposes a mobile challenge center from home and report", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  ["challengeView", "homeChallengeButton", "reportChallengeCards", "todayChallenge", "challengeProgress", "newChallengeButton", "challengeTemplateSheet"].forEach((id) => {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  });
  ["todayTaskTitle", "openTutorialButton", "copyTutorialButton", "checkInButton", "undoCheckInButton", "addChallengeCalendarButton"].forEach((id) => {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  });
  assert.match(html, /openChallengeCenter/);
  assert.match(html, /aria-modal=["']true["']/);
});

test("challenge center review hides the masthead while its view is active", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  assert.match(html, /\.challenge-mode \.masthead\s*\{\s*display:\s*none;/);
  assert.match(html, /document\.body\.classList\.toggle\(["']challenge-mode["'],\s*name === ["']challenge["']\)/);
});

test("challenge creation provides templates and optional custom fields", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  ["challengeTemplateCards", "customChallengeButton", "customChallengeForm", "customChallengeTitle", "customChallengeDays", "customChallengeFrequency", "challengeReminderTime", "tutorialInputs", "templateTutorialForm", "templateTutorialInputs", "deleteChallengeButton"].forEach((id) => {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  });
  assert.match(html, /faceStyleChallengeStateV2/);
  assert.equal(html.includes("window.prompt"), false);
});

test("training templates collect optional day-mapped tutorial links before creation", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  assert.match(html, /function showTemplateSetup\(template\)/);
  assert.match(html, /template\.tutorialSlots/);
  assert.match(html, /Array\.from\(\{ length: template\.tutorialSlots \}\)/);
  assert.match(html, /function submitTemplateTutorials\(event\)/);
  assert.match(html, /startChallenge\(\{ templateId: state\.pendingTemplateId, reminderTime, tutorials \}\)/);
});

test("every template uses the in-page reminder setup before starting", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  assert.match(html, /id=["']templateReminderTime["'][^>]*type=["']time["'][^>]*required/);
  assert.match(html, /function selectChallengeTemplate\(id\)[\s\S]*?showTemplateSetup\(template\);/);
  assert.doesNotMatch(html, /else startChallenge\(\{ templateId: id \}\)/);
  assert.match(html, /const reminderTime = \$\("templateReminderTime"\)\.value;/);
  assert.match(html, /startChallenge\(\{ templateId: state\.pendingTemplateId, reminderTime, tutorials \}\)/);
  assert.match(html, /确认任务提醒时间后即可开始/);
  assert.doesNotMatch(html, /确认每天的提醒时间后即可开始/);
});

test("calendar return startup opens the challenge center without opening a creation sheet", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  assert.match(html, /new URLSearchParams\(window\.location\.search\)\.get\(["']view["']\) === ["']challenge["']/);
  assert.match(html, /openChallengeCenter\(["']calendar["']\)/);
  assert.doesNotMatch(html, /if \(source === ["']report["']\) openTemplateSheet/);
});

test("daily check-in rerenders restore focus to a visible daily control", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  assert.match(html, /function focusTodayControl\(preferredId = ["']checkInButton["']\)/);
  assert.match(html, /toggleChallengeCheckInFor\(today, ["']undoCheckInButton["']\)/);
  assert.match(html, /toggleChallengeCheckInFor\(today, ["']checkInButton["']\)/);
  assert.match(html, /toggleChallengeCheckInFor\([^,]+, ["']undoCheckInButton["']\)/);
  assert.match(html, /\[preferred, \$\(["']undoCheckInButton["']\), \$\(["']yesterdayCheckInButton["']\), \$\(["']newChallengeButton["']\)\]/);
  assert.match(html, /\.find\(\(item\) => item && !item\.classList\.contains\(["']hidden["']\) && !item\.disabled\)/);
});

test("tutorial actions are omitted outside the active challenge date range", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  assert.match(html, /const tutorial = canCheckInToday \? FaceStyleCore\.getChallengeTutorialForDay\(challenge, challengeDay\) : null;/);
  assert.match(html, /今天是休息日/);
  assert.match(html, /下次任务/);
  assert.match(html, /id=["']yesterdayCheckInButton["']/);
});

test("custom challenge submission validates reminder time and complete tutorial pairs", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  assert.match(html, /const reminderTime = \$\("challengeReminderTime"\)\.value;/);
  assert.match(html, /!validReminderTime/);
  assert.match(html, /教程名称和链接需要同时填写/);
  assert.doesNotMatch(html, /label \|\| "参考教程"/);
});

test("report recommendation cards enter the shared challenge setup directly", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  assert.match(html, /data-report-challenge-id/);
  assert.match(html, /function openReportChallengeSetup\(actionId, trigger\)/);
  assert.match(html, /showTemplateSetup\(template\)/);
  assert.match(html, /showCustomChallengeForm\(prefill\)/);
  assert.match(html, /taskLabel: action\.action/);
  assert.match(html, /data-open-active-challenge/);
  assert.match(html, /function openTemplateSheet\(recommendedTemplateId = "", focusTrigger = document\.activeElement\)/);
});

test("challenge deletion persists a tombstone before cleanup and only clears it after success", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  assert.match(html, /async function deleteActiveChallenge\(\)/);
  assert.match(html, /const challengeId = challenge\.id;/);
  assert.match(html, /await Promise\.resolve\(window\.deleteChallengePhotos\(challengeId\)\)/);
  assert.match(html, /FaceStyleCore\.addPendingPhotoDeletion/);
  assert.match(html, /FaceStyleCore\.removePendingPhotoDeletion/);
  assert.match(html, /state\.challengeState\.active = null;/);
  assert.match(html, /照片清理稍后会自动重试/);
});

test("challenge deletion clears active state before awaiting photo cleanup", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const match = html.match(/async function deleteActiveChallenge\(\) \{([\s\S]*?)\n    function focusTodayControl/);
  assert.ok(match, "deleteActiveChallenge body must be present");
  const body = match[1];
  const challengeId = body.indexOf("const challengeId = challenge.id;");
  const tombstone = body.indexOf("FaceStyleCore.addPendingPhotoDeletion");
  const clearActive = body.indexOf("state.challengeState.active = null;");
  const persistTombstone = body.indexOf("saveChallengeState();", tombstone);
  const persistCleared = body.indexOf("saveChallengeState();", clearActive);
  const render = body.indexOf("renderChallengeCenter();");
  const cleanup = body.indexOf("await Promise.resolve(window.deleteChallengePhotos(challengeId))");
  assert.ok(challengeId >= 0 && tombstone > challengeId);
  assert.ok(persistTombstone > tombstone && clearActive > persistTombstone);
  assert.ok(persistCleared > clearActive && render > persistCleared);
  assert.ok(cleanup > render);
});

test("all aria-modal sheets use centralized focus containment and background isolation", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  assert.match(html, /function openModalSheet\(sheet, trigger, initialFocus, onEscape\)/);
  assert.match(html, /function closeModalSheet\(sheet, returnFocus = true\)/);
  assert.match(html, /function refreshModalIsolation\(\)/);
  assert.match(html, /element\.inert = true/);
  assert.match(html, /event\.key !== "Tab"/);
  assert.match(html, /event\.shiftKey/);
  assert.match(html, /modalStack\[modalStack\.length - 1\]/);
});

test("challenge photos expose start, end, comparison, and deletion controls", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  ["startPhotoInput", "endPhotoInput", "comparisonView", "beforePhoto", "afterPhoto", "deleteChallengeButton"].forEach((id) => {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  });
  assert.match(html, /indexedDB\.open\(["']faceStyleChallengePhotos["']/);
  assert.match(html, /deleteChallengePhotos/);
  ["openChallengePhotoDb", "saveChallengePhoto", "getChallengePhotos", "deleteChallengePhotos", "compressChallengePhoto"].forEach((name) => {
    assert.match(html, new RegExp(`function ${name}`));
  });
  assert.match(html, /createImageBitmap/);
  assert.match(html, /URL\.revokeObjectURL/);
  assert.match(html, /当前浏览器仍可打卡，但不能保存对比照片/);
});

test("completed challenges expose a downloadable, privacy-safe poster", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  ["completionCard", "downloadPosterButton", "posterCanvas"].forEach((id) => {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  });
  assert.match(html, /<div id=["']completionComparisonPreview["'] class=["']completion-comparison["']/);
  assert.match(html, /async function buildChallengePoster\(challenge, progress, photos\)/);
  assert.match(html, /async function downloadChallengePoster\(\)/);
  assert.match(html, /canvas\.width\s*=\s*1080/);
  assert.match(html, /canvas\.height\s*=\s*1440/);
  assert.match(html, /canvas\.toBlob\([\s\S]*?["']image\/png["']/);
  assert.match(html, /我完成了 \$\{progress\.completed\}\/\$\{progress\.total\} 天挑战/);
  assert.match(html, /state\.challengeState\.history\.push\(/);
  assert.match(html, /URL\.revokeObjectURL\(objectUrl\)/);
  assert.match(html, /Promise\.allSettled\(\[loadChallengePosterImage\(start\), loadChallengePosterImage\(end\)\]\)/);
  assert.match(html, /getChallengePhotos\(challenge\.id\)[\s\S]*?catch \(_\) \{\s*photos = \[\];/);
  assert.match(html, /FaceStyleCore\.getChallengePosterFinishDate\(challenge\)/);
  assert.match(html, /FaceStyleCore\.sanitizeChallengePosterFilename\(challenge\.title\)/);
  assert.match(html, /finally \{[\s\S]*?if \(objectUrl\) setTimeout\(\(\) => URL\.revokeObjectURL\(objectUrl\), 0\);/);
  assert.doesNotMatch(html, /poster[^\n]*?(?:肤色|脸型|五官|变白|治疗|疗效)/i);
});

test("challenge photo capture only saves for the still-active challenge", () => {
  const core = loadCore();
  const active = { id: "challenge-1", status: "active" };
  assert.equal(core.maySaveChallengePhoto("challenge-1", active), true);
  assert.equal(core.maySaveChallengePhoto("challenge-2", active), false);
  assert.equal(core.maySaveChallengePhoto("challenge-1", { ...active, status: "completed" }), false);
  assert.equal(core.maySaveChallengePhoto("challenge-1", null), false);
});

test("challenge photo failures distinguish storage from file processing", () => {
  const core = loadCore();
  assert.equal(core.getChallengePhotoFailureScope("storage"), "storage");
  assert.equal(core.getChallengePhotoFailureScope("file"), "file");
  assert.equal(core.getChallengePhotoFailureScope("decode"), "file");
});

test("challenge center review gives the sheet cancellation control a 44px target", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  assert.match(html, /\.bottom-sheet \.text-btn\s*\{\s*min-height:\s*2\.75rem;/);
});

test("challenge template data cannot be mutated through public APIs", () => {
  const core = loadCore();
  core.CHALLENGE_TEMPLATES[0].title = "已篡改";
  core.CHALLENGE_TEMPLATES[0].photoDays[0] = 99;
  const returned = core.getChallengeTemplates();
  returned[0].title = "已篡改";
  returned[0].photoDays[0] = 99;

  const fresh = core.getChallengeTemplates();
  assert.equal(fresh[0].title, "30 天身体乳习惯");
  assert.equal(fresh[0].photoDays[0], 1);
  assert.equal(core.createChallenge({ templateId: "body-lotion-30" }).title, "30 天身体乳习惯");
});

test("tutorial links only accept web URLs", () => {
  const core = loadCore();
  assert.equal(core.validateTutorialUrl("https://www.xiaohongshu.com/explore/1"), "https://www.xiaohongshu.com/explore/1");
  assert.equal(core.validateTutorialUrl("http://example.com/a"), "http://example.com/a");
  assert.equal(core.validateTutorialUrl("javascript:alert(1)"), "");
  assert.equal(core.validateTutorialUrl("not a url"), "");
});

test("createChallenge normalizes a template into one active challenge", () => {
  const challenge = loadCore().createChallenge({
    templateId: "makeup-3-in-7",
    reminderTime: "20:30",
    tutorials: [
      { label: "第一个妆容", url: "https://example.com/look-1" },
      { label: "第二个妆容", url: "https://example.com/look-2" },
      { label: "第三个妆容", url: "https://example.com/look-3" }
    ]
  }, new Date("2026-08-28T08:00:00"));
  assert.equal(challenge.kind, "training");
  assert.equal(challenge.durationDays, 7);
  assert.equal(challenge.status, "active");
  assert.deepEqual(Object.keys(challenge.checkIns), []);
  assert.deepEqual(challenge.tutorials.map((item) => item.url), [
    "https://example.com/look-1",
    "https://example.com/look-2",
    "https://example.com/look-3"
  ]);
});

test("challenge progress counts completion and current streak", () => {
  const core = loadCore();
  let challenge = core.createChallenge({ templateId: "body-lotion-30" }, new Date("2026-08-28T08:00:00"));
  challenge = core.toggleChallengeCheckIn(challenge, "2026-08-28");
  challenge = core.toggleChallengeCheckIn(challenge, "2026-08-29");
  const progress = core.getChallengeProgress(challenge, "2026-08-29");
  assert.equal(progress.day, 2);
  assert.equal(progress.completed, 2);
  assert.equal(progress.streak, 2);
  assert.equal(progress.completionRate, 7);
});

test("one occurrence schedule covers daily, weekly, and persisted scheduled challenges", () => {
  const core = loadCore();
  assert.deepEqual(Array.from(core.getChallengeOccurrenceDays({ frequency: "daily", durationDays: 4 })), [1, 2, 3, 4]);
  assert.deepEqual(Array.from(core.getChallengeOccurrenceDays({ frequency: "weekly", durationDays: 28 })), [1, 8, 15, 22]);
  assert.deepEqual(Array.from(core.getChallengeOccurrenceDays({ frequency: "weekly", durationDays: 15 })), [1, 8, 15]);
  assert.deepEqual(Array.from(core.getChallengeOccurrenceDays({ frequency: "scheduled", durationDays: 7, taskDays: [7, 1, 4, 4] })), [1, 4, 7]);
  assert.deepEqual(Array.from(core.getChallengeOccurrenceDays({ frequency: "scheduled", durationDays: 7, taskDays: [0, 8, "4"] })), []);
  assert.deepEqual(Array.from(core.getChallengeOccurrenceDays({ frequency: "scheduled", durationDays: 7 })), []);
});

test("off-day check-ins are rejected and progress ignores invalid dates", () => {
  const core = loadCore();
  const challenge = core.createChallenge({ templateId: "makeup-3-in-7" }, new Date("2026-08-28T08:00:00Z"));
  const unchanged = core.toggleChallengeCheckIn(challenge, "2026-08-29");
  assert.deepEqual({ ...unchanged.checkIns }, {});
  const withInvalid = { ...challenge, checkIns: { "2026-08-29": { completedAt: "2026-08-29T08:00:00Z" }, "2026-08-31": { completedAt: "2026-08-31T08:00:00Z" } } };
  const progress = core.getChallengeProgress(withInvalid, "2026-09-03");
  assert.equal(progress.total, 3);
  assert.equal(progress.completed, 1);
});

test("streak follows consecutive scheduled occurrences instead of calendar days", () => {
  const core = loadCore();
  let challenge = core.createChallenge({ templateId: "makeup-3-in-7" }, new Date("2026-08-28T08:00:00Z"));
  challenge = core.toggleChallengeCheckIn(challenge, "2026-08-28");
  challenge = core.toggleChallengeCheckIn(challenge, "2026-08-31");
  assert.equal(core.getChallengeProgress(challenge, "2026-09-01").streak, 2);
  challenge = core.toggleChallengeCheckIn(challenge, "2026-09-03");
  assert.equal(core.getChallengeProgress(challenge, "2026-09-03").streak, 3);
});

test("tutorials map by occurrence order and are absent on rest days", () => {
  const core = loadCore();
  const challenge = core.createChallenge({
    templateId: "makeup-3-in-7",
    tutorials: [
      { label: "一", url: "https://example.com/1" },
      { label: "二", url: "https://example.com/2" },
      { label: "三", url: "https://example.com/3" }
    ]
  }, new Date("2026-08-28T08:00:00Z"));
  assert.equal(core.getChallengeTutorialForDay(challenge, 1).label, "一");
  assert.equal(core.getChallengeTutorialForDay(challenge, 4).label, "二");
  assert.equal(core.getChallengeTutorialForDay(challenge, 7).label, "三");
  assert.equal(core.getChallengeTutorialForDay(challenge, 2), null);
});

test("date-only challenge arithmetic stays exact across DST boundaries", () => {
  const core = loadCore();
  const challenge = { startedAt: "2026-03-07" };
  assert.equal(core.getChallengeDay(challenge, "2026-03-08"), 2);
  assert.equal(core.getChallengeDay(challenge, "2026-03-09"), 3);
  assert.equal(core.getChallengeDay({ startedAt: "2026-10-31" }, "2026-11-02"), 3);
});

test("challenge creation defensively copies template photo and task days", () => {
  const core = loadCore();
  const templates = core.getChallengeTemplates();
  const challenge = core.createChallenge({ templateId: "makeup-3-in-7" }, new Date("2026-08-28T08:00:00Z"));
  assert.deepEqual(Array.from(challenge.photoDays), [1, 7]);
  assert.deepEqual(Array.from(challenge.taskDays), [1, 4, 7]);
  challenge.photoDays[0] = 99;
  challenge.taskDays[0] = 99;
  assert.deepEqual(Array.from(core.createChallenge({ templateId: "makeup-3-in-7" }).photoDays), [1, 7]);
  assert.deepEqual(Array.from(core.createChallenge({ templateId: "makeup-3-in-7" }).taskDays), [1, 4, 7]);
  templates.find((item) => item.id === "makeup-3-in-7").taskDays[0] = 88;
  assert.deepEqual(Array.from(core.getChallengeTemplates().find((item) => item.id === "makeup-3-in-7").taskDays), [1, 4, 7]);
  const custom = core.createChallenge({ templateId: "custom", title: "自定义", durationDays: 7 });
  assert.deepEqual(Array.from(custom.photoDays), []);
  assert.deepEqual(Array.from(custom.taskDays), []);
});

test("V2 state normalization validates active, history, and deletion tombstones", () => {
  const core = loadCore();
  const valid = core.createChallenge({ templateId: "makeup-3-in-7", reminderTime: "20:15" }, new Date("2026-08-28T08:00:00Z"));
  const normalized = core.normalizeChallengeState({
    version: 2,
    active: { ...valid, checkIns: { "2026-08-28": {}, nope: true }, tutorials: [{ label: "好", url: "https://example.com/a" }, { label: "坏", url: "javascript:bad" }], photoDays: [1, 7, 99], taskDays: [7, 1, 4, 4] },
    history: [
      { id: " old ", title: "已完成", startedAt: "2026-08-01", completedAt: "2026-08-28", durationDays: 28, completed: 99, completionRate: 140, streak: -2 },
      { id: "array-dates", title: "坏日期", startedAt: ["2026-08-01"], completedAt: ["2026-08-28"], durationDays: 28, completed: 1, completionRate: 4, streak: 1 },
      { id: "", title: "坏记录" }
    ],
    pendingPhotoDeletionIds: [" abc ", "abc", 42, "", "def"]
  });
  assert.equal(normalized.active.id, valid.id);
  assert.deepEqual(Object.keys(normalized.active.checkIns), ["2026-08-28"]);
  assert.equal(normalized.active.tutorials.length, 1);
  assert.deepEqual(Array.from(normalized.active.photoDays), [1, 7]);
  assert.deepEqual(Array.from(normalized.active.taskDays), [1, 4, 7]);
  assert.equal(normalized.history.length, 1);
  assert.equal(normalized.history[0].completed, 28);
  assert.equal(normalized.history[0].completionRate, 100);
  assert.equal(normalized.history[0].streak, 0);
  assert.deepEqual(Array.from(normalized.pendingPhotoDeletionIds), ["abc", "def"]);
  const scheduledHistory = core.normalizeChallengeState({
    version: 2,
    history: [{ id: "scheduled", title: "排期挑战", startedAt: "2026-08-01", completedAt: "2026-08-28", durationDays: 28, total: 3, completed: 9, completionRate: 140, streak: 9 }]
  }).history[0];
  assert.equal(scheduledHistory.completed, 3);
  assert.equal(scheduledHistory.streak, 3);
});

test("V2 state normalization drops unusable active challenges without throwing", () => {
  const core = loadCore();
  for (const active of [null, {}, { id: "x", title: "x", startedAt: "bad", durationDays: 7, frequency: "daily", reminderTime: "21:30", status: "active" }, { id: "x", title: "x", startedAt: "2026-08-28", durationDays: 999, frequency: "daily", reminderTime: "21:30", status: "active" }]) {
    assert.doesNotThrow(() => core.normalizeChallengeState({ version: 2, active }));
    assert.equal(core.normalizeChallengeState({ version: 2, active }).active, null);
  }
  assert.deepEqual(JSON.parse(JSON.stringify(core.normalizeChallengeState(null))), { version: 2, active: null, history: [], pendingPhotoDeletionIds: [] });
});

test("photo-deletion tombstone helpers trim, deduplicate, and resolve IDs", () => {
  const core = loadCore();
  let challengeState = core.normalizeChallengeState({ version: 2, pendingPhotoDeletionIds: [" old "] });
  challengeState = core.addPendingPhotoDeletion(challengeState, " new ");
  challengeState = core.addPendingPhotoDeletion(challengeState, "new");
  challengeState = core.addPendingPhotoDeletion(challengeState, "   ");
  assert.deepEqual(Array.from(challengeState.pendingPhotoDeletionIds), ["old", "new"]);
  challengeState = core.removePendingPhotoDeletion(challengeState, "new");
  assert.deepEqual(Array.from(challengeState.pendingPhotoDeletionIds), ["old"]);
});

test("completion helpers use the scheduled finish date and retain metadata only", () => {
  const core = loadCore();
  const challenge = core.createChallenge({
    templateId: "custom",
    title: "晚间习惯",
    durationDays: 3,
    taskLabel: "完成今天的习惯"
  }, new Date("2026-08-28T08:00:00"));
  const progress = { completed: 2, completionRate: 67, streak: 1 };
  assert.equal(core.isChallengeCompletionEligible(challenge, "2026-08-29"), false);
  assert.equal(core.isChallengeCompletionEligible(challenge, "2026-08-30"), true);
  assert.equal(core.getChallengePosterFinishDate(challenge), "2026-08-30");
  assert.equal(core.getChallengePosterFinishDate({ ...challenge, completedAt: "2026-09-01" }), "2026-09-01");
  const summary = core.createChallengeHistoryEntry(challenge, progress, "2026-09-01");
  assert.deepEqual({ ...summary }, {
    id: challenge.id,
    title: "晚间习惯",
    startedAt: "2026-08-28",
    completedAt: "2026-09-01",
    durationDays: 3,
    total: 3,
    completed: 2,
    completionRate: 67,
    streak: 1
  });
  assert.equal("checkIns" in summary, false);
  assert.equal("tutorials" in summary, false);
});

test("poster helpers fall back safely and sanitize download filenames", () => {
  const core = loadCore();
  assert.deepEqual(Array.from(core.normalizeChallengePosterPhotos(null)), []);
  assert.deepEqual(Array.from(core.normalizeChallengePosterPhotos([{ slot: "start", blob: "local" }, { slot: "other", blob: "skip" }])), [{ slot: "start", blob: "local" }]);
  assert.equal(core.sanitizeChallengePosterFilename("春\n夏/秋\u0000"), "春-夏-秋");
  assert.equal(core.sanitizeChallengePosterFilename("  "), "我的挑战");
});

test("challenge ICS includes task, tutorial and return URL", () => {
  const core = loadCore();
  const challenge = core.createChallenge({
    templateId: "eye-makeup-7",
    tutorials: [{ label: "眼妆教程", url: "https://example.com/tutorial" }]
  }, new Date("2026-08-28T08:00:00"));
  const ics = core.buildChallengeCalendarText(challenge, "https://example.app/?view=challenge");
  const unfolded = unfoldIcs(ics);
  assert.match(unfolded, /BEGIN:VCALENDAR/);
  assert.match(unfolded, /RRULE:FREQ=DAILY;COUNT=7/);
  assert.match(unfolded, /URL:https:\/\/example\.app\/\?view=challenge/);
  assert.match(unfolded, /https:\/\/example\.com\/tutorial/);
  assert.match(unfolded, /回到挑战中心完成打卡/);
  assert.match(unfolded, /https:\/\/example\.app\/\?view=challenge/);
});

test("challenge ICS only emits an HTTPS return URL", () => {
  const core = loadCore();
  const challenge = core.createChallenge({ templateId: "eye-makeup-7" }, new Date("2026-08-28T08:00:00"));
  const ics = core.buildChallengeCalendarText(challenge, "http://example.app/?view=challenge");
  const unfolded = unfoldIcs(ics);
  assert.doesNotMatch(unfolded, /URL:http:\/\/example\.app/);
  assert.doesNotMatch(unfolded, /DESCRIPTION:[^\r\n]*http:\/\/example\.app/);
  assert.match(unfolded, /DESCRIPTION:[^\r\n]*回到挑战中心完成打卡/);
});

test("challenge ICS derives weekly count and emits irregular events per occurrence", () => {
  const core = loadCore();
  const weekly = core.createChallenge({ templateId: "custom", title: "15 天每周", durationDays: 15, frequency: "weekly", reminderTime: "08:10" }, new Date("2026-08-28T08:00:00Z"));
  const weeklyIcs = core.buildChallengeCalendarText(weekly, "https://example.app/?view=challenge");
  assert.match(weeklyIcs, /RRULE:FREQ=WEEKLY;COUNT=3/);
  assert.equal((weeklyIcs.match(/BEGIN:VEVENT/g) || []).length, 1);

  const scheduled = core.createChallenge({ templateId: "makeup-3-in-7", reminderTime: "20:30" }, new Date("2026-08-28T08:00:00Z"));
  const scheduledIcs = core.buildChallengeCalendarText(scheduled, "https://example.app/?view=challenge");
  assert.equal((scheduledIcs.match(/BEGIN:VEVENT/g) || []).length, 3);
  assert.doesNotMatch(scheduledIcs, /RRULE:/);
  assert.match(scheduledIcs, /DTSTART:20260828T203000/);
  assert.match(scheduledIcs, /DTSTART:20260831T203000/);
  assert.match(scheduledIcs, /DTSTART:20260903T203000/);
});

test("scheduled ICS maps one tutorial to each occurrence event", () => {
  const core = loadCore();
  const challenge = core.createChallenge({
    templateId: "makeup-3-in-7",
    reminderTime: "20:30",
    tutorials: [
      { label: "妆容一", url: "https://example.com/look-1" },
      { label: "妆容二", url: "https://example.com/look-2" },
      { label: "妆容三", url: "https://example.com/look-3" }
    ]
  }, new Date("2026-08-28T08:00:00Z"));
  const events = unfoldIcs(core.buildChallengeCalendarText(challenge, "https://example.app/?view=challenge"))
    .match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g);
  assert.equal(events.length, 3);
  events.forEach((event, index) => {
    assert.match(event, new RegExp(`https://example\\.com/look-${index + 1}`));
    [1, 2, 3].filter((number) => number !== index + 1).forEach((number) => {
      assert.doesNotMatch(event, new RegExp(`https://example\\.com/look-${number}`));
    });
  });
});

test("challenge ICS folds long UTF-8 content lines at 75 octets and unfolds losslessly", () => {
  const core = loadCore();
  const title = "这是一个需要在手机日历中完整显示的超长中文挑战标题";
  const taskLabel = "完成一项包含许多中文字符并且不能在多字节字符中间断开的挑战任务";
  const tutorialUrl = `https://example.com/${"long-segment-".repeat(8)}`;
  const challenge = core.createChallenge({
    templateId: "custom",
    title,
    taskLabel,
    durationDays: 3,
    tutorials: [{ label: "超长中文教程名称用于验证折行", url: tutorialUrl }]
  }, new Date("2026-08-28T08:00:00Z"));
  const ics = core.buildChallengeCalendarText(challenge, "https://example.app/?view=challenge");
  const physicalLines = ics.split("\r\n").filter(Boolean);
  physicalLines.forEach((line) => assert.ok(Buffer.byteLength(line, "utf8") <= 75, `${Buffer.byteLength(line, "utf8")} octets: ${line}`));
  assert.ok(physicalLines.some((line) => line.startsWith(" ")));
  const unfolded = unfoldIcs(ics);
  assert.match(unfolded, new RegExp(`SUMMARY:${title}`));
  assert.ok(unfolded.includes(taskLabel));
  assert.ok(unfolded.includes(tutorialUrl));
  assert.doesNotMatch(unfolded, /�/);
});

test("challenge ICS normalizes CRLF and CR in descriptions", () => {
  const core = loadCore();
  const challenge = core.createChallenge({
    templateId: "custom",
    title: "自定义挑战",
    taskLabel: "第一行\r\n第二行\r第三行",
    tutorials: [{ label: "教程\r\n标题\r续", url: "https://example.com/tutorial" }]
  }, new Date("2026-08-28T08:00:00"));
  const ics = core.buildChallengeCalendarText(challenge, "https://example.app/?view=challenge");
  const unfolded = unfoldIcs(ics);
  const description = unfolded.slice(unfolded.indexOf("DESCRIPTION:"), unfolded.indexOf("\r\nRRULE:"));
  assert.equal(description.includes("\r"), false);
  assert.match(description, /第一行\\n第二行\\n第三行\\n教程\\n标题\\n续/);
});

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

test("readable report remains traceable after quality override", () => {
  const core = loadCore();
  const quality = core.overridePhotoQuality(core.evaluatePhotoQuality({ ...goodSignals(), points: rotate(makeFrontLandmarks(), 8) }));
  const measurements = core.computeMeasurements(makeFrontLandmarks(), "low", "medium");
  const profile = core.inferQuestionnaire({ postCleanse: "tzone", reactivity: "rarely", primaryGoal: "overall", dailyMinutes: 5, hairMaintenance: "minimal", monthlyBudget: "basic" });
  const report = core.composeReport({ quality, measurements, profile });
  assert.equal(report.quality.overridden, true);
  assert.ok(report.readableProfile.faceShape.metricIds.length >= 3);
  assert.ok(report.readableProfile.memorySentence);
});

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
    assert.ok(Number.isFinite(axis.value));
    assert.ok(axis.value >= 0 && axis.value <= 100);
  });
  assert.equal(identity.axes.find((axis) => axis.id === "features").label, "五官量感差异");
  assert.equal(identity.title.includes("评分"), false);
});

test("identity presentation rejects missing or non-finite required measurements", () => {
  const core = loadCore();
  const measurements = core.computeMeasurements(makeFrontLandmarks(), "high");
  const readable = core.deriveReadableProfile(measurements, { level: "high" });
  const incomplete = { ...measurements, faceLengthWidth: {} };
  assert.throws(() => core.buildIdentityPresentation(incomplete, readable, new Date("2026-08-31T12:00:00Z")), /requires finite measurement: faceLengthWidth\.value/);
  const nonFinite = { ...measurements, visualWeight: { ...measurements.visualWeight, nose: Infinity } };
  assert.throws(() => core.buildIdentityPresentation(nonFinite, readable, new Date("2026-08-31T12:00:00Z")), /requires finite measurement: visualWeight\.nose/);
});

test("identity presentation serial is safe for invalid dates and deterministic for equal timestamps", () => {
  const core = loadCore();
  const measurements = core.computeMeasurements(makeFrontLandmarks(), "high");
  const readable = core.deriveReadableProfile(measurements, { level: "high" });
  const invalid = core.buildIdentityPresentation(measurements, readable, new Date("invalid"));
  assert.equal(invalid.serial, "NO.0000");
  const first = core.buildIdentityPresentation(measurements, readable, new Date("2026-08-31T12:00:00Z"));
  const second = core.buildIdentityPresentation(measurements, readable, new Date("2026-08-31T12:00:00Z"));
  assert.equal(first.serial, second.serial);
});

test("report renders the identity model as svg and readable trait bars", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  assert.match(html, /function renderIdentityRadar\(axes\)/);
  assert.match(html, /<svg[^>]+identity-radar-svg/);
  assert.match(html, /function renderIdentityTraitBars\(report, identity\)/);
  assert.match(html, /FaceStyleCore\.buildIdentityPresentation/);
  assert.match(html, /查看解读依据/);
});

test("identity report renderer normalizes untrusted percentage values", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  assert.match(html, /function normalizeIdentityPercent\(value\)/);
  assert.match(html, /const numeric = Number\(value\);/);
  assert.match(html, /Number\.isFinite\(numeric\) \? Math\.min\(100, Math\.max\(0, numeric\)\) : 0/);
  assert.match(html, /const normalizedAxes = axes\.map\(\(axis\) => \(\{ \.\.\.axis, value: normalizeIdentityPercent\(axis\.value\) \}\)\);/);
  assert.match(html, /const values = normalizedAxes\.map\(\(axis, index\) => point\(index, axis\.value\)\.join\(","\)\)\.join\(" "\);/);
  assert.match(html, /const courtValues = court\.values\.map\(normalizeIdentityPercent\);/);
  assert.match(html, /courtValues\.map\(\(value, index\) => `<i style="--segment:\$\{value\}"/);
  assert.match(html, /const identityAxes = identity\.axes\.slice\(0, 3\)\.map\(\(axis\) => \(\{ \.\.\.axis, value: normalizeIdentityPercent\(axis\.value\) \}\)\);/);
  assert.doesNotMatch(html, /const values = axes\.map/);
  assert.doesNotMatch(html, /court\.values\.map\(\(value, index\)/);
});
