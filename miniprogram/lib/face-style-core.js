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

function inferQuestionnaire(answers = {}) {
  const skinMap = { tight: "dry", comfortable: "normal", tzone: "combination", allOver: "oily" };
  const required = ["postCleanse", "reactivity", "primaryGoal", "dailyMinutes", "hairMaintenance", "monthlyBudget"];
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

const KNOWLEDGE_BASE = Object.freeze({
  sources: {
    interEthnicReview: { title: "跨族群面部尺寸系统综述", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC3074358/", type: "research" },
    southernChineseCanons: { title: "华南成人新古典面部比例研究", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC3532441/", type: "research" },
    photoStandard: { title: "标准化面部摄影指南", url: "https://www.imi.org.uk/wp-content/uploads/2022/03/NG_Dental_Photo_2_0_S.pdf", type: "guideline" },
    aadBasics: { title: "美国皮肤科学会基础护肤建议", url: "https://www.aad.org/public/everyday-care/skin-care-basics/care/skin-care-budget", type: "guideline" },
    faceApi: { title: "Face-API.js 68 点说明", url: "https://github.com/justadudewhohacks/face-api.js/", type: "implementation" }
  },
  metrics: {
    face_length_width: { formulaText: "估算发际线至下巴长度 ÷ 面宽", referenceType: "产品启发式解释带", sourceIds: ["interEthnicReview", "faceApi"] },
    cheek_face_width: { formulaText: "颧区可见宽度 ÷ 面宽", referenceType: "照片内归一化几何", sourceIds: ["faceApi"] },
    jaw_face_width: { formulaText: "下颌转折宽度 ÷ 面宽", referenceType: "照片内归一化几何", sourceIds: ["faceApi"] },
    chin_face_width: { formulaText: "下巴两侧宽度 ÷ 面宽", referenceType: "照片内归一化几何", sourceIds: ["faceApi"] },
    eye_spacing: { formulaText: "内眼角距离 ÷ 平均眼宽", referenceType: "古典五眼视觉参照", sourceIds: ["southernChineseCanons"] },
    left_eye_side_space: { formulaText: "外眼角至可见脸缘距离 ÷ 平均眼宽", referenceType: "照片内五眼留白代理", sourceIds: ["southernChineseCanons", "faceApi"] },
    right_eye_side_space: { formulaText: "外眼角至可见脸缘距离 ÷ 平均眼宽", referenceType: "照片内五眼留白代理", sourceIds: ["southernChineseCanons", "faceApi"] },
    eye_aspect_left: { formulaText: "左眼垂直开合 ÷ 左眼宽", referenceType: "照片内归一化几何", sourceIds: ["faceApi"] },
    eye_aspect_right: { formulaText: "右眼垂直开合 ÷ 右眼宽", referenceType: "照片内归一化几何", sourceIds: ["faceApi"] },
    canthal_tilt: { formulaText: "双眼内外眼角连线的平均角度", referenceType: "造型方向参考", sourceIds: ["faceApi", "photoStandard"] },
    brow_tilt: { formulaText: "左右眉首尾连线的平均角度", referenceType: "造型方向参考", sourceIds: ["faceApi"] },
    brow_eye_distance: { formulaText: "眉眼中心距离 ÷ 平均眼宽", referenceType: "照片内归一化几何", sourceIds: ["faceApi"] },
    eye_size_difference: { formulaText: "左右眼宽差 ÷ 平均眼宽", referenceType: "拍摄敏感指标", sourceIds: ["photoStandard"] },
    nose_face_width: { formulaText: "鼻翼宽度 ÷ 面宽", referenceType: "照片内归一化几何", sourceIds: ["interEthnicReview", "faceApi"] },
    nose_eye_spacing: { formulaText: "鼻翼宽度 ÷ 内眼角距离", referenceType: "照片内归一化几何", sourceIds: ["faceApi"] },
    mouth_face_width: { formulaText: "嘴角宽度 ÷ 面宽", referenceType: "照片内归一化几何", sourceIds: ["interEthnicReview", "faceApi"] },
    upper_lower_lip: { formulaText: "上唇可见高度 ÷ 下唇可见高度", referenceType: "表情敏感指标", sourceIds: ["faceApi"] },
    mouth_tilt: { formulaText: "两侧嘴角连线角度", referenceType: "表情与拍摄敏感指标", sourceIds: ["photoStandard"] },
    jaw_curve: { formulaText: "下颌折线路径 ÷ 两侧下颌直线距离", referenceType: "轮廓曲线代理", sourceIds: ["faceApi"] },
    symmetry: { formulaText: "成对关键点镜像残差的平均值", referenceType: "拍摄敏感的二维代理", sourceIds: ["photoStandard", "faceApi"] },
    court_upper: { formulaText: "估算发际线至鼻根 ÷ 三庭总长", referenceType: "低可信度估算", sourceIds: ["interEthnicReview", "southernChineseCanons"] },
    court_middle: { formulaText: "鼻根至鼻底 ÷ 三庭总长", referenceType: "古典三庭视觉参照", sourceIds: ["interEthnicReview", "southernChineseCanons"] },
    court_lower: { formulaText: "鼻底至下巴 ÷ 三庭总长", referenceType: "古典三庭视觉参照", sourceIds: ["interEthnicReview", "southernChineseCanons"] }
  },
  styleRules: {
    eye_concentrated: { evidenceType: "styling", advice: "眉头减淡，眼尾可适度向外延伸 2–3 毫米", avoid: "不要同时加重眉头与眼头", sourceIds: [] },
    eye_spacious: { evidenceType: "styling", advice: "眉头可自然前移，眼头增加少量亮度和线条", avoid: "避免继续拉长外眼线", sourceIds: [] },
    eye_reference: { evidenceType: "styling", advice: "保持眼线与眉形的自然长度，先用明暗测试重心", limitation: "属于造型经验，不代表优劣", sourceIds: [] },
    middle_long: { evidenceType: "styling", advice: "腮红横向轻扫，卧蚕适度提亮，眉毛避免过度高挑", avoid: "避免把鼻影拉得过长", sourceIds: [] },
    face_long: { evidenceType: "styling", advice: "用刘海、脸侧层次或横向腮红分段纵向视觉", avoid: "避免头顶和纵向线条同时过度拉高", sourceIds: [] },
    face_wide: { evidenceType: "styling", advice: "用锁骨、领口和脸侧纵向层次增加方向感", avoid: "避免两侧同时堆积厚重体积", sourceIds: [] },
    canthal_up: { evidenceType: "styling", advice: "眼线沿原生走向轻收尾，唇颊保持柔和", limitation: "眼角方向会受表情和拍摄角度影响", sourceIds: [] },
    canthal_down: { evidenceType: "styling", advice: "外眼角上方增加少量睫毛与阴影，不必强行上挑", limitation: "眼角方向会受表情和拍摄角度影响", sourceIds: [] },
    brow_direction: { evidenceType: "styling", advice: "顺着眉骨方向整理眉峰，先减少而非新增线条", limitation: "眉毛可塑性高，建议逐步试验", sourceIds: [] },
    nose_contour: { evidenceType: "styling", advice: "鼻影控制在眼窝至鼻翼的自然转折内，少量多次", avoid: "避免一条深色直线贯穿鼻梁", sourceIds: [] },
    lip_emphasis: { evidenceType: "styling", advice: "在眼妆较轻时用唇色建立一个清晰重点", avoid: "避免眼唇同时使用最高对比", sourceIds: [] },
    jaw_framing: { evidenceType: "styling", advice: "用脸侧碎发、耳饰和领口控制下半脸的线条密度", limitation: "轮廓建议取决于发量和实际侧面结构", sourceIds: [] },
    feature_light: { evidenceType: "styling", advice: "使用低对比、边缘柔和的颜色，保留皮肤留白", avoid: "避免每个五官同时加深轮廓", sourceIds: [] },
    feature_strong: { evidenceType: "styling", advice: "可承接更清晰的眉眼或唇部重点，但一次只选一个", avoid: "避免多个高对比重点互相竞争", sourceIds: [] }
  },
  careRules: {
    base: { evidenceType: "care", morning: ["按出油感受选择清水或温和清洁", "保湿", "广谱 SPF 30+ 防晒"], evening: ["温和清洁", "保湿"], sourceIds: ["aadBasics"] },
    sensitive: { evidenceType: "care", advice: "一次只新增一种产品，先做小范围试用；持续刺痛、红肿或皮疹时停止并咨询皮肤科医生", sourceIds: ["aadBasics"] }
  }
});

const metric = (id, value, unit, extra = {}) => {
  const knowledge = KNOWLEDGE_BASE.metrics[id] || {};
  return {
    id,
    value: round(value, extra.digits ?? 2),
    unit,
    evidenceType: "geometry",
    confidence: extra.confidence || "high",
    ...knowledge,
    ...extra
  };
};

function computeRegionalSymmetry(points, faceWidth, qualityLevel) {
  const midX = (points[27].x + points[8].x) / 2;
  const regions = {
    eyes: [[36, 45], [37, 44], [38, 43], [39, 42], [40, 47], [41, 46]],
    brows: [[17, 26], [18, 25], [19, 24], [20, 23], [21, 22]],
    mouth: [[48, 54], [49, 53], [50, 52], [59, 55], [58, 56]],
    jaw: [[0, 16], [2, 14], [4, 12], [6, 10]]
  };
  const regionValues = {};
  Object.entries(regions).forEach(([name, pairs]) => {
    regionValues[name] = pairs.reduce((sum, [left, right]) => {
      const horizontal = (points[left].x + points[right].x) - 2 * midX;
      const vertical = points[left].y - points[right].y;
      return sum + Math.hypot(horizontal, vertical) / faceWidth;
    }, 0) / pairs.length;
  });
  const average = Object.values(regionValues).reduce((sum, value) => sum + value, 0) / Object.keys(regionValues).length;
  return metric("symmetry", average * 100, "% residual", {
    label: "二维镜像残差",
    confidence: qualityLevel === "high" ? "medium" : "low",
    note: "该数值容易受拍摄角度、表情与光线影响，只用于检查照片内左右差异。",
    regions: Object.fromEntries(Object.entries(regionValues).map(([name, value]) => [name, round(value * 100, 1)]))
  });
}

function computeMeasurements(points, qualityLevel = "high", confidenceCap = null) {
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
  const leftEyeCenter = averagePoint(points, [36, 37, 38, 39, 40, 41]);
  const rightEyeCenter = averagePoint(points, [42, 43, 44, 45, 46, 47]);
  const leftBrowCenter = averagePoint(points, [17, 18, 19, 20, 21]);
  const rightBrowCenter = averagePoint(points, [22, 23, 24, 25, 26]);
  const jawPath = [0, 2, 4, 6, 8, 10, 12, 14, 16].reduce((sum, index, position, indexes) => position ? sum + distance(points[indexes[position - 1]], points[index]) : 0, 0);
  const eyeAspectLeft = safeDivide((distance(points[37], points[41]) + distance(points[38], points[40])) / 2, leftEyeWidth, 0);
  const eyeAspectRight = safeDivide((distance(points[43], points[47]) + distance(points[44], points[46])) / 2, rightEyeWidth, 0);
  const canthalTilt = (angleDegrees(points[36], points[39]) + angleDegrees(points[42], points[45])) / 2;
  const browTilt = (angleDegrees(points[17], points[21]) + angleDegrees(points[22], points[26])) / 2;
  const result = {
    faceWidth: round(faceWidth, 2),
    faceLengthWidth: metric("face_length_width", safeDivide(estimatedFaceLength, faceWidth, 0), "ratio", { label: "估算脸长宽比", referenceType: "产品启发式解释带" }),
    cheekFaceWidth: metric("cheek_face_width", safeDivide(distance(points[2], points[14]), faceWidth, 0), "ratio", { label: "颧区/面宽" }),
    jawFaceWidth: metric("jaw_face_width", safeDivide(distance(points[4], points[12]), faceWidth, 0), "ratio", { label: "下颌/面宽" }),
    chinFaceWidth: metric("chin_face_width", safeDivide(distance(points[6], points[10]), faceWidth, 0), "ratio", { label: "下巴/面宽" }),
    eyeSpacing: metric("eye_spacing", eyeSpacingValue, "eye_width", { label: "眼距/眼宽", band: eyeSpacingValue < .85 ? "concentrated" : eyeSpacingValue <= 1.15 ? "reference" : "spacious", referenceType: "古典五眼视觉参照" }),
    leftEyeSideSpace: metric("left_eye_side_space", safeDivide(Math.abs(points[36].x - points[0].x), averageEyeWidth, 0), "eye_width", { label: "左侧眼外留白", confidence: qualityLevel === "high" ? "medium" : "low" }),
    rightEyeSideSpace: metric("right_eye_side_space", safeDivide(Math.abs(points[16].x - points[45].x), averageEyeWidth, 0), "eye_width", { label: "右侧眼外留白", confidence: qualityLevel === "high" ? "medium" : "low" }),
    eyeAspectLeft: metric("eye_aspect_left", eyeAspectLeft, "ratio", { label: "左眼开合" }),
    eyeAspectRight: metric("eye_aspect_right", eyeAspectRight, "ratio", { label: "右眼开合" }),
    canthalTilt: metric("canthal_tilt", canthalTilt, "°", { label: "眼角方向", confidence: qualityLevel }),
    browTilt: metric("brow_tilt", browTilt, "°", { label: "眉毛方向", confidence: qualityLevel }),
    browEyeDistance: metric("brow_eye_distance", safeDivide((distance(leftBrowCenter, leftEyeCenter) + distance(rightBrowCenter, rightEyeCenter)) / 2, averageEyeWidth, 0), "eye_width", { label: "眉眼距离" }),
    eyeSizeDifference: metric("eye_size_difference", safeDivide(Math.abs(leftEyeWidth - rightEyeWidth), averageEyeWidth, 0), "ratio", { label: "左右眼宽差", confidence: qualityLevel === "high" ? "medium" : "low" }),
    noseFaceWidth: metric("nose_face_width", safeDivide(noseWidth, faceWidth, 0), "ratio", { label: "鼻翼/面宽" }),
    noseEyeSpacing: metric("nose_eye_spacing", safeDivide(noseWidth, innerEyeDistance, 0), "ratio", { label: "鼻翼/内眼距" }),
    mouthFaceWidth: metric("mouth_face_width", safeDivide(mouthWidth, faceWidth, 0), "ratio", { label: "嘴宽/面宽" }),
    lipRatio: metric("upper_lower_lip", safeDivide(distance(points[51], points[62]), distance(points[66], points[57]), 0), "ratio", { label: "上下唇高度代理", confidence: "low" }),
    mouthTilt: metric("mouth_tilt", angleDegrees(points[48], points[54]), "°", { label: "嘴角连线", confidence: "low" }),
    jawCurve: metric("jaw_curve", safeDivide(jawPath, distance(points[0], points[16]), 0), "ratio", { label: "下颌曲线代理" }),
    visualWeight: {
      eyes: round(safeDivide(averageEyeWidth * 2, faceWidth, 0), 2),
      brows: round(safeDivide((distance(points[17], points[21]) + distance(points[22], points[26])) / 2, faceWidth, 0), 2),
      nose: round(safeDivide(noseWidth, faceWidth, 0), 2),
      lips: round(safeDivide(mouthWidth, faceWidth, 0), 2)
    },
    courts: ["upper", "middle", "lower"].map((id, index) => metric(`court_${id}`, roundedCourts[index], "%", { label: ["上庭", "中庭", "下庭"][index], confidence: index === 0 ? "low" : qualityLevel, referenceType: index === 0 ? "低可信度估算" : "古典三庭视觉参照" })),
    symmetry: computeRegionalSymmetry(points, faceWidth, qualityLevel)
  };
  return confidenceCap ? capMeasurementConfidence(result, confidenceCap) : result;
}

function rankFaceShapes(measurements) {
  const ratio = measurements.faceLengthWidth.value;
  const jaw = measurements.jawFaceWidth.value;
  const chin = measurements.chinFaceWidth.value;
  const cheek = measurements.cheekFaceWidth.value;
  const curve = measurements.jawCurve.value;
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

function deriveReadableProfile(measurements, quality = { level: "high" }) {
  const ranked = rankFaceShapes(measurements);
  const primary = ranked[0][0];
  const secondary = ranked[1][1] >= ranked[0][1] * .72 ? ranked[1][0] : null;
  const courtValues = measurements.courts.map((item) => item.value);
  const courtLabels = measurements.courts.map((item) => item.value > 36 ? "相对突出" : item.value < 30 ? "相对收敛" : "接近三等分参照");
  const eyeTerm = measurements.eyeSpacing.band === "spacious" ? "眼距相对舒展" : measurements.eyeSpacing.band === "concentrated" ? "眼距相对集中" : "接近一眼宽参照";
  const weightScore = (measurements.visualWeight.eyes + measurements.visualWeight.brows + measurements.visualWeight.nose + measurements.visualWeight.lips) / 4;
  const featureWeight = weightScore < .2 ? "五官量感偏轻" : weightScore > .28 ? "五官量感偏强" : "五官量感适中";
  const lineTendency = measurements.jawCurve.value > 1.22 ? "曲线感较明显" : measurements.jawCurve.value < 1.14 ? "直线感较明显" : "直曲混合";
  const shapeExplanations = {
    "长脸": "纵向比例相对突出，脸侧线条更容易形成向下延伸感。",
    "圆脸": "长宽较接近，下颌路径呈现较明显的柔和曲线。",
    "方脸": "下颌宽度存在感较明显，轮廓方向相对清晰。",
    "菱形脸": "颧区相对突出，下颌与下巴的横向宽度较收。",
    "心形脸": "颧区相对舒展，下巴横向宽度较收。",
    "椭圆脸": "长宽处于中间带，颧区与下颌宽度过渡较连续。"
  };
  const strengths = [
    measurements.eyeSpacing.band === "spacious" ? "眼部留白舒展，适合清晰但不过度外扩的眉眼重点。" : "眉眼聚焦感清楚，适合把视觉重点放在眼尾与睫毛。",
    lineTendency.includes("曲线") ? "轮廓过渡柔和，容易承接自然层次和柔和边缘。" : "轮廓方向清晰，容易承接利落线条和明确配饰。"
  ].slice(0, 2);
  const attention = [measurements.eyeSpacing.band === "spacious" ? "眉头和眼尾若同时外扩，眼部横向留白会进一步增加。" : "眉头若同时加深并向内延伸，眉眼重心会更集中。"];
  return {
    faceShape: { primary, secondary, explanation: shapeExplanations[primary], confidence: quality.level === "low" || quality.overridden ? "low" : "medium", metricIds: [measurements.faceLengthWidth.id, measurements.cheekFaceWidth.id, measurements.jawFaceWidth.id, measurements.chinFaceWidth.id, measurements.jawCurve.id] },
    threeCourts: { values: courtValues, labels: courtLabels, summary: `上庭 ${courtValues[0]}%、中庭 ${courtValues[1]}%、下庭 ${courtValues[2]}%；上庭为估算，三庭仅作视觉参照。`, metricIds: measurements.courts.map((item) => item.id), confidence: "low" },
    fiveEyes: { term: eyeTerm, summary: `眼距约 ${measurements.eyeSpacing.value} 个眼宽，左侧可见留白约 ${measurements.leftEyeSideSpace.value} 个眼宽，右侧约 ${measurements.rightEyeSideSpace.value} 个眼宽；五眼为古典视觉参照，不代表审美等级。`, metricIds: [measurements.eyeSpacing.id, measurements.leftEyeSideSpace.id, measurements.rightEyeSideSpace.id], confidence: quality.level === "high" ? "medium" : "low" },
    featureWeight: { term: featureWeight, metricIds: [measurements.eyeAspectLeft.id, measurements.browEyeDistance.id, measurements.noseFaceWidth.id, measurements.mouthFaceWidth.id], confidence: quality.level === "high" ? "medium" : "low" },
    lineTendency: { term: lineTendency, metricIds: [measurements.jawCurve.id], confidence: measurements.jawCurve.confidence },
    strengths,
    attention,
    memorySentence: `${secondary ? `${primary}偏${secondary}` : `${primary}倾向`}，${eyeTerm}，${courtLabels[1] === "接近三等分参照" ? "中庭接近三等分参照" : `中庭${courtLabels[1]}`}。`
  };
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const finiteValue = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const scaleIdentityValue = (value, min, max) => round(clamp((finiteValue(value) - min) / (max - min), 0, 1) * 100, 0);

function buildIdentityPresentation(measurements, readableProfile, generatedAt = new Date()) {
  const requiredMetrics = ["faceLengthWidth", "cheekFaceWidth", "jawFaceWidth", "symmetry", "eyeSpacing"];
  requiredMetrics.forEach((id) => {
    if (!Number.isFinite(measurements?.[id]?.value)) throw new TypeError(`Identity presentation requires finite measurement: ${id}.value`);
  });
  ["eyes", "brows", "nose", "lips"].forEach((id) => {
    if (!Number.isFinite(measurements?.visualWeight?.[id])) throw new TypeError(`Identity presentation requires finite measurement: visualWeight.${id}`);
  });
  if (!Array.isArray(measurements?.courts) || measurements.courts.length < 3) throw new TypeError("Identity presentation requires three finite court measurements");
  measurements.courts.slice(0, 3).forEach((item, index) => {
    if (!Number.isFinite(item?.value)) throw new TypeError(`Identity presentation requires finite measurement: courts[${index}].value`);
  });
  const courts = measurements.courts.slice(0, 3).map((item) => item.value);
  const courtDrift = Math.max(...courts.map((value) => Math.abs(value - 33.33)));
  const visualWeight = ["eyes", "brows", "nose", "lips"].reduce((sum, id) => sum + measurements.visualWeight[id], 0) / 4;
  const metricValue = (id) => measurements[id].value;
  const axes = [
    { id: "lengthWidth", label: "轮廓纵横差异", value: scaleIdentityValue(Math.abs(metricValue("faceLengthWidth") - 1.04), 0, .24) },
    { id: "cheekJaw", label: "颧颌宽度差异", value: scaleIdentityValue(Math.abs(metricValue("cheekFaceWidth") - metricValue("jawFaceWidth")), 0, .22) },
    { id: "features", label: "五官量感差异", value: scaleIdentityValue(Math.abs(visualWeight - .24), 0, .10) },
    { id: "courts", label: "三庭分布差异", value: scaleIdentityValue(courtDrift, 0, 10) },
    { id: "mirror", label: "左右对照差异", value: scaleIdentityValue(metricValue("symmetry"), 0, 8) },
    { id: "eyeSpace", label: "眼距参照差异", value: scaleIdentityValue(Math.abs(metricValue("eyeSpacing") - 1), 0, .45) }
  ];
  const pronounced = axes.filter((axis) => axis.value >= 68).length;
  const type = pronounced >= 3 ? "UNIQUE" : pronounced >= 1 ? "SIGNATURE" : "CLASSIC";
  const parsedDate = generatedAt instanceof Date ? generatedAt.getTime() : new Date(generatedAt).getTime();
  const minuteIndex = Number.isFinite(parsedDate) ? Math.abs(Math.trunc(parsedDate / 60000)) % 10000 : 0;
  const serial = `NO.${String(Math.trunc(minuteIndex)).padStart(4, "0")}`;
  const line = readableProfile?.lineTendency?.term || "直曲混合";
  const style = line.includes("直线") ? "冷感叙事型" : line.includes("曲线") ? "柔和氛围型" : "清晰平衡型";
  return {
    serial,
    type,
    title: `${readableProfile?.faceShape?.primary || "轮廓"} · ${style}`,
    poem: line.includes("直线") ? "你的轮廓方向清晰，像一帧被认真收藏的旧电影。" : "你的线条留有柔和余韵，适合让细节慢慢被看见。",
    portraitTags: [readableProfile?.threeCourts?.labels?.[1], readableProfile?.fiveEyes?.term, readableProfile?.featureWeight?.term].filter(Boolean).slice(0, 3),
    axes
  };
}

function conclusion({ title, value, explanation, action, evidenceType, metricIds = [], confidence = "high" }) {
  if (!evidenceType || (evidenceType !== "care" && metricIds.length === 0)) throw new Error("Untraceable conclusion");
  return { title, value, explanation, action, evidenceType, metricIds, confidence };
}

function composeReport({ quality, measurements, profile }) {
  const readableProfile = deriveReadableProfile(measurements, quality);
  const ratio = measurements.faceLengthWidth;
  const eye = measurements.eyeSpacing;
  const middle = measurements.courts[1];
  const ratioBand = ratio.value > 1.12 ? "纵向相对突出" : ratio.value < .95 ? "横向相对突出" : "长宽接近中间带";
  const eyeLabel = eye.band === "spacious" ? "眼距相对舒展" : eye.band === "concentrated" ? "眼距相对集中" : "接近一眼宽参照";
  const middleLabel = middle.value > 36 ? "中庭占比相对高" : middle.value < 30 ? "中庭占比相对低" : "中庭接近三等分参照";
  const traitMap = {
    face: conclusion({ title: "整体轮廓", value: `${ratio.value.toFixed(2)} : 1`, explanation: `${ratioBand}。脸长包含发际线估算，因此置信度低于面宽。`, action: "用发型和领口做一次横向/纵向线条对照。", evidenceType: "geometry", metricIds: [ratio.id], confidence: ratio.confidence }),
    eye: conclusion({ title: "眼部间距", value: `${eye.value.toFixed(2)} 个眼宽`, explanation: `${eyeLabel}；一眼宽只作为古典视觉参照，不是理想标准。`, action: eye.band === "spacious" ? "眉头可自然前移，先试不外拉的眼线。" : eye.band === "concentrated" ? "眉头减淡，眼尾可轻微外延。" : "保持自然长度，比较柔和与清晰两种边缘。", evidenceType: "geometry", metricIds: [eye.id], confidence: eye.confidence }),
    middle: conclusion({ title: "三庭视觉参照", value: `${measurements.courts.map((item) => item.value).join(" / ")}%`, explanation: `${middleLabel}；上庭来自发际线估算，整组仅用于构图参考。`, action: "在同一光线下比较不同眉形与腮红位置。", evidenceType: "geometry", metricIds: measurements.courts.map((item) => item.id), confidence: "low" })
  };
  const priority = profile?.primaryGoal === "makeup" ? ["eye", "middle", "face"] : profile?.primaryGoal === "hair" ? ["face", "middle", "eye"] : ["face", "eye", "middle"];
  const coreTraits = priority.map((id) => traitMap[id]);
  const eyeRuleId = eye.band === "spacious" ? "eye_spacious" : eye.band === "concentrated" ? "eye_concentrated" : "eye_reference";
  const eyeRule = KNOWLEDGE_BASE.styleRules[eyeRuleId];
  const faceRule = KNOWLEDGE_BASE.styleRules[ratio.value > 1.06 ? "face_long" : "face_wide"];
  const jawRule = KNOWLEDGE_BASE.styleRules.jaw_framing;
  const timeNote = profile?.dailyMinutes <= 5 ? "控制为一步变化，约 2 分钟完成。" : "可分别拍照比较两种强度。";
  const hairNote = profile?.hairMaintenance === "minimal" ? "优先选择自然落位、无需每日夹卷的脸侧层次。" : faceRule.advice;
  const styleAdvice = [
    conclusion({ title: "妆容", value: eyeLabel, explanation: `${eyeRule.advice}。${timeNote}`, action: eyeRule.avoid || eyeRule.limitation, evidenceType: "styling", metricIds: [eye.id], confidence: "medium" }),
    conclusion({ title: "发型", value: ratioBand, explanation: hairNote, action: faceRule.avoid || faceRule.limitation, evidenceType: "styling", metricIds: [ratio.id], confidence: "medium" }),
    conclusion({ title: "穿搭与配饰", value: `下颌曲线 ${measurements.jawCurve.value.toFixed(2)}`, explanation: jawRule.advice, action: jawRule.limitation, evidenceType: "styling", metricIds: [measurements.jawCurve.id], confidence: "medium" })
  ];
  const dataGroups = [
    { id: "overall", title: "整体比例", items: [measurements.faceLengthWidth, measurements.cheekFaceWidth, measurements.jawFaceWidth, measurements.chinFaceWidth, ...measurements.courts] },
    { id: "eye_brow", title: "眼部与眉部", items: [measurements.eyeSpacing, measurements.leftEyeSideSpace, measurements.rightEyeSideSpace, measurements.eyeAspectLeft, measurements.eyeAspectRight, measurements.canthalTilt, measurements.browTilt, measurements.browEyeDistance, measurements.eyeSizeDifference] },
    { id: "nose_lip", title: "鼻部与唇部", items: [measurements.noseFaceWidth, measurements.noseEyeSpacing, measurements.mouthFaceWidth, measurements.lipRatio, measurements.mouthTilt] },
    { id: "jaw_symmetry", title: "下颌与左右差异", items: [measurements.jawCurve, measurements.symmetry] }
  ];
  const skinLabels = { dry: "偏干肤感", normal: "较舒适肤感", combination: "混合肤感", oily: "偏油肤感" };
  const sensitivityLabels = { sensitive: "较易反应", possible: "偶有反应", low: "较少反应" };
  const carePlan = profile?.complete ? {
    tendency: `${skinLabels[profile.skinTendency]} · ${sensitivityLabels[profile.sensitivityTendency]}`,
    morning: KNOWLEDGE_BASE.careRules.base.morning,
    evening: KNOWLEDGE_BASE.careRules.base.evening,
    boundary: profile.sensitivityTendency === "sensitive" || profile.sensitivityTendency === "possible" ? KNOWLEDGE_BASE.careRules.sensitive.advice : "若持续出现刺痛、红肿或皮疹，停止新增产品并咨询皮肤科医生。",
    evidenceType: "care",
    sourceIds: ["aadBasics"]
  } : null;
  const goalLabels = { skin: "稳定基础护理", makeup: "调整一个妆容变量", hair: "调整一个发型变量", overall: "调整一个造型变量" };
  const styleAction = profile?.primaryGoal === "hair" ? hairNote : eyeRule.advice;
  const styleKeyword = profile?.primaryGoal === "hair" ? `${readableProfile.faceShape.primary} 低维护 发型 对照` : `${readableProfile.fiveEyes.term} 眉形 眼线 对照`;
  const actionCards = profile?.complete ? [
    {
      id: "style-focus",
      title: goalLabels[profile.primaryGoal] || goalLabels.overall,
      reason: `与你的“${readableProfile.faceShape.primary}倾向、${readableProfile.fiveEyes.term}”观察直接相关，先只比较一个变量。`,
      action: styleAction,
      duration: profile.dailyMinutes <= 5 ? "每天约 2–5 分钟" : "每次约 10–15 分钟",
      cost: profile.monthlyBudget === "basic" ? "优先使用现有物品" : "无需立即购买新品",
      successSignal: "你能清楚说出哪一种更协调、更容易执行。",
      stopRule: "如果连续三次都觉得步骤负担大，就降低强度或换卡。",
      searchKeyword: styleKeyword
    },
    {
      id: "foundation",
      title: "先稳定基础状态",
      reason: `你的自评为“${skinLabels[profile.skinTendency]} · ${sensitivityLabels[profile.sensitivityTendency]}”，先减少变量更容易观察。`,
      action: "连续 7 天只稳定清洁、保湿和白天广谱 SPF 30+ 防晒，不同时新增多件产品。",
      duration: "早晚各约 3 分钟",
      cost: "不要求新增预算",
      successSignal: "能够稳定执行，并知道哪一步让自己更舒适。",
      stopRule: "出现持续刺痛、红肿或皮疹时停止新增产品并咨询皮肤科医生。",
      searchKeyword: "科学护肤 基础三件套 敏感肌 精简"
    },
    {
      id: "photo-review",
      title: "做一次同条件复盘",
      reason: "单次照片容易受角度和光线影响，同条件记录比追求某个数字更可靠。",
      action: "今天保存一张基线照，第 7 天和第 30 天在相同距离、光线和表情下复拍，只比较舒适度与执行难度。",
      duration: "每次约 3 分钟",
      cost: "零成本",
      successSignal: "三张照片条件接近，能看出所选动作是否值得保留。",
      stopRule: "如果拍摄条件差异明显，不做前后结论，只重新建立基线。",
      searchKeyword: "妆前妆后 同光线 对比记录 方法"
    }
  ] : [{
    id: "geometry-compare",
    title: "先做一次几何对照",
    reason: "问卷信息不完整，先从照片内可观察的造型变量开始。",
    action: eyeRule.advice,
    duration: "约 5 分钟",
    cost: "零成本",
    successSignal: "能分辨两种方案带来的视觉差异。",
    stopRule: "如果照片角度不同，不比较结果。",
    searchKeyword: "眉形 眼线 同角度 对照"
  }];
  const sourceIds = new Set(["southernChineseCanons", "interEthnicReview", "faceApi", "photoStandard"]);
  if (carePlan) sourceIds.add("aadBasics");
  const sources = Array.from(sourceIds, (id) => ({ id, ...KNOWLEDGE_BASE.sources[id] }));
  return {
    quality,
    readableProfile,
    coreTraits,
    dataGroups,
    styleAdvice,
    carePlan,
    actionCards,
    sources,
    limitations: [
      "结果依赖单张照片的角度、镜头距离、光线和表情。",
      "上庭使用关键点外推估算，置信度较低。",
      "脸型倾向与术语阈值属于产品启发式解释带，不是普适分类标准。",
      "本工具只做二维几何与通用护理整理，不替代专业诊疗或个体审美判断。"
    ]
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
  createChallengeHistoryEntry,
  inferQuestionnaire,
  computeMeasurements,
  deriveReadableProfile,
  buildIdentityPresentation,
  composeReport
};
