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

test("consent storage failure is explained and does not open photo selection", () => {
  const toasts = [];
  const navigations = [];
  const { definition } = loadPage("pages/consent/consent.js", {
    "../../lib/photo-preflight": {
      FACE_CONSENT_STORAGE_KEY: "face-analysis-consent",
      createFaceConsent: () => ({ type: "face-analysis" })
    }
  }, {
    setStorageSync() { throw new Error("storage unavailable"); },
    showToast({ title }) { toasts.push(title); },
    navigateTo({ url }) { navigations.push(url); }
  });
  assert.doesNotThrow(() => definition.acceptConsent());
  assert.deepEqual(navigations, []);
  assert.ok(toasts.some(title => /保存同意失败/.test(title)));
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

test("chooseMedia cancellation stays on the photo page without an error", async () => {
  const toasts = [];
  const navigations = [];
  const { definition } = loadPage("pages/photo-check/photo-check.js", {
    "../../lib/photo-preflight": {
      FACE_CONSENT_STORAGE_KEY: "face-analysis-consent",
      FACE_PREFLIGHT_STORAGE_KEY: "face-analysis-preflight",
      assertFaceConsent(value) { return value; },
      compressPhotoToJpeg() { throw new Error("must not compress a cancellation"); }
    },
    "../../lib/face-style-core": { evaluatePhotoQuality() {}, overridePhotoQuality() {} }
  }, {
    getStorageSync() { return { type: "face-analysis" }; },
    chooseMedia(options) { options.fail({ errMsg: "chooseMedia:fail cancel" }); },
    showToast({ title }) { toasts.push(title); },
    navigateTo({ url }) { navigations.push(url); }
  });
  const page = { ...definition, data: { ...definition.data }, setData(value) { Object.assign(this.data, value); } };
  await definition.choosePhoto.call(page);
  assert.equal(page.data.choosing, false);
  assert.equal(page.data.compressionError, "");
  assert.deepEqual(toasts, []);
  assert.deepEqual(navigations, []);
});

test("PNG input is drawn to Canvas 2D and exported as bounded JPEG in order", async () => {
  let attempts = 0;
  const order = [];
  const requests = [];
  const { compressPhotoToJpeg } = require("../../miniprogram/lib/photo-preflight");
  function makeCanvas() {
    const image = {};
    Object.defineProperty(image, "src", {
      set(value) {
        order.push(["load", value]);
        queueMicrotask(() => image.onload());
      }
    });
    return {
      width: 0,
      height: 0,
      createImage() { order.push(["createImage"]); return image; },
      getContext(type) {
        order.push(["context", type]);
        return { drawImage(_image, x, y, width, height) { order.push(["draw", x, y, width, height]); } };
      }
    };
  }
  const api = {
    canvasToTempFilePath(options) {
      requests.push(options);
      attempts += 1;
      order.push(["export", options.fileType, options.destWidth, options.destHeight]);
      if (attempts === 1) options.fail(new Error("temporary"));
      else options.success({ tempFilePath: "ready.jpg" });
    },
    getImageInfo(options) {
      order.push(["inspect", options.src]);
      options.success({ width: 1600, height: 1200, type: "jpeg" });
    }
  };
  await assert.rejects(() => compressPhotoToJpeg(api, makeCanvas(), { path: "source.png", width: 3200, height: 2400 }), /PHOTO_COMPRESSION_FAILED/);
  const ready = await compressPhotoToJpeg(api, makeCanvas(), { path: "source.png", width: 3200, height: 2400 });
  assert.deepEqual(ready, { path: "ready.jpg", width: 1600, height: 1200, type: "jpeg" });
  assert.equal(attempts, 2);
  assert.equal(requests[1].fileType, "jpg");
  assert.equal(requests[1].quality, 0.85);
  assert.equal(requests[1].destWidth, 1600);
  assert.equal(requests[1].destHeight, 1200);
  assert.deepEqual(order.slice(-6), [
    ["createImage"],
    ["load", "source.png"],
    ["context", "2d"],
    ["draw", 0, 0, 1600, 1200],
    ["export", "jpg", 1600, 1200],
    ["inspect", "ready.jpg"]
  ]);
});

test("canvas setup, image load, draw, export, and inspection failures are retryable errors", async () => {
  const { compressPhotoToJpeg } = require("../../miniprogram/lib/photo-preflight");
  const photo = { path: "source.heic", width: 1200, height: 1800 };
  const goodApi = {
    canvasToTempFilePath(options) { options.success({ tempFilePath: "ready.jpg" }); },
    getImageInfo(options) { options.success({ width: 800, height: 1200, type: "jpeg" }); }
  };
  const makeCanvas = ({ loadFails = false, drawFails = false } = {}) => {
    const image = {};
    Object.defineProperty(image, "src", {
      set() { queueMicrotask(() => (loadFails ? image.onerror() : image.onload())); }
    });
    return {
      createImage() { return image; },
      getContext() {
        return { drawImage() { if (drawFails) throw new Error("draw failed"); } };
      }
    };
  };
  const cases = [
    [{}, goodApi],
    [makeCanvas({ loadFails: true }), goodApi],
    [makeCanvas({ drawFails: true }), goodApi],
    [makeCanvas(), { ...goodApi, canvasToTempFilePath(options) { options.fail(new Error("export failed")); } }],
    [makeCanvas(), { ...goodApi, getImageInfo(options) { options.fail(new Error("inspect failed")); } }]
  ];
  for (const [canvas, api] of cases) {
    await assert.rejects(() => compressPhotoToJpeg(api, canvas, photo), /PHOTO_COMPRESSION_FAILED/);
  }
});

test("successful compression enters an honest pending-quality state and readiness gates continuation", async () => {
  const toasts = [];
  const writes = [];
  const { definition } = loadPage("pages/photo-check/photo-check.js", {
    "../../lib/photo-preflight": {
      FACE_CONSENT_STORAGE_KEY: "face-analysis-consent",
      FACE_PREFLIGHT_STORAGE_KEY: "face-analysis-preflight",
      assertFaceConsent(value) { return value; },
      getPhotoCanvas: async () => ({ id: "canvas" }),
      compressPhotoToJpeg: async () => ({ path: "ready.jpg", width: 800, height: 1200, type: "jpeg" })
    },
    "../../lib/face-style-core": {
      evaluatePhotoQuality: () => ({ accepted: true, level: "high", issues: [] }),
      overridePhotoQuality: value => value
    }
  }, {
    getStorageSync() { return { type: "face-analysis" }; },
    chooseMedia(options) { options.success({ tempFiles: [{ tempFilePath: "source.png", width: 1200, height: 1800 }] }); },
    showToast({ title }) { toasts.push(title); },
    setStorageSync(key, value) { writes.push([key, value]); }
  });
  const page = { ...definition, data: { ...definition.data }, createSelectorQuery() {}, setData(value) { Object.assign(this.data, value); } };
  await definition.choosePhoto.call(page);
  assert.equal(page.data.preflightStatus, "awaiting-quality");
  assert.equal(page.data.quality, null);
  assert.equal(page.data.readyForAnalysis, false);
  definition.continueAnalysis.call(page);
  assert.ok(toasts.some(title => /质量检查尚未接入，暂不能开始/.test(title)));
  assert.deepEqual(writes, []);

  definition.applyQualitySignals.call(page, { source: "future-analysis-adapter" });
  assert.equal(page.data.preflightStatus, "quality-ready");
  assert.equal(page.data.readyForAnalysis, true);
  definition.continueAnalysis.call(page);
  assert.equal(writes[0][0], "face-analysis-preflight");
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
  assert.match(qualityCopy, /照片已准备，下一步进行质量检查/);
  assert.match(qualityCopy, /bindtap="continueAnalysis"/);
  assert.match(qualityCopy, /type="2d"/);
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
