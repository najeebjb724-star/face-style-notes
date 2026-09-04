const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadWebCore() {
  const html = fs.readFileSync(path.join(__dirname, "..", "..", "index.html"), "utf8");
  const match = html.match(/<script id="face-style-core">([\s\S]*?)<\/script>/);
  assert.ok(match, "index.html must contain #face-style-core");
  const context = { window: {}, console, URL, Date };
  vm.createContext(context);
  vm.runInContext(match[1], context, { filename: "face-style-core.js" });
  return context.window.FaceStyleCore;
}

function loadMiniCore() {
  return require("../../miniprogram/lib/face-style-core");
}

function toPlain(value) {
  return JSON.parse(JSON.stringify(value));
}

function assertParity(method, ...args) {
  const web = loadWebCore();
  const mini = loadMiniCore();
  assert.deepEqual(toPlain(mini[method](...args)), toPlain(web[method](...args)));
}

test("mini program challenge creation matches the web MVP", () => {
  const input = { templateId: "custom", title: "身体乳", durationDays: 7, frequency: "daily", reminderTime: "21:30" };
  const now = new Date("2026-09-03T12:00:00+08:00");
  assertParity("createChallenge", input, now);
});

test("supported HTTPS tutorial URLs match the web MVP without a global URL constructor", () => {
  const web = loadWebCore();
  const mini = loadMiniCore();
  const urls = [
    "  HTTPS://Example.COM  ",
    "https://Docs.Example.COM:8443/guides/eye makeup?q=day one#step 1",
    "https://cdn.example.com/tutorial/%E7%9C%BC%E5%A6%86?next=%2Flesson%202#done",
    "https://example.com:443/tutorial",
    "https://example.com?lesson=1"
  ];
  const input = {
    templateId: "eye-makeup-7",
    tutorials: urls.map((url, index) => ({ label: `教程 ${index + 1}`, url }))
  };
  const now = new Date("2026-09-03T12:00:00+08:00");
  const expected = web.createChallenge(input, now).tutorials;
  const originalURL = global.URL;
  global.URL = undefined;
  try {
    assert.deepEqual(mini.createChallenge(input, now).tutorials, toPlain(expected));
  } finally {
    global.URL = originalURL;
  }
});

test("ambiguous or unsupported tutorial URL forms are rejected without a global URL constructor", () => {
  const mini = loadMiniCore();
  const urls = [
    "https://example.com/a/../b",
    "https://example.com/a/%2e%2e/b",
    "https://example.com/a/.%2e/b",
    "https://example.com/a/%2e./b",
    "https://例子.测试/tutorial",
    "https://%65xample.com/tutorial",
    "https://user:pass@example.com/tutorial",
    "https://127.0.0.1/tutorial",
    "https://0177.0.0.1/tutorial",
    "https://0x7f.0.0.1/tutorial",
    "https://0x7f000001/tutorial",
    "https://example.1/tutorial",
    "https://[2001:db8::1]/tutorial",
    "https://[::ffff:127.0.0.1]/tutorial",
    "https://example.com:/tutorial",
    "https://example.com:65536/tutorial",
    "https://example.com::443/tutorial",
    "https://exa_mple.com/tutorial",
    "https://xn--a.com/tutorial",
    "https://.example.com/tutorial",
    "https://example..com/tutorial",
    "https:///tutorial",
    "https://example.com/%ZZ",
    "https://example.com/a\u0001b",
    "https://example.com/a\u0085b",
    "https://example.com/a\\b",
    "https://example.com/a|b",
    "https://example.com/?a'b",
    "https://example.com/#a[b",
    "http://example.com/tutorial",
    "javascript:alert(1)"
  ];
  const now = new Date("2026-09-03T12:00:00+08:00");
  const originalURL = global.URL;
  global.URL = undefined;
  try {
    urls.forEach((url) => {
      const challenge = mini.createChallenge({
        templateId: "eye-makeup-7",
        tutorials: [{ label: "不支持", url }]
      }, now);
      assert.deepEqual(challenge.tutorials, [], url);
    });
  } finally {
    global.URL = originalURL;
  }
});

test("mini program exports only the challenge interface and immutable habit and training templates", () => {
  const web = loadWebCore();
  const mini = loadMiniCore();
  assert.deepEqual(Object.keys(mini).sort(), [
    "CHALLENGE_TEMPLATES",
    "createChallenge",
    "createChallengeHistoryEntry",
    "getChallengeOccurrenceDays",
    "getChallengeProgress",
    "toggleChallengeCheckIn"
  ].sort());
  assert.deepEqual(toPlain(mini.CHALLENGE_TEMPLATES), toPlain(web.CHALLENGE_TEMPLATES));
  assert.ok(mini.CHALLENGE_TEMPLATES.some((item) => item.kind === "habit"));
  assert.ok(mini.CHALLENGE_TEMPLATES.some((item) => item.kind === "training"));
  assert.ok(Object.isFrozen(mini.CHALLENGE_TEMPLATES));
  mini.CHALLENGE_TEMPLATES.forEach((item) => {
    assert.ok(Object.isFrozen(item));
    assert.ok(Object.isFrozen(item.photoDays));
    assert.ok(Object.isFrozen(item.taskDays));
  });

  const now = new Date("2026-08-28T08:00:00Z");
  const first = mini.createChallenge({ templateId: "makeup-3-in-7" }, now);
  first.photoDays[0] = 99;
  first.taskDays[0] = 99;
  const second = mini.createChallenge({ templateId: "makeup-3-in-7" }, now);
  const webSecond = web.createChallenge({ templateId: "makeup-3-in-7" }, now);
  assert.deepEqual(toPlain(second), toPlain(webSecond));
  assert.notStrictEqual(second.photoDays, mini.CHALLENGE_TEMPLATES[3].photoDays);
  assert.notStrictEqual(second.taskDays, mini.CHALLENGE_TEMPLATES[3].taskDays);
});

