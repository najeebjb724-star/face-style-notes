const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const miniProgramRoot = path.join(__dirname, "../../miniprogram");
const read = relativePath => fs.readFileSync(path.join(miniProgramRoot, relativePath), "utf8");

test("mini program copy keeps the approved palette and avoids prohibited language", () => {
  const approvedColors = new Set([
    "#F7F3EE", "#FFFDF9", "#C9A87C", "#2C2420", "#7A6B5A", "#D4C4B0", "#EDE5D8"
  ]);
  const interfaceFiles = [
    "app.wxss", "pages/home/home.wxml", "pages/home/home.wxss",
    "pages/challenges/challenges.wxml", "pages/challenges/challenges.wxss",
    "pages/profile/profile.wxml", "pages/profile/profile.wxss"
  ];
  const prohibitedCopy = ["AI分析中", "扫描中", "颜值评分", "缺点"];

  for (const file of interfaceFiles) {
    const source = read(file);
    for (const color of source.match(/#[0-9a-fA-F]{6}/g) || []) {
      assert.ok(approvedColors.has(color.toUpperCase()), `${file} uses unapproved color ${color}`);
    }
    for (const phrase of prohibitedCopy) {
      assert.ok(!source.includes(phrase), `${file} includes prohibited copy ${phrase}`);
    }
  }
});

test("home provides visitor-safe state and the three stable entry actions", () => {
  let definition;
  const navigations = [];
  vm.runInNewContext(read("pages/home/home.js"), {
    Page(page) {
      definition = page;
    },
    wx: {
      navigateTo(options) {
        navigations.push(options.url);
      },
      switchTab(options) {
        navigations.push(options.url);
      }
    }
  });

  assert.ok(definition.data, "home state is missing");
  assert.deepEqual(JSON.parse(JSON.stringify(definition.data)), {
    latestReport: null,
    activeChallenge: null
  });
  assert.doesNotThrow(() => definition.onShow.call({ setData() {} }));
  definition.startAnalysis();
  definition.openChallenge();
  definition.openLatestReport.call({ data: { latestReport: { id: "report-1" } } });
  assert.deepEqual(navigations, [
    "/pages/consent/consent",
    "/pages/challenges/challenges",
    "/pages/report/report?id=report-1"
  ]);
});

test("home loads available cloud bootstrap state without breaking visitor mode", async () => {
  let definition;
  let requestedFunction;
  vm.runInNewContext(read("pages/home/home.js"), {
    Page(page) {
      definition = page;
    },
    wx: {
      cloud: {
        callFunction(options) {
          requestedFunction = options.name;
          return Promise.resolve({
            result: {
              latestReport: { id: "report-2" },
              activeChallenge: { title: "七日风格练习" }
            }
          });
        }
      }
    }
  });
  assert.equal(typeof definition.onShow, "function", "home cloud loader is missing");
  const updates = [];
  await definition.onShow.call({
    setData(value) {
      updates.push(value);
    }
  });

  assert.equal(requestedFunction, "bootstrapUser");
  assert.deepEqual(JSON.parse(JSON.stringify(updates)), [{
    latestReport: { id: "report-2" },
    activeChallenge: { title: "七日风格练习" }
  }]);
});

test("home presents both new-user entries and stateful entry cards", () => {
  const source = read("pages/home/home.wxml");

  for (const expected of [
    "开始面部解读", "先做一个变美挑战", "activeChallenge", "latestReport",
    "bindtap=\"startAnalysis\"", "bindtap=\"openChallenge\"", "bindtap=\"openLatestReport\""
  ]) {
    assert.ok(source.includes(expected), `home entry is missing ${expected}`);
  }
});

test("task two tabs are safe mobile landing pages", () => {
  for (const page of ["challenges", "profile"]) {
    const markup = read(`pages/${page}/${page}.wxml`);
    const styles = read(`pages/${page}/${page}.wxss`);
    assert.ok(markup.includes("美学身份卡"), `${page} landing page needs an identity heading`);
    assert.match(styles, /min-height:\s*100vh/);
    assert.match(styles, /box-sizing:\s*border-box/);
  }
  const homeStyles = read("pages/home/home.wxss");
  assert.match(homeStyles, /min-height:\s*100vh/);
  assert.match(homeStyles, /min-height:\s*88rpx/);
  assert.match(homeStyles, /box-sizing:\s*border-box/);
});
