const { callCloud } = require("../../services/cloud-client");

function getCanvas(page, selector) {
  return new Promise((resolve, reject) => {
    wx.createSelectorQuery().in(page).select(selector).fields({ node: true, size: true }).exec(result => {
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

function buildSharedReport(query = {}) {
  return {
    identity: { title: previewText(query.title, "我的美学身份卡"), subtitle: previewText(query.subtitle, "分享预览"), axes: [] },
    memorySentence: previewText(query.memory, "找到适合自己的表达方式。"),
    quality: { referenceOnly: true },
    readableProfile: { threeCourts: { summary: "" }, fiveEyes: { summary: "" }, strengths: [], attention: [] },
    coreTraits: [],
    dataGroups: [],
    styleAdvice: [],
    limitations: ["这是不含照片和详细结构数据的分享预览。"],
    sources: [],
    actionCards: []
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

function reportPreview(report = {}) {
  return { title: report.identity?.title, subtitle: report.identity?.subtitle, memory: report.memorySentence };
}

async function ensureShareToken(page) {
  if (page.data.shareToken) return page.data.shareToken;
  const shareToken = await createPreview("report", reportPreview(page.data.report));
  if (shareToken) page.setData({ shareToken });
  return shareToken;
}

async function getMiniCode(canvas, scene) {
  if (!scene) return null;
  try {
    const response = await wx.cloud.callFunction({
      name: "shareApi",
      data: { scene, page: "pages/report/report" }
    });
    const fileId = response?.result?.fileId;
    if (!fileId) return null;
    const file = await wx.cloud.downloadFile({ fileID: fileId });
    return loadCanvasImage(canvas, file.tempFilePath);
  } catch (_) {
    return null;
  }
}

Page({
  data: { report: null, reportId: "", shareToken: "", loading: true, errorText: "", posterSaving: false, posterError: "" },
  async onLoad(query) {
    const token = query?.token || (query?.scene && query.scene !== "preview" ? query.scene : "");
    if (token) {
      try {
        const shared = await getPreview(token);
        if (shared?.kind !== "report") throw new Error("PREVIEW_NOT_FOUND");
        return this.setData({ report: buildSharedReport(shared.preview), reportId: "", loading: false });
      } catch (_) {
        return this.setData({ loading: false, errorText: "这份分享预览已失效或无法打开。" });
      }
    }
    if (query?.share === "1" || query?.scene === "preview") {
      return this.setData({ report: buildSharedReport(query), reportId: "", loading: false });
    }
    const id = typeof query?.id === "string" ? query.id : "";
    if (!id) return this.setData({ loading: false, errorText: "未找到这份结构参考。" });
    try {
      const report = await callCloud("analysisApi", { action: "getReport", payload: { reportId: id } });
      this.setData({ report, reportId: id, loading: false });
      const shareToken = await createPreview("report", reportPreview(report));
      if (shareToken) this.setData({ shareToken });
    } catch (_) {
      this.setData({ loading: false, errorText: "暂时无法读取这份结构参考，请稍后重试。" });
    }
  },
  createRecommendedChallenge() {
    const goal = this.data.report?.actionCards?.[0]?.title;
    const template = goal === "调整一个发型变量" ? "clean-tools-4" : "makeup-3-in-7";
    wx.navigateTo({ url: `/pages/challenge-create/challenge-create?template=${template}` });
  },
  async saveIdentityPoster() {
    if (!this.data.report || this.data.posterSaving) return;
    this.setData({ posterSaving: true, posterError: "" });
    try {
      const { canvas, context } = await getCanvas(this, "#identityPoster");
      const miniCode = await getMiniCode(canvas, await ensureShareToken(this));
      require("../../lib/poster").drawIdentityPoster(context, this.data.report, { miniCode });
      await saveCanvas(canvas);
      wx.showToast({ title: "已保存到相册", icon: "success" });
    } catch (_) {
      this.setData({ posterError: "未能保存海报。若未授权相册，请授权后重试。" });
    } finally {
      this.setData({ posterSaving: false });
    }
  },
  retryIdentityPosterAuthorization() {
    wx.openSetting({
      success: ({ authSetting } = {}) => {
        if (authSetting?.["scope.writePhotosAlbum"]) this.saveIdentityPoster();
      }
    });
  },
  onShareAppMessage() {
    const report = this.data.report || {};
    const identity = report.identity || {};
    const title = previewText(identity.title, "我的美学身份卡");
    const subtitle = previewText(identity.subtitle, "分享预览");
    const memory = previewText(report.memorySentence, "找到适合自己的表达方式。");
    const token = this.data.shareToken;
    return token
      ? { title, path: `/pages/report/report?token=${token}` }
      : { title, path: `/pages/report/report?share=1&title=${encodeURIComponent(title)}&subtitle=${encodeURIComponent(subtitle)}&memory=${encodeURIComponent(memory)}` };
  }
});
