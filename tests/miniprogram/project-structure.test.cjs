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

test("mini program interface uses only the approved color palette", () => {
  const approvedColors = new Set([
    "#F7F3EE",
    "#FFFDF9",
    "#C9A87C",
    "#2C2420",
    "#7A6B5A",
    "#D4C4B0",
    "#EDE5D8"
  ]);
  const interfaceFiles = [];
  const collectFiles = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        collectFiles(entryPath);
      } else if ([".json", ".wxml", ".wxss"].includes(path.extname(entry.name))) {
        interfaceFiles.push(entryPath);
      }
    }
  };

  collectFiles(path.join(__dirname, "../../miniprogram"));

  for (const file of interfaceFiles) {
    const colors = fs.readFileSync(file, "utf8").match(/#[0-9a-fA-F]{6}/g) || [];
    for (const color of colors) {
      assert.ok(approvedColors.has(color.toUpperCase()), `${file} uses unapproved color ${color}`);
    }
  }
});
