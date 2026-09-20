const { randomUUID } = require("node:crypto");

function invalidArgument() {
  const error = new Error("INVALID_ARGUMENT");
  error.code = "INVALID_ARGUMENT";
  return error;
}

function validateRequest({ scene, page } = {}) {
  if (typeof scene !== "string" || !scene || scene.length > 32) throw invalidArgument();
  if (!["pages/report/report", "pages/challenge-complete/challenge-complete"].includes(page)) throw invalidArgument();
  return { scene, page };
}

function createMiniCodeService(cloud) {
  return async function getMiniCode(request) {
    const { scene, page } = validateRequest(request);
    const result = await cloud.openapi.wxacode.getUnlimited({ scene, page, checkPath: true });
    const fileContent = Buffer.isBuffer(result) ? result : result?.buffer;
    if (!fileContent) throw new Error("MINI_CODE_FAILED");
    const uploaded = await cloud.uploadFile({
      cloudPath: `mini-codes/${randomUUID()}.png`,
      fileContent
    });
    return uploaded.fileID;
  };
}

async function main(event) {
  const cloud = require("wx-server-sdk");
  cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
  return { fileId: await createMiniCodeService(cloud)(event) };
}

module.exports = { main, createMiniCodeService, validateRequest };
