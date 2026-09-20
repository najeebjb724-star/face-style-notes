const { createHash, randomBytes, randomUUID, timingSafeEqual } = require("node:crypto");
const { assertOwnedRecord } = require("../../../shared/cloud-guards");
const { createPhotoLifecycle: createPhotoCleanup, adaptCloudDatabase } = require("../../lifecycleJobs");
// Deterministic report functions are inlined for this self-contained CloudBase bundle.
function distance(a, b) { return Math.hypot(b.x - a.x, b.y - a.y); }
function safeDivide(numerator, denominator, fallback = 0) { return Number.isFinite(numerator) && Number.isFinite(denominator) && denominator !== 0 ? numerator / denominator : fallback; }
function averagePoint(points, indexes) { return { x: indexes.reduce((sum, index) => sum + points[index].x, 0) / indexes.length, y: indexes.reduce((sum, index) => sum + points[index].y, 0) / indexes.length }; }
function angleDegrees(a, b) { return Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI; }
function round(value, digits = 2) { if (!Number.isFinite(value)) return null; const factor = 10 ** digits; return Math.round((value + Math.sign(value || 1) * Number.EPSILON) * factor) / factor; }
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

const ANALYSIS_STATUSES = new Set(["queued", "processing", "complete", "failed"]);
const SOURCE_PHOTO_STATUSES = new Set(["pending", "deleting", "deleted", "manual_review"]);
const SAFE_ERRORS = new Set(["CONSENT_REQUIRED", "FORBIDDEN", "INVALID_ACTION", "INVALID_ARGUMENT", "UNAUTHENTICATED"]);
const CONSENT_TYPE = "face-analysis";
const CONSENT_VERSION = "2026-09-03";
const REPORT_RULES_VERSION = "web-face-style-core-2026-09-03";

function codedError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function requireObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw codedError("INVALID_ARGUMENT");
  return value;
}

function requireId(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw codedError("INVALID_ARGUMENT");
  return value;
}

function requireTempFileId(value) {
  if (typeof value !== "string" || value.length > 512 || !/^cloud:\/\/[A-Za-z0-9._~:/-]+\.jpg$/i.test(value)) {
    throw codedError("INVALID_ARGUMENT");
  }
  return value;
}

function sanitizeQuality(value) {
  const quality = requireObject(value);
  if (quality.accepted !== true) throw codedError("INVALID_ARGUMENT");
  const result = { accepted: true };
  if (["low", "medium", "high"].includes(quality.level)) result.level = quality.level;
  if (["local-basic", "landmark"].includes(quality.scope)) result.scope = quality.scope;
  if (quality.referenceOnly === true) result.referenceOnly = true;
  return result;
}

function isMissingDocument(error) {
  return error?.code === "DATABASE_DOCUMENT_NOT_EXIST" || error?.errCode === -502005 || /not[ _-]?exist/i.test(error?.message || "");
}

async function readOptional(reference) {
  try {
    const result = await reference.get();
    return result?.data || null;
  } catch (error) {
    if (isMissingDocument(error)) return null;
    throw error;
  }
}

function credentialDigest(credential) {
  return createHash("sha256").update(credential).digest("hex");
}

function validateDownloadDescriptor(value) {
  if (!value || typeof value.url !== "string" || !/^https:\/\//.test(value.url)
    || typeof value.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.sha256)) {
    throw codedError("INVALID_CONFIGURATION");
  }
  return { url: value.url, sha256: value.sha256 };
}

function validateAnalysisResult(result, jobId) {
  if (!result || result.jobId !== jobId || !Array.isArray(result.points) || result.points.length !== 68
    || !result.points.every(point => point && Number.isFinite(point.x) && Number.isFinite(point.y))
    || !Number.isFinite(result.detectionScore) || result.detectionScore < 0 || result.detectionScore > 1
    || !result.faceBox || !Number.isFinite(result.faceBox.x) || !Number.isFinite(result.faceBox.y)
    || !Number.isFinite(result.faceBox.width) || result.faceBox.width <= 0
    || !Number.isFinite(result.faceBox.height) || result.faceBox.height <= 0
    || !result.imageSize || !Number.isInteger(result.imageSize.width) || result.imageSize.width <= 0
    || !Number.isInteger(result.imageSize.height) || result.imageSize.height <= 0
    || typeof result.modelVersion !== "string" || !result.modelVersion) throw codedError("INVALID_RESULT");
  return result;
}

