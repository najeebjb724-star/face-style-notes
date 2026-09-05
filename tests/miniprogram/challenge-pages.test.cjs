const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "../../miniprogram");
const read = relativePath => fs.readFileSync(path.join(root, relativePath), "utf8");

function loadPage(relativePath, dependencies = {}, wxOverrides = {}) {
  let definition;
  const wx = {
    navigateTo() {},
    showToast() {},
    ...wxOverrides
  };
  vm.runInNewContext(read(relativePath), {
    Page(page) { definition = page; },
    wx,
    Date,
    Promise,
    require(moduleName) {
      if (!(moduleName in dependencies)) throw new Error(`unexpected require: ${moduleName}`);
      return dependencies[moduleName];
    }
  });
  return { definition, wx };
}

test("challenge detail exposes one primary daily action", () => {
  const wxml = read("pages/challenge-detail/challenge-detail.wxml");
  assert.equal((wxml.match(/class="[^"]*primary-action/g) || []).length, 1);
  assert.match(wxml, /完成今日打卡/);
  assert.match(wxml, /补记昨天/);
});

test("challenge journey registers four screens, two components, and six stable events", () => {
  const app = JSON.parse(read("app.json"));
  for (const page of [
    "pages/challenges/challenges",
    "pages/challenge-create/challenge-create",
    "pages/challenge-detail/challenge-detail",
    "pages/challenge-complete/challenge-complete"
  ]) assert.ok(app.pages.includes(page), `${page} is not registered`);

  const create = read("pages/challenge-create/challenge-create.js");
  const detail = read("pages/challenge-detail/challenge-detail.js");
  for (const event of ["selectTemplate", "submitChallenge"]) assert.match(create, new RegExp(`${event}\\s*\\(`));
  for (const event of ["completeToday", "undoToday", "recordPhoto", "finishChallenge"]) {
    assert.match(detail, new RegExp(`${event}\\s*\\(`));
  }

  const createJson = JSON.parse(read("pages/challenge-create/challenge-create.json"));
  const detailJson = JSON.parse(read("pages/challenge-detail/challenge-detail.json"));
  assert.equal(createJson.usingComponents["challenge-card"], "/components/challenge-card/challenge-card");
  assert.equal(detailJson.usingComponents["photo-pair"], "/components/photo-pair/photo-pair");
});

test("all challenge controls remain tappable and layouts fit a 320px viewport", () => {
  const styleFiles = [
    "pages/challenges/challenges.wxss",
    "pages/challenge-create/challenge-create.wxss",
    "pages/challenge-detail/challenge-detail.wxss",
    "pages/challenge-complete/challenge-complete.wxss",
    "components/challenge-card/challenge-card.wxss",
    "components/photo-pair/photo-pair.wxss"
  ];
  const styles = styleFiles.map(read).join("\n");
  assert.match(styles, /\.tap-target[^}]*min-height:\s*44px/s);
  assert.doesNotMatch(styles, /(?:min-)?width:\s*(?:3[2-9]\d|[4-9]\d{2}|[1-9]\d{3,})px/);
  assert.doesNotMatch(styles, /(?:min-)?width:\s*(?:6[4-9]\d|[7-9]\d{2}|[1-9]\d{3,})rpx/);
  for (const file of styleFiles) assert.match(read(file), /box-sizing:\s*border-box/);

  for (const base of [
    "pages/challenges/challenges",
    "pages/challenge-create/challenge-create",
    "pages/challenge-detail/challenge-detail",
    "pages/challenge-complete/challenge-complete",
    "components/challenge-card/challenge-card",
    "components/photo-pair/photo-pair"
  ]) {
    const buttons = read(`${base}.wxml`).match(/<button\b[^>]*>/g) || [];
    for (const button of buttons) assert.match(button, /class="[^"]*tap-target/, `${base}: ${button}`);
    if (buttons.length) assert.match(read(`${base}.wxss`), /\.tap-target[^}]*min-height:\s*44px/s, base);
  }
});

test("challenge centre keeps templates browsable when no cloud result is available", async () => {
  const { definition } = loadPage("pages/challenges/challenges.js", {
    "../../services/cloud-client": { callCloud: async () => { throw new Error("offline"); } },
    "../../lib/face-style-core": { CHALLENGE_TEMPLATES: [{ id: "one", title: "轻盈练习" }] }
  });
  const updates = [];
  await assert.doesNotReject(() => definition.onShow.call({
    data: definition.data,
    setData(value) { updates.push(value); }
  }));
  assert.equal(definition.data.templates.length, 1);
  assert.ok(updates.some(value => value.activeChallenge === null && value.isVisitor === true));
});

