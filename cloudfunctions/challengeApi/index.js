const { assertOwnedRecord } = require("../../shared/cloud-guards");
const {
  createChallenge,
  getChallengeProgress,
  createChallengeHistoryEntry
} = require("../../miniprogram/lib/face-style-core");

function codedError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function requireObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw codedError("INVALID_ARGUMENT");
  }
  return value;
}

function requireId(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw codedError("INVALID_ARGUMENT");
  }
  return value;
}

function requireDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw codedError("INVALID_ARGUMENT");
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw codedError("INVALID_ARGUMENT");
  }
  return value;
}

function isMissingDocument(error) {
  return error?.code === "DATABASE_DOCUMENT_NOT_EXIST"
    || error?.errCode === -502005
    || /not[ _-]?exist/i.test(error?.message || "");
}

async function readOptionalDocument(reference) {
  try {
    const result = await reference.get();
    return result?.data || null;
  } catch (error) {
    if (isMissingDocument(error)) return null;
    throw error;
  }
}

async function findOne(database, collectionName, filters) {
  const result = await database.collection(collectionName).where(filters).limit(1).get();
  return result.data[0] || null;
}

async function findCheckIns(database, openid, challengeId) {
  const result = await database.collection("checkins").where({
    _openid: openid,
    challengeId
  }).get();
  return result.data;
}

function hydrateCheckIns(challenge, records) {
  const checkIns = {};
  for (const record of records) {
    if (record.completed === true) {
      checkIns[record.date] = { completedAt: record.updatedAt || record.date };
    }
  }
  return { ...challenge, checkIns };
}

function createChallengeApi({ database, getWXContext, now = () => new Date() }) {
  if (!database || typeof getWXContext !== "function") {
    throw codedError("INVALID_CONFIGURATION");
  }

  return async function handleChallenge(event = {}) {
    const { OPENID: openid } = getWXContext();
    if (!openid) throw codedError("UNAUTHENTICATED");

    const payload = event.payload === undefined ? {} : requireObject(event.payload);

    if (event.action === "create") {
      const challenge = createChallenge(payload, now());
      challenge.id = requireId(challenge.id);

      return database.runTransaction(async transaction => {
        const ownerReference = transaction.collection("challengeOwners").doc(openid);
        const [owner, existing] = await Promise.all([
          readOptionalDocument(ownerReference),
          findOne(transaction, "challenges", { _openid: openid, status: "active" })
        ]);
        if (owner?.activeChallengeId || existing) {
          throw codedError("ACTIVE_CHALLENGE_EXISTS");
        }

        const record = { ...challenge, _openid: openid };
        await transaction.collection("challenges").doc(challenge.id).set({ data: record });
        await ownerReference.set({ data: { _openid: openid, activeChallengeId: challenge.id } });
        return { _id: challenge.id, ...record };
      });
    }

    if (event.action === "getActive") {
      const active = await findOne(database, "challenges", {
        _openid: openid,
        status: "active"
      });
      if (!active) return null;
      assertOwnedRecord(active, openid);
      return hydrateCheckIns(active, await findCheckIns(database, openid, active._id));
    }

    if (event.action === "checkIn" || event.action === "undoCheckIn") {
      const challengeId = requireId(payload.challengeId);
      const commandId = requireId(payload.id);
      const date = requireDate(payload.date);
      const completed = event.action === "checkIn";
      const checkinId = `${openid}_${challengeId}_${date}`;

      return database.runTransaction(async transaction => {
        const challenge = await readOptionalDocument(
          transaction.collection("challenges").doc(challengeId)
        );
        assertOwnedRecord(challenge, openid);
        if (challenge.status !== "active") throw codedError("CHALLENGE_NOT_ACTIVE");

        await transaction.collection("checkins").doc(checkinId).set({
          data: {
            _openid: openid,
            challengeId,
            date,
            completed,
            commandId,
            updatedAt: database.serverDate()
          }
        });
        return { ok: true, checkinId };
      });
    }

    if (event.action === "finish") {
      const challengeId = requireId(payload.challengeId);
      const completedAt = requireDate(payload.date);

      return database.runTransaction(async transaction => {
        const challengeReference = transaction.collection("challenges").doc(challengeId);
        const challenge = await readOptionalDocument(challengeReference);
        assertOwnedRecord(challenge, openid);
        if (challenge.status !== "active") throw codedError("CHALLENGE_NOT_ACTIVE");

        const hydrated = hydrateCheckIns(
          challenge,
          await findCheckIns(transaction, openid, challengeId)
        );
        const progress = getChallengeProgress(hydrated, completedAt);
        const history = createChallengeHistoryEntry(hydrated, progress, completedAt);
        await challengeReference.update({
          data: {
            status: "completed",
            completedAt,
            history,
            updatedAt: database.serverDate()
          }
        });
        const ownerReference = transaction.collection("challengeOwners").doc(openid);
        const owner = await readOptionalDocument(ownerReference);
        if (owner?.activeChallengeId === challengeId) {
          await ownerReference.set({ data: { _openid: openid, activeChallengeId: null } });
        }
        return { ...challenge, status: "completed", completedAt, history };
      });
    }

    if (event.action === "delete") {
      const challengeId = requireId(payload.challengeId);

      return database.runTransaction(async transaction => {
        const challengeReference = transaction.collection("challenges").doc(challengeId);
        const challenge = await readOptionalDocument(challengeReference);
        assertOwnedRecord(challenge, openid);

        const checkins = await findCheckIns(transaction, openid, challengeId);
        await Promise.all(checkins.map(item => (
          transaction.collection("checkins").doc(item._id).remove()
        )));
        await challengeReference.remove();

        const ownerReference = transaction.collection("challengeOwners").doc(openid);
        const owner = await readOptionalDocument(ownerReference);
        if (owner?.activeChallengeId === challengeId) {
          await ownerReference.set({ data: { _openid: openid, activeChallengeId: null } });
        }
        return { ok: true };
      });
    }

    throw codedError("INVALID_ACTION");
  };
}

async function challengeApi(event, context) {
  const cloud = require("wx-server-sdk");
  cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
  return createChallengeApi({
    database: cloud.database(),
    getWXContext: () => cloud.getWXContext()
  })(event, context);
}

module.exports = {
  main: challengeApi,
  challengeApi,
  createChallengeApi
};
