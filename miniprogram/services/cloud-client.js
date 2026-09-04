const { createConnectionError } = require("../lib/contracts");

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
    throw result.error;
  }

  return result;
}

module.exports = { callCloud };
