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

Page({
  data: { challengeId: "", history: null, posterSaving: false, posterError: "" },

  onLoad(options = {}) {
    const challengeId = options.id || "";
    const eventChannel = typeof this.getOpenerEventChannel === "function"
      ? this.getOpenerEventChannel()
      : null;
    eventChannel?.on("challengeCompleted", history => {
      if (history) this.setData({ history });
    });
    let history = null;
    try {
      history = challengeId ? wx.getStorageSync(`challenge-completion:${challengeId}`) : null;
    } catch (_) {}
    this.setData({ challengeId, history: history || null });
  },

  backToChallenges() {
    wx.switchTab({ url: "/pages/challenges/challenges" });
  },

  async saveChallengePoster() {
    if (!this.data.history || this.data.posterSaving) return;
    this.setData({ posterSaving: true, posterError: "" });
    try {
      const { canvas, context } = await getCanvas(this);
      require("../../lib/poster").drawChallengePoster(context, this.data.history, [], null);
      await saveCanvas(canvas);
      wx.showToast({ title: "已保存到相册", icon: "success" });
    } catch (_) {
      this.setData({ posterError: "未能保存海报。若未授权相册，请授权后重试。" });
    } finally {
      this.setData({ posterSaving: false });
    }
  },

  retryChallengePosterAuthorization() {
    wx.openSetting({ complete: () => this.saveChallengePoster() });
  },

  onShareAppMessage() {
    const id = this.data.challengeId || this.data.history?.id || "";
    return { title: "我的挑战结营复盘", path: `/pages/challenge-complete/challenge-complete?id=${id}` };
  }
});
