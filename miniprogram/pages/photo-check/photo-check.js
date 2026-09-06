const {
  FACE_CONSENT_STORAGE_KEY,
  assertFaceConsent,
  compressPhotoToJpeg
} = require("../../lib/photo-preflight");
const { evaluatePhotoQuality, overridePhotoQuality } = require("../../lib/face-style-core");

function chooseOnePhoto() {
  return new Promise((resolve, reject) => {
    wx.chooseMedia({
      count: 1,
      mediaType: ["image"],
      sourceType: ["album", "camera"],
      success: resolve,
      fail: reject
    });
  });
}

Page({
  data: {
    choosing: false,
    selectedPhoto: null,
    quality: null,
    compressionError: "",
    readyForAnalysis: false
  },

  async choosePhoto() {
    this.setData({ choosing: true, compressionError: "" });
    try {
      assertFaceConsent(wx.getStorageSync(FACE_CONSENT_STORAGE_KEY));
    } catch (_) {
      this.setData({ choosing: false });
      wx.showToast({ title: "请先同意本次照片处理", icon: "none" });
      wx.navigateTo({ url: "/pages/consent/consent" });
      return;
    }

    try {
      const result = await chooseOnePhoto();
      const media = result?.tempFiles?.[0];
      if (!media?.tempFilePath) {
        this.setData({ choosing: false });
        return;
      }
      const selectedPhoto = await compressPhotoToJpeg(wx, {
        path: media.tempFilePath,
        width: media.width,
        height: media.height
      });
      this.setData({
        choosing: false,
        selectedPhoto,
        quality: null,
        readyForAnalysis: false
      });
    } catch (error) {
      const cancelled = /cancel/i.test(error?.errMsg || error?.message || "");
      this.setData({
        choosing: false,
        compressionError: cancelled ? "" : "照片处理没有完成，请重试或换一张照片。"
      });
    }
  },

  applyQualitySignals(signals) {
    const quality = evaluatePhotoQuality(signals);
    this.setData({ quality, readyForAnalysis: quality.accepted });
    return quality;
  },

  chooseAgain() {
    return this.choosePhoto();
  },

  useAnyway() {
    if (!this.data.quality || this.data.quality.accepted) return;
    const quality = overridePhotoQuality(this.data.quality);
    this.setData({ quality, readyForAnalysis: true });
  }
});
