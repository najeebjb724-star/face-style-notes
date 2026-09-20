const test = require("node:test");
const assert = require("node:assert/strict");

const { createMain, createReminderApi, getConfig } = require("../../cloudfunctions/reminderApi");

function createDatabase(records = {}) {
  const collections = new Map(Object.entries(records).map(([name, rows]) => [name, new Map(rows.map(row => [row._id, { ...row }]))]));
  const collection = name => {
    if (!collections.has(name)) collections.set(name, new Map());
    const rows = collections.get(name);
    return {
      where(filter) {
        const matching = [...rows.values()].filter(row => Object.entries(filter).every(([key, value]) => row[key] === value));
        return { limit: count => ({ get: async () => ({ data: matching.slice(0, count) }) }) };
      },
      doc(id) {
        return {
          get: async () => ({ data: rows.get(id) || null }),
          set: async ({ data }) => rows.set(id, { ...data, _id: id }),
          update: async data => rows.set(id, { ...rows.get(id), ...data })
        };
      }
    };
  };
  return { collection, serverDate: () => "server-date", snapshot: name => [...(collections.get(name)?.values() || [])] };
}

test("getConfig reads the reminder template ID from the environment", () => {
  assert.deepEqual(getConfig({ REMINDER_TEMPLATE_ID: "template-1" }), { templateId: "template-1" });
});

test("an unset reminder template ID cannot be accepted through the cloud API", async () => {
  const database = createDatabase({ challenges: [{ _id: "challenge-1", _openid: "user-1", status: "active", reminderTime: "21:30" }] });
  const api = createReminderApi({ database, getWXContext: () => ({ OPENID: "user-1" }), getConfig: () => ({ templateId: "" }) });
  await assert.rejects(api.saveSubscriptionResult({ templateId: "", status: "accept" }), error => error.code === "INVALID_ARGUMENT");
});

test("an accepted subscription is saved for the caller active challenge", async () => {
  const database = createDatabase({ challenges: [{ _id: "challenge-1", _openid: "user-1", status: "active", reminderTime: "21:30" }] });
  const api = createReminderApi({ database, getWXContext: () => ({ OPENID: "user-1" }), getConfig: () => ({ templateId: "template-1" }), now: () => new Date("2026-09-03T12:00:00Z") });
  await api.saveSubscriptionResult({ templateId: "template-1", status: "accept" });
  const [subscription] = database.snapshot("reminder_subscriptions");
  assert.deepEqual({
    _openid: subscription._openid,
    challengeId: subscription.challengeId,
    templateId: subscription.templateId,
    status: subscription.status,
    usedAt: subscription.usedAt
  }, { _openid: "user-1", challengeId: "challenge-1", templateId: "template-1", status: "accept", usedAt: null });
});

test("due accepted subscriptions stay unused when no template data mapping is configured", async () => {
  const database = createDatabase({ reminder_subscriptions: [{ _id: "subscription-1", _openid: "user-1", templateId: "template-1", status: "accept", dueAt: "2026-09-03T12:00:00.000Z", usedAt: null }] });
  const api = createReminderApi({ database, getWXContext: () => ({ OPENID: "user-1" }), getConfig: () => ({ templateId: "template-1" }), now: () => new Date("2026-09-03T12:01:00Z") });
  const result = await api.sendDueReminders(new Date("2026-09-03T12:01:00Z"));
  assert.equal(result.skipped, 1);
  assert.equal(database.snapshot("reminder_subscriptions")[0].usedAt, null);
});

test("a successful due send marks an accepted subscription used once", async () => {
  const database = createDatabase({ reminder_subscriptions: [{ _id: "subscription-1", _openid: "user-1", templateId: "template-1", status: "accept", dueAt: "2026-09-03T12:00:00.000Z", usedAt: null }] });
  let sent = 0;
  const api = createReminderApi({ database, getWXContext: () => ({ OPENID: "user-1" }), getConfig: () => ({ templateId: "template-1" }), now: () => new Date("2026-09-03T12:01:00Z"), sendSubscription: async () => { sent += 1; }, templateData: { thing1: { value: "打卡" } } });
  const result = await api.sendDueReminders(new Date("2026-09-03T12:01:00Z"));
  assert.equal(result.sent, 1);
  assert.equal(sent, 1);
  assert.equal(database.snapshot("reminder_subscriptions")[0].usedAt, "2026-09-03T12:01:00.000Z");
});

test("the public cloud entry rejects worker-only reminder sends", async () => {
  const cloud = {
    database: () => createDatabase(),
    getWXContext: () => ({ OPENID: "user-1" }),
    openapi: { subscribeMessage: { send: async () => {} } }
  };
  await assert.rejects(createMain(cloud)({ action: "sendDueReminders" }), error => error.code === "INVALID_ARGUMENT");
});
