const CHALLENGE_TEMPLATES = Object.freeze([
  { id: "body-lotion-30", kind: "habit", title: "30 天身体乳习惯", durationDays: 30, frequency: "daily", taskLabel: "今天涂身体乳", photoDays: [1, 30], taskDays: [], tutorialSlots: 0 },
  { id: "sunscreen-21", kind: "habit", title: "21 天每日防晒", durationDays: 21, frequency: "daily", taskLabel: "今天完成防晒", photoDays: [1, 21], taskDays: [], tutorialSlots: 0 },
  { id: "clean-tools-4", kind: "habit", title: "4 周清洁化妆工具", durationDays: 28, frequency: "weekly", taskLabel: "本周清洁化妆工具", photoDays: [], taskDays: [], tutorialSlots: 0 },
  { id: "makeup-3-in-7", kind: "training", title: "7 天学会 3 个完整妆容", durationDays: 7, frequency: "scheduled", taskLabel: "完成今天的妆容练习", photoDays: [1, 7], taskDays: [1, 4, 7], tutorialSlots: 3 },
  { id: "eye-makeup-7", kind: "training", title: "7 天眼妆练习", durationDays: 7, frequency: "daily", taskLabel: "完成今天的眼妆练习", photoDays: [1, 7], taskDays: [], tutorialSlots: 3 },
  { id: "brow-makeup-7", kind: "training", title: "7 天眉妆练习", durationDays: 7, frequency: "daily", taskLabel: "完成今天的眉妆练习", photoDays: [1, 7], taskDays: [], tutorialSlots: 3 }
].map((item) => Object.freeze({ ...item, photoDays: Object.freeze([...item.photoDays]), taskDays: Object.freeze([...item.taskDays]) })));

function distance(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function safeDivide(numerator, denominator, fallback = 0) {
  return Number.isFinite(numerator) && Number.isFinite(denominator) && denominator !== 0 ? numerator / denominator : fallback;
}

function averagePoint(points, indexes) {
  return {
    x: indexes.reduce((sum, index) => sum + points[index].x, 0) / indexes.length,
    y: indexes.reduce((sum, index) => sum + points[index].y, 0) / indexes.length
  };
}

function angleDegrees(a, b) {
  return Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
}

function round(value, digits = 2) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round((value + Math.sign(value || 1) * Number.EPSILON) * factor) / factor;
}

function evaluatePhotoQuality(signals) {
  const { detectionScore, faceBox, imageSize, points, laplacianVariance, meanBrightness } = signals;
  const leftEye = averagePoint(points, [36, 37, 38, 39, 40, 41]);
  const rightEye = averagePoint(points, [42, 43, 44, 45, 46, 47]);
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
    accepted: !issues.some(item => item.severity === "reject"),
    level: issues.length ? "low" : medium ? "medium" : "high",
    issues,
    metrics: {
      roll: round(roll, 1), yawProxy: round(yawProxy, 3), faceRatio: round(faceRatio, 3),
      laplacianVariance: round(laplacianVariance, 1), meanBrightness: round(meanBrightness, 1)
    }
  };
}

function overridePhotoQuality(quality) {
  return { ...quality, accepted: true, level: "low", overridden: true, referenceOnly: true };
}

function localCalendarDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function dateToUtcDayOrdinal(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
  if (!match) return NaN;
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const ordinal = Date.UTC(year, month - 1, day) / 86400000;
  const verified = new Date(ordinal * 86400000);
  return verified.getUTCFullYear() === year && verified.getUTCMonth() === month - 1 && verified.getUTCDate() === day ? ordinal : NaN;
}

function calendarDateFromOrdinal(ordinal) {
  if (!Number.isFinite(ordinal)) return "";
  const date = new Date(ordinal * 86400000);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function normalizeDayArray(value, durationDays) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((day) => Number.isInteger(day) && day >= 1 && day <= durationDays))].sort((a, b) => a - b);
}

function getChallengeOccurrenceDays(challenge) {
  const durationDays = Number.isInteger(challenge?.durationDays) && challenge.durationDays >= 1 ? challenge.durationDays : 0;
  if (!durationDays) return [];
  if (challenge.frequency === "daily") return Array.from({ length: durationDays }, (_, index) => index + 1);
  if (challenge.frequency === "weekly") return Array.from({ length: Math.ceil(durationDays / 7) }, (_, index) => index * 7 + 1).filter((day) => day <= durationDays);
  if (challenge.frequency === "scheduled") return normalizeDayArray(challenge.taskDays, durationDays);
  return [];
}

