Page({
  data: { challengeId: "" },

  onLoad(options = {}) {
    this.setData({ challengeId: options.id || "" });
  },

  backToChallenges() {
    wx.switchTab({ url: "/pages/challenges/challenges" });
  }
});