test("daily, weekly, and scheduled occurrence rules match the web MVP", () => {
  [
    { frequency: "daily", durationDays: 4 },
    { frequency: "weekly", durationDays: 15 },
    { frequency: "scheduled", durationDays: 7, taskDays: [7, 1, 4, 4, 0, 8, "4"] },
    { frequency: "scheduled", durationDays: 7 },
    { frequency: "unknown", durationDays: 7 }
  ].forEach((challenge) => assertParity("getChallengeOccurrenceDays", challenge));
});

test("valid check-in toggles and off-day rejection match without mutating the challenge", () => {
  const web = loadWebCore();
  const mini = loadMiniCore();
  const challenge = {
    startedAt: "2026-08-28",
    durationDays: 7,
    frequency: "scheduled",
    taskDays: [1, 4, 7],
    checkIns: { "2026-08-31": { completedAt: "2026-08-31T12:00:00.000Z" } }
  };
  const miniToggled = mini.toggleChallengeCheckIn(challenge, "2026-08-31");
  const webToggled = web.toggleChallengeCheckIn(challenge, "2026-08-31");
  assert.deepEqual(toPlain(miniToggled), toPlain(webToggled));
  assert.deepEqual(toPlain(challenge.checkIns), { "2026-08-31": { completedAt: "2026-08-31T12:00:00.000Z" } });

  const miniOffDay = mini.toggleChallengeCheckIn(challenge, "2026-08-29");
  const webOffDay = web.toggleChallengeCheckIn(challenge, "2026-08-29");
  assert.strictEqual(miniOffDay, challenge);
  assert.strictEqual(webOffDay, challenge);
  assert.deepEqual(toPlain(miniOffDay), toPlain(webOffDay));

  const RealDate = Date;
  class FixedDate extends RealDate {
    constructor(...args) {
      super(...(args.length ? args : ["2026-08-28T12:00:00.000Z"]));
    }

    static now() {
      return new RealDate("2026-08-28T12:00:00.000Z").getTime();
    }
  }
  global.Date = FixedDate;
  try {
    const fixedWeb = loadWebCore();
    const unchecked = { ...challenge, checkIns: {} };
    assert.deepEqual(
      toPlain(mini.toggleChallengeCheckIn(unchecked, "2026-08-28")),
      toPlain(fixedWeb.toggleChallengeCheckIn(unchecked, "2026-08-28"))
    );
  } finally {
    global.Date = RealDate;
  }
});

test("progress, streak, and date-only DST boundary behavior match the web MVP", () => {
  const daily = {
    startedAt: "2026-03-07",
    durationDays: 4,
    frequency: "daily",
    taskDays: [],
    checkIns: {
      "2026-03-07": { completedAt: "a" },
      "2026-03-08": { completedAt: "b" },
      "2026-03-09": { completedAt: "c" }
    }
  };
  assertParity("getChallengeProgress", daily, "2026-03-09");
  assertParity("getChallengeProgress", { ...daily, startedAt: "2026-10-31", checkIns: {} }, "2026-11-02");

  const scheduled = {
    startedAt: "2026-08-28",
    durationDays: 7,
    frequency: "scheduled",
    taskDays: [1, 4, 7],
    checkIns: {
      "2026-08-28": { completedAt: "a" },
      "2026-08-29": { completedAt: "off-day" },
      "2026-08-31": { completedAt: "b" },
      "2026-09-03": { completedAt: "c" }
    }
  };
  assertParity("getChallengeProgress", scheduled, "2026-09-03");
});

test("history completion metadata matches the web MVP and omits challenge details", () => {
  const challenge = {
    id: "challenge-1",
    title: "晚间习惯",
    startedAt: "2026-08-28",
    durationDays: 3,
    frequency: "daily",
    taskDays: [],
    checkIns: { "2026-08-28": { completedAt: "a" } },
    tutorials: [{ label: "教程", url: "https://example.com" }]
  };
  const progress = { completed: 2, completionRate: 67, streak: 1 };
  assertParity("createChallengeHistoryEntry", challenge, progress, "2026-09-01");
  const entry = loadMiniCore().createChallengeHistoryEntry(challenge, progress, "2026-09-01");
  assert.deepEqual(Object.keys(entry), ["id", "title", "startedAt", "completedAt", "durationDays", "total", "completed", "completionRate", "streak"]);
  assert.equal("checkIns" in entry, false);
  assert.equal("tutorials" in entry, false);
});
