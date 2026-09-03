const { createConnectionError } = require("../lib/contracts");

async function callCloud(name, data = {}) {
  let response;

  try {
    response = await wx.cloud.callFunction({ name, data });
  } catch (error) {
    throw createConnectionError();
  }

  const result = response && response.result ? response.result : {};
  if (result.error) {
    throw result.error;
  }

  return result;
}

module.exports = { callCloud };
