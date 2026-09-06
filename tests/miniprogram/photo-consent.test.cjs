const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "../../miniprogram");
const read = relativePath => fs.readFileSync(path.join(root, relativePath), "utf8");

function loadWebCore() {
  const html = fs.readFileSync(path.join(root, "../index.html"), "utf8");
  const source = html.match(/<script id="face-style-core">([\s\S]*?)<\/script>/)[1];
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(source, context);
  return context.window.FaceStyleCore;
}

function loadPage(relativePath, dependencies = {}, wxOverrides = {}) {
  let definition;
  const wx = {
    navigateTo() {},
    switchTab() {},
    showToast() {},
    ...wxOverrides
  };
  vm.runInNewContext(read(relativePath), {
    Page(page) { definition = page; },
    wx,
    Date,
    Promise,
    require(moduleName) {
      if (!(moduleName in dependencies)) throw new Error(`unexpected require: ${moduleName}`);
      return dependencies[moduleName];
    }
  });
  return { definition, wx };
}

function frontLandmarks() {
  const points = Array.from({ length: 68 }, (_, index) => ({ x: 100 + index, y: 100 }));
  points[0] = { x: 100, y: 180 };
  points[16] = { x: 300, y: 180 };
  points[30] = { x: 200, y: 170 };
  [36, 37, 38, 39, 40, 41].forEach((index, offset) => { points[index] = { x: 150 + offset, y: 140 }; });
  [42, 43, 44, 45, 46, 47].forEach((index, offset) => { points[index] = { x: 240 + offset, y: 140 }; });
  return points;
}

function goodSignals(overrides = {}) {
  return {
    detectionScore: 0.9,
    faceBox: { width: 260, height: 320 },
    imageSize: { width: 800, height: 1000 },
    points: frontLandmarks(),
    laplacianVariance: 90,
    meanBrightness: 130,
    ...overrides
  };
}

test("face analysis requires its own current and parseable consent", () => {
  const { createFaceConsent, assertFaceConsent } = require("../../miniprogram/lib/photo-preflight");
  for (const invalid of [
    null,
    { type: "challenge-photo", version: "2026-09-03", acceptedAt: "2026-09-03T00:00:00.000Z" },
    { type: "face-analysis", version: "old", acceptedAt: "2026-09-03T00:00:00.000Z" },
    { type: "face-analysis", version: "2026-09-03", acceptedAt: "not-a-date" }
  ]) assert.throws(() => assertFaceConsent(invalid), /CONSENT_REQUIRED/);

  const consent = createFaceConsent(new Date("2026-09-03T10:20:30.000Z"));
  assert.deepEqual(consent, {
    type: "face-analysis",
    version: "2026-09-03",
    acceptedAt: "2026-09-03T10:20:30.000Z"
  });
  assert.equal(assertFaceConsent(consent), consent);
});

test("photo dimensions fit inside 1600px without upscaling", () => {
  const { fitPhotoDimensions } = require("../../miniprogram/lib/photo-preflight");
  assert.deepEqual(fitPhotoDimensions(3200, 2400), { width: 1600, height: 1200 });
  assert.deepEqual(fitPhotoDimensions(900, 1800), { width: 800, height: 1600 });
  assert.deepEqual(fitPhotoDimensions(640, 480), { width: 640, height: 480 });
  assert.throws(() => fitPhotoDimensions(0, 480), /PHOTO_DIMENSIONS_INVALID/);
});

test("mini-program quality gate keeps the web thresholds and explicit reference override", () => {
  const core = require("../../miniprogram/lib/face-style-core");
  const web = loadWebCore();
  const accepted = core.evaluatePhotoQuality(goodSignals());
  assert.equal(accepted.accepted, true);
  assert.deepEqual(accepted, JSON.parse(JSON.stringify(web.evaluatePhotoQuality(goodSignals()))));

  const rejected = core.evaluatePhotoQuality(goodSignals({
    faceBox: { width: 140, height: 170 },
    laplacianVariance: 30,
    meanBrightness: 40
  }));
  assert.deepEqual(rejected.issues.map(issue => issue.id), ["face_too_small", "blurry", "too_dark"]);
  const webRejected = web.evaluatePhotoQuality(goodSignals({
    faceBox: { width: 140, height: 170 },
    laplacianVariance: 30,
    meanBrightness: 40
  }));
  assert.deepEqual(rejected, JSON.parse(JSON.stringify(webRejected)));
  const overridden = core.overridePhotoQuality(rejected);
  assert.equal(overridden.accepted, true);
  assert.equal(overridden.overridden, true);
  assert.equal(overridden.referenceOnly, true);
  assert.deepEqual(overridden.issues, rejected.issues);
});

