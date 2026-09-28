const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

test("unbundled cloud entries keep runtime dependencies inside their function directory", () => {
  for (const name of ["bootstrapUser", "reminderApi", "shareApi"]) {
    const directory = path.join(__dirname, "../../cloudfunctions", name);
    const source = fs.readFileSync(path.join(directory, "index.js"), "utf8");
    for (const match of source.matchAll(/require\(["'](\.[^"']+)["']\)/g)) {
      const resolved = path.resolve(directory, match[1]);
      assert.ok(resolved.startsWith(`${directory}${path.sep}`), `${name} imports outside its deployable directory`);
      assert.ok(fs.existsSync(`${resolved}.js`) || fs.existsSync(resolved), `${name} dependency is missing: ${match[1]}`);
    }
  }
});

test("mini program declares the approved three tabs", () => {
  const app = JSON.parse(fs.readFileSync(path.join(__dirname, "../../miniprogram/app.json"), "utf8"));
  assert.deepEqual(app.tabBar.list.map(item => item.pagePath), [
    "pages/home/home", "pages/challenges/challenges", "pages/profile/profile"
  ]);
});

test("mini program project uses the registered public AppID", () => {
  const project = JSON.parse(fs.readFileSync(path.join(__dirname, "../../project.config.json"), "utf8"));

  assert.equal(project.appid, "wx7ea0d886cbaea650");
});

test("cloud environment lookup uses the free environment only before release", () => {
  const { getCloudEnv } = require("../../miniprogram/config/env");

  assert.equal(getCloudEnv("develop"), "cloud1-d0gi550jk9a2f9337");
  assert.equal(getCloudEnv("trial"), "cloud1-d0gi550jk9a2f9337");
  assert.equal(getCloudEnv("release"), "");
});

test("app launch selects the CloudBase environment from the runtime version", () => {
  let app;
  let initializedWith;
  const source = fs.readFileSync(path.join(__dirname, "../../miniprogram/app.js"), "utf8");

  vm.runInNewContext(source, {
    App(definition) {
      app = definition;
    },
    wx: {
      getAccountInfoSync() {
        return { miniProgram: { envVersion: "trial" } };
      },
      cloud: {
        init(options) {
          initializedWith = options;
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

  assert.deepEqual(JSON.parse(JSON.stringify(initializedWith)), {
    env: "cloud1-d0gi550jk9a2f9337",
    traceUser: true
  });
});

test("app launch does not connect the release build to the development environment", () => {
  let app;
  let initializationCount = 0;
  const source = fs.readFileSync(path.join(__dirname, "../../miniprogram/app.js"), "utf8");

  vm.runInNewContext(source, {
    App(definition) {
      app = definition;
    },
    wx: {
      getAccountInfoSync() {
        return { miniProgram: { envVersion: "release" } };
      },
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