function assertLease(job, leaseId, leaseToken) {
  if (!job || typeof leaseId !== "string" || job.leaseId !== leaseId || typeof leaseToken !== "string"
    || typeof job.leaseHash !== "string") throw codedError("LEASE_INVALID");
  const expected = Buffer.from(job.leaseHash, "hex");
  const actual = Buffer.from(credentialDigest(leaseToken), "hex");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw codedError("LEASE_INVALID");
}

function stableJobId(openid, clientRequestId) {
  return `job-${createHash("sha256").update(JSON.stringify([openid, clientRequestId])).digest("hex")}`;
}

function stableReservationId(openid, uploadRequestId) {
  return `reservation-${createHash("sha256").update(JSON.stringify([openid, uploadRequestId])).digest("hex")}`;
}

function deadlineMillis(value) {
  const parsed = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : NaN;
}

function createClientSafeMain(handle) {
  return async function main(event, context) {
    try {
      return await handle(event, context);
    } catch (error) {
      if (SAFE_ERRORS.has(error?.code) && error.message === error.code) {
        return { error: { code: error.code, message: error.message } };
      }
      throw error;
    }
  };
}

function minimalStatus(job) {
  if (!ANALYSIS_STATUSES.has(job?.status)) throw codedError("INVALID_STATUS");
  const result = { status: job.status };
  if (job.status === "complete" && typeof job.reportId === "string") result.reportId = job.reportId;
  if (job.status === "failed") result.error = "ANALYSIS_FAILED";
  return result;
}

function cleanupTransition(job) {
  const changes = {};
  if (job.status === "queued" || job.status === "processing") changes.status = "failed";
  if (job.sourcePhotoStatus === "pending") changes.sourcePhotoStatus = "deleting";
  return transitionAnalysisJob(job, changes);
}

async function recoverAssignedJob({ transaction, database, uploadReference, upload, requestTime, expectedJobId }) {
  const jobId = requireId(upload.jobId);
  if (expectedJobId && jobId !== expectedJobId) throw codedError("INVALID_STATUS");
  const jobReference = transaction.collection("analysis_jobs").doc(jobId);
  const job = await readOptional(jobReference);
  assertOwnedRecord(job, upload._openid);
  let current = job;
  const deadline = deadlineMillis(upload.deleteBy);
  if (!Number.isFinite(deadline) || deadline <= requestTime.getTime()) {
    current = cleanupTransition(job);
    await uploadReference.update({ status: "deleting", abandonedAt: database.serverDate() });
    if (current.status !== job.status || current.sourcePhotoStatus !== job.sourcePhotoStatus) {
      const changes = { status: current.status, sourcePhotoStatus: current.sourcePhotoStatus };
      if (job.status !== current.status) changes.errorCode = "UPLOAD_EXPIRED";
      await jobReference.update(changes);
    }
  }
  return { jobId, ...minimalStatus(current) };
}

function transitionAnalysisJob(job, changes) {
  const next = { ...job, ...changes };
  if (!ANALYSIS_STATUSES.has(next.status) || !SOURCE_PHOTO_STATUSES.has(next.sourcePhotoStatus)) {
    throw codedError("INVALID_STATUS");
  }
  const statusTransitions = {
    queued: new Set(["queued", "processing", "failed"]),
    processing: new Set(["processing", "complete", "failed"]),
    complete: new Set(["complete"]),
    failed: new Set(["failed"])
  };
  const photoTransitions = {
    pending: new Set(["pending", "deleting", "deleted", "manual_review"]),
    deleting: new Set(["deleting", "deleted", "manual_review"]),
    deleted: new Set(["deleted"]),
    manual_review: new Set(["manual_review", "deleted"])
  };
  if (!statusTransitions[job.status]?.has(next.status) || !photoTransitions[job.sourcePhotoStatus]?.has(next.sourcePhotoStatus)) {
    throw codedError("INVALID_STATUS");
  }
  return next;
}

