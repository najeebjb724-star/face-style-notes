const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");

const {
  createChallengeApi,
  createClientSafeMain
} = require("../../cloudfunctions/challengeApi");

test("cloud entry returns only trusted business errors in a client-safe envelope", async () => {
  const conflict = createClientSafeMain(async () => {
    const error = new Error("ACTIVE_CHALLENGE_EXISTS");
    error.code = "ACTIVE_CHALLENGE_EXISTS";
    throw error;
  });
  assert.deepEqual(await conflict({}), {
    error: { code: "ACTIVE_CHALLENGE_EXISTS", message: "ACTIVE_CHALLENGE_EXISTS" }
  });

  const incomplete = createClientSafeMain(async () => {
    const error = new Error("CHALLENGE_NOT_COMPLETE");
    error.code = "CHALLENGE_NOT_COMPLETE";
    throw error;
  });
  assert.deepEqual(await incomplete({}), {
    error: { code: "CHALLENGE_NOT_COMPLETE", message: "CHALLENGE_NOT_COMPLETE" }
  });

  const unexpected = createClientSafeMain(async () => {
    const error = new Error("database host leaked");
    error.code = "DATABASE_FAILURE";
    throw error;
  });
  await assert.rejects(unexpected({}), /database host leaked/);
});

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
          async set(data) {
            assert.equal(Object.hasOwn(data, "data"), false, "transaction set receives a direct document");
            const record = { _id: id, ...data };
            const index = records.findIndex(item => item._id === id);
            if (index === -1) records.push(record);
            else records[index] = record;
            return { _id: id };
          },
          async update(data) {
            assert.equal(Object.hasOwn(data, "data"), false, "transaction update receives a direct document");
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

function createApi(database, openid = "openid-A", options = {}) {
  return createChallengeApi({
    database,
    getWXContext: () => ({ OPENID: openid }),
    now: () => new Date("2026-09-03T08:00:00.000Z"),
    ...options
  });
}

function createOptimisticCreateDatabase() {
  const challenges = [];
  const owners = new Map();
  const metrics = { initialOwnerReads: 0, conflicts: 0 };
  let releaseInitialReads;
  const initialReadsReady = new Promise(resolve => { releaseInitialReads = resolve; });

  async function run(work) {
    const initialOwner = owners.get("openid-A");
    let nextOwner;
    let nextChallenge;
    const transaction = {
      collection(name) {
        if (name === "challengeOwners") {
          return {
            doc(id) {
              return {
                async get() {
                  if (!owners.get(id)) {
                    metrics.initialOwnerReads += 1;
                    if (metrics.initialOwnerReads === 2) releaseInitialReads();
                    await initialReadsReady;
                  }
                  const record = owners.get(id);
                  return { data: record ? { ...record } : null };
                },
                async set(data) {
                  assert.equal(Object.hasOwn(data, "data"), false);
                  nextOwner = { _id: id, ...data };
                }
              };
            }
          };
        }
        if (name === "challenges") {
          const query = {
            where(filters) {
              query.filters = filters;
              return query;
            },
            limit() { return query; },
            async get() {
              return { data: challenges.filter(record => Object.entries(query.filters).every(
                ([key, value]) => record[key] === value
              )).map(record => ({ ...record })) };
            },
            doc(id) {
              return {
                async set(data) {
                  assert.equal(Object.hasOwn(data, "data"), false);
                  nextChallenge = { _id: id, ...data };
                }
              };
            }
          };
          return query;
        }
        throw new Error(`unexpected collection ${name}`);
      }
    };

    await work(transaction);
    if (JSON.stringify(owners.get("openid-A")) !== JSON.stringify(initialOwner)) {
      metrics.conflicts += 1;
      return run(work);
    }
    if (nextOwner) owners.set("openid-A", nextOwner);
    if (nextChallenge) challenges.push(nextChallenge);
    return { ok: true };
  }

  return {
    runTransaction: run,
    metrics,
    snapshot(name) {
      if (name === "challenges") return challenges.map(record => ({ ...record }));
      return [];
    }
  };
}

function checkinId(openid, challengeId, date) {
  return `checkin-${createHash("sha256").update(JSON.stringify([openid, challengeId, date])).digest("hex")}`;
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
    _id: checkinId("openid-A", "c1", "2026-09-03"),
    _openid: "openid-A",
    challengeId: "c1",
    date: "2026-09-03",
    completed: true,
    commandId: "cmd-replay",
    updatedAt: "SERVER_DATE"
  }]);
});

