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
  ["uploadView", "analysisView", "questionnaireView", "reportView", "qualityLevel", "coreTraits", "dataGroups", "carePlan", "actionCards", "reminderCards", "timeCards", "milestoneList", "calendarButton", "clearActionButton", "evidenceDrawer"].forEach((id) => {
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
  assert.match(html, /faceStyleActionStateV1/);
  assert.match(html, /selectActionCard/);
  assert.match(html, /selectReminder/);
  assert.match(html, /selectReminderTime/);
  assert.match(html, /toggleMilestone/);
});

test("calendar helper builds milestone and weekly ICS variants", () => {
  const core = loadCore();
  const card = { id: "style-focus", title: "调整一个造型变量", action: "比较两种眉形。" };
  const milestones = core.buildCalendarText(card, "milestones", "2026-08-28");
  assert.match(milestones, /BEGIN:VCALENDAR/);
  assert.match(milestones, /调整一个造型变量/);
  assert.equal((milestones.match(/BEGIN:VEVENT/g) || []).length, 3);
  const weekly = core.buildCalendarText(card, "weekly", "2026-08-28");
  assert.match(weekly, /RRULE:FREQ=WEEKLY;COUNT=4/);
  assert.equal((weekly.match(/BEGIN:VEVENT/g) || []).length, 1);
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
  ["challengeView", "homeChallengeButton", "reportChallengeButton", "todayChallenge", "challengeProgress", "newChallengeButton", "challengeTemplateSheet"].forEach((id) => {
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
  assert.match(html, /function showTemplateTutorialSetup\(template\)/);
  assert.match(html, /template\.tutorialSlots/);
  assert.match(html, /Array\.from\(\{ length: template\.tutorialSlots \}\)/);
  assert.match(html, /function submitTemplateTutorials\(event\)/);
  assert.match(html, /startChallenge\(\{ templateId: state\.pendingTemplateId, tutorials \}\)/);
});

test("calendar return startup opens the challenge center without opening a creation sheet", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  assert.match(html, /new URLSearchParams\(window\.location\.search\)\.get\(["']view["']\) === ["']challenge["']/);
  assert.match(html, /openChallengeCenter\(["']calendar["']\)/);
  assert.match(html, /if \(source === ["']report["']\) openTemplateSheet/);
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
  assert.match(html, /const tutorial = todayInChallenge \? getTodayTutorial\(challenge, progress\.day\) : null;/);
  assert.match(html, /id=["']yesterdayCheckInButton["']/);
});

test("custom challenge submission validates reminder time and complete tutorial pairs", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  assert.match(html, /const reminderTime = \$\("challengeReminderTime"\)\.value;/);
  assert.match(html, /!validReminderTime/);
  assert.match(html, /教程名称和链接需要同时填写/);
  assert.doesNotMatch(html, /label \|\| "参考教程"/);
});

test("report challenge sheet returns focus to a visible challenge control", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  assert.match(html, /openTemplateSheet\(getRecommendedChallengeTemplateId\(\), \$\("newChallengeButton"\)\)/);
  assert.match(html, /function openTemplateSheet\(recommendedTemplateId = "", focusTrigger = document\.activeElement\)/);
});

test("challenge deletion survives photo cleanup errors", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  assert.match(html, /async function deleteActiveChallenge\(\)/);
  assert.match(html, /const challengeId = challenge\.id;/);
  assert.match(html, /await Promise\.resolve\(window\.deleteChallengePhotos\(challengeId\)\)/);
  assert.match(html, /catch \(_\) \{\s*photoCleanupFailed = true;/);
  assert.match(html, /state\.challengeState\.active = null;/);
  assert.match(html, /照片清理失败，但挑战已删除/);
});

test("challenge deletion clears active state before awaiting photo cleanup", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const match = html.match(/async function deleteActiveChallenge\(\) \{([\s\S]*?)\n    function focusTodayControl/);
  assert.ok(match, "deleteActiveChallenge body must be present");
  const body = match[1];
  const challengeId = body.indexOf("const challengeId = challenge.id;");
  const clearActive = body.indexOf("state.challengeState.active = null;");
  const persist = body.indexOf("saveChallengeState();");
  const render = body.indexOf("renderChallengeCenter();");
  const cleanup = body.indexOf("await Promise.resolve(window.deleteChallengePhotos(challengeId))");
  assert.ok(challengeId >= 0 && clearActive > challengeId);
  assert.ok(persist > clearActive && render > persist);
  assert.ok(cleanup > render);
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

test("challenge ICS includes task, tutorial and return URL", () => {
  const core = loadCore();
  const challenge = core.createChallenge({
    templateId: "eye-makeup-7",
    tutorials: [{ label: "眼妆教程", url: "https://example.com/tutorial" }]
  }, new Date("2026-08-28T08:00:00"));
  const ics = core.buildChallengeCalendarText(challenge, "https://example.app/?view=challenge");
  assert.match(ics, /BEGIN:VCALENDAR/);
  assert.match(ics, /RRULE:FREQ=DAILY;COUNT=7/);
  assert.match(ics, /URL:https:\/\/example\.app\/\?view=challenge/);
  assert.match(ics, /https:\/\/example\.com\/tutorial/);
});

test("challenge ICS only emits an HTTPS return URL", () => {
  const core = loadCore();
  const challenge = core.createChallenge({ templateId: "eye-makeup-7" }, new Date("2026-08-28T08:00:00"));
  const ics = core.buildChallengeCalendarText(challenge, "http://example.app/?view=challenge");
  assert.doesNotMatch(ics, /URL:http:\/\/example\.app/);
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
  const description = ics.slice(ics.indexOf("DESCRIPTION:"), ics.indexOf("\r\nRRULE:"));
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
