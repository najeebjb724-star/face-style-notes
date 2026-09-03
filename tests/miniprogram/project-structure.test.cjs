const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

test("mini program declares the approved three tabs", () => {
  const app = JSON.parse(fs.readFileSync(path.join(__dirname, "../../miniprogram/app.json"), "utf8"));
  assert.deepEqual(app.tabBar.list.map(item => item.pagePath), [
    "pages/home/home", "pages/challenges/challenges", "pages/profile/profile"
  ]);
});

test("cloud environment lookup supports each release channel before configuration", () => {
  const { getCloudEnv } = require("../../miniprogram/config/env");

  assert.equal(getCloudEnv("develop"), "");
  assert.equal(getCloudEnv("trial"), "");
  assert.equal(getCloudEnv("release"), "");
});

test("app launch skips cloud initialization in local visitor mode", () => {
  let app;
  let initializationCount = 0;
  const source = fs.readFileSync(path.join(__dirname, "../../miniprogram/app.js"), "utf8");

  vm.runInNewContext(source, {
    App(definition) {
      app = definition;
    },
    wx: {
      cloud: {
        init() {
          initializationCount += 1;
        }
      }
    },
    require(moduleName) {
      if (moduleName === "./config/env") {
        return require("../../miniprogram/config/env");
      }
      throw new Error(`Unexpected module: ${moduleName}`);
    }
  });

  app.onLaunch();

  assert.equal(initializationCount, 0);
});
