Page({
  data: { challengeId: "", history: null },

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
  }
});
