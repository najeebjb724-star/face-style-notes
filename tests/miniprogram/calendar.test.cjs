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

const challenge = { id: "challenge-1", title: "七日护肤", taskLabel: "晚间基础护理", reminderTime: "21:30", checkIns: {} };
const core = { toggleChallengeCheckIn: value => value, getChallengeProgress: () => ({}) };
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
