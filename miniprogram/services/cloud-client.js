const { createConnectionError } = require("../lib/contracts");

const TRUSTED_BUSINESS_ERRORS = new Set([
  "ACTIVE_CHALLENGE_EXISTS",
  "CHALLENGE_NOT_ACTIVE",
  "FORBIDDEN",
  "INVALID_ARGUMENT",
  "UNAUTHENTICATED"
]);

async function callCloud(name, data = {}) {
  let response;

  try {
    response = await wx.cloud.callFunction({ name, data });
  } catch (error) {
    throw createConnectionError();
  }

  const result = response && response.result;
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw createConnectionError();
  }
  if (result.error) {
    if (result.error
      && typeof result.error === "object"
      && TRUSTED_BUSINESS_ERRORS.has(result.error.code)
      && result.error.message === result.error.code) {
      throw { code: result.error.code, message: result.error.message };
    }
    throw createConnectionError();
  }

  return result;
}

module.exports = { callCloud };