function createAnalysisApi({
  database,
  getWXContext,
  now = () => new Date(),
  createId = prefix => `${prefix}-${randomUUID()}`,
  createCredential = () => randomBytes(32).toString("base64url"),
  photoCleanup,
  dispatchAnalysis = async () => {}
}) {
  if (!database || typeof getWXContext !== "function") throw codedError("INVALID_CONFIGURATION");

  return async function handle(event = {}) {
    const openid = getWXContext()?.OPENID;
    if (!openid) throw codedError("UNAUTHENTICATED");
    const payload = event.payload === undefined ? {} : requireObject(event.payload);

    if (event.action === "recordConsent") {
      const acceptedAt = typeof payload.acceptedAt === "string" ? Date.parse(payload.acceptedAt) : NaN;
      const requestTime = now();
      if (payload.type !== CONSENT_TYPE || payload.version !== CONSENT_VERSION || !Number.isFinite(acceptedAt) || acceptedAt > requestTime.getTime() || payload.revokedAt) {
        throw codedError("INVALID_ARGUMENT");
      }
      const consentId = requireId(createId("consent"));
      await database.collection("consents").doc(consentId).set({
        _openid: openid,
        type: CONSENT_TYPE,
        version: CONSENT_VERSION,
        acceptedAt: new Date(acceptedAt).toISOString(),
        revokedAt: null,
        createdAt: database.serverDate()
      });
      return { consentId };
    }

    if (event.action === "reserveUpload") {
      const consentId = requireId(payload.consentId);
      const clientRequestId = requireId(payload.clientRequestId);
      const uploadRequestId = requireId(payload.uploadRequestId);
      const requestTime = now();
      const reservationId = stableReservationId(openid, uploadRequestId);
      const result = await database.runTransaction(async transaction => {
        const consent = await readOptional(transaction.collection("consents").doc(consentId));
        const acceptedAt = typeof consent?.acceptedAt === "string" ? Date.parse(consent.acceptedAt) : NaN;
        if (!consent || consent._openid !== openid || consent.type !== CONSENT_TYPE || consent.version !== CONSENT_VERSION
          || !Number.isFinite(acceptedAt) || acceptedAt > requestTime.getTime() || consent.revokedAt) throw codedError("CONSENT_REQUIRED");
        const reference = transaction.collection("analysis_uploads").doc(reservationId);
        const existing = await readOptional(reference);
        if (existing) {
          assertOwnedRecord(existing, openid);
          if (existing.consentId !== consentId || existing.clientRequestId !== clientRequestId
            || !["pending", "attached", "assigned"].includes(existing.status)) throw codedError("UPLOAD_REQUIRED");
          if (existing.status === "assigned") {
            const view = await recoverAssignedJob({ transaction, database, uploadReference: reference, upload: existing, requestTime });
            return { reservationId, cloudPath: existing.cloudPath, ...view };
          }
          const deadline = deadlineMillis(existing.deleteBy);
          if (!Number.isFinite(deadline) || deadline <= requestTime.getTime()) {
            await reference.update({ status: "deleting", abandonedAt: database.serverDate() });
            return { expired: true };
          }
          return { reservationId, cloudPath: existing.cloudPath };
        }
        const cloudPath = `analysis/${reservationId}/source.jpg`;
        await reference.set({
          _openid: openid, consentId, clientRequestId, uploadRequestId, cloudPath, status: "pending",
          deleteBy: new Date(requestTime.getTime() + 30 * 60 * 1000).toISOString(), createdAt: database.serverDate()
        });
        return { reservationId, cloudPath };
      });
      if (result.expired) { await photoCleanup?.deleteUploadPhoto(reservationId); throw codedError("UPLOAD_REQUIRED"); }
      if (result.jobId && ["complete", "failed"].includes(result.status)) await photoCleanup?.deleteAnalysisPhoto(result.jobId);
      return result;
    }

    if (event.action === "attachUpload") {
      const reservationId = requireId(payload.reservationId);
      const tempFileId = requireTempFileId(payload.tempFileId);
      const requestTime = now();
      const result = await database.runTransaction(async transaction => {
        const reference = transaction.collection("analysis_uploads").doc(reservationId);
        const upload = await readOptional(reference);
        assertOwnedRecord(upload, openid);
        const deadline = deadlineMillis(upload.deleteBy);
        if (!Number.isFinite(deadline) || deadline <= requestTime.getTime()) {
          if (upload.status !== "assigned") await reference.update({ status: "deleting", abandonedAt: database.serverDate() });
          return { expired: true };
        }
        if (upload.status === "attached" && upload.tempFileId === tempFileId) return { reservationId, status: "attached" };
        if (upload.status !== "pending" || !tempFileId.endsWith(`/${upload.cloudPath}`)) throw codedError("UPLOAD_REQUIRED");
        await reference.update({ tempFileId, status: "attached", attachedAt: database.serverDate() });
        return { reservationId, status: "attached" };
      });
      if (result.expired) { await photoCleanup?.deleteUploadPhoto(reservationId); throw codedError("UPLOAD_REQUIRED"); }
      return result;
    }

    if (event.action === "abandonUpload") {
      const reservationId = requireId(payload.reservationId);
      const result = await database.runTransaction(async transaction => {
        const reference = transaction.collection("analysis_uploads").doc(reservationId);
        const upload = await readOptional(reference);
        assertOwnedRecord(upload, openid);
        if (upload.status === "deleted") return { reservationId, status: "deleted" };
        if (upload.status === "deleting") return { reservationId, status: "deleting", ...(upload.jobId ? { jobId: upload.jobId } : {}) };
        if (upload.status === "assigned") {
          const jobReference = transaction.collection("analysis_jobs").doc(requireId(upload.jobId));
          const job = await readOptional(jobReference);
          assertOwnedRecord(job, openid);
          if (job.reservationId !== reservationId || job.tempFileId !== upload.tempFileId) throw codedError("INVALID_STATUS");
          const next = cleanupTransition(job);
          await jobReference.update({ status: next.status, sourcePhotoStatus: next.sourcePhotoStatus,
            ...(["queued", "processing"].includes(job.status) ? { errorCode: "CANCELLED" } : {}) });
          await reference.update({ status: "deleting", abandonedAt: database.serverDate() });
          return { reservationId, status: "deleting", jobId: upload.jobId };
        }
        if (!["pending", "attached"].includes(upload.status)) throw codedError("INVALID_STATUS");
        await reference.update({ status: "deleting", abandonedAt: database.serverDate() });
        return { reservationId, status: "deleting" };
      });
      if (result.jobId) await photoCleanup?.deleteAnalysisPhoto(result.jobId);
      else await photoCleanup?.deleteUploadPhoto(reservationId);
      return result;
    }

    if (event.action === "cancelAnalysis") {
      const jobId = requireId(payload.jobId);
      const result = await database.runTransaction(async transaction => {
        const reference = transaction.collection("analysis_jobs").doc(jobId);
        const job = await readOptional(reference);
        assertOwnedRecord(job, openid);
        const next = cleanupTransition(job);
        await reference.update({ status: next.status, sourcePhotoStatus: next.sourcePhotoStatus, errorCode: "CANCELLED" });
        return { jobId, ...minimalStatus(next) };
      });
      await photoCleanup?.deleteAnalysisPhoto(jobId);
      return result;
    }

    if (event.action === "createAnalysis") {
      const consentId = requireId(payload.consentId);
      const clientRequestId = requireId(payload.clientRequestId);
      const tempFileId = requireTempFileId(payload.tempFileId);
      const reservationId = requireId(payload.reservationId);
      const quality = sanitizeQuality(payload.quality);
      const requestTime = now();
      const jobId = stableJobId(openid, clientRequestId);

      const created = await database.runTransaction(async transaction => {
        const existing = await readOptional(transaction.collection("analysis_jobs").doc(jobId));
        if (existing) {
          assertOwnedRecord(existing, openid);
          const existingUploadReference = transaction.collection("analysis_uploads").doc(requireId(existing.reservationId));
          const existingUpload = await readOptional(existingUploadReference);
          assertOwnedRecord(existingUpload, openid);
          return { view: await recoverAssignedJob({
            transaction, database, uploadReference: existingUploadReference, upload: existingUpload, requestTime,
            expectedJobId: existing._id || jobId
          }) };
        }
        const consent = await readOptional(transaction.collection("consents").doc(consentId));
        const consentAcceptedAt = typeof consent?.acceptedAt === "string" ? Date.parse(consent.acceptedAt) : NaN;
        if (!consent || consent._openid !== openid || consent.type !== CONSENT_TYPE || consent.version !== CONSENT_VERSION
          || !Number.isFinite(consentAcceptedAt) || consentAcceptedAt > requestTime.getTime() || consent.revokedAt) {
          throw codedError("CONSENT_REQUIRED");
        }
        const uploadReference = transaction.collection("analysis_uploads").doc(reservationId);
        const upload = await readOptional(uploadReference);
        assertOwnedRecord(upload, openid);
        if (upload.status !== "attached" || upload.tempFileId !== tempFileId
          || upload.consentId !== consentId || upload.clientRequestId !== clientRequestId) throw codedError("UPLOAD_REQUIRED");
        const uploadDeadline = deadlineMillis(upload.deleteBy);
        if (!Number.isFinite(uploadDeadline) || uploadDeadline <= requestTime.getTime()) {
          await uploadReference.update({ status: "deleting", abandonedAt: database.serverDate() });
          return { expired: true };
        }
        const credential = createCredential();
        if (typeof credential !== "string" || credential.length < 16) throw codedError("INVALID_CONFIGURATION");
        const record = {
          _openid: openid,
          consentId,
          reservationId,
          clientRequestId,
          tempFileId,
          quality,
          status: "queued",
          sourcePhotoStatus: "pending",
          deleteBy: new Date(uploadDeadline).toISOString(),
          credentialHash: credentialDigest(credential),
          credentialPurpose: "face-analysis",
          credentialExpiresAt: new Date(Math.min(requestTime.getTime() + 5 * 60 * 1000, uploadDeadline)).toISOString(),
          credentialUsedAt: null,
          createdAt: database.serverDate()
        };
        await transaction.collection("analysis_jobs").doc(jobId).set(record);
        await transaction.collection("analysis_uploads").doc(reservationId).update({ status: "assigned", jobId });
        return {
          view: { jobId, status: "queued" },
          dispatch: { jobId, reservationId, tempFileId, credential, credentialExpiresAt: record.credentialExpiresAt }
        };
      });
      if (created.expired) { await photoCleanup?.deleteUploadPhoto(reservationId); throw codedError("UPLOAD_REQUIRED"); }
      if (created.dispatch) {
        try {
          await dispatchAnalysis(created.dispatch);
        } catch (_) {
          created.view = await database.runTransaction(async transaction => {
            const jobReference = transaction.collection("analysis_jobs").doc(created.view.jobId);
            const uploadReference = transaction.collection("analysis_uploads").doc(created.dispatch.reservationId);
            const job = await readOptional(jobReference);
            const upload = await readOptional(uploadReference);
            if (!job || !upload || job._openid !== openid || upload._openid !== openid) throw codedError("FORBIDDEN");
            if (job.status === "queued" && !job.credentialUsedAt && upload.status === "assigned"
              && job.reservationId === created.dispatch.reservationId && upload.jobId === created.view.jobId
              && upload.tempFileId === job.tempFileId) {
              const next = transitionAnalysisJob(job, { status: "failed", sourcePhotoStatus: "deleting" });
              await jobReference.update({
                status: next.status, sourcePhotoStatus: next.sourcePhotoStatus, errorCode: "DISPATCH_FAILED"
              });
              await uploadReference.update({ status: "deleting", abandonedAt: database.serverDate() });
              return { jobId: created.view.jobId, ...minimalStatus(next) };
            }
            return { jobId: created.view.jobId, ...minimalStatus(job) };
          });
        }
      }
      if (["complete", "failed"].includes(created.view.status)) await photoCleanup?.deleteAnalysisPhoto(created.view.jobId);
      return created.view;
    }

    if (event.action === "getAnalysis") {
      const jobId = requireId(payload.jobId);
      let job = await readOptional(database.collection("analysis_jobs").doc(jobId));
      assertOwnedRecord(job, openid);
      if (job.status === "processing" && deadlineMillis(job.leaseExpiresAt) <= now().getTime()) {
        await recoverExpiredContainerLease({ database, jobId, now: now(), photoCleanup });
        job = await readOptional(database.collection("analysis_jobs").doc(jobId));
      }
      if (!ANALYSIS_STATUSES.has(job.status)) throw codedError("INVALID_STATUS");
      return minimalStatus(job);
    }

    if (event.action === "getReport") {
      const reportId = requireId(payload.reportId);
      const report = await readOptional(database.collection("reports").doc(reportId));
      assertOwnedRecord(report, openid);
      // Deliberately return the saved, owner-scoped reading only: no landmark data is retained.
      return report.report;
    }

    throw codedError("INVALID_ACTION");
  };
}

