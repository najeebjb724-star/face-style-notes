const {
  FACE_CONSENT_STORAGE_KEY,
  FACE_PREFLIGHT_STORAGE_KEY,
  assertFaceConsent,
  getPhotoCanvas,
  compressPhotoToJpeg,
  evaluateBasicPhotoQuality
} = require("../../lib/photo-preflight");
const { evaluatePhotoQuality, overridePhotoQuality } = require("../../lib/face-style-core");
const ANALYSIS_STATE_STORAGE_KEY = "face-analysis-upload-state";

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
    preflightStatus: "idle",
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
      const canvas = await getPhotoCanvas(this);
      const selectedPhoto = await compressPhotoToJpeg(wx, canvas, {
        path: media.tempFilePath,
        width: media.width,
        height: media.height
      });
      const quality = evaluateBasicPhotoQuality(selectedPhoto.basicSignals);
      this.setData({
        choosing: false,
        selectedPhoto,
        quality,
        preflightStatus: quality.accepted ? "quality-ready" : "quality-blocked",
        readyForAnalysis: quality.accepted
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
    this.setData({
      quality,
      preflightStatus: quality.accepted ? "quality-ready" : "quality-blocked",
      readyForAnalysis: quality.accepted
    });
    return quality;
  },

  chooseAgain() {
    return this.choosePhoto();
  },

  useAnyway() {
    if (!this.data.quality || this.data.quality.accepted) return;
    const quality = overridePhotoQuality(this.data.quality);
    this.setData({ quality, preflightStatus: "quality-ready", readyForAnalysis: true });
  },

  async continueAnalysis() {
    if (!this.data.readyForAnalysis || !this.data.selectedPhoto || !this.data.quality) {
      wx.showToast({ title: "质量检查尚未接入，暂不能开始", icon: "none" });
      return;
    }
    try {
      const consent = assertFaceConsent(wx.getStorageSync(FACE_CONSENT_STORAGE_KEY));
      const previous = wx.getStorageSync(ANALYSIS_STATE_STORAGE_KEY);
      if (previous?.reservationId) {
        try {
          const { callCloud } = require("../../services/cloud-client");
          await callCloud("analysisApi", { action: "abandonUpload", payload: { reservationId: previous.reservationId } });
        } catch (_) {}
      }
      wx.setStorageSync(FACE_PREFLIGHT_STORAGE_KEY, {
        photo: this.data.selectedPhoto,
        quality: this.data.quality,
        consent
      });
      wx.removeStorageSync(ANALYSIS_STATE_STORAGE_KEY);
      wx.showToast({ title: "照片已准备，正在进入分析", icon: "none" });
      wx.navigateTo({ url: "/pages/analysis/analysis" });
    } catch (_) {
      wx.showToast({ title: "保存照片准备状态失败，请重试", icon: "none" });
    }
  }
});
