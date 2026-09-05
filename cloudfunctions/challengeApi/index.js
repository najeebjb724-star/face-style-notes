// challengeApi-build-fingerprint:22330ec80807e1750d66f558327f896b0f886bf66aca2388ba979163efbe1213:6f09a25c27d4697584c8fa98e5570ebea900a8f01a0d09f8e6a917d247542b09
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
    function toggleChallengeCheckIn(challenge, date = localCalendarDate()) {
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
      createChallenge: createChallenge2,
      toggleChallengeCheckIn,
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
    if (event.action === "create") {
      const challenge = createChallenge(payload, now());
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
      const completed = event.action === "checkIn";
      return database.runTransaction(async (transaction) => {
        const challenge = await readOptionalDocument(
          transaction.collection("challenges").doc(challengeId)
        );
        assertOwnedRecord(challenge, openid);
        if (challenge.status !== "active") throw codedError("CHALLENGE_NOT_ACTIVE");
        const recordId = checkinId(openid, challengeId, date);
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
      const completedAt = requireDate(payload.date);
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