async function claimContainerJob({
  database,
  jobId,
  credential,
  now = new Date(),
  createDownloadDescriptor,
  createLeaseCredential = () => ({ leaseId: `lease-${randomUUID()}`, leaseToken: randomBytes(32).toString("base64url") })
}) {
  if (typeof createDownloadDescriptor !== "function") throw codedError("INVALID_CONFIGURATION");
  return database.runTransaction(async transaction => {
    const reference = transaction.collection("analysis_jobs").doc(requireId(jobId));
    const job = await readOptional(reference);
    if (!job || typeof credential !== "string" || typeof job.credentialHash !== "string") throw codedError("CREDENTIAL_INVALID");
    if (job.credentialUsedAt) throw codedError("CREDENTIAL_USED");
    if (job.status !== "queued" || job.sourcePhotoStatus !== "pending") throw codedError("CREDENTIAL_INVALID");
    if (job.credentialPurpose !== "face-analysis") throw codedError("CREDENTIAL_INVALID");
    const upload = await readOptional(transaction.collection("analysis_uploads").doc(requireId(job.reservationId)));
    if (!upload || upload._openid !== job._openid || upload.jobId !== jobId || upload.status !== "assigned"
      || upload.tempFileId !== job.tempFileId) throw codedError("CREDENTIAL_INVALID");
    const expiresAt = Date.parse(job.credentialExpiresAt);
    if (!Number.isFinite(expiresAt)) throw codedError("CREDENTIAL_INVALID");
    const deleteBy = deadlineMillis(job.deleteBy);
    if (!Number.isFinite(deleteBy)) throw codedError("CREDENTIAL_INVALID");
    if (expiresAt <= now.getTime() || deleteBy <= now.getTime()) throw codedError("CREDENTIAL_EXPIRED");
    const expected = Buffer.from(job.credentialHash, "hex");
    const actual = Buffer.from(credentialDigest(credential), "hex");
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw codedError("CREDENTIAL_INVALID");
    const lease = createLeaseCredential();
    if (!lease || typeof lease.leaseId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(lease.leaseId)
      || typeof lease.leaseToken !== "string" || lease.leaseToken.length < 16) throw codedError("INVALID_CONFIGURATION");
    const download = validateDownloadDescriptor(await createDownloadDescriptor(job.tempFileId, jobId));
    const leaseExpiresAt = new Date(Math.min(now.getTime() + 2 * 60 * 1000, deleteBy)).toISOString();
    const next = transitionAnalysisJob(job, { status: "processing" });
    await reference.update({
      status: next.status,
      sourcePhotoStatus: next.sourcePhotoStatus,
      credentialUsedAt: database.serverDate(),
      leaseId: lease.leaseId,
      leaseHash: credentialDigest(lease.leaseToken),
      leaseExpiresAt
    });
    return { jobId, leaseId: lease.leaseId, leaseToken: lease.leaseToken, download };
  });
}

