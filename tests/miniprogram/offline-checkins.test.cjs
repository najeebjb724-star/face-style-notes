const test = require("node:test");
const assert = require("node:assert/strict");

const modulePath = "../../miniprogram/services/offline-checkins";

function loadModuleWithoutWx() {
  const previousWx = globalThis.wx;
  delete globalThis.wx;
  delete require.cache[require.resolve(modulePath)];
  try {
    return require(modulePath);
  } finally {
    if (previousWx !== undefined) globalThis.wx = previousWx;
  }
}

function createStorage() {
  const values = new Map();
  return {
    getStorageSync(key) {
      return values.get(key);
    },
    setStorageSync(key, value) {
      values.set(key, structuredClone(value));
    }
  };
}

function command(id, date) {
  return { id, challengeId: "c1", date, completed: true };
}

test("module loading is safe without a wx global and exposes the public queue API", () => {
  const offline = loadModuleWithoutWx();
  assert.equal(typeof offline.enqueueCheckIn, "function");
  assert.equal(typeof offline.flushCheckIns, "function");
  assert.equal(typeof offline.createOfflineCheckIns, "function");
});

test("queue persists unique command ids and sends them in stable order", async () => {
  const { createOfflineCheckIns } = loadModuleWithoutWx();
  const storage = createStorage();
  const queue = createOfflineCheckIns(storage);
  const sent = [];

  queue.enqueueCheckIn(command("cmd-1", "2026-09-03"));
  queue.enqueueCheckIn({ ...command("cmd-1", "2026-09-04"), completed: false });
  queue.enqueueCheckIn(command("cmd-2", "2026-09-04"));
  await queue.flushCheckIns(async item => {
    sent.push(item.id);
    return { ok: true };
  });

  assert.deepEqual(sent, ["cmd-1", "cmd-2"]);
  assert.deepEqual(storage.getStorageSync("offline-checkins"), []);
});

test("flush removes acknowledged commands but retains the failed command and later work", async () => {
  const { createOfflineCheckIns } = loadModuleWithoutWx();
  const storage = createStorage();
  const queue = createOfflineCheckIns(storage);
  const firstAttempt = [];
  const retry = [];
  for (let day = 1; day <= 3; day += 1) {
    queue.enqueueCheckIn(command(`cmd-${day}`, `2026-09-0${day}`));
  }

  await assert.rejects(queue.flushCheckIns(async item => {
    firstAttempt.push(item.id);
    if (item.id === "cmd-2") throw new Error("offline");
    return { ok: true };
  }), /offline/);
  assert.deepEqual(firstAttempt, ["cmd-1", "cmd-2"]);
  assert.deepEqual(
    storage.getStorageSync("offline-checkins").map(item => item.id),
    ["cmd-2", "cmd-3"]
  );

  await queue.flushCheckIns(async item => {
    retry.push(item.id);
    return { ok: true };
  });
  await queue.flushCheckIns(async item => retry.push(item.id));

  assert.deepEqual(retry, ["cmd-2", "cmd-3"]);
  assert.deepEqual(storage.getStorageSync("offline-checkins"), []);
});

test("concurrent flush calls share one drain and never duplicate a command", async () => {
  const { createOfflineCheckIns } = loadModuleWithoutWx();
  const queue = createOfflineCheckIns(createStorage());
  const sent = [];
  queue.enqueueCheckIn(command("cmd-1", "2026-09-03"));

  let acknowledge;
  const send = async item => {
    sent.push(item.id);
    await new Promise(resolve => { acknowledge = resolve; });
    return { ok: true };
  };
  const first = queue.flushCheckIns(send);
  const second = queue.flushCheckIns(send);
  await new Promise(resolve => setImmediate(resolve));
  acknowledge();
  await Promise.all([first, second]);

  assert.deepEqual(sent, ["cmd-1"]);
});