test("future check-ins are rejected against the trusted China business date", async () => {
  const database = createDatabase({ challenges: [challenge({ durationDays: 7 })], checkins: [] });
  const api = createApi(database, "openid-A", {
    now: () => new Date("2026-09-03T16:30:00.000Z")
  });

  await assert.rejects(api({
    action: "checkIn",
    payload: { id: "future-command", challengeId: "c1", date: "2026-09-05" }
  }), error => error.code === "INVALID_ARGUMENT");
  assert.deepEqual(database.snapshot("checkins"), []);
});

test("old queued check-ins cannot write outside the challenge occurrence schedule", async () => {
  const database = createDatabase({
    challenges: [challenge({ durationDays: 8, frequency: "weekly" })],
    checkins: []
  });
  const api = createApi(database);

  for (const date of ["2026-09-02", "2026-09-04", "2026-09-11"]) {
    await assert.rejects(api({
      action: "checkIn",
      payload: { id: `old-${date}`, challengeId: "c1", date }
    }), error => error.code === "INVALID_ARGUMENT");
  }
  assert.deepEqual(database.snapshot("checkins"), []);
});

test("undo only corrects an existing completed occurrence", async () => {
  const emptyDatabase = createDatabase({ challenges: [challenge()], checkins: [] });
  await assert.rejects(createApi(emptyDatabase)({
    action: "undoCheckIn",
    payload: { id: "old-undo", challengeId: "c1", date: "2026-09-03" }
  }), error => error.code === "INVALID_ARGUMENT");
  assert.deepEqual(emptyDatabase.snapshot("checkins"), []);

  const database = createDatabase({
    challenges: [challenge()],
    checkins: [{
      _id: checkinId("openid-A", "c1", "2026-09-03"),
      _openid: "openid-A",
      challengeId: "c1",
      date: "2026-09-03",
      completed: true
    }]
  });
  const result = await createApi(database)({
    action: "undoCheckIn",
    payload: { id: "correct-undo", challengeId: "c1", date: "2026-09-03" }
  });
  assert.equal(result.ok, true);
  assert.equal(database.snapshot("checkins")[0].completed, false);
});

test("replayed undo remains acknowledged after the existing record is already corrected", async () => {
  const database = createDatabase({
    challenges: [challenge()],
    checkins: [{
      _id: checkinId("openid-A", "c1", "2026-09-03"),
      _openid: "openid-A",
      challengeId: "c1",
      date: "2026-09-03",
      completed: true
    }]
  });
  const api = createApi(database);
  const request = {
    action: "undoCheckIn",
    payload: { id: "retryable-undo", challengeId: "c1", date: "2026-09-03" }
  };

  assert.equal((await api(request)).ok, true);
  assert.equal((await api(request)).ok, true);
  assert.equal(database.snapshot("checkins")[0].completed, false);
});

