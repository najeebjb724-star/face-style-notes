const { callCloud } = require("../../services/cloud-client");

Page({
  data: { report: null, loading: true, errorText: "" },
  async onLoad(query) {
    const id = typeof query?.id === "string" ? query.id : "";
    if (!id) return this.setData({ loading: false, errorText: "未找到这份结构参考。" });
    try {
      const report = await callCloud("analysisApi", { action: "getReport", payload: { reportId: id } });
      this.setData({ report, loading: false });
    } catch (_) {
      this.setData({ loading: false, errorText: "暂时无法读取这份结构参考，请稍后重试。" });
    }
  },
  createRecommendedChallenge() {
    const goal = this.data.report?.actionCards?.[0]?.title;
    const template = goal === "调整一个发型变量" ? "clean-tools-4" : "makeup-3-in-7";
    wx.navigateTo({ url: `/pages/challenge-create/challenge-create?template=${template}` });
  }
});
