const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const detailPath = path.join(__dirname, "../../miniprogram/pages/challenge-detail/challenge-detail.js");

function loadDetail(dependencies = {}, wxOverrides = {}) {
  let definition;
  const wx = { showToast() {}, ...wxOverrides };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(detailPath, "utf8"), {
    Page(page) { definition = page; },
    wx,
    Date,
    Promise,
    module,
    require(name) {
      if (!(name in dependencies)) throw new Error(`unexpected require: ${name}`);
      return dependencies[name];
    }
  });
  return { definition, helpers: module.exports, wx };
}

const challenge = { id: "challenge-1", title: "七日护肤", taskLabel: "晚间基础护理", reminderTime: "21:30", startedAt: "2026-09-03", durationDays: 3, frequency: "daily", checkIns: {} };
const core = { toggleChallengeCheckIn: value => value, getChallengeProgress: () => ({}), getChallengeOccurrenceDays: () => [1, 2, 3] };
const offline = { enqueueCheckIn() {}, flushCheckIns: async () => {} };

test("calendar event contains task and mini program return hint", () => {
  const { helpers } = loadDetail({
    "../../services/cloud-client": { callCloud: async () => ({}) },
    "../../services/offline-checkins": offline,
    "../../lib/face-style-core": core
  });
  const event = helpers.buildCalendarEvent(challenge, { day: 4, startsAt: 1788442200 });
  assert.match(event.title, /挑战/);
  assert.match(event.title, /晚间基础护理/);
  assert.match(event.description, /回到小程序完成打卡/);
  assert.equal(event.alarm, true);
  assert.equal(event.startTime, 1788442200);
});

test("calendar rejection preserves the current challenge data", () => {
  let calendarOptions;
  const { definition } = loadDetail({
    "../../services/cloud-client": { callCloud: async () => ({}) },
    "../../services/offline-checkins": offline,
    "../../lib/face-style-core": core
  }, { addPhoneCalendar(options) { calendarOptions = options; } });
  const page = {
    ...definition,
    data: { ...definition.data, challenge, today: "2026-09-03", checkedIn: false },
    setData(value) { Object.assign(this.data, value); }
  };
  definition.addToPhoneCalendar.call(page);
  assert.equal(typeof calendarOptions.fail, "function");
  calendarOptions.fail();
  assert.equal(page.data.challenge, challenge);
  assert.equal(page.data.checkedIn, false);
});

test("calendar setup adds one standard event for every scheduled challenge occurrence", () => {
  const options = [];
  const { definition } = loadDetail({
    "../../services/cloud-client": { callCloud: async () => ({}) },
    "../../services/offline-checkins": offline,
    "../../lib/face-style-core": core
  }, { addPhoneCalendar(option) { options.push(option); option.success(); } });
  const page = { ...definition, data: { ...definition.data, challenge, today: "2026-09-03" }, setData() {} };
  definition.addToPhoneCalendar.call(page);
  assert.equal(options.length, 3);
  assert.deepEqual(options.map(option => option.title), ["挑战第 1 天：晚间基础护理", "挑战第 2 天：晚间基础护理", "挑战第 3 天：晚间基础护理"]);
});

test("calendar setup omits challenge days that already passed", () => {
  const { helpers } = loadDetail({
    "../../services/cloud-client": { callCloud: async () => ({}) },
    "../../services/offline-checkins": offline,
    "../../lib/face-style-core": core
  });
  assert.deepEqual(JSON.parse(JSON.stringify(helpers.buildCalendarEvents(challenge, "2026-09-04").map(event => event.title))), [
    "挑战第 2 天：晚间基础护理",
    "挑战第 3 天：晚间基础护理"
  ]);
});

test("calendar fallback explains that each remaining day needs confirmation", () => {
  const wxml = fs.readFileSync(path.join(__dirname, "../../miniprogram/pages/challenge-detail/challenge-detail.wxml"), "utf8");
  assert.match(wxml, /添加剩余挑战日到手机日历/);
  assert.match(wxml, /逐条确认/);
  assert.match(wxml, /取消后将停止/);
});

test("subscription is requested only from its button and a rejection does not alter the challenge", async () => {
  const calls = [];
  const { definition } = loadDetail({
    "../../services/cloud-client": {
      callCloud: async (name, request) => {
        calls.push([name, request]);
        return request.action === "getConfig" ? { templateId: "template-1" } : { ok: true };
      }
    },
    "../../services/offline-checkins": offline,
    "../../lib/face-style-core": core
  }, {
    requestSubscribeMessage(options) { options.complete({ "template-1": "reject" }); }
  });
  const page = {
    ...definition,
    data: { ...definition.data, challenge, checkedIn: false },
    setData(value) { Object.assign(this.data, value); }
  };
  await definition.enableWechatReminder.call(page);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    ["reminderApi", { action: "getConfig" }],
    ["reminderApi", { action: "saveSubscriptionResult", payload: { templateId: "template-1", status: "reject" } }]
  ]);
  assert.equal(page.data.challenge, challenge);
  assert.equal(page.data.checkedIn, false);
});
