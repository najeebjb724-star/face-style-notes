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

Page({
  data: { report: null, reportId: "", loading: true, errorText: "", posterSaving: false, posterError: "" },
  async onLoad(query) {
    const id = typeof query?.id === "string" ? query.id : "";
    if (!id) return this.setData({ loading: false, errorText: "未找到这份结构参考。" });
    try {
      const report = await callCloud("analysisApi", { action: "getReport", payload: { reportId: id } });
      this.setData({ report, reportId: id, loading: false });
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
      require("../../lib/poster").drawIdentityPoster(context, this.data.report);
      await saveCanvas(canvas);
      wx.showToast({ title: "已保存到相册", icon: "success" });
    } catch (_) {
      this.setData({ posterError: "未能保存海报。若未授权相册，请授权后重试。" });
    } finally {
      this.setData({ posterSaving: false });
    }
  },
  retryIdentityPosterAuthorization() {
    wx.openSetting({ complete: () => this.saveIdentityPoster() });
  },
  onShareAppMessage() {
    const id = this.data.reportId || this.data.report?.id || "";
    return { title: "我的美学身份卡", path: `/pages/report/report?id=${id}` };
  }
});