async function settleContainerJob({ database, jobId, leaseId, leaseToken, now, status, errorCode, result, photoCleanup }) {
  const settled = await database.runTransaction(async transaction => {
    const reference = transaction.collection("analysis_jobs").doc(requireId(jobId));
    const job = await readOptional(reference);
    assertLease(job, leaseId, leaseToken);
    if (job.status === "complete" || job.status === "failed") return { jobId, status: job.status };
    if (job.status !== "processing" || deadlineMillis(job.leaseExpiresAt) <= now.getTime()) throw codedError("LEASE_EXPIRED");
    const uploadReference = transaction.collection("analysis_uploads").doc(requireId(job.reservationId));
    const upload = await readOptional(uploadReference);
    if (!upload || upload._openid !== job._openid || upload.jobId !== jobId || upload.status !== "assigned") throw codedError("LEASE_INVALID");
    const next = transitionAnalysisJob(job, { status, sourcePhotoStatus: "deleting" });
    const changes = { status: next.status, sourcePhotoStatus: next.sourcePhotoStatus, settledAt: database.serverDate() };
    if (status === "complete") {
      const analysisResult = validateAnalysisResult(result, jobId);
      const measurements = computeMeasurements(analysisResult.points, job.quality?.level || "high");
      const profile = inferQuestionnaire(job.questionnaire || {});
      const report = composeReport({ quality: job.quality, measurements, profile });
      const reportId = `report-${jobId}`;
      // A malformed-but-finite container payload must not expose landmarks or make
      // cleanup fail; identity axes use a neutral residual in that narrow case.
      const identityMeasurements = Number.isFinite(measurements.symmetry?.value)
        ? measurements
        : { ...measurements, symmetry: { ...measurements.symmetry, value: 0 } };
      const identity = buildIdentityPresentation(identityMeasurements, report.readableProfile, now);
      await transaction.collection("reports").doc(reportId).set({
        _openid: job._openid,
        jobId,
        modelVersion: analysisResult.modelVersion,
        reportRulesVersion: REPORT_RULES_VERSION,
        report: {
          ...report,
          identity,
          memorySentence: report.readableProfile.memorySentence,
          generatedAt: now.toISOString()
        },
        createdAt: database.serverDate()
      });
      changes.reportId = reportId;
    }
    else changes.errorCode = typeof errorCode === "string" && /^[A-Z0-9_]{1,64}$/.test(errorCode) ? errorCode : "ANALYSIS_FAILED";
    await reference.update(changes);
    await uploadReference.update({ status: "deleting", abandonedAt: database.serverDate() });
    return { jobId, status };
  });
  await photoCleanup?.deleteAnalysisPhoto(jobId);
  return settled;
}

