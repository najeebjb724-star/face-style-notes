// challengeApi-build-fingerprint:fe95fc59c3bbbdf4dd5b84c01b179ae0fbcc32176b81faa1c680b883b78ce03e:1b8a32ae11108ec8da00fe68edb50a4354cf92f5829ffed77abb3545308f7ad9
var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};

// ../../shared/cloud-guards.js
var require_cloud_guards = __commonJS({
  "../../shared/cloud-guards.js"(exports2, module2) {
    function assertOwnedRecord2(record, openid) {
      if (!openid || !record || record._openid !== openid) {
        const error = new Error("FORBIDDEN");
        error.code = "FORBIDDEN";
        throw error;
      }
    }
    module2.exports = { assertOwnedRecord: assertOwnedRecord2 };
  }
});

// ../../miniprogram/lib/face-style-core.js
var require_face_style_core = __commonJS({
  "../../miniprogram/lib/face-style-core.js"(exports2, module2) {
    var CHALLENGE_TEMPLATES = Object.freeze([
      { id: "body-lotion-30", kind: "habit", title: "30 \u5929\u8EAB\u4F53\u4E73\u4E60\u60EF", durationDays: 30, frequency: "daily", taskLabel: "\u4ECA\u5929\u6D82\u8EAB\u4F53\u4E73", photoDays: [1, 30], taskDays: [], tutorialSlots: 0 },
      { id: "sunscreen-21", kind: "habit", title: "21 \u5929\u6BCF\u65E5\u9632\u6652", durationDays: 21, frequency: "daily", taskLabel: "\u4ECA\u5929\u5B8C\u6210\u9632\u6652", photoDays: [1, 21], taskDays: [], tutorialSlots: 0 },
      { id: "clean-tools-4", kind: "habit", title: "4 \u5468\u6E05\u6D01\u5316\u5986\u5DE5\u5177", durationDays: 28, frequency: "weekly", taskLabel: "\u672C\u5468\u6E05\u6D01\u5316\u5986\u5DE5\u5177", photoDays: [], taskDays: [], tutorialSlots: 0 },
      { id: "makeup-3-in-7", kind: "training", title: "7 \u5929\u5B66\u4F1A 3 \u4E2A\u5B8C\u6574\u5986\u5BB9", durationDays: 7, frequency: "scheduled", taskLabel: "\u5B8C\u6210\u4ECA\u5929\u7684\u5986\u5BB9\u7EC3\u4E60", photoDays: [1, 7], taskDays: [1, 4, 7], tutorialSlots: 3 },
      { id: "eye-makeup-7", kind: "training", title: "7 \u5929\u773C\u5986\u7EC3\u4E60", durationDays: 7, frequency: "daily", taskLabel: "\u5B8C\u6210\u4ECA\u5929\u7684\u773C\u5986\u7EC3\u4E60", photoDays: [1, 7], taskDays: [], tutorialSlots: 3 },
      { id: "brow-makeup-7", kind: "training", title: "7 \u5929\u7709\u5986\u7EC3\u4E60", durationDays: 7, frequency: "daily", taskLabel: "\u5B8C\u6210\u4ECA\u5929\u7684\u7709\u5986\u7EC3\u4E60", photoDays: [1, 7], taskDays: [], tutorialSlots: 3 }
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
      push(detectionScore < 0.55, "low_detection", "\u9762\u90E8\u7EC6\u8282\u4E0D\u8DB3", "\u6362\u4E00\u5F20\u66F4\u6E05\u6670\u3001\u65E0\u906E\u6321\u7684\u7167\u7247");
      push(faceRatio < 0.28 || faceBox.width < 180, "face_too_small", "\u8138\u90E8\u5728\u753B\u9762\u4E2D\u592A\u5C0F", "\u9760\u8FD1\u4E00\u4E9B\uFF0C\u5E76\u4FDD\u7559\u5B8C\u6574\u5934\u90E8\u8F6E\u5ED3");
      push(faceRatio > 0.85, "face_too_large", "\u8138\u90E8\u79BB\u955C\u5934\u592A\u8FD1", "\u624B\u673A\u540E\u9000\u5230\u7EA6\u4E00\u81C2\u8DDD\u79BB");
      push(roll > 5, "head_roll", "\u5934\u90E8\u503E\u659C\u4F1A\u5F71\u54CD\u6BD4\u4F8B", "\u8BA9\u53CC\u773C\u8FDE\u7EBF\u4FDD\u6301\u6C34\u5E73");
      push(yawProxy > 0.12, "head_yaw", "\u8138\u90E8\u6CA1\u6709\u6B63\u5BF9\u955C\u5934", "\u9F3B\u5C16\u671D\u5411\u955C\u5934\uFF0C\u5DE6\u53F3\u8138\u988A\u9732\u51FA\u63A5\u8FD1");
      push(laplacianVariance < 45, "blurry", "\u7167\u7247\u53EF\u80FD\u6A21\u7CCA", "\u64E6\u51C0\u955C\u5934\u5E76\u4FDD\u6301\u624B\u673A\u7A33\u5B9A");
      push(meanBrightness < 55, "too_dark", "\u9762\u90E8\u5149\u7EBF\u592A\u6697", "\u9762\u5411\u7A97\u6237\u6216\u589E\u52A0\u5747\u5300\u5149\u7EBF");
      push(meanBrightness > 215, "too_bright", "\u9762\u90E8\u51FA\u73B0\u8FC7\u66DD", "\u907F\u5F00\u76F4\u5C04\u5F3A\u5149\u5E76\u964D\u4F4E\u66DD\u5149");
      const medium = roll > 3 || yawProxy > 0.08;
      return {
        accepted: !issues.some((item) => item.severity === "reject"),
        level: issues.length ? "low" : medium ? "medium" : "high",
        issues,
        metrics: {
          roll: round(roll, 1),
          yawProxy: round(yawProxy, 3),
          faceRatio: round(faceRatio, 3),
          laplacianVariance: round(laplacianVariance, 1),
          meanBrightness: round(meanBrightness, 1)
        }
      };
    }
    function overridePhotoQuality(quality) {
      return { ...quality, accepted: true, level: "low", overridden: true, referenceOnly: true };
    }
    function localCalendarDate(date = /* @__PURE__ */ new Date()) {
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    }
    function dateToUtcDayOrdinal(value) {
      const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
      if (!match) return NaN;
      const [, yearText, monthText, dayText] = match;
      const year = Number(yearText);
      const month = Number(monthText);
      const day = Number(dayText);
      const ordinal = Date.UTC(year, month - 1, day) / 864e5;
      const verified = new Date(ordinal * 864e5);
      return verified.getUTCFullYear() === year && verified.getUTCMonth() === month - 1 && verified.getUTCDate() === day ? ordinal : NaN;
    }
    function calendarDateFromOrdinal(ordinal) {
      if (!Number.isFinite(ordinal)) return "";
      const date = new Date(ordinal * 864e5);
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
    function createChallenge2(input, now = /* @__PURE__ */ new Date()) {
      const template = CHALLENGE_TEMPLATES.find((item) => item.id === input.templateId);
      const custom = input.templateId === "custom";
      if (!template && !custom) throw new Error("\u8BF7\u9009\u62E9\u4E00\u4E2A\u6311\u6218\u6A21\u677F");
      const durationDays = custom ? Math.min(90, Math.max(1, Number(input.durationDays) || 7)) : template.durationDays;
      const startedAt = input.startedAt || localCalendarDate(now);
      return {
        version: 2,
        id: `challenge-${now.getTime()}`,
        templateId: input.templateId,
        title: custom ? String(input.title || "\u6211\u7684\u53D8\u7F8E\u6311\u6218").trim().slice(0, 30) : template.title,
        kind: custom ? "custom" : template.kind,
        durationDays,
        frequency: custom ? input.frequency === "weekly" ? "weekly" : "daily" : template.frequency,
        reminderTime: /^([01]\d|2[0-3]):[0-5]\d$/.test(input.reminderTime) ? input.reminderTime : "21:30",
        startedAt,
        taskLabel: custom ? String(input.taskLabel || input.title || "\u5B8C\u6210\u4ECA\u5929\u7684\u6311\u6218").trim().slice(0, 40) : template.taskLabel,
        tutorials: (input.tutorials || []).map((item) => ({ label: String(item.label || "\u6559\u7A0B").slice(0, 30), url: validateTutorialUrl(item.url) })).filter((item) => item.url),
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
    function toggleChallengeCheckIn2(challenge, date = localCalendarDate()) {
      const day = getChallengeDay(challenge, date);
      if (!isChallengeOccurrenceDay(challenge, day)) return challenge;
      const checkIns = { ...challenge.checkIns };
      if (checkIns[date]) delete checkIns[date];
      else checkIns[date] = { completedAt: (/* @__PURE__ */ new Date()).toISOString() };
      return { ...challenge, checkIns };
    }
    function getChallengeProgress2(challenge, date = localCalendarDate()) {
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
    function createChallengeHistoryEntry2(challenge, progress, completedAt = localCalendarDate()) {
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
    module2.exports = {
      CHALLENGE_TEMPLATES,
      evaluatePhotoQuality,
      overridePhotoQuality,
      createChallenge: createChallenge2,
      toggleChallengeCheckIn: toggleChallengeCheckIn2,
      getChallengeProgress: getChallengeProgress2,
      getChallengeOccurrenceDays,
      createChallengeHistoryEntry: createChallengeHistoryEntry2
    };
  }
});

// src/index.js
var { createHash, randomUUID } = require("node:crypto");
var { assertOwnedRecord } = require_cloud_guards();
var {
  createChallenge,
  toggleChallengeCheckIn,
  getChallengeProgress,
  createChallengeHistoryEntry
} = require_face_style_core();
function codedError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}
var CLIENT_SAFE_ERROR_CODES = /* @__PURE__ */ new Set([
  "ACTIVE_CHALLENGE_EXISTS",
  "CHALLENGE_NOT_COMPLETE",
  "CHALLENGE_NOT_ACTIVE",
  "FORBIDDEN",
  "INVALID_ARGUMENT",
  "UNAUTHENTICATED"
]);
function createClientSafeMain(handle) {
  return async function clientSafeMain(event, context) {
    try {
      return await handle(event, context);
    } catch (error) {
      if (CLIENT_SAFE_ERROR_CODES.has(error?.code) && error.message === error.code) {
        return { error: { code: error.code, message: error.message } };
      }
      throw error;
    }
  };
}
function requireObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw codedError("INVALID_ARGUMENT");
  }
  return value;
}
function requireId(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw codedError("INVALID_ARGUMENT");
  }
  return value;
}
function requireDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw codedError("INVALID_ARGUMENT");
  }
  const parsed = /* @__PURE__ */ new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw codedError("INVALID_ARGUMENT");
  }
  return value;
}
function chinaBusinessDate(value) {
  return new Date(value.getTime() + 8 * 60 * 60 * 1e3).toISOString().slice(0, 10);
}
function checkinId(openid, challengeId, date) {
  return `checkin-${createHash("sha256").update(JSON.stringify([openid, challengeId, date])).digest("hex")}`;
}
function isMissingDocument(error) {
  return error?.code === "DATABASE_DOCUMENT_NOT_EXIST" || error?.errCode === -502005 || /not[ _-]?exist/i.test(error?.message || "");
}
async function readOptionalDocument(reference) {
  try {
    const result = await reference.get();
    return result?.data || null;
  } catch (error) {
    if (isMissingDocument(error)) return null;
    throw error;
  }
}
async function findOne(database, collectionName, filters) {
  const result = await database.collection(collectionName).where(filters).limit(1).get();
  return result.data[0] || null;
}
async function findCheckIns(database, openid, challengeId) {
  const result = await database.collection("checkins").where({
    _openid: openid,
    challengeId
  }).get();
  return result.data;
}
function hydrateCheckIns(challenge, records) {
  const checkIns = {};
  for (const record of records) {
    if (record.completed === true) {
      checkIns[record.date] = { completedAt: record.updatedAt || record.date };
    }
  }
  return { ...challenge, checkIns };
}
function createChallengeApi({ database, getWXContext, now = () => /* @__PURE__ */ new Date(), createChallengeId = randomUUID }) {
  if (!database || typeof getWXContext !== "function" || typeof createChallengeId !== "function") {
    throw codedError("INVALID_CONFIGURATION");
  }
  return async function handleChallenge(event = {}) {
    const { OPENID: openid } = getWXContext();
    if (!openid) throw codedError("UNAUTHENTICATED");
    const payload = event.payload === void 0 ? {} : requireObject(event.payload);
    const requestNow = now();
    const trustedDate = chinaBusinessDate(requestNow);
    if (event.action === "create") {
      const challenge = createChallenge({ ...payload, startedAt: trustedDate }, requestNow);
      challenge.id = requireId(createChallengeId());
      return database.runTransaction(async (transaction) => {
        const ownerReference = transaction.collection("challengeOwners").doc(openid);
        const [owner, existing] = await Promise.all([
          readOptionalDocument(ownerReference),
          findOne(transaction, "challenges", { _openid: openid, status: "active" })
        ]);
        if (owner?.activeChallengeId || existing) {
          throw codedError("ACTIVE_CHALLENGE_EXISTS");
        }
        const record = { ...challenge, _openid: openid };
        await transaction.collection("challenges").doc(challenge.id).set(record);
        await ownerReference.set({ _openid: openid, activeChallengeId: challenge.id });
        return { _id: challenge.id, ...record };
      });
    }
    if (event.action === "getActive") {
      const active = await findOne(database, "challenges", {
        _openid: openid,
        status: "active"
      });
      if (!active) return null;
      assertOwnedRecord(active, openid);
      return hydrateCheckIns(active, await findCheckIns(database, openid, active._id));
    }
    if (event.action === "checkIn" || event.action === "undoCheckIn") {
      const challengeId = requireId(payload.challengeId);
      const commandId = requireId(payload.id);
      const date = requireDate(payload.date);
      if (date > trustedDate) throw codedError("INVALID_ARGUMENT");
      const completed = event.action === "checkIn";
      return database.runTransaction(async (transaction) => {
        const challenge = await readOptionalDocument(
          transaction.collection("challenges").doc(challengeId)
        );
        assertOwnedRecord(challenge, openid);
        if (challenge.status !== "active") throw codedError("CHALLENGE_NOT_ACTIVE");
        const recordId = checkinId(openid, challengeId, date);
        const occurrenceProbe = { ...challenge, checkIns: {} };
        if (toggleChallengeCheckIn(occurrenceProbe, date) === occurrenceProbe) {
          throw codedError("INVALID_ARGUMENT");
        }
        const existing = await readOptionalDocument(
          transaction.collection("checkins").doc(recordId)
        );
        if (!completed && !existing) {
          throw codedError("INVALID_ARGUMENT");
        }
        await transaction.collection("checkins").doc(recordId).set({
          _openid: openid,
          challengeId,
          date,
          completed,
          commandId,
          updatedAt: database.serverDate()
        });
        return { ok: true, checkinId: recordId };
      });
    }
    if (event.action === "finish") {
      const challengeId = requireId(payload.challengeId);
      const completedAt = trustedDate;
      if (payload.date !== void 0 && requireDate(payload.date) !== completedAt) {
        throw codedError("INVALID_ARGUMENT");
      }
      return database.runTransaction(async (transaction) => {
        const challengeReference = transaction.collection("challenges").doc(challengeId);
        const challenge = await readOptionalDocument(challengeReference);
        assertOwnedRecord(challenge, openid);
        if (challenge.status !== "active") throw codedError("CHALLENGE_NOT_ACTIVE");
        const hydrated = hydrateCheckIns(
          challenge,
          await findCheckIns(transaction, openid, challengeId)
        );
        const progress = getChallengeProgress(hydrated, completedAt);
        if (progress.isComplete !== true) throw codedError("CHALLENGE_NOT_COMPLETE");
        const history = createChallengeHistoryEntry(hydrated, progress, completedAt);
        await challengeReference.update({
          status: "completed",
          completedAt,
          history,
          updatedAt: database.serverDate()
        });
        const ownerReference = transaction.collection("challengeOwners").doc(openid);
        const owner = await readOptionalDocument(ownerReference);
        if (owner?.activeChallengeId === challengeId) {
          await ownerReference.set({ _openid: openid, activeChallengeId: null });
        }
        return { ...challenge, status: "completed", completedAt, history };
      });
    }
    if (event.action === "delete") {
      const challengeId = requireId(payload.challengeId);
      return database.runTransaction(async (transaction) => {
        const challengeReference = transaction.collection("challenges").doc(challengeId);
        const challenge = await readOptionalDocument(challengeReference);
        assertOwnedRecord(challenge, openid);
        const checkins = await findCheckIns(transaction, openid, challengeId);
        await Promise.all(checkins.map((item) => transaction.collection("checkins").doc(item._id).remove()));
        await challengeReference.remove();
        const ownerReference = transaction.collection("challengeOwners").doc(openid);
        const owner = await readOptionalDocument(ownerReference);
        if (owner?.activeChallengeId === challengeId) {
          await ownerReference.set({ _openid: openid, activeChallengeId: null });
        }
        return { ok: true };
      });
    }
    throw codedError("INVALID_ACTION");
  };
}
async function challengeApi(event, context) {
  const cloud = require("wx-server-sdk");
  cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
  return createChallengeApi({
    database: cloud.database(),
    getWXContext: () => cloud.getWXContext()
  })(event, context);
}
module.exports = {
  main: createClientSafeMain(challengeApi),
  challengeApi,
  createChallengeApi,
  createClientSafeMain
};
