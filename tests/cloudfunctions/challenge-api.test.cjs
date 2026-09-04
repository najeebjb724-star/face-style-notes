const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  createChallengeApi
} = require("../../cloudfunctions/challengeApi");

function createDatabase(seed = {}) {
  const collections = Object.fromEntries(
    Object.entries(seed).map(([name, records]) => [name, records.map(record => ({ ...record }))])
  );
  let transactionTail = Promise.resolve();

  function collection(name) {
    const records = collections[name] || (collections[name] = []);
    let filters = {};
    let maximum;

    const query = {
      where(value) {
        filters = value;
        return query;
      },
      limit(value) {
        maximum = value;
        return query;
      },
      async get() {
        let data = records.filter(record => Object.entries(filters).every(
          ([key, value]) => record[key] === value
        ));
        if (maximum !== undefined) data = data.slice(0, maximum);
        return { data: data.map(record => ({ ...record })) };
      },
      async remove() {
        const retained = records.filter(record => !Object.entries(filters).every(
          ([key, value]) => record[key] === value
        ));
        const removed = records.length - retained.length;
        collections[name] = retained;
        return { stats: { removed } };
      },
      doc(id) {
        return {
          async get() {
            const record = records.find(item => item._id === id);
            return { data: record ? { ...record } : null };
          },
          async set({ data }) {
            const record = { _id: id, ...data };
            const index = records.findIndex(item => item._id === id);
            if (index === -1) records.push(record);
            else records[index] = record;
            return { _id: id };
          },
          async update({ data }) {
            const index = records.findIndex(item => item._id === id);
            if (index === -1) throw new Error("NOT_FOUND");
            records[index] = { ...records[index], ...data };
            return { stats: { updated: 1 } };
          },
          async remove() {
            const index = records.findIndex(item => item._id === id);
            if (index !== -1) records.splice(index, 1);
            return { stats: { removed: index === -1 ? 0 : 1 } };
          }
        };
      }
    };

    return query;
  }

  return {
    serverDate() {
      return "SERVER_DATE";
    },
    collection,
    runTransaction(work) {
      const result = transactionTail.then(() => work({ collection }));
      transactionTail = result.catch(() => undefined);
      return result;
    },
    snapshot(name) {
      return (collections[name] || []).map(record => ({ ...record }));
    }
  };
}

function challenge(overrides = {}) {
  return {
    _id: "c1",
    id: "c1",
    _openid: "openid-A",
    version: 2,
    templateId: "custom",
    title: "喝水",
    kind: "custom",
    durationDays: 2,
    frequency: "daily",
    reminderTime: "21:30",
    startedAt: "2026-09-03",
    taskLabel: "喝水",
    tutorials: [],
    photoDays: [],
    taskDays: [],
    checkIns: {},
    status: "active",
    createdAt: "2026-09-03T00:00:00.000Z",
    ...overrides
  };
}

function createApi(database, openid = "openid-A") {
  return createChallengeApi({
    database,
    getWXContext: () => ({ OPENID: openid }),
    now: () => new Date("2026-09-03T08:00:00.000Z")
  });
}

test("replayed check-in command creates one owner-and-date record", async () => {
  const database = createDatabase({ challenges: [challenge()], checkins: [] });
  const api = createApi(database);
  const command = {
    id: "cmd-1",
    challengeId: "c1",
    date: "2026-09-03",
    completed: true,
    _openid: "forged-user"
  };

  await api({ action: "checkIn", payload: command });
  await api({ action: "checkIn", payload: { ...command, id: "cmd-replay" } });

  assert.deepEqual(database.snapshot("checkins"), [{
    _id: "openid-A_c1_2026-09-03",
    _openid: "openid-A",
    challengeId: "c1",
    date: "2026-09-03",
    completed: true,
    commandId: "cmd-replay",
    updatedAt: "SERVER_DATE"
  }]);
});