function completeContainerJob({ database, jobId, leaseId, leaseToken, result, now = new Date(), photoCleanup }) {
  return settleContainerJob({ database, jobId, leaseId, leaseToken, result, now, status: "complete", photoCleanup });
}

function failContainerJob({ database, jobId, leaseId, leaseToken, errorCode, now = new Date(), photoCleanup }) {
  return settleContainerJob({ database, jobId, leaseId, leaseToken, errorCode, now, status: "failed", photoCleanup });
}

async function recoverExpiredContainerLease({ database, jobId, now = new Date(), photoCleanup }) {
  const result = await database.runTransaction(async transaction => {
    const reference = transaction.collection("analysis_jobs").doc(requireId(jobId));
    const job = await readOptional(reference);
    if (!job) throw codedError("INVALID_STATUS");
    if (job.status !== "processing" || deadlineMillis(job.leaseExpiresAt) > now.getTime()) return { jobId, status: job.status };
    const next = transitionAnalysisJob(job, { status: "failed", sourcePhotoStatus: "deleting" });
    await reference.update({ status: next.status, sourcePhotoStatus: next.sourcePhotoStatus, errorCode: "LEASE_EXPIRED" });
    const uploadReference = transaction.collection("analysis_uploads").doc(requireId(job.reservationId));
    const upload = await readOptional(uploadReference);
    if (upload && upload._openid === job._openid && upload.jobId === jobId && upload.status === "assigned") {
      await uploadReference.update({ status: "deleting", abandonedAt: database.serverDate() });
    }
    return { jobId, status: "failed" };
  });
  if (["complete", "failed"].includes(result.status)) await photoCleanup?.deleteAnalysisPhoto(jobId);
  return result;
}

