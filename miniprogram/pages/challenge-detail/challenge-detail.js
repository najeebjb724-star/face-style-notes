const { callCloud } = require("../../services/cloud-client");
const { enqueueCheckIn, flushCheckIns } = require("../../services/offline-checkins");
const { toggleChallengeCheckIn, getChallengeProgress } = require("../../lib/face-style-core");

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

function challengeViewData(challenge, today, yesterday) {
  return {
    challenge,
    today,
    yesterday,
    progress: getChallengeProgress(challenge, today),
    checkedIn: Boolean(challenge.checkIns?.[today]),
    canCheckIn: toggleChallengeCheckIn(challenge, today) !== challenge,
    canCheckInYesterday: !challenge.checkIns?.[yesterday]
      && toggleChallengeCheckIn(challenge, yesterday) !== challenge
  };
}

function refreshCalendar(page) {
  const today = localDate();
  const yesterday = localDate(-1);
  page.setData(page.data.challenge
    ? challengeViewData(page.data.challenge, today, yesterday)
    : { today, yesterday });
  return { today, yesterday };
}

Page({
  data: {
    challenge: null,
    today: localDate(),
    yesterday: localDate(-1),
    checkedIn: false,
    canCheckIn: false,
    canCheckInYesterday: true,
    progress: null,
    photos: {},
    isVisitor: false,
    finishing: false
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

  onShow() {
    this.refreshChallengeDates();
  },

  refreshChallengeDates() {
    return refreshCalendar(this);
  },

  updateChallenge(challenge, today = this.data.today || localDate(), yesterday = this.data.yesterday || localDate(-1)) {
    this.setData(challengeViewData(challenge, today, yesterday));
  },

  async applyCheckIn(date, completed, calendar = this.data) {
    if (this._finishing || this.data.finishing) return;
    const wasCompleted = Boolean(this.data.challenge.checkIns?.[date]);
    if (wasCompleted === completed) return;
    const challenge = toggleChallengeCheckIn(this.data.challenge, date);
    if (challenge === this.data.challenge) return;
    const command = {
      id: `${this.data.challenge.id || this.data.challenge._id}-${date}-${completed ? "done" : "undo"}`,
      challengeId: this.data.challenge._id || this.data.challenge.id,
      date,
      completed
    };
    enqueueCheckIn(command);
    this.setData(challengeViewData(challenge, calendar.today, calendar.yesterday));
    try {
      await syncQueuedCheckIns();
    } catch (_) {
      wx.showToast({ title: "已保存在本机，联网后会同步", icon: "none" });
    }
  },

  completeToday() {
    if (this._finishing || this.data.finishing) return;
    const calendar = refreshCalendar(this);
    return this.applyCheckIn(calendar.today, true, calendar);
  },

  undoToday() {
    if (this._finishing || this.data.finishing) return;
    const calendar = refreshCalendar(this);
    return this.applyCheckIn(calendar.today, false, calendar);
  },

  recordYesterday() {
    if (this._finishing || this.data.finishing) return;
    const calendar = refreshCalendar(this);
    return this.applyCheckIn(calendar.yesterday, true, calendar);
  },

  recordPhoto(event) {
    if (this._finishing || this.data.finishing) return;
    refreshCalendar(this);
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
    if (this._finishing || this.data.finishing) return;
    this._finishing = true;
    this.setData({ finishing: true });
    refreshCalendar(this);
    const challengeId = this.data.challenge._id || this.data.challenge.id;
    try {
      await syncQueuedCheckIns();
    } catch (_) {
      this._finishing = false;
      this.setData({ finishing: false });
      wx.showToast({ title: "打卡尚未同步，联网后再结营", icon: "none" });
      return;
    }

    let completed;
    try {
      completed = await callCloud("challengeApi", {
        action: "finish",
        payload: { challengeId }
      });
      if (!completed?.history) throw new Error("MISSING_HISTORY");
    } catch (error) {
      this._finishing = false;
      this.setData({ finishing: false });
      const title = error?.code === "CHALLENGE_NOT_COMPLETE"
        ? "挑战周期结束且完成至少一次打卡后才可结营"
        : "暂时无法结营，请稍后重试";
      wx.showToast({ title, icon: "none" });
      return;
    }

    try {
      wx.setStorageSync(`challenge-completion:${challengeId}`, completed.history);
    } catch (_) {}
    try {
      wx.navigateTo({
        url: `/pages/challenge-complete/challenge-complete?id=${challengeId}`,
        success({ eventChannel }) {
          eventChannel?.emit("challengeCompleted", completed.history);
        },
        fail() {
          wx.showToast({ title: "结营已保存，请返回后重试打开结营页", icon: "none" });
        }
      });
    } catch (_) {
      wx.showToast({ title: "结营已保存，请返回后重试打开结营页", icon: "none" });
    }
  }
});