test("challenge creation blocks a second active challenge before submission", async () => {
  let cloudCalls = 0;
  const toasts = [];
  const { definition } = loadPage("pages/challenge-create/challenge-create.js", {
    "../../services/cloud-client": { callCloud: async () => { cloudCalls += 1; return { challenge: {} }; } },
    "../../lib/face-style-core": {
      CHALLENGE_TEMPLATES: [],
      createChallenge: input => input
    }
  }, { showToast(options) { toasts.push(options.title); } });
  await definition.submitChallenge.call({
    data: { activeChallenge: { id: "active-1" }, selectedTemplateId: "custom", form: {} },
    setData() {}
  });
  assert.equal(cloudCalls, 0);
  assert.ok(toasts.some(text => text.includes("进行中")));
});

test("daily check-in is queued before cloud sync and remains optimistic offline", async () => {
  const order = [];
  const updates = [];
  const { definition } = loadPage("pages/challenge-detail/challenge-detail.js", {
    "../../services/cloud-client": { callCloud: async () => { order.push("cloud"); throw new Error("offline"); } },
    "../../services/offline-checkins": {
      enqueueCheckIn() { order.push("queue"); },
      async flushCheckIns(send) { order.push("flush"); await send({ id: "queued" }); }
    },
    "../../lib/face-style-core": {
      toggleChallengeCheckIn(challenge, date) {
        return { ...challenge, checkIns: { [date]: { completedAt: "now" } } };
      },
      getChallengeProgress() { return { day: 1, total: 7, completed: 1, completionRate: 14, streak: 1, isComplete: false }; },
      createChallengeHistoryEntry() { return {}; }
    }
  });
  await definition.completeToday.call({
    ...definition,
    data: { challenge: { id: "c1", checkIns: {} }, today: "2026-09-03" },
    setData(value) { updates.push(value); }
  });
  assert.deepEqual(order.slice(0, 2), ["queue", "flush"]);
  assert.ok(updates.some(value => value.checkedIn === true));
});

test("off-day and already-completed requests never enter the offline queue", async () => {
  let enqueued = 0;
  const unchanged = { id: "c1", checkIns: {} };
  const { definition } = loadPage("pages/challenge-detail/challenge-detail.js", {
    "../../services/cloud-client": { callCloud: async () => ({ ok: true }) },
    "../../services/offline-checkins": {
      enqueueCheckIn() { enqueued += 1; },
      async flushCheckIns() {}
    },
    "../../lib/face-style-core": {
      toggleChallengeCheckIn: challenge => challenge,
      getChallengeProgress: () => ({}),
      createChallengeHistoryEntry: () => ({})
    }
  });
  const page = { ...definition, data: { challenge: unchanged, today: "2026-09-03" }, setData() {} };
  await definition.applyCheckIn.call(page, "2026-09-03", true);
  assert.equal(enqueued, 0);

  const alreadyComplete = { id: "c1", checkIns: { "2026-09-03": { completedAt: "now" } } };
  page.data.challenge = alreadyComplete;
  await definition.applyCheckIn.call(page, "2026-09-03", true);
  assert.equal(enqueued, 0);
});

test("detail availability comes from the shared challenge toggle rule", () => {
  const calls = [];
  const challenge = { id: "c1", checkIns: {} };
  const { definition } = loadPage("pages/challenge-detail/challenge-detail.js", {
    "../../services/cloud-client": { callCloud: async () => ({}) },
    "../../services/offline-checkins": { enqueueCheckIn() {}, flushCheckIns: async () => {} },
    "../../lib/face-style-core": {
      toggleChallengeCheckIn(value, date) {
        calls.push(date);
        return date === "2026-09-03" ? { ...value } : value;
      },
      getChallengeProgress: () => ({}),
      createChallengeHistoryEntry: () => ({})
    }
  });
  const updates = [];
  definition.updateChallenge.call({
    data: { today: "2026-09-03", yesterday: "2026-09-02" },
    setData(value) { updates.push(value); }
  }, challenge);
  assert.deepEqual(calls, ["2026-09-03", "2026-09-02"]);
  assert.equal(updates[0].canCheckIn, true);
  assert.equal(updates[0].canCheckInYesterday, false);
});

test("an already completed yesterday stays hidden and cannot be queued again", async () => {
  let enqueued = 0;
  const challenge = { id: "c1", checkIns: { "2026-09-02": { completedAt: "then" } } };
  const { definition } = loadPage("pages/challenge-detail/challenge-detail.js", {
    "../../services/cloud-client": { callCloud: async () => ({}) },
    "../../services/offline-checkins": { enqueueCheckIn() { enqueued += 1; }, flushCheckIns: async () => {} },
    "../../lib/face-style-core": {
      toggleChallengeCheckIn(value, date) {
        return { ...value, checkIns: { ...value.checkIns, [date]: undefined } };
      },
      getChallengeProgress: () => ({})
    }
  });
  const updates = [];
  const page = {
    ...definition,
    data: { challenge, today: "2026-09-03", yesterday: "2026-09-02" },
    setData(value) { updates.push(value); }
  };
  definition.updateChallenge.call(page, challenge);
  await definition.recordYesterday.call(page);
  assert.equal(updates[0].canCheckInYesterday, false);
  assert.equal(enqueued, 0);
});