test("consent accepts or declines without sharing challenge-photo state", () => {
  const writes = [];
  const removals = [];
  const navigations = [];
  const { definition } = loadPage("pages/consent/consent.js", {
    "../../lib/photo-preflight": {
      FACE_CONSENT_STORAGE_KEY: "face-analysis-consent",
      createFaceConsent: () => ({ type: "face-analysis", version: "2026-09-03", acceptedAt: "now" })
    }
  }, {
    setStorageSync(key, value) { writes.push([key, value]); },
    removeStorageSync(key) { removals.push(key); },
    navigateTo({ url }) { navigations.push(url); },
    switchTab({ url }) { navigations.push(url); }
  });

  definition.acceptConsent();
  definition.declineConsent();
  assert.deepEqual(writes, [["face-analysis-consent", { type: "face-analysis", version: "2026-09-03", acceptedAt: "now" }]]);
  assert.deepEqual(removals, ["face-analysis-consent"]);
  assert.deepEqual(navigations, ["/pages/photo-check/photo-check", "/pages/challenges/challenges"]);
});

test("photo selection checks consent first and cancellation stays retryable", async () => {
  let chooseCalls = 0;
  const toasts = [];
  const { definition } = loadPage("pages/photo-check/photo-check.js", {
    "../../lib/photo-preflight": {
      FACE_CONSENT_STORAGE_KEY: "face-analysis-consent",
      assertFaceConsent() { throw new Error("CONSENT_REQUIRED"); },
      fitPhotoDimensions() { return { width: 100, height: 100 }; }
    },
    "../../lib/face-style-core": { evaluatePhotoQuality() {}, overridePhotoQuality() {} }
  }, {
    getStorageSync() { return { type: "challenge-photo" }; },
    chooseMedia() { chooseCalls += 1; },
    showToast({ title }) { toasts.push(title); },
    navigateTo() {}
  });
  const page = { ...definition, data: { ...definition.data }, setData(value) { Object.assign(this.data, value); } };
  await definition.choosePhoto.call(page);
  assert.equal(chooseCalls, 0);
  assert.ok(toasts.some(title => /先同意/.test(title)));
  assert.equal(page.data.choosing, false);
});

test("declining still opens challenges when local consent cleanup fails", () => {
  const navigations = [];
  const { definition } = loadPage("pages/consent/consent.js", {
    "../../lib/photo-preflight": {
      FACE_CONSENT_STORAGE_KEY: "face-analysis-consent",
      createFaceConsent() {}
    }
  }, {
    removeStorageSync() { throw new Error("storage unavailable"); },
    switchTab({ url }) { navigations.push(url); }
  });
  assert.doesNotThrow(() => definition.declineConsent());
  assert.deepEqual(navigations, ["/pages/challenges/challenges"]);
});

test("compression failure preserves the page and a successful retry verifies JPEG bounds", async () => {
  let attempts = 0;
  const requests = [];
  const { compressPhotoToJpeg } = require("../../miniprogram/lib/photo-preflight");
  const api = {
    compressImage(options) {
      requests.push(options);
      attempts += 1;
      if (attempts === 1) options.fail(new Error("temporary"));
      else options.success({ tempFilePath: "ready.jpg" });
    },
    getImageInfo(options) {
      options.success({ width: 1600, height: 1200, type: "jpeg" });
    }
  };
  await assert.rejects(() => compressPhotoToJpeg(api, { path: "source.jpg", width: 3200, height: 2400 }), /PHOTO_COMPRESSION_FAILED/);
  const ready = await compressPhotoToJpeg(api, { path: "source.jpg", width: 3200, height: 2400 });
  assert.deepEqual(ready, { path: "ready.jpg", width: 1600, height: 1200, type: "jpeg" });
  assert.equal(attempts, 2);
  assert.equal(requests[1].compressedWidth, 1600);
  assert.equal(requests[1].compressedHeight, 1200);
});

test("low quality screen always offers retake and explicit continue", () => {
  const app = JSON.parse(read("app.json"));
  assert.ok(app.pages.includes("pages/consent/consent"));
  assert.ok(app.pages.includes("pages/photo-check/photo-check"));

  const consentCopy = read("components/privacy-consent/privacy-consent.wxml");
  for (const copy of ["本次结构与风格参考", "长期保存结构化报告与身份卡", "立即删除", "最长 30 分钟"]) {
    assert.match(consentCopy, new RegExp(copy));
  }

  const qualityCopy = read("pages/photo-check/photo-check.wxml");
  assert.match(qualityCopy, /重新拍一张/);
  assert.match(qualityCopy, /仍用这张照片分析/);
  assert.match(qualityCopy, /参考结果/);
  assert.doesNotMatch(`${consentCopy}\n${qualityCopy}`, /颜值评分|缺点|完美比例|疗效|医疗/);

  for (const base of ["pages/consent/consent", "pages/photo-check/photo-check", "components/privacy-consent/privacy-consent"]) {
    const markup = read(`${base}.wxml`);
    const styles = read(`${base}.wxss`);
    for (const button of markup.match(/<button\b[^>]*>/g) || []) assert.match(button, /class="[^"]*tap-target/);
    assert.match(styles, /\.tap-target[^}]*min-height:\s*44px/s);
    assert.match(styles, /box-sizing:\s*border-box/);
    assert.doesNotMatch(styles, /(?:min-)?width:\s*(?:3[2-9]\d|[4-9]\d{2}|[1-9]\d{3,})px/);
    assert.doesNotMatch(styles, /(?:min-)?width:\s*(?:6[4-9]\d|[7-9]\d{2}|[1-9]\d{3,})rpx/);
  }
});
