const test = require('node:test');
const assert = require('node:assert/strict');
let createAccountApi;
try { ({ createAccountApi } = require('../../cloudfunctions/accountApi')); } catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }
const { createPhotoLifecycle, adaptCloudDatabase } = require('../../cloudfunctions/lifecycleJobs');
const NOW = new Date('2026-09-21T08:00:00Z');

function setup(seed = {}) {
  const records = structuredClone(seed);
  const command = Object.fromEntries(['lte', 'gt', 'in', 'neq'].map(op => [op, value => ({ op, value })]));
  const collection = name => ({
    doc(id) { return {
      async get() { return { data: structuredClone((records[name] || []).find(row => row._id === id) || null) }; },
      async set(envelope) { assert.deepEqual(Object.keys(envelope), ['data']); const rows = records[name] ||= []; const index = rows.findIndex(row => row._id === id); const row = { ...envelope.data, _id: id }; if (index < 0) rows.push(row); else rows[index] = row; },
      async update(envelope) { assert.deepEqual(Object.keys(envelope), ['data']); const row = records[name]?.find(row => row._id === id); assert.ok(row, 'update existing document'); Object.assign(row, envelope.data); },
      async remove() { records[name] = (records[name] || []).filter(row => row._id !== id); }
    }; },
    where(filter) { let limit = 100; let order; return {
      limit(value) { limit = value; return this; }, orderBy(key) { order = key; return this; },
      async get() {
        const rows = (records[name] || []).filter(row => Object.entries(filter).every(([key, value]) => {
          if (!value?.op) return row[key] === value;
          if (value.op === 'lte') return row[key] <= value.value;
          if (value.op === 'gt') return row[key] > value.value;
          if (value.op === 'in') return value.value.includes(row[key]);
          return row[key] !== value.value;
        }));
        if (order) rows.sort((a, b) => String(a[order]).localeCompare(String(b[order])));
        return { data: structuredClone(rows.slice(0, limit)) };
      }
    }; }
  });
  const database = { collection, command, serverDate: () => NOW.toISOString(), runTransaction: fn => fn({ collection }) };
  assert.equal(typeof createAccountApi, 'function', 'createAccountApi must exist');
  const api = createAccountApi({ database, getWXContext: () => ({ OPENID: 'A' }), now: () => NOW });
  return { records, database, api };
}
const row = (id, extra = {}, owner = 'A') => ({ _id: id, _openid: owner, ...extra });

test('challenge list data includes the persisted status needed for native routing', async () => {
  const { api } = setup({ challenges: [
    row('active', { status: 'active', title: '进行中' }),
    row('completed', { status: 'completed', title: '已完成' }),
    row('legacy')
  ] });

  const result = await api({ action: 'listData', payload: { kind: 'challenges' } });

  assert.deepEqual(result.items.map(item => ({ id: item.id, status: item.status })), [
    { id: 'active', status: 'active' },
    { id: 'completed', status: 'completed' },
    { id: 'legacy', status: null }
  ]);
});

test('account deletion drains every private collection, preserves other owners and a truthful audit', async () => {
  const names = ['users', 'consents', 'analysis_jobs', 'analysis_uploads', 'reports', 'challengeOwners', 'challenges', 'checkins', 'challenge_photos', 'reminder_subscriptions', 'share_previews'];
  const seed = Object.fromEntries(names.map(name => [name, [row(`${name}-A`), row(`${name}-B`, {}, 'B')]]));
  seed.challenge_photos[0].deletionState = 'deleted';
  seed.reports.push(...Array.from({ length: 105 }, (_, i) => row(`report-${i}`)));
  const { api, records } = setup(seed);
  const result = await api({ action: 'deleteAccountData', payload: { _openid: 'B' } });
  for (const name of names) assert.deepEqual(records[name], [seed[name].find(item => item._openid === 'B')]);
  assert.equal(result.reports, 106);
  assert.equal(result.challenges, 1);
  assert.equal(result.subscriptions, 1);
  assert.equal(result.completedAt, NOW.toISOString());
  assert.ok(records.deletion_jobs.some(item => item.kind === 'account-summary' && item._openid === 'A'));
});

test('single deletion rejects a foreign record and cascades only owned challenge children', async () => {
  const { api, records } = setup({ challenges: [row('c'), row('foreign', {}, 'B')], reports: [row('foreign', {}, 'B')], checkins: [row('mine', { challengeId: 'c' }), row('foreign-child', { challengeId: 'c' }, 'B')], reminder_subscriptions: [row('sub', { challengeId: 'c', sendState: 'sending' })], challengeOwners: [row('A', { activeChallengeId: 'c' })] });
  await assert.rejects(api({ action: 'deleteReport', payload: { reportId: 'foreign' } }), /FORBIDDEN/);
  await assert.rejects(api({ action: 'deleteChallenge', payload: { challengeId: 'foreign' } }), /FORBIDDEN/);
  await api({ action: 'deleteChallenge', payload: { challengeId: 'c' } });
  assert.deepEqual(records.checkins.map(item => item._id), ['foreign-child']);
  assert.deepEqual(records.reminder_subscriptions, []);
  assert.equal(records.challengeOwners[0].activeChallengeId, null);
});