test("trusted runtime identity gates every challenge read and mutation", async () => {
  const database = createDatabase({
    challenges: [challenge({ _openid: "openid-B" })],
    checkins: []
  });
  const api = createApi(database, "openid-A");

  assert.equal(await api({ action: "getActive", payload: { _openid: "openid-B" } }), null);
  for (const action of ["checkIn", "undoCheckIn", "finish", "delete"]) {
    await assert.rejects(
      api({
        action,
        payload: {
          id: "cmd-1",
          challengeId: "c1",
          date: "2026-09-03",
          _openid: "openid-B"
        }
      }),
      error => error.code === "FORBIDDEN"
    );
  }
  assert.deepEqual(database.snapshot("challenges"), [challenge({ _openid: "openid-B" })]);
  assert.deepEqual(database.snapshot("checkins"), []);
});

test("concurrent creation allows only one active challenge for an owner", async () => {
  const database = createDatabase({ challenges: [], checkins: [], challengeOwners: [] });
  const api = createApi(database);
  const payload = {
    templateId: "custom",
    title: "每天喝水",
    taskLabel: "喝水",
    durationDays: 7,
    frequency: "daily"
  };

  const results = await Promise.allSettled([
    api({ action: "create", payload }),
    api({ action: "create", payload })
  ]);

  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(results.filter(result => result.reason?.code === "ACTIVE_CHALLENGE_EXISTS").length, 1);
  assert.equal(database.snapshot("challenges").filter(item => item.status === "active").length, 1);
});

test("finish derives history from shared challenge functions and ends active state", async () => {
  const database = createDatabase({
    challenges: [challenge()],
    checkins: [{
      _id: "openid-A_c1_2026-09-03",
      _openid: "openid-A",
      challengeId: "c1",
      date: "2026-09-03",
      completed: true
    }],
    challengeOwners: [{ _id: "openid-A", activeChallengeId: "c1" }]
  });
  const result = await createApi(database)({
    action: "finish",
    payload: { challengeId: "c1", date: "2026-09-04" }
  });

  assert.equal(result.status, "completed");
  assert.deepEqual(result.history, {
    id: "c1",
    title: "喝水",
    startedAt: "2026-09-03",
    completedAt: "2026-09-04",
    durationDays: 2,
    total: 2,
    completed: 1,
    completionRate: 50,
    streak: 0
  });
  assert.equal(database.snapshot("challengeOwners")[0].activeChallengeId, null);
});

test("delete removes only the owned challenge and its check-ins", async () => {
  const database = createDatabase({
    challenges: [challenge(), challenge({ _id: "c2", id: "c2", _openid: "openid-B" })],
    checkins: [
      { _id: "a", _openid: "openid-A", challengeId: "c1" },
      { _id: "b", _openid: "openid-B", challengeId: "c2" }
    ],
    challengeOwners: [{ _id: "openid-A", activeChallengeId: "c1" }],
    photos: [{ _id: "photo-1", challengeId: "c1" }],
    reminders: [{ _id: "reminder-1", challengeId: "c1" }]
  });

  await createApi(database)({ action: "delete", payload: { challengeId: "c1" } });

  assert.deepEqual(database.snapshot("challenges").map(item => item._id), ["c2"]);
  assert.deepEqual(database.snapshot("checkins").map(item => item._id), ["b"]);
  assert.equal(database.snapshot("challengeOwners")[0].activeChallengeId, null);
  assert.equal(database.snapshot("photos").length, 1);
  assert.equal(database.snapshot("reminders").length, 1);
});

test("challenge API rejects missing runtime identity and unknown actions", async () => {
  const database = createDatabase({ challenges: [] });
  await assert.rejects(
    createApi(database, null)({ action: "getActive" }),
    error => error.code === "UNAUTHENTICATED"
  );
  await assert.rejects(
    createApi(database)({ action: "replaceAll", payload: {} }),
    error => error.code === "INVALID_ACTION"
  );
});

test("challengeApi pins the CloudBase SDK and commits an npm lockfile", () => {
  const packageRoot = path.join(__dirname, "../../cloudfunctions/challengeApi");
  const packageJson = JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"));
  const packageLock = JSON.parse(fs.readFileSync(path.join(packageRoot, "package-lock.json"), "utf8"));

  assert.equal(packageJson.dependencies["wx-server-sdk"], "4.0.2");
  assert.equal(packageLock.lockfileVersion, 3);
  assert.equal(packageLock.packages[""].dependencies["wx-server-sdk"], "4.0.2");
  assert.equal(packageLock.packages["node_modules/wx-server-sdk"].version, "4.0.2");
});
