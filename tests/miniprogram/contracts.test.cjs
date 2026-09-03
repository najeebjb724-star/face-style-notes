const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { assertOwnedRecord } = require("../../shared/cloud-guards");
const { callCloud } = require("../../miniprogram/services/cloud-client");

test("owned records cannot be read by another openid", () => {
  assert.throws(() => assertOwnedRecord({ _openid: "A" }, "B"), error => {
    assert.equal(error.code, "FORBIDDEN");
    assert.equal(error.message, "FORBIDDEN");
    return true;
  });
  assert.doesNotThrow(() => assertOwnedRecord({ _openid: "A" }, "A"));
  assert.throws(() => assertOwnedRecord(null, "A"), /FORBIDDEN/);
  assert.throws(() => assertOwnedRecord({}, undefined), /FORBIDDEN/);
});

test("callCloud returns a successful cloud result", async t => {
  t.after(() => delete global.wx);
  let request;
  global.wx = {
    cloud: {
      callFunction(options) {
        request = options;
        return Promise.resolve({ result: { userId: "user-1" } });
      }
    }
  };

  const result = await callCloud("bootstrapUser", { source: "home" });

  assert.deepEqual(request, {
    name: "bootstrapUser",
    data: { source: "home" }
  });
  assert.deepEqual(result, { userId: "user-1" });
});

test("callCloud propagates a structured cloud error", async t => {
  t.after(() => delete global.wx);
  const cloudError = { code: "FORBIDDEN", message: "FORBIDDEN" };
  global.wx = {
    cloud: {
      callFunction() {
        return Promise.resolve({ result: { error: cloudError } });
      }
    }
  };

  await assert.rejects(callCloud("privateAction", {}), error => {
    assert.deepEqual(error, cloudError);
    return true;
  });
});

for (const [name, callFunction] of [
  ["synchronous runtime failures", () => { throw new Error("offline"); }],
  ["asynchronous transport failures", () => Promise.reject(new Error("offline"))]
]) {
  test(`callCloud normalizes ${name}`, async t => {
    t.after(() => delete global.wx);
    global.wx = { cloud: { callFunction } };

    await assert.rejects(callCloud("bootstrapUser", {}), error => {
      assert.deepEqual(error, {
        code: "CLOUD_UNAVAILABLE",
        message: "暂时无法连接，请稍后重试"
      });
      return true;
    });
  });
}

test("error state exposes one recoverable retry action", () => {
  const componentRoot = path.join(
    __dirname,
    "../../miniprogram/components/error-state"
  );
  let definition;
  vm.runInNewContext(
    fs.readFileSync(path.join(componentRoot, "error-state.js"), "utf8"),
    { Component(value) { definition = value; } }
  );
  const events = [];

  definition.methods.retry.call({
    triggerEvent(name) {
      events.push(name);
    }
  });

  assert.deepEqual(events, ["retry"]);
  assert.match(
    fs.readFileSync(path.join(componentRoot, "error-state.wxml"), "utf8"),
    /bindtap="retry"/
  );
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(componentRoot, "error-state.json"), "utf8")).component,
    true
  );
});