function requireHttpsUrl(value, hosts) {
  let url;
  try { url = new URL(value); } catch { throw codedError("INVALID_CONFIGURATION"); }
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")
    || (hosts && !hosts.includes(url.hostname.toLowerCase()))) throw codedError("INVALID_CONFIGURATION");
  return url.toString();
}

function createProductionDownloadDescriptor({ cloud, allowedPhotoHosts, fetchImpl = globalThis.fetch }) {
  if (!cloud || !Array.isArray(allowedPhotoHosts) || !allowedPhotoHosts.length) throw codedError("INVALID_CONFIGURATION");
  const hosts = allowedPhotoHosts.map(host => String(host).toLowerCase());
  return async tempFileId => {
    requireTempFileId(tempFileId);
    const signed = await cloud.getTempFileURL({ fileList: [tempFileId] });
    const item = signed?.fileList?.[0];
    if (item?.fileID !== tempFileId || item.status !== 0) throw codedError("INVALID_CONFIGURATION");
    const url = requireHttpsUrl(item.tempFileURL, hosts);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetchImpl(url, { redirect: "manual", signal: controller.signal });
      if (response?.status !== 200 || !response.body?.getReader) {
        try { await response?.body?.cancel?.(); } catch {}
        throw codedError("PHOTO_DOWNLOAD_FAILED");
      }
      if (Number(response.headers.get("content-length")) > 8 * 1024 * 1024) {
        try { await response.body.cancel(); } catch {}
        throw codedError("PHOTO_TOO_LARGE");
      }
      const reader = response.body.getReader();
      const digest = createHash("sha256");
      let size = 0;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 8 * 1024 * 1024) { await reader.cancel(); throw codedError("PHOTO_TOO_LARGE"); }
        digest.update(value);
      }
      return { url, sha256: digest.digest("hex") };
    } catch (error) {
      if (controller.signal.aborted) throw codedError("PHOTO_DOWNLOAD_TIMEOUT");
      throw error;
    } finally { clearTimeout(timer); }
  };
}

