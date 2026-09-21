const test = require("node:test");
const assert = require("node:assert/strict");

const { createMain, createReminderApi, getConfig } = require("../../cloudfunctions/reminderApi");

function createDatabase(records = {}, options = {}) {
  const collections = new Map(Object.entries(records).map(([name, rows]) => [name, new Map(rows.map(row => [row._id, { ...row }]))]));
  const queries = [];
  const collection = name => {
    if (!collections.has(name)) collections.set(name, new Map());
    const rows = collections.get(name);
    return {
      where(filter) {
        const query = { filter, order: null, limit: null };
        queries.push(query);
        return {
          orderBy(key, direction) { query.order = [key, direction]; return this; },
          limit(count) {
            query.limit = count;
            return {
              get: async () => {
                let matching = [...rows.values()].filter(row => Object.entries(filter).every(([key, value]) => value?.kind === "lte" ? row[key] <= value.value : row[key] === value));
                if (query.order) matching = matching.sort((left, right) => query.order[1] === "asc" ? String(left[query.order[0]]).localeCompare(String(right[query.order[0]])) : String(right[query.order[0]]).localeCompare(String(left[query.order[0]])));
                return { data: matching.slice(0, count) };
              }
            };
          }
        };
      },
      doc(id) {
        return {
          get: async () => ({ data: rows.get(id) || null }),
          set: async ({ data }) => rows.set(id, { ...data, _id: id }),
          update: async ({ data }) => {
            if (!data) throw new Error("update requires a data envelope");
            if (options.failUpdate?.(data)) throw new Error("update failed");
            rows.set(id, { ...rows.get(id), ...data });
          }
        };
      }
    };
  };
  return {
    collection,
    command: { lte: value => ({ kind: "lte", value }) },
    runTransaction: async callback => { if (options.beforeTransaction) await options.beforeTransaction(collections); return callback({ collection }); },
    serverDate: () => "server-date",
    snapshot: name => [...(collections.get(name)?.values() || [])],
    queries
  };
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

test("subscription creation loses the race when challenge deletion starts", async () => {
  let first = true;
  const database = createDatabase({ challenges: [{ _id: "challenge-1", _openid: "user-1", status: "active", reminderTime: "21:30" }] }, {
    beforeTransaction(collections) {
      if (!first) return;
      first = false;
      collections.get("challenges").delete("challenge-1");
    }
  });
  const api = createReminderApi({ database, getWXContext: () => ({ OPENID: "user-1" }), getConfig: () => ({ templateId: "template-1" }) });
  await assert.rejects(api.saveSubscriptionResult({ templateId: "template-1", status: "accept" }), error => error.code === "CHALLENGE_NOT_ACTIVE");
  assert.deepEqual(database.snapshot("reminder_subscriptions"), []);
});

test("sender settles an orphaned subscription without sending it", async () => {
  const database = createDatabase({ reminder_subscriptions: [{ _id: "subscription-1", _openid: "user-1", challengeId: "deleted", templateId: "template-1", status: "accept", sendState: "pending", dueAt: "2026-09-03T12:00:00.000Z", usedAt: null }] });
  let sent = 0;
  const api = createReminderApi({ database, getWXContext: () => ({ OPENID: "user-1" }), getConfig: () => ({ templateId: "template-1" }), sendSubscription: async () => { sent += 1; }, templateData: { thing1: { value: "打卡" } } });
  const result = await api.sendDueReminders(new Date("2026-09-03T12:01:00Z"));
  assert.equal(result.sent, 0);
  assert.equal(sent, 0);
  assert.equal(database.snapshot("reminder_subscriptions")[0].sendState, "unavailable");
});

test("due accepted subscriptions stay unused when no template data mapping is configured", async () => {
  const database = createDatabase({ reminder_subscriptions: [{ _id: "subscription-1", _openid: "user-1", templateId: "template-1", status: "accept", sendState: "pending", dueAt: "2026-09-03T12:00:00.000Z", usedAt: null }] });
  const api = createReminderApi({ database, getWXContext: () => ({ OPENID: "user-1" }), getConfig: () => ({ templateId: "template-1" }), now: () => new Date("2026-09-03T12:01:00Z") });
  const result = await api.sendDueReminders(new Date("2026-09-03T12:01:00Z"));
  assert.equal(result.skipped, 1);
  assert.equal(database.snapshot("reminder_subscriptions")[0].usedAt, null);
});

test("a successful due send marks an accepted subscription used once", async () => {
  const database = createDatabase({ challenges: [{ _id: "challenge-1", _openid: "user-1", status: "active" }], reminder_subscriptions: [{ _id: "subscription-1", _openid: "user-1", challengeId: "challenge-1", templateId: "template-1", status: "accept", sendState: "pending", dueAt: "2026-09-03T12:00:00.000Z", usedAt: null }] });
  let sent = 0;
  const api = createReminderApi({ database, getWXContext: () => ({ OPENID: "user-1" }), getConfig: () => ({ templateId: "template-1" }), now: () => new Date("2026-09-03T12:01:00Z"), sendSubscription: async () => { sent += 1; }, templateData: { thing1: { value: "打卡" } } });
  const result = await api.sendDueReminders(new Date("2026-09-03T12:01:00Z"));
  assert.equal(result.sent, 1);
  assert.equal(sent, 1);
  assert.equal(database.snapshot("reminder_subscriptions")[0].usedAt, "2026-09-03T12:01:00.000Z");
});

test("due reminders use a bounded due-time ordered query", async () => {
  const database = createDatabase({ challenges: [{ _id: "c1", _openid: "user-1", status: "active" }, { _id: "c2", _openid: "user-2", status: "active" }], reminder_subscriptions: [
    { _id: "late", _openid: "user-1", challengeId: "c1", templateId: "template-1", status: "accept", sendState: "pending", dueAt: "2026-09-03T12:00:00.000Z", usedAt: null },
    { _id: "early", _openid: "user-2", challengeId: "c2", templateId: "template-1", status: "accept", sendState: "pending", dueAt: "2026-09-03T11:00:00.000Z", usedAt: null }
  ] });
  const sent = [];
  const api = createReminderApi({ database, getWXContext: () => ({ OPENID: "user-1" }), getConfig: () => ({ templateId: "template-1" }), sendSubscription: async request => sent.push(request.touser), templateData: { thing1: { value: "打卡" } } });
  await api.sendDueReminders(new Date("2026-09-03T12:01:00Z"));
  assert.deepEqual(sent, ["user-2", "user-1"]);
  const query = database.queries.at(-1);
  assert.equal(query.filter.dueAt.kind, "lte");
  assert.deepEqual(query.order, ["dueAt", "asc"]);
  assert.equal(query.limit, 100);
});

test("a claimed reminder is not sent again after post-send persistence fails", async () => {
  const database = createDatabase({ challenges: [{ _id: "challenge-1", _openid: "user-1", status: "active" }], reminder_subscriptions: [{ _id: "subscription-1", _openid: "user-1", challengeId: "challenge-1", templateId: "template-1", status: "accept", sendState: "pending", dueAt: "2026-09-03T12:00:00.000Z", usedAt: null }] }, { failUpdate: data => Boolean(data.usedAt) });
  let sent = 0;
  const api = createReminderApi({ database, getWXContext: () => ({ OPENID: "user-1" }), getConfig: () => ({ templateId: "template-1" }), sendSubscription: async () => { sent += 1; }, templateData: { thing1: { value: "打卡" } } });
  await api.sendDueReminders(new Date("2026-09-03T12:01:00Z"));
  await api.sendDueReminders(new Date("2026-09-03T12:02:00Z"));
  assert.equal(sent, 1);
  assert.notEqual(database.snapshot("reminder_subscriptions")[0].sendState, "pending");
});

test("the public cloud entry rejects worker-only reminder sends", async () => {
  const cloud = {
    database: () => createDatabase(),
    getWXContext: () => ({ OPENID: "user-1" }),
    openapi: { subscribeMessage: { send: async () => {} } }
  };
  await assert.rejects(createMain(cloud)({ action: "sendDueReminders" }), error => error.code === "INVALID_ARGUMENT");
});