test('challenge cascade resumes from its owner-bound intent after the root is already gone', async () => {
  const { createHash } = require('node:crypto');
  const challengeId = 'c';
  const intentId = `account-challenge-${createHash('sha256').update(JSON.stringify(['A', challengeId])).digest('hex')}`;
  const { api, records } = setup({
    deletion_jobs: [row(intentId, { kind: 'account-challenge', challengeId, auditId: 'account-existing', state: 'deleting' })],
    checkins: [row('checkin', { challengeId })],
    reminder_subscriptions: [row('subscription', { challengeId })],
    challengeOwners: [row('A', { activeChallengeId: challengeId })]
  });
  records.deletion_jobs.push(row('account-existing', { kind: 'account-summary', action: 'deleteChallenge', finished: false, summary: { reports: 0, challenges: 0, subscriptions: 0, acceptedAt: NOW.toISOString(), completedAt: null } }));
  const summary = await api({ action: 'deleteChallenge', payload: { challengeId } });
  assert.equal(summary.auditId, 'account-existing');
  assert.deepEqual(records.checkins, []);
  assert.deepEqual(records.reminder_subscriptions, []);
  assert.equal(records.challengeOwners[0].activeChallengeId, null);
  assert.equal(records.deletion_jobs.find(item => item._id === intentId).state, 'deleted');
});

test('withdrawal revokes consent and removes in-flight source data while preserving saved reports and challenges', async () => {
  const { api, records } = setup({ consents: [row('consent', { type: 'face-analysis', revokedAt: null })], analysis_jobs: [row('job', { status: 'processing', tempFileId: 'cloud://source' })], analysis_uploads: [row('upload', { tempFileId: 'cloud://source' })], reports: [row('saved')], challenges: [row('c')] });
  const summary = await api({ action: 'withdrawFaceConsent' });
  assert.equal(records.consents[0].revokedAt, NOW.toISOString());
  assert.deepEqual(records.analysis_jobs, []);
  assert.equal(records.reports.length, 1);
  assert.equal(records.challenges.length, 1);
  assert.equal(summary.photos.pending, 1);
  assert.equal(summary.completedAt, null);
});

test('durable exact-file intent survives parent deletion and failed SDK replies then retries successfully', async () => {
  const { api, records, database } = setup({ challenge_photos: [row('p', { fileId: 'cloud://photo' })], share_previews: [row('s', { miniCodeFileIds: ['cloud://mini'] })] });
  const result = await api({ action: 'deleteAccountData' });
  assert.equal(result.photos.pending, 2);
  assert.equal(result.completedAt, null);
  let success = false;
  const lifecycle = createPhotoLifecycle({ database: adaptCloudDatabase(database), now: () => NOW, cloud: { async deleteFile({ fileList }) { return { fileList: [{ fileID: success ? fileList[0] : 'cloud://wrong', status: 0 }] }; } } });
  await lifecycle.deleteExpiredPhotos(NOW);
  assert.equal(records.deletion_jobs.filter(item => item.kind === 'account-file' && item.state === 'retrying').length, 2);
  success = true;
  await lifecycle.deleteExpiredPhotos(new Date(NOW.getTime() + 61000));
  assert.equal(records.deletion_jobs.filter(item => item.kind === 'account-file' && item.state === 'deleted').length, 2);
  const status = await api({ action: 'getDeletionStatus', payload: { auditId: result.auditId } });
  assert.equal(status.photos.pending, 0);
  assert.ok(status.completedAt);
});

test('account deletion audit waits for a mini-code upload already in flight', async () => {
  const { api, records } = setup({ deletion_jobs: [row('share-upload-1', { kind: 'share-upload', state: 'uploading', dueAt: NOW.toISOString() })] });
  const summary = await api({ action: 'deleteAccountData' });
  assert.equal(summary.photos.pending, 1);
  assert.equal(summary.completedAt, null);
  assert.ok(records.deletion_jobs.find(item => item._id === 'share-upload-1').auditIds.includes(summary.auditId));
});

