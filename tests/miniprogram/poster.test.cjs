const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const {
  buildChallengePosterModel,
  buildIdentityPosterModel,
  drawChallengePoster
} = require("../../miniprogram/lib/poster");

function loadPage(relativePath, dependencies = {}, wx = {}) {
  let definition;
  const source = fs.readFileSync(path.join(__dirname, "../../miniprogram", relativePath), "utf8");
  vm.runInNewContext(source, {
    Page(page) { definition = page; },
    wx,
    Promise,
    encodeURIComponent,
    require(name) {
      if (!(name in dependencies)) throw new Error(`unexpected require: ${name}`);
      return dependencies[name];
    }
  });
  return definition;
}

test("default challenge poster excludes facial measurements", () => {
  const challenge = {
    title: "七日练习",
    completed: 7,
    total: 7,
    completionRate: 100,
    streak: 7,
    measurements: { faceRatio: 1.2 },
    landmarks: [{ x: 1, y: 2 }]
  };
  const model = buildChallengePosterModel(challenge, { includePhotos: false });

  assert.equal("measurements" in model, false);
  assert.equal("landmarks" in model, false);
  assert.equal(model.includePhotos, false);
});

test("identity poster uses presentation copy instead of measurement data", () => {
  const model = buildIdentityPosterModel({
    identity: { title: "温和表达者", subtitle: "自然清透" },
    memorySentence: "轻盈且有层次",
    measurements: { faceRatio: 1.2 },
    readableProfile: { landmarks: [{ x: 1, y: 2 }] }
  });

  assert.equal(model.title, "温和表达者");
  assert.equal(model.memorySentence, "轻盈且有层次");
  assert.equal("measurements" in model, false);
  assert.equal("landmarks" in model, false);
});

test("challenge drawing does not draw photos unless explicitly opted in", () => {
  const calls = [];
  const context = {
    fillRect() {},
    fillText(value) { calls.push(value); },
    drawImage() { calls.push("image"); },
    set fillStyle(_) {},
    set font(_) {},
    set textAlign(_) {}
  };

  drawChallengePoster(context, { title: "七日练习", completed: 7, total: 7 }, ["photo-a"], null);

  assert.equal(calls.includes("image"), false);
});

test("opted-in challenge poster draws fresh start and end photos", () => {
  const images = [];
  const context = {
    fillRect() {},
    fillText() {},
    drawImage(image) { images.push(image); },
    set fillStyle(_) {},
    set font(_) {},
    set textAlign(_) {}
  };
  const start = { id: "start" };
  const end = { id: "end" };
  drawChallengePoster(context, { title: "七日练习", includePhotos: true }, [start, end], null);
  assert.deepEqual(images, [start, end]);
});

test("challenge poster keeps two photos and its mini-code in separate Canvas regions", () => {
  const calls = [];
  const context = {
    fillRect() {},
    fillText() {},
    drawImage(...args) { calls.push(args); },
    set fillStyle(_) {},
    set font(_) {},
    set textAlign(_) {}
  };
  const start = { id: "start" };
  const end = { id: "end" };
  const code = { id: "code" };
  drawChallengePoster(context, { title: "七日练习", includePhotos: true }, [start, end], code);
  assert.deepEqual(calls, [
    [start, 42, 270, 80, 80],
    [end, 130, 270, 80, 80],
    [code, 218, 285, 50, 50]
  ]);
});

test("report sharing sends a presentation-only preview that a recipient can render", async () => {
  let cloudCalls = 0;
  const page = loadPage("pages/report/report.js", {
    "../../services/cloud-client": { callCloud: async () => { cloudCalls += 1; return {}; } }
  }, { cloud: { callFunction: async () => ({ result: { kind: "report", preview: { title: "温和表达者", subtitle: "自然清透", memory: "轻盈且有层次" } } }) } });
  const shared = page.onShareAppMessage.call({
    data: {
      shareToken: "uNguessableToken1234567890123456",
      reportId: "private-id",
      report: { identity: { title: "温和表达者", subtitle: "自然清透" }, memorySentence: "轻盈且有层次", measurements: { ratio: 1.2 } }
    }
  });
  assert.equal(shared.path, "/pages/report/report?token=uNguessableToken1234567890123456");
  assert.doesNotMatch(shared.path, /private-id|ratio|measurements/);

  const updates = [];
  await page.onLoad.call({ setData(value) { updates.push(value); } }, { token: "uNguessableToken1234567890123456" });
  assert.equal(cloudCalls, 0);
  assert.equal(updates.at(-1).report.identity.title, "温和表达者");

  const scannedUpdates = [];
  await page.onLoad.call({ setData(value) { scannedUpdates.push(value); } }, { scene: "uNguessableToken1234567890123456" });
  assert.equal(scannedUpdates.at(-1).report.identity.title, "温和表达者");
});

