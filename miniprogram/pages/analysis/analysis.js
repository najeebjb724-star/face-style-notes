const {
  FACE_PREFLIGHT_STORAGE_KEY,
  assertFaceConsent
} = require("../../lib/photo-preflight");
const { callCloud } = require("../../services/cloud-client");

const POLL_DELAYS = [4000, 8000, 16000, 30000];
const ANALYSIS_STATE_STORAGE_KEY = "face-analysis-upload-state";

function randomId() {
  const bytes = new Uint8Array(16);
  if (typeof wx.getRandomValues !== "function") throw new Error("RANDOM_UNAVAILABLE");
  wx.getRandomValues(bytes);
  return Array.from(bytes, value => value.toString(16).padStart(2, "0")).join("");
}

function uploadPhoto(localPath, cloudPath) {
  return new Promise((resolve, reject) => {
    wx.cloud.uploadFile({
      cloudPath,
      filePath: localPath,
      success: result => result?.fileID ? resolve(result.fileID) : reject(new Error("UPLOAD_FAILED")),
      fail: reject
    });
  });
}

function validPreflight(value) {
  return value?.photo?.type === "jpeg"
    && typeof value.photo.path === "string"
    && value.quality?.accepted === true
    && typeof value.quality.scope === "string";
}

Page({
  data: {
    status: "idle",
    statusText: "准备开始",
    errorText: "",
    canRetryUpload: false,
    canRefresh: false,
    reportId: null
  },

  onLoad() {
    return this.startAnalysis();
  },

  async startAnalysis() {
    const saved = wx.getStorageSync(ANALYSIS_STATE_STORAGE_KEY) || {};
    this._consentId = this._consentId || saved.consentId;
    this._clientRequestId = this._clientRequestId || saved.clientRequestId;
    this._tempFileId = this._tempFileId || saved.tempFileId;
    this._jobId = this._jobId || saved.jobId;
    if (this._jobId) {
      this.setData({ status: "queued", statusText: "正在准备你的结构参考", errorText: "", canRefresh: true });
      await this.refreshStatus();
      this.schedulePoll();
      return;
    }

    let preflight;
    try {
      preflight = wx.getStorageSync(FACE_PREFLIGHT_STORAGE_KEY);
      assertFaceConsent(preflight?.consent);
      if (!validPreflight(preflight)) throw new Error("PREFLIGHT_REQUIRED");
    } catch (_) {
      this.setData({ status: "failed", errorText: "请重新确认照片处理说明并选择照片。", canRetryUpload: false });
      return;
    }

    this.setData({ status: "uploading", statusText: "正在安全上传照片", errorText: "", canRetryUpload: false });
    try {
      if (!this._consentId) {
        const consent = await callCloud("analysisApi", { action: "recordConsent", payload: preflight.consent });
        this._consentId = consent.consentId;
      }
      const clientRequestId = this._clientRequestId || randomId();
      this._clientRequestId = clientRequestId;
      persistState(this);
      if (!this._tempFileId) {
        const photoName = randomId();
        this._tempFileId = await uploadPhoto(preflight.photo.path, `analysis/${clientRequestId}/${photoName}.jpg`);
        persistState(this);
      }
      const job = await callCloud("analysisApi", {
        action: "createAnalysis",
        payload: {
          consentId: this._consentId,
          tempFileId: this._tempFileId,
          quality: preflight.quality,
          clientRequestId
        }
      });
      this._jobId = job.jobId;
      persistState(this);
      this._pollIndex = 0;
      this.applyStatus(job);
      this.schedulePoll();
    } catch (_) {
      this.setData({ status: "failed", errorText: "照片上传或任务创建没有完成，请重试。", canRetryUpload: true, canRefresh: false });
    }
  },

  applyStatus(result) {
    const status = result?.status;
    if (status === "queued" || status === "processing") {
      this.setData({ status, statusText: "正在准备你的结构参考", errorText: "", canRefresh: true, reportId: null });
    } else if (status === "complete" && result.reportId) {
      this.stopPolling();
      this.setData({ status, statusText: "结构参考已准备好", errorText: "", canRefresh: false, reportId: result.reportId });
    } else if (status === "failed") {
      this.stopPolling();
      this.setData({ status, errorText: "这次处理没有完成，你可以刷新状态或重新选择照片。", canRefresh: true });
    }
  },

  async refreshStatus() {
    if (!this._jobId) return;
    try {
      const result = await callCloud("analysisApi", { action: "getAnalysis", payload: { jobId: this._jobId } });
      this.applyStatus(result);
      return result;
    } catch (_) {
      this.setData({ errorText: "暂时无法获取进度，请稍后手动刷新。", canRefresh: true });
    }
  },

  schedulePoll() {
    this.stopPolling();
    if (this._pollIndex >= POLL_DELAYS.length || !["queued", "processing"].includes(this.data.status)) return;
    const delay = POLL_DELAYS[this._pollIndex++];
    this._pollTimer = setTimeout(async () => {
      this._pollTimer = null;
      await this.refreshStatus();
      this.schedulePoll();
    }, delay);
  },

  stopPolling() {
    if (this._pollTimer) clearTimeout(this._pollTimer);
    this._pollTimer = null;
  },

  chooseAgain() {
    this.stopPolling();
    wx.navigateBack({ delta: 1 });
  },

  onUnload() {
    this.stopPolling();
  }
});

function persistState(page) {
  wx.setStorageSync(ANALYSIS_STATE_STORAGE_KEY, {
    consentId: page._consentId,
    clientRequestId: page._clientRequestId,
    tempFileId: page._tempFileId,
    jobId: page._jobId
  });
}
