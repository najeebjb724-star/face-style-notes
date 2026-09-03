const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createBootstrapUser
} = require("../../cloudfunctions/bootstrapUser");

function createDatabase(seed) {
  const collections = Object.fromEntries(
    Object.entries(seed).map(([name, records]) => [name, records.map(record => ({ ...record }))])
  );

  return {
    serverDate() {
      return "SERVER_DATE";
    },
    collection(name) {
      const records = collections[name] || (collections[name] = []);
      let filters = {};
      let order;
      let maximum;

      const query = {
        where(value) {
          filters = value;
          return query;
        },
        orderBy(field, direction) {
          order = { field, direction };
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
          if (order) {
            const multiplier = order.direction === "desc" ? -1 : 1;
            data = [...data].sort(
              (left, right) => (left[order.field] - right[order.field]) * multiplier
            );
          }
          if (maximum !== undefined) data = data.slice(0, maximum);
          return { data: data.map(record => ({ ...record })) };
        },
        async add({ data }) {
          const record = { _id: `${name}-generated`, ...data };
          records.push(record);
          return { _id: record._id };
        }
      };

      return query;
    },
    snapshot(name) {
      return collections[name].map(record => ({ ...record }));
    }
  };
}

test("bootstrapUser trusts runtime OPENID and returns only its latest private state", async () => {
  const database = createDatabase({
    users: [
      { _id: "user-a", _openid: "A" },
      { _id: "user-b", _openid: "B" }
    ],
    reports: [
      { _id: "report-a-old", _openid: "A", createdAt: 1 },
      { _id: "report-a-latest", _openid: "A", createdAt: 2 },
      { _id: "report-b-private", _openid: "B", createdAt: 99 }
    ],
    challenges: [
      { _id: "challenge-a-ended", _openid: "A", status: "completed", createdAt: 20 },
      { _id: "challenge-a-active", _openid: "A", status: "active", createdAt: 10 },
      { _id: "challenge-b-private", _openid: "B", status: "active", createdAt: 99 }
    ]
  });
  const bootstrapUser = createBootstrapUser({
    database,
    getWXContext: () => ({ OPENID: "A" })
  });

  const result = await bootstrapUser({ _openid: "B" }, {});

  assert.deepEqual(result, {
    userId: "user-a",
    latestReport: { _id: "report-a-latest", _openid: "A", createdAt: 2 },
    activeChallenge: {
      _id: "challenge-a-active",
      _openid: "A",
      status: "active",
      createdAt: 10
    }
  });
  assert.ok(!JSON.stringify(result).includes("private"));
});

test("bootstrapUser creates a missing user from the trusted runtime identity", async () => {
  const database = createDatabase({ users: [], reports: [], challenges: [] });
  const bootstrapUser = createBootstrapUser({
    database,
    getWXContext: () => ({ OPENID: "trusted-user" })
  });

  const result = await bootstrapUser({ _openid: "forged-user" }, {});

  assert.deepEqual(result, {
    userId: "users-generated",
    latestReport: null,
    activeChallenge: null
  });
  assert.deepEqual(database.snapshot("users"), [{
    _id: "users-generated",
    _openid: "trusted-user",
    createdAt: "SERVER_DATE"
  }]);
});

test("bootstrapUser never falls back to a client identity", async () => {
  const database = createDatabase({ users: [], reports: [], challenges: [] });
  const bootstrapUser = createBootstrapUser({
    database,
    getWXContext: () => ({})
  });

  await assert.rejects(
    bootstrapUser({ _openid: "forged-user" }, {}),
    error => {
      assert.equal(error.code, "UNAUTHENTICATED");
      return true;
    }
  );
  assert.deepEqual(database.snapshot("users"), []);
});
