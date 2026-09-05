const { callCloud } = require("../../services/cloud-client");
const { CHALLENGE_TEMPLATES } = require("../../lib/face-style-core");

Page({
  data: {
    templates: CHALLENGE_TEMPLATES,
    activeChallenge: null,
    isVisitor: false,
    loading: false
  },

  async onShow() {
    this.setData({ loading: true });
    try {
      const activeChallenge = await callCloud("challengeApi", { action: "getActive", payload: {} });
      this.setData({ activeChallenge, isVisitor: false, loading: false });
    } catch (_) {
      // callCloud currently treats an empty getActive result like a connection failure.
      // Keeping templates visible makes both that case and visitor mode useful.
      this.setData({ activeChallenge: null, isVisitor: true, loading: false });
    }
  },

  openActiveChallenge() {
    if (!this.data.activeChallenge) return;
    wx.navigateTo({ url: `/pages/challenge-detail/challenge-detail?id=${this.data.activeChallenge._id || this.data.activeChallenge.id}` });
  },

  startChallenge() {
    const active = this.data.activeChallenge ? "?active=1" : "";
    wx.navigateTo({ url: `/pages/challenge-create/challenge-create${active}` });
  }
});
