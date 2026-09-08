const {
  FACE_PREFLIGHT_STORAGE_KEY,
  assertFaceConsent
} = require("../../lib/photo-preflight");
const { callCloud } = require("../../services/cloud-client");

const POLL_DELAYS = [4000, 8000, 16000, 30000];
const ANALYSIS_STATE_STORAGE_KEY = "face-analysis-upload-state";

function randomId() {
  return new Promise((resolve, reject) => {
    if (typeof wx.getRandomValues !== "function") return reject(new Error("RANDOM_UNAVAILABLE"));
    wx.getRandomValues({
      length: 16,
      success: result => {
        const bytes = new Uint8Array(result?.randomValues || new ArrayBuffer(0));
        if (bytes.length !== 16 || bytes.every(value => value === 0)) return reject(new Error("RANDOM_UNAVAILABLE"));
        resolve(Array.from(bytes, value => value.toString(16).padStart(2, "0")).join(""));
      },
      fail: reject
    });
  });
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
    const generation = (this._generation || 0) + 1;
    this._generation = generation;
    this._disposed = false;
    const active = () => !this._disposed && this._generation === generation;
    const saved = wx.getStorageSync(ANALYSIS_STATE_STORAGE_KEY) || {};
    this._consentId = this._consentId || saved.consentId;
    this._clientRequestId = this._clientRequestId || saved.clientRequestId;
    this._uploadRequestId = this._uploadRequestId || saved.uploadRequestId;
    this._tempFileId = this._tempFileId || saved.tempFileId;
    this._reservationId = this._reservationId || saved.reservationId;
    this._cloudPath = this._cloudPath || saved.cloudPath;
    this._attached = this._attached || saved.attached;
    this._jobId = this._jobId || saved.jobId;
    if (this._jobId) {
      this._pollIndex = 0;
      this.setData({ status: "queued", statusText: "正在准备你的结构参考", errorText: "", canRefresh: true });
      await this.refreshStatus(generation);
      if (!active()) return;
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
        if (!active()) return;
        this._consentId = consent.consentId;
      }
      const clientRequestId = this._clientRequestId || await randomId();
      if (!active()) return;
      this._clientRequestId = clientRequestId;
      this._uploadRequestId = this._uploadRequestId || await randomId();
      if (!active()) return;
      persistState(this);
      if (!this._reservationId) {
        const reservation = await callCloud("analysisApi", {
          action: "reserveUpload", payload: { consentId: this._consentId, clientRequestId, uploadRequestId: this._uploadRequestId }
        });
        if (!active()) return;
        this._reservationId = reservation.reservationId;
        this._cloudPath = reservation.cloudPath;
        persistState(this);
      }
      if (!this._tempFileId) {
        this._tempFileId = await uploadPhoto(preflight.photo.path, this._cloudPath);
        if (!active()) return;
        persistState(this);
      }
      if (!this._attached) {
        await callCloud("analysisApi", { action: "attachUpload", payload: { reservationId: this._reservationId, tempFileId: this._tempFileId } });
        if (!active()) return;
        this._attached = true;
        persistState(this);
      }
      const job = await callCloud("analysisApi", {
        action: "createAnalysis",
        payload: {
          consentId: this._consentId,
          reservationId: this._reservationId,
          tempFileId: this._tempFileId,
          quality: preflight.quality,
          clientRequestId
        }
      });
      if (!active()) return;
      this._jobId = job.jobId;
      persistState(this);
      this._pollIndex = 0;
      this.applyStatus(job);
      this.schedulePoll();
    } catch (_) {
      if (!active()) return;
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

  async refreshStatus(request = this._generation) {
    const generation = typeof request === "number" ? request : this._generation;
    if (!this._jobId) return;
    try {
      const result = await callCloud("analysisApi", { action: "getAnalysis", payload: { jobId: this._jobId } });
      if (this._disposed || generation !== this._generation) return;
      this.applyStatus(result);
      return result;
    } catch (_) {
      if (this._disposed || generation !== this._generation) return;
      this.setData({ errorText: "暂时无法获取进度，请稍后手动刷新。", canRefresh: true });
    }
  },

  schedulePoll() {
    this.stopPolling();
    if (this._pollIndex >= POLL_DELAYS.length || !["queued", "processing"].includes(this.data.status)) return;
    const delay = POLL_DELAYS[this._pollIndex++];
    const generation = this._generation;
    this._pollTimer = setTimeout(async () => {
      this._pollTimer = null;
      if (this._disposed || generation !== this._generation) return;
      await this.refreshStatus(generation);
      if (this._disposed || generation !== this._generation) return;
      this.schedulePoll();
    }, delay);
  },

  stopPolling() {
    if (this._pollTimer) clearTimeout(this._pollTimer);
    this._pollTimer = null;
  },

  async chooseAgain() {
    this.stopPolling();
    if (this._reservationId) {
      try {
        await callCloud("analysisApi", { action: "abandonUpload", payload: { reservationId: this._reservationId } });
      } catch (_) {}
    }
    wx.removeStorageSync(ANALYSIS_STATE_STORAGE_KEY);
    wx.navigateBack({ delta: 1 });
  },

  onUnload() {
    this._disposed = true;
    this._generation = (this._generation || 0) + 1;
    this.stopPolling();
  }
});

function persistState(page) {
  wx.setStorageSync(ANALYSIS_STATE_STORAGE_KEY, {
    consentId: page._consentId,
    clientRequestId: page._clientRequestId,
    uploadRequestId: page._uploadRequestId,
    tempFileId: page._tempFileId,
    reservationId: page._reservationId,
    cloudPath: page._cloudPath,
    attached: page._attached,
    jobId: page._jobId
  });
}