test("check-in document ids are stable and unambiguous around underscores", async () => {
  const database = createDatabase({
    challenges: [
      challenge({ _id: "c_1", id: "c_1", _openid: "owner_a" }),
      challenge({ _id: "1", id: "1", _openid: "owner_a_c" })
    ],
    checkins: []
  });

  await createApi(database, "owner_a")({
    action: "checkIn",
    payload: { id: "cmd-1", challengeId: "c_1", date: "2026-09-03" }
  });
  await createApi(database, "owner_a_c")({
    action: "checkIn",
    payload: { id: "cmd-2", challengeId: "1", date: "2026-09-03" }
  });

  const ids = database.snapshot("checkins").map(item => item._id);
  assert.deepEqual(ids, [
    checkinId("owner_a", "c_1", "2026-09-03"),
    checkinId("owner_a_c", "1", "2026-09-03")
  ]);
  assert.notEqual(ids[0], ids[1]);
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

test("owner lock survives concurrent reads through an optimistic transaction retry", async () => {
  const database = createOptimisticCreateDatabase();
  const payload = { templateId: "custom", title: "每天喝水", taskLabel: "喝水", durationDays: 7 };
  const ids = ["uuid-one", "uuid-two"];
  const api = createApi(database, "openid-A", { createChallengeId: () => ids.shift() });

  const results = await Promise.allSettled([
    api({ action: "create", payload }),
    api({ action: "create", payload })
  ]);

  assert.equal(database.metrics.initialOwnerReads, 2);
  assert.equal(database.metrics.conflicts, 1);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(results.filter(result => result.reason?.code === "ACTIVE_CHALLENGE_EXISTS").length, 1);
  assert.equal(database.snapshot("challenges").length, 1);
});

test("creation uses injected globally unique ids across owners in the same millisecond", async () => {
  const database = createDatabase({ challenges: [], checkins: [], challengeOwners: [] });
  const payload = {
    templateId: "custom",
    title: "每天喝水",
    taskLabel: "喝水",
    durationDays: 7,
    frequency: "daily"
  };
  const ids = ["uuid-owner-a", "uuid-owner-b"];

  const created = await Promise.all([
    createApi(database, "openid-A", { createChallengeId: () => ids.shift() })({ action: "create", payload }),
    createApi(database, "openid-B", { createChallengeId: () => ids.shift() })({ action: "create", payload })
  ]);

  assert.deepEqual(created.map(item => item._id), ["uuid-owner-a", "uuid-owner-b"]);
  assert.deepEqual(database.snapshot("challenges").map(item => item._id).sort(), ["uuid-owner-a", "uuid-owner-b"]);
});

test("creation always uses the trusted China business date instead of client startedAt", async () => {
  const database = createDatabase({ challenges: [], checkins: [], challengeOwners: [] });
  const created = await createApi(database, "openid-A", {
    now: () => new Date("2026-09-03T16:30:00.000Z"),
    createChallengeId: () => "trusted-date-id"
  })({
    action: "create",
    payload: {
      templateId: "custom",
      title: "每天喝水",
      durationDays: 7,
      startedAt: "2099-12-31"
    }
  });

  assert.equal(created.startedAt, "2026-09-04");
});

test("finish rejects an incomplete challenge without changing challenge or owner state", async () => {
  const original = challenge({ durationDays: 2 });
  const database = createDatabase({
    challenges: [original],
    checkins: [{
      _id: checkinId("openid-A", "c1", "2026-09-03"),
      _openid: "openid-A",
      challengeId: "c1",
      date: "2026-09-03",
      completed: true
    }],
    challengeOwners: [{ _id: "openid-A", activeChallengeId: "c1" }]
  });

  await assert.rejects(createApi(database)({
    action: "finish",
    payload: { challengeId: "c1" }
  }), error => error.code === "CHALLENGE_NOT_COMPLETE");
  assert.deepEqual(database.snapshot("challenges"), [original]);
  assert.equal(database.snapshot("challengeOwners")[0].activeChallengeId, "c1");
});

test("finish rejects a forged future date without changing completed-eligible state", async () => {
  const original = challenge();
  const database = createDatabase({
    challenges: [original],
    checkins: [{
      _id: checkinId("openid-A", "c1", "2026-09-03"),
      _openid: "openid-A",
      challengeId: "c1",
      date: "2026-09-03",
      completed: true
    }],
    challengeOwners: [{ _id: "openid-A", activeChallengeId: "c1" }]
  });

  await assert.rejects(createApi(database, "openid-A", {
    now: () => new Date("2026-09-03T16:30:00.000Z")
  })({
    action: "finish",
    payload: { challengeId: "c1", date: "2099-12-31" }
  }), error => error.code === "INVALID_ARGUMENT");
  assert.deepEqual(database.snapshot("challenges"), [original]);
  assert.equal(database.snapshot("challengeOwners")[0].activeChallengeId, "c1");
});

test("finish derives its date from trusted China time and ends active state", async () => {
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
  const result = await createApi(database, "openid-A", {
    now: () => new Date("2026-09-03T16:30:00.000Z")
  })({
    action: "finish",
    payload: { challengeId: "c1" }
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
  assert.equal(packageJson.devDependencies.esbuild, "0.25.0");
  assert.equal(packageLock.lockfileVersion, 3);
  assert.equal(packageLock.packages[""].dependencies["wx-server-sdk"], "4.0.2");
  assert.equal(packageLock.packages["node_modules/wx-server-sdk"].version, "4.0.2");
  assert.equal(packageLock.packages["node_modules/esbuild"].version, "0.25.0");
});

test("deployment package is self-contained and generated entry is current", () => {
  const packageRoot = path.join(__dirname, "../../cloudfunctions/challengeApi");
  assert.equal(fs.existsSync(path.join(packageRoot, "src/index.js")), true);
  execFileSync(process.execPath, ["build.js", "--check"], { cwd: packageRoot, stdio: "pipe" });

  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "challenge-api-"));
  try {
    const isolatedPackage = path.join(temporaryRoot, "challengeApi");
    fs.cpSync(packageRoot, isolatedPackage, { recursive: true, filter: source => !source.includes("node_modules") });
    const isolated = require(path.join(isolatedPackage, "index.js"));
    assert.equal(typeof isolated.createChallengeApi, "function");
    assert.equal(typeof isolated.main, "function");
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("build check detects source changes without esbuild installed", () => {
  const packageRoot = path.join(__dirname, "../../cloudfunctions/challengeApi");
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "challenge-api-stale-"));
  try {
    const isolatedRoot = path.join(temporaryRoot, "repo");
    const isolatedPackage = path.join(isolatedRoot, "cloudfunctions", "challengeApi");
    fs.cpSync(packageRoot, isolatedPackage, { recursive: true, filter: source => !source.includes("node_modules") });
    fs.mkdirSync(path.join(isolatedRoot, "shared"), { recursive: true });
    fs.mkdirSync(path.join(isolatedRoot, "miniprogram", "lib"), { recursive: true });
    fs.copyFileSync(path.join(packageRoot, "../../shared/cloud-guards.js"), path.join(isolatedRoot, "shared/cloud-guards.js"));
    fs.copyFileSync(path.join(packageRoot, "../../miniprogram/lib/face-style-core.js"), path.join(isolatedRoot, "miniprogram/lib/face-style-core.js"));
    fs.appendFileSync(path.join(isolatedPackage, "src/index.js"), "\n// stale test\n");
    assert.throws(
      () => execFileSync(process.execPath, ["build.js", "--check"], { cwd: isolatedPackage, stdio: "pipe" }),
      error => /challengeApi build is stale/.test(error.stderr.toString())
    );
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("build check detects generated entry corruption without esbuild installed", () => {
  const packageRoot = path.join(__dirname, "../../cloudfunctions/challengeApi");
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "challenge-api-corrupt-"));
  try {
    const isolatedRoot = path.join(temporaryRoot, "repo");
    const isolatedPackage = path.join(isolatedRoot, "cloudfunctions", "challengeApi");
    fs.cpSync(packageRoot, isolatedPackage, { recursive: true, filter: source => !source.includes("node_modules") });
    fs.mkdirSync(path.join(isolatedRoot, "shared"), { recursive: true });
    fs.mkdirSync(path.join(isolatedRoot, "miniprogram", "lib"), { recursive: true });
    fs.copyFileSync(path.join(packageRoot, "../../shared/cloud-guards.js"), path.join(isolatedRoot, "shared/cloud-guards.js"));
    fs.copyFileSync(path.join(packageRoot, "../../miniprogram/lib/face-style-core.js"), path.join(isolatedRoot, "miniprogram/lib/face-style-core.js"));
    fs.appendFileSync(path.join(isolatedPackage, "index.js"), "\n// corrupt generated entry\n");
    assert.throws(
      () => execFileSync(process.execPath, ["build.js", "--check"], { cwd: isolatedPackage, stdio: "pipe" }),
      error => /challengeApi build is stale/.test(error.stderr.toString())
    );
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
