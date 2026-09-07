const {
  FACE_CONSENT_STORAGE_KEY,
  createFaceConsent,
  activateFaceConsent,
  revokeFaceConsent
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
    activateFaceConsent(consent);
    wx.navigateTo({ url: "/pages/photo-check/photo-check" });
  },

  declineConsent() {
    const revokedConsent = revokeFaceConsent();
    try {
      wx.setStorageSync(FACE_CONSENT_STORAGE_KEY, revokedConsent);
    } catch (_) {}
    wx.switchTab({ url: "/pages/challenges/challenges" });
  }
});
