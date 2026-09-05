const { callCloud } = require("../../services/cloud-client");
const { enqueueCheckIn, flushCheckIns } = require("../../services/offline-checkins");
const { toggleChallengeCheckIn, getChallengeProgress, createChallengeHistoryEntry } = require("../../lib/face-style-core");

function localDate(offsetDays = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function syncQueuedCheckIns() {
  return flushCheckIns(command => callCloud("challengeApi", {
    action: command.completed ? "checkIn" : "undoCheckIn",
    payload: command
  }));
}

Page({
  data: {
    challenge: null,
    today: localDate(),
    checkedIn: false,
    canCheckIn: false,
    canCheckInYesterday: true,
    progress: null,
    photos: {},
    isVisitor: false
  },

  async onLoad() {
    try {
      const challenge = await callCloud("challengeApi", { action: "getActive", payload: {} });
      if (!challenge) return;
      this.updateChallenge(challenge);
      syncQueuedCheckIns().catch(() => {});
    } catch (_) {
      this.setData({ isVisitor: true });
    }
  },

  updateChallenge(challenge) {
    const today = this.data.today || localDate();
    this.setData({
      challenge,
      progress: getChallengeProgress(challenge, today),
      checkedIn: Boolean(challenge.checkIns?.[today]),
      canCheckIn: true
    });
  },

  async applyCheckIn(date, completed) {
    const challenge = toggleChallengeCheckIn(this.data.challenge, date);
    const command = {
      id: `${this.data.challenge.id || this.data.challenge._id}-${date}-${completed ? "done" : "undo"}`,
      challengeId: this.data.challenge._id || this.data.challenge.id,
      date,
      completed
    };
    enqueueCheckIn(command);
    this.setData({
      challenge,
      progress: getChallengeProgress(challenge, this.data.today),
      checkedIn: Boolean(challenge.checkIns?.[this.data.today])
    });
    try {
      await syncQueuedCheckIns();
    } catch (_) {
      wx.showToast({ title: "已保存在本机，联网后会同步", icon: "none" });
    }
  },

  completeToday() {
    return this.applyCheckIn(this.data.today, true);
  },

  undoToday() {
    return this.applyCheckIn(this.data.today, false);
  },

  recordYesterday() {
    return this.applyCheckIn(localDate(-1), true);
  },

  recordPhoto(event) {
    const slot = event.detail?.slot || event.currentTarget?.dataset?.slot || "stage";
    if (!wx.chooseMedia) return;
    wx.chooseMedia({ count: 1, mediaType: ["image"] })
      .then(({ tempFiles }) => {
        if (!tempFiles?.[0]?.tempFilePath) return;
        this.setData({ [`photos.${slot}`]: tempFiles[0].tempFilePath });
      })
      .catch(() => {});
  },

  async finishChallenge() {
    const challengeId = this.data.challenge._id || this.data.challenge.id;
    // Build the text-only summary locally as a safe fallback; photos are optional.
    createChallengeHistoryEntry(this.data.challenge, this.data.progress, this.data.today);
    try {
      await callCloud("challengeApi", { action: "finish", payload: { challengeId, date: this.data.today } });
      wx.navigateTo({ url: `/pages/challenge-complete/challenge-complete?id=${challengeId}` });
    } catch (_) {
      wx.showToast({ title: "暂时无法结营，请稍后重试", icon: "none" });
    }
  }
});