test("challenge sharing renders a safe recap without sender local storage", async () => {
  const page = loadPage("pages/challenge-complete/challenge-complete.js", {}, {
    getStorageSync() { return null; },
    cloud: { callFunction: () => Promise.resolve({ result: { kind: "challenge", preview: { title: "七日练习", completed: 7, total: 7, rate: 100, streak: 7 } } }) }
  });
  const shared = page.onShareAppMessage.call({
    data: { shareToken: "uNguessableToken1234567890123456", challengeId: "private-id", history: { title: "七日练习", completed: 7, total: 7, completionRate: 100, streak: 7, landmarks: [1] } }
  });
  assert.equal(shared.path, "/pages/challenge-complete/challenge-complete?token=uNguessableToken1234567890123456");
  assert.doesNotMatch(shared.path, /private-id|landmarks/);

  const updates = [];
  await page.onLoad.call({ setData(value) { updates.push(value); }, getOpenerEventChannel() { return null; } }, { token: "uNguessableToken1234567890123456" });
  assert.equal(updates.at(-1).history.title, "七日练习");
  assert.equal(updates.at(-1).history.completed, 7);

  const scannedUpdates = [];
  await page.onLoad.call({ setData(value) { scannedUpdates.push(value); }, getOpenerEventChannel() { return null; } }, { scene: "uNguessableToken1234567890123456" });
  assert.equal(scannedUpdates.at(-1).history.title, "七日练习");
});

test("challenge poster photo opt-in is fresh, local, and never persisted", () => {
  const page = loadPage("pages/challenge-complete/challenge-complete.js", {}, {});
  assert.equal(typeof page.choosePosterPhotos, "function");
  assert.equal(typeof page.setPosterPhotoConsent, "function");
  const markup = fs.readFileSync(path.join(__dirname, "../../miniprogram/pages/challenge-complete/challenge-complete.wxml"), "utf8");
  assert.match(markup, /bindtap="choosePosterPhotos"/);
  assert.match(markup, /bindchange="setPosterPhotoConsent"/);
});

test("album settings cancellation does not retry poster saving", () => {
  const page = loadPage("pages/challenge-complete/challenge-complete.js", {}, {
    openSetting(options) { options.success({ authSetting: { "scope.writePhotosAlbum": false } }); }
  });
  let saves = 0;
  page.retryChallengePosterAuthorization.call({ saveChallengePoster() { saves += 1; } });
  assert.equal(saves, 0);
});

test("server mini-code generation validates the target and returns only a file id", async () => {
  const { getMiniCode } = require("../../cloudfunctions/shareApi");
  const calls = [];
  const cloud = {
    openapi: { wxacode: { getUnlimited: async request => { calls.push(request); return Buffer.from("code"); } } },
    uploadFile: async request => ({ fileID: `cloud:///${request.cloudPath}` })
  };
  const scene = "uNguessableToken1234567890123456";
  const fileId = await getMiniCode({ scene, page: "pages/report/report" }, cloud);
  assert.match(fileId, /^cloud:\/\/\/mini-codes\/.+\.png$/);
  assert.deepEqual(calls, [{ scene, page: "pages/report/report", checkPath: true }]);
  await assert.rejects(() => getMiniCode({ scene: "preview", page: "pages/home/home" }, cloud), { code: "INVALID_ARGUMENT" });
});

test("server share previews are sanitized, unguessable, and expire before lookup", async () => {
  const { createShareApi } = require("../../cloudfunctions/shareApi");
  const records = new Map();
  const database = {
    collection() {
      return { doc(token) { return {
        async set({ data }) { records.set(token, data); },
        async get() { return { data: records.get(token) }; }
      }; } };
    }
  };
  const api = createShareApi({
    database,
    getWXContext: () => ({ OPENID: "owner-1" }),
    now: () => new Date("2026-09-20T00:00:00.000Z"),
    createToken: () => "uNguessableToken1234567890123456"
  });
  const token = await api.createPreview({ kind: "report", preview: { title: "温和表达者", subtitle: "自然清透", memory: "轻盈且有层次", measurements: { ratio: 1.2 } } });
  assert.equal(token, "uNguessableToken1234567890123456");
  assert.equal("measurements" in records.get(token).preview, false);
  assert.deepEqual(await api.getPreview({ token }), { kind: "report", preview: { title: "温和表达者", subtitle: "自然清透", memory: "轻盈且有层次" } });
  await api.linkMiniCode({ token, fileId: "cloud://env.mini-codes/code.png" });
  assert.deepEqual(records.get(token).miniCodeFileIds, ["cloud://env.mini-codes/code.png"]);
  await assert.rejects(() => api.getPreview({ token: "invalid" }), { code: "INVALID_ARGUMENT" });
  records.get(token).expiresAt = "2026-09-19T00:00:00.000Z";
  await assert.rejects(() => api.getPreview({ token }), { code: "PREVIEW_EXPIRED" });
});

