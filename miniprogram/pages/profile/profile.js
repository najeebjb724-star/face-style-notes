const { callCloud } = require('../../services/cloud-client');
const { revokeFaceConsent, FACE_CONSENT_STORAGE_KEY, FACE_PREFLIGHT_STORAGE_KEY } = require('../../lib/photo-preflight');

function confirm(title, content) {
  return new Promise(resolve => wx.showModal({ title, content, confirmText: '继续', cancelText: '取消', success: result => resolve(result.confirm === true), fail: () => resolve(false) }));
}

Page({
  data: { reports: [], challenges: [], reportNext: null, challengeNext: null, busy: false, deletionMessage: '', auditId: '' },
  async onShow() {
    await this.loadRecords();
    const auditId = wx.getStorageSync('last-deletion-audit');
    if (auditId) { this.setData({ auditId }); await this.refreshDeletionStatus(); }
  },
  async loadRecords() {
    try {
      const [reports, challenges] = await Promise.all(['reports', 'challenges'].map(kind => callCloud('accountApi', { action: 'listData', payload: { kind } })));
      this.setData({ reports: reports.items, challenges: challenges.items, reportNext: reports.next, challengeNext: challenges.next });
    } catch (_) { this.setData({ deletionMessage: '记录暂时无法加载，请稍后重试。' }); }
  },
  async loadMore(event) {
    const kind = event.currentTarget.dataset.kind;
    if (!['reports', 'challenges'].includes(kind)) return;
    const key = kind === 'reports' ? 'reportNext' : 'challengeNext';
    try {
      const result = await callCloud('accountApi', { action: 'listData', payload: { kind, after: this.data[key] } });
      this.setData({ [kind]: [...this.data[kind], ...result.items], [key]: result.next });
    } catch (_) { this.setData({ deletionMessage: '记录暂时无法加载，请稍后重试。' }); }
  },
  showSummary(summary) {
    const pending = summary.photos.pending;
    this.setData({ auditId: summary.auditId, deletionMessage: `已移除身份卡 ${summary.reports} 份、挑战 ${summary.challenges} 组、提醒记录 ${summary.subscriptions} 条。${pending ? `还有 ${pending} 个云端文件待清理，系统将重试；这不代表物理删除完成。` : summary.completedAt ? '云端文件清理已完成。' : '请求尚未确认完成，请重试。'}` });
    wx.setStorageSync('last-deletion-audit', summary.auditId);
  },
  async refreshDeletionStatus() {
    if (!this.data.auditId) return;
    try { this.showSummary(await callCloud('accountApi', { action: 'getDeletionStatus', payload: { auditId: this.data.auditId } })); }
    catch (_) { this.setData({ deletionMessage: '清理状态暂时无法确认，请稍后刷新。' }); }
  },
  async deleteData(action, payload, description) {
    if (this.data.busy) return;
    this.setData({ busy: true });
    try {
      if (!await confirm('数据管理', description)) return;
      if (!await confirm('再次确认', '确认后将开始处理，已删除的记录无法恢复。是否继续？')) return;
      const summary = await callCloud('accountApi', { action, payload });
      if (action === 'deleteAccountData' || action === 'withdrawFaceConsent') {
        revokeFaceConsent();
        for (const key of [FACE_CONSENT_STORAGE_KEY, FACE_PREFLIGHT_STORAGE_KEY, 'face-analysis-upload-state']) wx.removeStorageSync(key);
      }
      if (action === 'deleteAccountData') {
        wx.removeStorageSync('offline-checkins');
        for (const key of wx.getStorageInfoSync().keys) if (key.startsWith('challenge-completion:')) wx.removeStorageSync(key);
      }
      if (action === 'deleteChallenge') {
        wx.removeStorageSync(`challenge-completion:${payload.challengeId}`);
        const queue = wx.getStorageSync('offline-checkins');
        if (Array.isArray(queue)) wx.setStorageSync('offline-checkins', queue.filter(item => item.challengeId !== payload.challengeId));
      }
      await this.loadRecords();
      this.showSummary(summary);
    } catch (_) { this.setData({ deletionMessage: '删除未确认完成，可能已有部分数据被移除。请重试；云端文件清理任务会继续保留。' }); }
    finally { this.setData({ busy: false }); }
  },
  confirmDeleteAll() { return this.deleteData('deleteAccountData', {}, '清空身份卡、挑战、打卡、同意记录和分享预览，取消后续提醒，并安排云端照片清理。已发出的提醒、他人保存的分享图片无法撤回。'); },
  confirmDeleteReport(event) { return this.deleteData('deleteReport', { reportId: event.currentTarget.dataset.id }, '删除这份身份卡及关联分析记录，同时使你已有的身份卡分享预览失效。挑战记录保留。'); },
  confirmDeleteChallenge(event) { return this.deleteData('deleteChallenge', { challengeId: event.currentTarget.dataset.id }, '删除这组挑战、打卡和提醒记录，安排照片清理，并使你已有的挑战分享预览失效。'); },
  confirmWithdrawConsent() { return this.deleteData('withdrawFaceConsent', {}, '撤回人脸分析同意，停止未完成的分析并安排源照片清理。已保存的身份卡和挑战保留；以后分析需要重新同意。'); }
});