function createProductionDispatch({ endpoint, fetchImpl = globalThis.fetch }) {
  const url = requireHttpsUrl(endpoint);
  return async ({ jobId, credential }) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 115_000);
    try {
      const response = await fetchImpl(url, {
        method: "POST", redirect: "manual", signal: controller.signal,
        headers: { authorization: `Bearer ${credential}`, "content-type": "application/json" },
        body: JSON.stringify({ jobId })
      });
      try { await response?.body?.cancel?.(); } catch {}
      if (response?.status !== 200) throw codedError("DISPATCH_FAILED");
    } finally { clearTimeout(timer); }
  };
}

function createContainerCoordinatorMain({ database, createDownloadDescriptor, now = () => new Date(), photoCleanup }) {
  if (!database || typeof createDownloadDescriptor !== "function") throw codedError("INVALID_CONFIGURATION");
  return async event => {
    const reply = (statusCode, value) => ({ statusCode, headers: { "content-type": "application/json" }, body: JSON.stringify(value) });
    if (event?.httpMethod !== "POST") return reply(405, { ok: false, code: "INVALID_METHOD" });
    const auth = event.headers?.authorization || event.headers?.Authorization;
    const match = typeof auth === "string" && auth.match(/^Bearer ([^\s]{16,512})$/);
    if (!match) return reply(401, { ok: false, code: "CREDENTIAL_INVALID" });
    let input;
    try { input = typeof event.body === "string" ? JSON.parse(event.body) : event.body; }
    catch { return reply(400, { ok: false, code: "INVALID_REQUEST" }); }
    if (!input || typeof input !== "object" || Array.isArray(input)) return reply(400, { ok: false, code: "INVALID_REQUEST" });
    try {
      const jobId = requireId(input.jobId);
      let result;
      if (input.action === "claim") result = await claimContainerJob({ database, jobId, credential: match[1], now: now(), createDownloadDescriptor });
      else if (input.action === "complete") result = await completeContainerJob({ database, jobId, leaseId: input.leaseId, leaseToken: match[1], result: input.result, now: now(), photoCleanup });
      else if (input.action === "fail") result = await failContainerJob({ database, jobId, leaseId: input.leaseId, leaseToken: match[1], errorCode: input.errorCode, now: now(), photoCleanup });
      else return reply(400, { ok: false, code: "INVALID_ACTION" });
      return reply(200, { ok: true, ...result });
    } catch (error) {
      if (["CREDENTIAL_INVALID", "CREDENTIAL_EXPIRED", "CREDENTIAL_USED", "LEASE_INVALID", "LEASE_EXPIRED"].includes(error?.code)) {
        return reply(401, { ok: false, code: "CREDENTIAL_INVALID" });
      }
      return reply(503, { ok: false, code: "CREDENTIAL_SERVICE_UNAVAILABLE" });
    }
  };
}

async function analysisApi(event, context) {
  const cloud = require("wx-server-sdk");
  cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
  const database = adaptCloudDatabase(cloud.database());
  const photoCleanup = createPhotoCleanup({ database, cloud, alert: event => console.error(JSON.stringify(event)) });
  if (event?.httpMethod) {
    const createDownloadDescriptor = createProductionDownloadDescriptor({ cloud,
      allowedPhotoHosts: String(process.env.PHOTO_URL_HOSTS || "").split(",").map(host => host.trim()).filter(Boolean) });
    return createContainerCoordinatorMain({ database, createDownloadDescriptor, photoCleanup })(event);
  }
  const dispatchAnalysis = delivery => createProductionDispatch({ endpoint: process.env.FACE_ANALYSIS_URL })(delivery);
  return createAnalysisApi({ database, getWXContext: () => cloud.getWXContext(), dispatchAnalysis, photoCleanup })(event, context);
}

module.exports = {
  main: createClientSafeMain(analysisApi),
  analysisApi,
  claimContainerJob,
  completeContainerJob,
  createAnalysisApi,
  createPhotoCleanup,
  createClientSafeMain,
  createContainerCoordinatorMain,
  createProductionDispatch,
  createProductionDownloadDescriptor,
  failContainerJob,
  recoverExpiredContainerLease,
  transitionAnalysisJob,
  computeMeasurements,
  inferQuestionnaire,
  composeReport,
  buildIdentityPresentation
};
