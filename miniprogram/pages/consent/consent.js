const {
  FACE_CONSENT_STORAGE_KEY,
  createFaceConsent
} = require("../../lib/photo-preflight");

Page({
  acceptConsent() {
    const consent = createFaceConsent();
    try {
      wx.setStorageSync(FACE_CONSENT_STORAGE_KEY, consent);
    } catch (_) {
      wx.showToast({ title: "保存同意失败，请重试", icon: "none" });
      return;
    }
    wx.navigateTo({ url: "/pages/photo-check/photo-check" });
  },

  declineConsent() {
    try {
      wx.removeStorageSync(FACE_CONSENT_STORAGE_KEY);
    } catch (_) {}
    wx.switchTab({ url: "/pages/challenges/challenges" });
  }
});
