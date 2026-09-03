const { getCloudEnv } = require("../../config/env");

const cloudEnv = getCloudEnv("develop");

Page({
  data: {
    latestReport: null,
    activeChallenge: null
  },

  onShow() {
    if (!cloudEnv || typeof wx === "undefined" || !wx.cloud || typeof wx.cloud.callFunction !== "function") {
      return Promise.resolve();
    }

    try {
      return wx.cloud.callFunction({ name: "bootstrapUser" })
        .then(({ result }) => {
          if (!result) return;
          this.setData({
            latestReport: result.latestReport || null,
            activeChallenge: result.activeChallenge || null
          });
        })
        .catch(() => {});
    } catch {
      return Promise.resolve();
    }
  },

  startAnalysis() {
    wx.navigateTo({ url: "/pages/consent/consent" });
  },

  openChallenge() {
    wx.switchTab({ url: "/pages/challenges/challenges" });
  },

  openLatestReport() {
    const { latestReport } = this.data;
    if (!latestReport) return;
    wx.navigateTo({ url: `/pages/report/report?id=${latestReport.id}` });
  }
});
