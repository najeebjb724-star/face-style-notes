const { createHash } = require("node:crypto");

function codedError(code) {
  return Object.assign(new Error(code), { code });
}

function getConfig(environment = process.env) {
  return { templateId: typeof environment.REMINDER_TEMPLATE_ID === "string" ? environment.REMINDER_TEMPLATE_ID.trim() : "" };
}

function getTemplateData(environment = process.env) {
  if (typeof environment.REMINDER_TEMPLATE_DATA !== "string" || !environment.REMINDER_TEMPLATE_DATA.trim()) return null;
  try {
    const data = JSON.parse(environment.REMINDER_TEMPLATE_DATA);
    return data && typeof data === "object" && !Array.isArray(data) ? data : null;
  } catch (_) {
    return null;
  }
}

function subscriptionId(openid, challengeId, templateId) {
  return `reminder-${createHash("sha256").update(`${openid}:${challengeId}:${templateId}`).digest("hex")}`;
}

function nextDueAt(reminderTime, now) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(reminderTime || "");
  if (!match) return now.toISOString();
  const chinaNow = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const due = new Date(Date.UTC(chinaNow.getUTCFullYear(), chinaNow.getUTCMonth(), chinaNow.getUTCDate(), Number(match[1]) - 8, Number(match[2])));
  if (due <= now) due.setUTCDate(due.getUTCDate() + 1);
  return due.toISOString();
}

async function getActiveChallenge(database, openid) {
  const result = await database.collection("challenges").where({ _openid: openid, status: "active" }).limit(1).get();
  return result.data[0] || null;
}

function createReminderApi({ database, getWXContext, getConfig: config = getConfig, now = () => new Date(), sendSubscription, templateData = null }) {
  if (!database || typeof getWXContext !== "function") throw codedError("INVALID_CONFIGURATION");

  async function saveSubscriptionResult({ templateId, status } = {}) {
    const { OPENID: openid } = getWXContext();
    if (!openid) throw codedError("UNAUTHENTICATED");
    const configuredTemplateId = config().templateId;
    if (!configuredTemplateId || templateId !== configuredTemplateId || !["accept", "reject", "ban"].includes(status)) throw codedError("INVALID_ARGUMENT");
    const challenge = await getActiveChallenge(database, openid);
    if (!challenge) throw codedError("CHALLENGE_NOT_ACTIVE");
    const id = subscriptionId(openid, challenge._id, templateId);
    await database.collection("reminder_subscriptions").doc(id).set({ data: {
      _openid: openid,
      challengeId: challenge._id,
      templateId,
      status,
      dueAt: status === "accept" ? nextDueAt(challenge.reminderTime, now()) : null,
      usedAt: null,
      updatedAt: now().toISOString()
    } });
    return { ok: true };
  }

  async function sendDueReminders(at = now()) {
    const result = await database.collection("reminder_subscriptions").where({ status: "accept", usedAt: null }).limit(100).get();
    const due = result.data.filter(item => item.dueAt && Date.parse(item.dueAt) <= at.getTime());
    if (!templateData || typeof sendSubscription !== "function") return { sent: 0, skipped: due.length };
    let sent = 0;
    for (const subscription of due) {
      await sendSubscription({
        touser: subscription._openid,
        templateId: subscription.templateId,
        page: "pages/challenge-detail/challenge-detail",
        data: templateData
      });
      await database.collection("reminder_subscriptions").doc(subscription._id).update({ usedAt: at.toISOString(), updatedAt: at.toISOString() });
      sent += 1;
    }
    return { sent, skipped: 0 };
  }

  return { getConfig: config, saveSubscriptionResult, sendDueReminders };
}

function createMain(cloud, environment = process.env) {
  const api = createReminderApi({
    database: cloud.database(),
    getWXContext: () => cloud.getWXContext(),
    getConfig: () => getConfig(environment),
    templateData: getTemplateData(environment),
    sendSubscription: request => cloud.openapi.subscribeMessage.send(request)
  });
  return async function main(event = {}) {
    if (event.action === "getConfig") return api.getConfig();
    if (event.action === "saveSubscriptionResult") return api.saveSubscriptionResult(event.payload);
    throw codedError("INVALID_ARGUMENT");
  };
}

async function main(event) {
  const cloud = require("wx-server-sdk");
  cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
  return createMain(cloud)(event);
}

module.exports = { main, createMain, createReminderApi, getConfig, getTemplateData, nextDueAt, subscriptionId };
