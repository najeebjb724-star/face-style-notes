const {
  FACE_CONSENT_STORAGE_KEY,
  createFaceConsent
} = require("../../lib/photo-preflight");

Page({
  acceptConsent() {
    const consent = createFaceConsent();
    wx.setStorageSync(FACE_CONSENT_STORAGE_KEY, consent);
    wx.navigateTo({ url: "/pages/photo-check/photo-check" });
  },

  declineConsent() {
    try {
      wx.removeStorageSync(FACE_CONSENT_STORAGE_KEY);
    } catch (_) {}
    wx.switchTab({ url: "/pages/challenges/challenges" });
  }
});
