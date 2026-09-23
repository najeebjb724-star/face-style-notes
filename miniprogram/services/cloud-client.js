const { createConnectionError } = require("../lib/contracts");

const TRUSTED_BUSINESS_ERRORS = new Set([
  "ACCOUNT_DELETION_IN_PROGRESS",
  "ACTIVE_CHALLENGE_EXISTS",
  "CHALLENGE_NOT_COMPLETE",
  "CHALLENGE_NOT_ACTIVE",
  "CONSENT_REQUIRED",
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

  if (!response || !("result" in response)) {
    throw createConnectionError();
  }
  const result = response.result;
  if (result === null) return null;
  if (typeof result !== "object" || Array.isArray(result)) throw createConnectionError();
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