test('status cannot miss an upload job while it converts to exact-file cleanup', async () => {
  const auditId = 'account-audit';
  const { api, records, database } = setup({ deletion_jobs: [
    row(auditId, { kind: 'account-summary', finished: true, summary: { reports: 0, challenges: 0, subscriptions: 0, acceptedAt: NOW.toISOString(), completedAt: null } }),
    row('upload', { kind: 'share-upload', accountCleanup: true, auditIds: [auditId], state: 'uploading' })
  ] });
  const originalCollection = database.collection;
  let deletionQueries = 0;
  database.collection = name => {
    const collection = originalCollection(name);
    if (name !== 'deletion_jobs') return collection;
    const originalWhere = collection.where;
    collection.where = filter => {
      const query = originalWhere(filter);
      const originalGet = query.get;
      query.get = async () => {
        const result = await originalGet();
        deletionQueries++;
        if (deletionQueries === 1) records.deletion_jobs.find(item => item._id === 'upload').kind = 'account-file';
        return result;
      };
      return query;
    };
    return collection;
  };
  const summary = await api({ action: 'getDeletionStatus', payload: { auditId } });
  assert.equal(summary.photos.pending, 1);
  assert.equal(summary.completedAt, null);
  assert.equal(deletionQueries, 1);
});

test('expiry removes share previews and retains mini-code deletion intent after SDK failure', async () => {
  const { records, database } = setup({ share_previews: [row('expired', { expiresAt: NOW.toISOString(), miniCodeFileIds: ['cloud://mini'] }), row('live', { expiresAt: '2026-10-01T00:00:00Z' })] });
  const lifecycle = createPhotoLifecycle({ database: adaptCloudDatabase(database), cloud: { deleteFile: async () => { throw new Error('offline'); } } });
  await lifecycle.deleteExpiredPhotos(NOW);
  assert.deepEqual(records.share_previews.map(item => item._id), ['live']);
  assert.ok(records.deletion_jobs.some(item => item.fileId === 'cloud://mini' && item.state !== 'deleted'));
});

test('missing photo identity remains manual work and legacy parent-based retries are superseded', async () => {
  const { api, records } = setup({ challenge_photos: [row('missing', { deletionState: 'retrying' })], analysis_jobs: [row('j', { tempFileId: 'cloud://source', sourcePhotoStatus: 'deleting' })], deletion_jobs: [row('analysis-j', { kind: 'analysis', sourceId: 'j', state: 'retrying', attempts: 2 })] });
  const summary = await api({ action: 'deleteAccountData' });
  assert.equal(summary.completedAt, null);
  assert.equal(summary.photos.pending, 2);
  assert.equal(records.deletion_jobs.find(item => item._id === 'analysis-j').state, 'superseded');
  assert.ok(records.deletion_jobs.some(item => item.kind === 'account-file' && item.state === 'manual_review'));
});

test('deletion status counts only file work linked to that audit', async () => {
  const { api, records } = setup({
    reports: [row('report')],
    deletion_jobs: [row('old-file', { kind: 'account-file', fileId: 'cloud://old', state: 'manual_review' })]
  });
  const summary = await api({ action: 'deleteReport', payload: { reportId: 'report' } });
  assert.deepEqual(summary.photos, { queued: 0, deleted: 0, pending: 0 });
  assert.equal(summary.completedAt, NOW.toISOString());
  assert.equal(records.deletion_jobs.find(item => item._id === 'old-file').state, 'manual_review');
});

test('withdrawal leaves unrelated consent types unchanged', async () => {
  const { api, records } = setup({ consents: [row('face', { type: 'face-analysis' }), row('other', { type: 'challenge-photo', revokedAt: null })] });
  await api({ action: 'withdrawFaceConsent' });
  assert.equal(records.consents.find(item => item._id === 'other').revokedAt, null);
});

test('analysis completion rechecks revoked consent inside its report transaction', async () => {
  const { createHash } = require('node:crypto');
  const { completeContainerJob } = require('../../cloudfunctions/analysisApi/src/index');
  const { database, records } = setup({
    consents: [row('consent', { revokedAt: NOW.toISOString() })],
    analysis_jobs: [row('job', { status: 'processing', sourcePhotoStatus: 'pending', quality: { level: 'high' }, consentId: 'consent', reservationId: 'upload', leaseId: 'lease', leaseHash: createHash('sha256').update('secret').digest('hex'), leaseExpiresAt: '2026-09-21T08:01:00Z' })],
    analysis_uploads: [row('upload', { status: 'assigned', jobId: 'job' })]
  });
  const result = { jobId: 'job', points: require('../fixtures/landmarks.cjs').makeFrontLandmarks(), modelVersion: 'face-api-0.22.2', detectionScore: .99, faceBox: { x: 0, y: 0, width: 100, height: 100 }, imageSize: { width: 500, height: 500 } };
  await assert.rejects(completeContainerJob({ database: adaptCloudDatabase(database), jobId: 'job', leaseId: 'lease', leaseToken: 'secret', result, now: NOW }), /CONSENT_REQUIRED/);
  assert.equal((records.reports || []).length, 0);
});