test("mini-code link failure deletes its exact uploaded file and reports rollback failure", async () => {
  const { getMiniCodeForPreview } = require("../../cloudfunctions/shareApi");
  const deleted = [];
  const cloud = {
    openapi: { wxacode: { getUnlimited: async () => Buffer.from("code") } },
    uploadFile: async () => ({ fileID: "cloud://env.mini-codes/code.png" }),
    deleteFile: async ({ fileList }) => { deleted.push(fileList); return { fileList: [{ fileID: fileList[0], status: 0 }] }; }
  };
  const api = { getPreview: async () => ({}), linkMiniCode: async () => { throw new Error("LINK_FAILED"); } };
  await assert.rejects(() => getMiniCodeForPreview({ scene: "uNguessableToken1234567890123456", page: "pages/report/report" }, cloud, api), /LINK_FAILED/);
  assert.deepEqual(deleted, [["cloud://env.mini-codes/code.png"]]);

  const rollbackFailure = new Error("LINK_FAILED");
  const failedCloud = { ...cloud, deleteFile: async () => ({ fileList: [{ fileID: "cloud://env.mini-codes/code.png", status: -1 }] }) };
  const failedApi = { getPreview: async () => ({}), linkMiniCode: async () => { throw rollbackFailure; } };
  await assert.rejects(
    () => getMiniCodeForPreview({ scene: "uNguessableToken1234567890123456", page: "pages/report/report" }, failedCloud, failedApi),
    error => error === rollbackFailure && error.rollbackFailed === true
  );
});

test("preview deletion during mini-code upload leaves durable exact-file cleanup when rollback fails", async () => {
  const { createShareApi, getMiniCodeForPreview } = require("../../cloudfunctions/shareApi");
  const token = "uNguessableToken1234567890123456";
  const stores = { share_previews: new Map([[token, { _id: token, _openid: "owner-1", kind: "report", preview: {}, expiresAt: "2026-09-27T00:00:00.000Z" }]]), deletion_jobs: new Map() };
  const collection = name => ({ doc: id => ({
    get: async () => ({ data: stores[name]?.get(id) || null }),
    set: async ({ data }) => { (stores[name] ||= new Map()).set(id, { ...data, _id: id }); },
    update: async ({ data }) => stores[name].set(id, { ...stores[name].get(id), ...data })
  }) });
  const database = { collection, runTransaction: callback => callback({ collection }) };
  const api = createShareApi({ database, getWXContext: () => ({ OPENID: "owner-1" }), now: () => new Date("2026-09-20T00:00:00.000Z") });
  const cloud = {
    openapi: { wxacode: { getUnlimited: async () => Buffer.from("code") } },
    uploadFile: async () => { stores.share_previews.delete(token); return { fileID: "cloud://env.mini-codes/raced.png" }; },
    deleteFile: async () => ({ fileList: [{ fileID: "cloud://env.mini-codes/raced.png", status: -1 }] })
  };
  await assert.rejects(() => getMiniCodeForPreview({ scene: token, page: "pages/report/report" }, cloud, api), error => error.code === "PREVIEW_NOT_FOUND" && error.rollbackFailed === true);
  const exact = [...stores.deletion_jobs.values()].find(item => item.fileId === "cloud://env.mini-codes/raced.png");
  assert.equal(exact.kind, "account-file");
  assert.equal(exact.state, "pending");
});

test("failed mini-code generation closes its upload lease", async () => {
  const { getMiniCodeForPreview } = require("../../cloudfunctions/shareApi");
  const finished = [];
  const api = { getPreview: async () => ({}), beginMiniCodeUpload: async () => "upload-job", finishMiniCodeUpload: async value => finished.push(value) };
  const cloud = { openapi: { wxacode: { getUnlimited: async () => { throw new Error("generation failed"); } } } };
  await assert.rejects(() => getMiniCodeForPreview({ scene: "uNguessableToken1234567890123456", page: "pages/report/report" }, cloud, api), /generation failed/);
  assert.deepEqual(finished, [{ jobId: "upload-job" }]);
});

test("production share entry rejects arbitrary scenes without uploading a mini-code", async () => {
  const { createMain } = require("../../cloudfunctions/shareApi");
  let uploads = 0;
  const cloud = {
    database() { return { collection() { return { doc() { return { get: async () => ({ data: null }) }; } }; } }; },
    getWXContext() { return { OPENID: "owner-1" }; },
    openapi: { wxacode: { getUnlimited: async () => Buffer.from("code") } },
    uploadFile: async () => { uploads += 1; return { fileID: "cloud://env.mini-codes/code.png" }; }
  };
  const entry = createMain(cloud);
  await assert.rejects(() => entry({ scene: "preview", page: "pages/report/report" }), { code: "INVALID_ARGUMENT" });
  await assert.rejects(() => entry({ action: "unknown", scene: "uNguessableToken1234567890123456", page: "pages/report/report" }), { code: "INVALID_ARGUMENT" });
  assert.equal(uploads, 0);
});