function validateTutorialUrl(value) {
  try {
    const raw = String(value);
    if (/[\u0000-\u001f\u007f-\u009f\\]/.test(raw)) return "";

    const match = /^https:\/\/([^/?#]+)(\/[^?#]*)?(\?[^#]*)?(#.*)?$/i.exec(raw.trim());
    if (!match) return "";

    const authority = /^([a-z0-9.-]+)(?::(\d+))?$/i.exec(match[1]);
    if (!authority) return "";
    const host = authority[1].toLowerCase();
    const labels = host.split(".");
    const validLabel = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
    const lastLabel = labels[labels.length - 1];
    const numericLastLabel = /^\d+$|^0x[0-9a-f]*$/i.test(lastLabel);
    if (host.length > 253 || numericLastLabel || labels.some((label) => !validLabel.test(label) || /^xn--/i.test(label))) return "";

    const portText = authority[2] || "";
    const port = Number(portText);
    if (portText && (portText.length > 5 || !Number.isInteger(port) || port < 1 || port > 65535)) return "";

    const path = match[2] || "/";
    const suffix = `${path}${match[3] || ""}${match[4] || ""}`;
    if (/%(?![0-9a-f]{2})/i.test(suffix)) return "";
    if (!/^[a-z0-9\-._~!$&()*+,;=:@/?#% ]*$/i.test(suffix)) return "";
    if (path.split("/").some((segment) => [".", ".."].includes(segment.replace(/%2e/gi, ".")))) return "";

    const normalizedPort = portText && port !== 443 ? `:${port}` : "";
    return encodeURI(`https://${host}${normalizedPort}${suffix}`).replace(/%25(?=[0-9a-f]{2})/gi, "%");
  } catch (_) {
    return "";
  }
}

function createChallenge(input, now = new Date()) {
  const template = CHALLENGE_TEMPLATES.find((item) => item.id === input.templateId);
  const custom = input.templateId === "custom";
  if (!template && !custom) throw new Error("请选择一个挑战模板");
  const durationDays = custom ? Math.min(90, Math.max(1, Number(input.durationDays) || 7)) : template.durationDays;
  const startedAt = input.startedAt || localCalendarDate(now);
  return {
    version: 2,
    id: `challenge-${now.getTime()}`,
    templateId: input.templateId,
    title: custom ? String(input.title || "我的变美挑战").trim().slice(0, 30) : template.title,
    kind: custom ? "custom" : template.kind,
    durationDays,
    frequency: custom ? (input.frequency === "weekly" ? "weekly" : "daily") : template.frequency,
    reminderTime: /^([01]\d|2[0-3]):[0-5]\d$/.test(input.reminderTime) ? input.reminderTime : "21:30",
    startedAt,
    taskLabel: custom ? String(input.taskLabel || input.title || "完成今天的挑战").trim().slice(0, 40) : template.taskLabel,
    tutorials: (input.tutorials || []).map((item) => ({ label: String(item.label || "教程").slice(0, 30), url: validateTutorialUrl(item.url) })).filter((item) => item.url),
    photoDays: custom ? [] : [...template.photoDays],
    taskDays: custom ? [] : [...template.taskDays],
    checkIns: {},
    status: "active",
    createdAt: now.toISOString()
  };
}

function getChallengeDay(challenge, date = localCalendarDate()) {
  const start = dateToUtcDayOrdinal(challenge?.startedAt);
  const current = dateToUtcDayOrdinal(date);
  return Number.isFinite(start) && Number.isFinite(current) ? current - start + 1 : NaN;
}

function isChallengeOccurrenceDay(challenge, day) {
  return getChallengeOccurrenceDays(challenge).includes(day);
}

function getChallengeDateForDay(challenge, day) {
  return calendarDateFromOrdinal(dateToUtcDayOrdinal(challenge?.startedAt) + day - 1);
}

function toggleChallengeCheckIn(challenge, date = localCalendarDate()) {
  const day = getChallengeDay(challenge, date);
  if (!isChallengeOccurrenceDay(challenge, day)) return challenge;
  const checkIns = { ...challenge.checkIns };
  if (checkIns[date]) delete checkIns[date];
  else checkIns[date] = { completedAt: new Date().toISOString() };
  return { ...challenge, checkIns };
}

function getChallengeProgress(challenge, date = localCalendarDate()) {
  const rawDay = getChallengeDay(challenge, date);
  const day = Number.isFinite(rawDay) ? Math.min(challenge.durationDays, Math.max(1, rawDay)) : 1;
  const occurrenceDays = getChallengeOccurrenceDays(challenge);
  const occurrenceDates = occurrenceDays.map((occurrenceDay) => getChallengeDateForDay(challenge, occurrenceDay));
  const completedDates = occurrenceDates.filter((occurrenceDate) => challenge.checkIns?.[occurrenceDate]);
  let streak = 0;
  const occurredDates = occurrenceDates.filter((_, index) => occurrenceDays[index] <= rawDay);
  for (let index = occurredDates.length - 1; index >= 0 && challenge.checkIns?.[occurredDates[index]]; index -= 1) {
    streak += 1;
  }
  const completed = completedDates.length;
  const total = occurrenceDays.length;
  return { day, total, completed, completionRate: total ? Math.round(completed / total * 100) : 0, streak, isComplete: rawDay >= challenge.durationDays && completed > 0 };
}

function createChallengeHistoryEntry(challenge, progress, completedAt = localCalendarDate()) {
  return {
    id: challenge.id,
    title: challenge.title,
    startedAt: challenge.startedAt,
    completedAt,
    durationDays: challenge.durationDays,
    total: Number.isInteger(progress.total) ? progress.total : getChallengeOccurrenceDays(challenge).length,
    completed: progress.completed,
    completionRate: progress.completionRate,
    streak: progress.streak
  };
}

module.exports = {
  CHALLENGE_TEMPLATES,
  evaluatePhotoQuality,
  overridePhotoQuality,
  createChallenge,
  toggleChallengeCheckIn,
  getChallengeProgress,
  getChallengeOccurrenceDays,
  createChallengeHistoryEntry
};
