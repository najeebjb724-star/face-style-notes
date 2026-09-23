const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
function setup(answers, fails = false) {
  let page; const calls = []; const modals = []; const navigations = []; const storage = { 'offline-checkins': [{ challengeId: 'c' }], 'face-analysis-consent': { acceptedAt: 'old' }, 'face-analysis-preflight': { path: 'photo' }, 'challenge-completion:c': { private: true }, unrelated: 'keep' };
  const wx = {
    showModal(options) { modals.push(options); options.success({ confirm: answers.shift() }); },
    navigateTo(options) { navigations.push(options.url); },
    getStorageInfoSync: () => ({ keys: Object.keys(storage) }), getStorageSync: key => storage[key], setStorageSync: (key, value) => { storage[key] = value; }, removeStorageSync: key => { delete storage[key]; }
  };
  vm.runInNewContext(fs.readFileSync('miniprogram/pages/profile/profile.js', 'utf8'), { Page: value => { page = value; }, wx, require: path => path.includes('photo-preflight') ? require('../../miniprogram/lib/photo-preflight') : ({ callCloud: async (name, event) => { calls.push({ name, ...event }); if (fails) throw new Error('offline'); return event.action === 'listData' ? { items: [], next: null } : { auditId: 'audit', reports: 2, challenges: 1, photos: { pending: 1 }, subscriptions: 1, completedAt: null }; } }) });
  page.data = { ...page.data }; page.setData = changes => Object.assign(page.data, changes);
  return { page, calls, modals, navigations, storage };
}

test('profile records open their owner-scoped native detail routes', () => {
  const { page, navigations } = setup([]);
  page.openReport({ currentTarget: { dataset: { id: 'report-1' } } });
  page.openChallengeHistory({ currentTarget: { dataset: { id: 'challenge-1' } } });
  assert.deepEqual(navigations, [
    '/pages/report/report?id=report-1',
    '/pages/challenge-complete/challenge-complete?id=challenge-1'
  ]);
});
test('all-data deletion requires both confirmations, then reports pending cleanup and clears only relevant local data', async () => {
  const { page, calls, modals, storage } = setup([true, true]);
  assert.equal(typeof page.confirmDeleteAll, 'function');
  await page.confirmDeleteAll();
  assert.equal(modals.length, 2);
  assert.equal(calls.filter(call => call.action === 'deleteAccountData').length, 1);
  assert.match(page.data.deletionMessage, /待清理/);
  assert.equal(storage.unrelated, 'keep');
  assert.equal(storage['offline-checkins'], undefined);
  assert.equal(storage['face-analysis-consent'], undefined);
  assert.equal(storage['face-analysis-preflight'], undefined);
  assert.equal(storage['challenge-completion:c'], undefined);
});
test('cancelling second confirmation makes no mutation', async () => {
  const { page, calls } = setup([true, false]);
  assert.equal(typeof page.confirmDeleteAll, 'function');
  await page.confirmDeleteAll();
  assert.equal(calls.length, 0);
});
test('failed deletion does not claim success or discard offline data', async () => {
  const { page, storage } = setup([true, true], true);
  assert.equal(typeof page.confirmDeleteAll, 'function');
  await page.confirmDeleteAll();
  assert.match(page.data.deletionMessage, /未确认完成/);
  assert.ok(storage['offline-checkins']);
});
