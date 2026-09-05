const { callCloud } = require("../../services/cloud-client");
const { CHALLENGE_TEMPLATES, createChallenge } = require("../../lib/face-style-core");

Page({
  data: {
    templates: CHALLENGE_TEMPLATES,
    selectedTemplateId: "",
    activeChallenge: null,
    submitting: false,
    form: {
      title: "",
      taskLabel: "",
      durationDays: 7,
      frequency: "daily",
      reminderTime: "21:30"
    }
  },

  onLoad(options = {}) {
    if (options.active === "1") this.setData({ activeChallenge: { id: "active" } });
  },

  async onShow() {
    if (this.data.activeChallenge) return;
    try {
      const activeChallenge = await callCloud("challengeApi", { action: "getActive", payload: {} });
      if (activeChallenge) this.setData({ activeChallenge });
    } catch (_) {}
  },

  selectTemplate(event) {
    const templateId = event.currentTarget?.dataset?.id || event.detail?.id || "";
    this.setData({ selectedTemplateId: templateId });
  },

  updateTitle(event) {
    this.setData({ "form.title": event.detail.value, "form.taskLabel": event.detail.value });
  },

  updateDuration(event) {
    this.setData({ "form.durationDays": Number(event.detail.value) || 7 });
  },

  updateReminder(event) {
    this.setData({ "form.reminderTime": event.detail.value });
  },

  chooseFrequency(event) {
    this.setData({ "form.frequency": event.currentTarget.dataset.value });
  },

  async submitChallenge() {
    if (this.data.activeChallenge) {
      wx.showToast({ title: "已有进行中的挑战", icon: "none" });
      return;
    }
    if (!this.data.selectedTemplateId) {
      wx.showToast({ title: "请先选择一个挑战", icon: "none" });
      return;
    }

    let payload;
    try {
      payload = createChallenge({ templateId: this.data.selectedTemplateId, ...this.data.form });
    } catch (error) {
      wx.showToast({ title: error.message || "请检查挑战设置", icon: "none" });
      return;
    }

    this.setData({ submitting: true });
    try {
      const challenge = await callCloud("challengeApi", { action: "create", payload });
      wx.navigateTo({ url: `/pages/challenge-detail/challenge-detail?id=${challenge._id || challenge.id}` });
    } catch (error) {
      const title = error?.code === "ACTIVE_CHALLENGE_EXISTS"
        ? "已有进行中的挑战"
        : "暂时无法创建，请稍后重试";
      wx.showToast({ title, icon: "none" });
    } finally {
      this.setData({ submitting: false });
    }
  }
});
