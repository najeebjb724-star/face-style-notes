const { createHash, randomUUID } = require('node:crypto');

const PRIVATE_COLLECTIONS = ['consents', 'analysis_jobs', 'analysis_uploads', 'reports', 'challenges', 'checkins', 'challenge_photos', 'reminder_subscriptions', 'challengeOwners', 'share_previews', 'users'];
const error = code => Object.assign(new Error(code), { code });
function requireId(id) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw error('INVALID_ARGUMENT');
  return id;
}
async function read(reference) {
  try { return (await reference.get())?.data || null; }
  catch (failure) {
    if (failure?.code === 'DATABASE_DOCUMENT_NOT_EXIST' || failure?.errCode === -502005) return null;
    throw failure;
  }
}
function assertOwner(record, openid) {
  if (!record || record._openid !== openid) throw error('FORBIDDEN');
}
function challengeIntentId(openid, challengeId) {
  return `account-challenge-${createHash('sha256').update(JSON.stringify([openid, challengeId])).digest('hex')}`;
}
function accountDeletionId(openid) {
  return `account-delete-${createHash('sha256').update(openid).digest('hex')}`;
}

// This handler uses the SDK's native { data } envelope, including transactions.
function createAccountApi({ database, getWXContext, now = () => new Date() }) {
  async function list(name, filter, after = '') {
    return (await database.collection(name).where({ ...filter, ...(after ? { _id: database.command.gt(after) } : {}) }).orderBy('_id', 'asc').limit(50).get()).data || [];
  }
  async function all(name, filter) {
    const rows = []; let after = '';
    for (;;) {
      const page = await list(name, filter, after);
      rows.push(...page);
      if (page.length < 50) return rows;
      after = page.at(-1)._id;
    }
  }
  async function queueFiles(tx, name, record, at, auditId) {
    const alreadyDeleted = record.sourcePhotoStatus === 'deleted' || record.status === 'deleted' || record.deletionState === 'deleted';
    const files = alreadyDeleted ? [] : [...new Set([record.tempFileId, record.fileId, ...(record.miniCodeFileIds || [])].filter(value => typeof value === 'string'))];
    const photoExpected = name === 'challenge_photos' || record.sourcePhotoStatus || (name === 'analysis_uploads' && record.status);
    if (!alreadyDeleted && !files.length && photoExpected) {
      await tx.collection('deletion_jobs').doc(`missing-${name}-${record._id}`).set({ data: { kind: 'account-file', accountCleanup: true, _openid: record._openid, sourceId: record._id, auditIds: [auditId], state: 'manual_review', attempts: 0, lastError: 'FILE_ID_MISSING', dueAt: at, createdAt: at } });
    }
    for (const fileId of files) {
      const id = `account-file-${createHash('sha256').update(JSON.stringify([record._openid, fileId])).digest('hex')}`;
      const reference = tx.collection('deletion_jobs').doc(id);
      const existing = await read(reference);
      if (existing) {
        const auditIds = [...new Set([...(existing.auditIds || []), auditId])];
        await reference.update({ data: { accountCleanup: true, auditIds } });
        continue;
      }
      await reference.set({ data: { kind: 'account-file', accountCleanup: true, _openid: record._openid, fileId, auditIds: [auditId], state: 'pending', attempts: 0, dueAt: at, createdAt: at } });
    }
    const legacyKind = { analysis_jobs: 'analysis', analysis_uploads: 'upload', challenge_photos: 'challenge-photo', challenges: 'challenge' }[name];
    if (legacyKind) {
      const reference = tx.collection('deletion_jobs').doc(`${legacyKind}-${record._id}`);
      const legacy = await read(reference);
      if (legacy?._openid === record._openid && legacy.state !== 'deleted') await reference.update({ data: { state: 'superseded', updatedAt: at } });
    }
  }
  async function status(openid, auditId) {
    const reference = database.collection('deletion_jobs').doc(requireId(auditId));
    const audit = await read(reference);
    assertOwner(audit, openid);
    if (audit.kind !== 'account-summary') throw error('INVALID_ARGUMENT');
    const files = (await all('deletion_jobs', { _openid: openid })).filter(item => (item.accountCleanup || item.kind === 'account-file' || item.kind === 'share-upload') && item.auditIds?.includes(auditId));
    const pending = files.filter(item => item.state !== 'deleted').length;
    const summary = { ...audit.summary, auditId, photos: { queued: files.length, deleted: files.length - pending, pending }, completedAt: audit.finished && !pending ? audit.summary.completedAt || now().toISOString() : null };
    await reference.update({ data: { summary } });
    return summary;
  }
  return async function handle(event = {}) {
    const openid = getWXContext()?.OPENID;
    if (!openid) throw error('UNAUTHENTICATED');
    const payload = event.payload || {};
    if (event.action === 'getDeletionStatus') return status(openid, payload.auditId);
    if (event.action === 'listData') {
      const name = payload.kind === 'challenges' ? 'challenges' : 'reports';
      if (payload.after) requireId(payload.after);
      const rows = await list(name, { _openid: openid }, payload.after);
      return { items: rows.map(item => ({ id: item._id, title: name === 'reports' ? '美学身份卡' : '风格挑战', createdAt: item.createdAt || item.startedAt || '' })), next: rows.length === 50 ? rows.at(-1)._id : null };
    }
    if (!['deleteReport', 'deleteChallenge', 'withdrawFaceConsent', 'deleteAccountData'].includes(event.action)) throw error('INVALID_ARGUMENT');
    const at = now().toISOString();
    let root; let cascadeIntent; let challengeId;
    if (event.action === 'deleteReport' || event.action === 'deleteChallenge') {
      const name = event.action === 'deleteReport' ? 'reports' : 'challenges';
      const targetId = requireId(payload[name === 'reports' ? 'reportId' : 'challengeId']);
      root = await read(database.collection(name).doc(targetId));
      if (event.action === 'deleteChallenge') {
        challengeId = targetId;
        cascadeIntent = await read(database.collection('deletion_jobs').doc(challengeIntentId(openid, challengeId)));
        if (root) assertOwner(root, openid);
        else if (!cascadeIntent || cascadeIntent._openid !== openid || cascadeIntent.challengeId !== challengeId) throw error('FORBIDDEN');
      } else assertOwner(root, openid);
    }
    const auditId = cascadeIntent?.auditId || `account-${randomUUID()}`;
    const auditReference = database.collection('deletion_jobs').doc(auditId);
    const existingAudit = cascadeIntent ? await read(auditReference) : null;
    const summary = existingAudit?.summary || { reports: 0, challenges: 0, subscriptions: 0, acceptedAt: at, completedAt: null };
    if (!existingAudit) await auditReference.set({ data: { kind: 'account-summary', _openid: openid, action: event.action, finished: false, summary } });
    if (event.action === 'deleteAccountData') {
      await database.collection('deletion_jobs').doc(accountDeletionId(openid)).set({ data: { kind: 'account-delete', _openid: openid, auditId, state: 'deleting', updatedAt: at } });
      for (const upload of await all('deletion_jobs', { _openid: openid })) {
        if (!upload.accountCleanup && upload.kind !== 'share-upload') continue;
        if (upload.state !== 'uploading') continue;
        await database.collection('deletion_jobs').doc(upload._id).update({ data: { auditIds: [...new Set([...(upload.auditIds || []), auditId])] } });
      }
    }
    if (event.action === 'deleteChallenge' && !cascadeIntent) {
      const intentId = challengeIntentId(openid, challengeId);
      await database.runTransaction(async tx => {
        const challenge = await read(tx.collection('challenges').doc(challengeId));
        assertOwner(challenge, openid);
        await tx.collection('deletion_jobs').doc(intentId).set({ data: { kind: 'account-challenge', _openid: openid, challengeId, auditId, state: 'deleting', createdAt: at } });
      });
      cascadeIntent = { challengeId, auditId };
    }
    async function removeRows(name, filter) {
      for (;;) {
        const rows = await list(name, { _openid: openid, ...filter });
        if (!rows.length) return;
        for (const candidate of rows) {
          const removed = await database.runTransaction(async tx => {
            const reference = tx.collection(name).doc(candidate._id);
            const current = await read(reference);
            if (!current) return false;
            assertOwner(current, openid);
            await queueFiles(tx, name, current, at, auditId);
            await reference.remove();
            return true;
          });
          if (removed && name === 'reports') summary.reports++;
          if (removed && name === 'challenges') summary.challenges++;
          if (removed && name === 'reminder_subscriptions') summary.subscriptions++;
        }
        await auditReference.update({ data: { summary } });
      }
    }
    if (event.action === 'withdrawFaceConsent') {
      for (const consent of await all('consents', { _openid: openid, type: 'face-analysis' })) {
        await database.runTransaction(async tx => {
          const reference = tx.collection('consents').doc(consent._id);
          assertOwner(await read(reference), openid);
          await reference.update({ data: { revokedAt: at } });
        });
      }
      await removeRows('analysis_jobs', {});
      await removeRows('analysis_uploads', {});
    } else if (event.action === 'deleteReport') {
      await removeRows('analysis_jobs', { reportId: root._id });
      if (root.jobId) {
        await removeRows('analysis_jobs', { _id: root.jobId });
        await removeRows('analysis_uploads', { jobId: root.jobId });
      }
      await removeRows('reports', { _id: root._id });
      // Previews have no source ID, so invalidate this owner's report previews.
      await removeRows('share_previews', { kind: 'report' });
    } else if (event.action === 'deleteChallenge') {
      for (const name of ['reminder_subscriptions', 'checkins', 'challenge_photos']) await removeRows(name, { challengeId });
      await removeRows('share_previews', { kind: 'challenge' });
      await database.runTransaction(async tx => {
        const reference = tx.collection('challengeOwners').doc(openid);
        const owner = await read(reference);
        if (owner?._openid === openid && owner.activeChallengeId === challengeId) await reference.update({ data: { activeChallengeId: null } });
      });
      await removeRows('challenges', { _id: challengeId });
      await database.collection('deletion_jobs').doc(challengeIntentId(openid, challengeId)).update({ data: { state: 'deleted', completedAt: at } });
    } else {
      for (const name of PRIVATE_COLLECTIONS) await removeRows(name, {});
      await database.collection('deletion_jobs').doc(accountDeletionId(openid)).update({ data: { state: 'completed', completedAt: at } });
    }
    await auditReference.update({ data: { finished: true, summary } });
    return status(openid, auditId);
  };
}

async function main(event) {
  const cloud = require('wx-server-sdk');
  cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
  try { return await createAccountApi({ database: cloud.database(), getWXContext: () => cloud.getWXContext() })(event); }
  catch (failure) {
    const code = ['UNAUTHENTICATED', 'FORBIDDEN', 'INVALID_ARGUMENT'].includes(failure?.code) ? failure.code : 'DELETION_INCOMPLETE';
    return { error: { code, message: code } };
  }
}
module.exports = { createAccountApi, main };