test("finishing waits for offline sync and does not call finish when sync fails", async () => {
  let finishCalls = 0;
  const navigations = [];
  const { definition } = loadPage("pages/challenge-detail/challenge-detail.js", {
    "../../services/cloud-client": { callCloud: async () => { finishCalls += 1; return {}; } },
    "../../services/offline-checkins": {
      enqueueCheckIn() {},
      async flushCheckIns() { throw new Error("offline"); }
    },
    "../../lib/face-style-core": {
      toggleChallengeCheckIn: value => value,
      getChallengeProgress: () => ({}),
      createChallengeHistoryEntry: () => ({})
    }
  }, { navigateTo(options) { navigations.push(options.url); } });
  await definition.finishChallenge.call({
    data: { challenge: { id: "c1" }, today: "2026-09-03", progress: {} },
    setData() {}
  });
  assert.equal(finishCalls, 0);
  assert.deepEqual(navigations, []);
});

test("a challenge can finish without any optional photos", async () => {
  const navigations = [];
  const stored = [];
  const { definition } = loadPage("pages/challenge-detail/challenge-detail.js", {
    "../../services/cloud-client": { callCloud: async () => ({ history: { id: "c1", title: "七日练习", total: 7, completed: 4, completionRate: 57, streak: 2 } }) },
    "../../services/offline-checkins": { enqueueCheckIn() {}, flushCheckIns: async () => {} },
    "../../lib/face-style-core": {
      toggleChallengeCheckIn: value => value,
      getChallengeProgress: () => ({ total: 7, completed: 4, completionRate: 57, streak: 2, isComplete: true }),
      createChallengeHistoryEntry: () => ({ id: "c1", completionRate: 57 })
    }
  }, {
    navigateTo(options) { navigations.push(options.url); },
    setStorageSync(key, value) { stored.push([key, value]); }
  });
  await definition.finishChallenge.call({
    data: { challenge: { id: "c1", photos: {} }, progress: { total: 7, completed: 4, completionRate: 57, streak: 2, isComplete: true } },
    setData() {}
  });
  assert.deepEqual(navigations, ["/pages/challenge-complete/challenge-complete?id=c1"]);
  assert.deepEqual(stored, [["challenge-completion:c1", {
    id: "c1", title: "七日练习", total: 7, completed: 4, completionRate: 57, streak: 2
  }]]);
  assert.match(read("pages/challenge-complete/challenge-complete.wxml"), /没有照片也可以|文字复盘/);
  for (const field of ["history.title", "history.completed", "history.total", "history.completionRate", "history.streak"]) {
    assert.match(read("pages/challenge-complete/challenge-complete.wxml"), new RegExp(field.replace(".", "\\.")));
  }
});

test("a completed challenge still navigates with its history when local storage fails", async () => {
  const history = { id: "c1", title: "七日练习", total: 7, completed: 7, completionRate: 100, streak: 7 };
  let navigation;
  let delivered;
  const { definition } = loadPage("pages/challenge-detail/challenge-detail.js", {
    "../../services/cloud-client": { callCloud: async () => ({ history }) },
    "../../services/offline-checkins": { enqueueCheckIn() {}, flushCheckIns: async () => {} },
    "../../lib/face-style-core": { toggleChallengeCheckIn: value => value, getChallengeProgress: () => ({}) }
  }, {
    setStorageSync() { throw new Error("storage full"); },
    navigateTo(options) {
      navigation = options.url;
      options.success({ eventChannel: { emit(name, value) { delivered = [name, value]; } } });
    }
  });
  await definition.finishChallenge.call({
    data: { challenge: { id: "c1" }, today: "2026-09-03" },
    setData() {}
  });
  assert.equal(navigation, "/pages/challenge-complete/challenge-complete?id=c1");
  assert.deepEqual(delivered, ["challengeCompleted", history]);
});

test("completion page accepts fresh server history through the opener event channel", () => {
  const history = { id: "c1", title: "真实复盘" };
  let listener;
  const { definition } = loadPage("pages/challenge-complete/challenge-complete.js", {}, {
    getStorageSync() { return null; }
  });
  const updates = [];
  definition.onLoad.call({
    setData(value) { updates.push(value); },
    getOpenerEventChannel() {
      return { on(name, callback) { assert.equal(name, "challengeCompleted"); listener = callback; } };
    }
  }, { id: "c1" });
  listener(history);
  assert.equal(updates.at(-1).history.id, "c1");
  assert.equal(updates.at(-1).history.title, "真实复盘");
});
