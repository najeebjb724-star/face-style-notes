function getCanvas(page) {
  return new Promise((resolve, reject) => {
    wx.createSelectorQuery().in(page).select("#challengePoster").fields({ node: true, size: true }).exec(result => {
      const canvas = result?.[0]?.node;
      if (!canvas) return reject(new Error("POSTER_CANVAS_UNAVAILABLE"));
      canvas.width = result[0].width;
      canvas.height = result[0].height;
      const context = canvas.getContext("2d");
      context.scale(result[0].width / 300, result[0].height / 420);
      resolve({ canvas, context });
    });
  });
}

function saveCanvas(canvas) {
  return new Promise((resolve, reject) => wx.canvasToTempFilePath({
    canvas,
    success: ({ tempFilePath }) => wx.saveImageToPhotosAlbum({ filePath: tempFilePath, success: resolve, fail: reject }),
    fail: reject
  }));
}

function previewText(value, fallback) {
  const text = typeof value === "string" ? value.trim() : "";
  return (text || fallback).slice(0, 36);
}

function safeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function buildSharedHistory(options = {}) {
  return {
    title: previewText(options.title, "我的挑战复盘"),
    completed: safeNumber(options.completed),
    total: safeNumber(options.total),
    completionRate: safeNumber(options.rate),
    streak: safeNumber(options.streak)
  };
}

function loadCanvasImage(canvas, source) {
  return new Promise((resolve, reject) => {
    const image = canvas.createImage();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = source;
  });
}

async function createPreview(kind, preview) {
  try {
    const response = await wx.cloud.callFunction({ name: "shareApi", data: { action: "createPreview", payload: { kind, preview } } });
    return response?.result?.token || "";
  } catch (_) {
    return "";
  }
}

async function getPreview(token) {
  const response = await wx.cloud.callFunction({ name: "shareApi", data: { action: "getPreview", payload: { token } } });
  return response?.result;
}

async function getChallengeHistory(challengeId) {
  const response = await wx.cloud.callFunction({
    name: "challengeApi",
    data: { action: "getHistory", payload: { challengeId } }
  });
  if (response?.result?.error || !response?.result) throw new Error("HISTORY_UNAVAILABLE");
  return response.result;
}

function challengePreview(history = {}) {
  return { title: history.title, completed: history.completed, total: history.total, rate: history.completionRate, streak: history.streak };
}

async function ensureShareToken(page) {
  if (page.data?.shareToken) return page.data.shareToken;
  const shareToken = await createPreview("challenge", challengePreview(page.data?.history));
  if (shareToken) page.setData({ shareToken });
  return shareToken;
}

async function getPosterAssets(page, canvas, scene) {
  const photoPaths = page.data.includePosterPhotos ? page.data.posterPhotos : [];
  const photos = await Promise.all(photoPaths.map(source => loadCanvasImage(canvas, source)));
  let miniCode = null;
  try {
    if (!scene) return { photos, miniCode };
    const response = await wx.cloud.callFunction({
      name: "shareApi",
      data: { scene, page: "pages/challenge-complete/challenge-complete" }
    });
    const fileId = response?.result?.fileId;
    if (fileId) {
      const file = await wx.cloud.downloadFile({ fileID: fileId });
      miniCode = await loadCanvasImage(canvas, file.tempFilePath);
    }
  } catch (_) {}
  return { photos, miniCode };
}

Page({
  data: { challengeId: "", history: null, shareToken: "", posterSaving: false, posterError: "", posterPhotos: [], includePosterPhotos: false },

  async onLoad(options = {}) {
    const token = options.token || (options.scene && options.scene !== "preview" ? options.scene : "");
    if (token) {
      try {
        const shared = await getPreview(token);
        if (shared?.kind !== "challenge") throw new Error("PREVIEW_NOT_FOUND");
        return this.setData({ challengeId: "", history: buildSharedHistory(shared.preview) });
      } catch (_) {
        return this.setData({ challengeId: "", history: null, posterError: "这份分享预览已失效或无法打开。" });
      }
    }
    if (options.share === "1" || options.scene === "preview") {
      return this.setData({ challengeId: "", history: buildSharedHistory(options) });
    }
    const challengeId = options.id || "";
    const eventChannel = typeof this.getOpenerEventChannel === "function"
      ? this.getOpenerEventChannel()
      : null;
    eventChannel?.on("challengeCompleted", history => {
      if (history) {
        this.setData({ history });
        ensureShareToken(this);
      }
    });
    let history = null;
    try {
      history = challengeId ? wx.getStorageSync(`challenge-completion:${challengeId}`) : null;
    } catch (_) {}
    this.setData({ challengeId, history: history || null });
    if (!history && challengeId) {
      try {
        history = await getChallengeHistory(challengeId);
        this.setData({ history });
      } catch (_) {}
    }
    if (history) await ensureShareToken(this);
  },

  backToChallenges() {
    wx.switchTab({ url: "/pages/challenges/challenges" });
  },

  async saveChallengePoster() {
    if (!this.data.history || this.data.posterSaving) return;
    this.setData({ posterSaving: true, posterError: "" });
    try {
      const { canvas, context } = await getCanvas(this);
      const { photos, miniCode } = await getPosterAssets(this, canvas, await ensureShareToken(this));
      require("../../lib/poster").drawChallengePoster(context, { ...this.data.history, includePhotos: this.data.includePosterPhotos }, photos, miniCode);
      await saveCanvas(canvas);
      wx.showToast({ title: "已保存到相册", icon: "success" });
    } catch (_) {
      this.setData({ posterError: "未能保存海报。若未授权相册，请授权后重试。" });
    } finally {
      this.setData({ posterSaving: false });
    }
  },

  retryChallengePosterAuthorization() {
    wx.openSetting({
      success: ({ authSetting } = {}) => {
        if (authSetting?.["scope.writePhotosAlbum"]) this.saveChallengePoster();
      }
    });
  },

  choosePosterPhotos() {
    wx.chooseMedia({
      count: 2,
      mediaType: ["image"],
      success: ({ tempFiles = [] }) => {
        const posterPhotos = tempFiles.map(file => file.tempFilePath).filter(Boolean).slice(0, 2);
        this.setData({ posterPhotos, includePosterPhotos: false });
      }
    });
  },

  setPosterPhotoConsent(event) {
    const includePosterPhotos = event?.detail?.value?.includes("includePhotos") === true;
    if (includePosterPhotos && !this.data.posterPhotos.length) {
      return wx.showToast({ title: "请先选择本次海报图片", icon: "none" });
    }
    this.setData({ includePosterPhotos });
  },

  onShareAppMessage() {
    const history = this.data.history || {};
    const title = previewText(history.title, "我的挑战复盘");
    const token = this.data.shareToken;
    return token
      ? { title, path: `/pages/challenge-complete/challenge-complete?token=${token}` }
      : { title, path: `/pages/challenge-complete/challenge-complete?share=1&title=${encodeURIComponent(title)}&completed=${safeNumber(history.completed)}&total=${safeNumber(history.total)}&rate=${safeNumber(history.completionRate)}&streak=${safeNumber(history.streak)}` };
  }
});
