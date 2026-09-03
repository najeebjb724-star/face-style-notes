function unauthenticatedError() {
  const error = new Error("UNAUTHENTICATED");
  error.code = "UNAUTHENTICATED";
  return error;
}

async function findOne(database, collectionName, filters, orderBy) {
  let query = database.collection(collectionName).where(filters);
  if (orderBy) {
    query = query.orderBy(orderBy, "desc");
  }
  const result = await query.limit(1).get();
  return result.data[0] || null;
}

async function ensureUser(database, openid) {
  const existingUser = await findOne(database, "users", { _openid: openid });
  if (existingUser) {
    return existingUser._id;
  }

  const result = await database.collection("users").add({
    data: {
      _openid: openid,
      createdAt: database.serverDate()
    }
  });
  return result._id;
}

function createBootstrapUser({ database, getWXContext }) {
  return async function bootstrapUser() {
    const { OPENID: openid } = getWXContext();
    if (!openid) {
      throw unauthenticatedError();
    }

    const userId = await ensureUser(database, openid);
    const [latestReport, activeChallenge] = await Promise.all([
      findOne(database, "reports", { _openid: openid }, "createdAt"),
      findOne(
        database,
        "challenges",
        { _openid: openid, status: "active" },
        "createdAt"
      )
    ]);

    return { userId, latestReport, activeChallenge };
  };
}

async function bootstrapUser(event, context) {
  const cloud = require("wx-server-sdk");
  cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
  return createBootstrapUser({
    database: cloud.database(),
    getWXContext: () => cloud.getWXContext()
  })(event, context);
}

module.exports = {
  main: bootstrapUser,
  bootstrapUser,
  createBootstrapUser
};
