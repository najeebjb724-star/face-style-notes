const { randomUUID } = require("node:crypto");

const PREVIEW_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,32}$/;

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

function codedError(code) {
  return Object.assign(new Error(code), { code });
}

function previewText(value, fallback) {
  const text = typeof value === "string" ? value.trim() : "";
  return (text || fallback).slice(0, 36);
}

function safeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function sanitizePreview(kind, preview = {}) {
  if (kind === "report") return {
    title: previewText(preview.title, "我的美学身份卡"),
    subtitle: previewText(preview.subtitle, "分享预览"),
    memory: previewText(preview.memory, "找到适合自己的表达方式。")
  };
  if (kind === "challenge") return {
    title: previewText(preview.title, "我的挑战复盘"),
    completed: safeNumber(preview.completed),
    total: safeNumber(preview.total),
    rate: safeNumber(preview.rate),
    streak: safeNumber(preview.streak)
  };
  throw codedError("INVALID_ARGUMENT");
}

function validToken(token) {
  if (typeof token !== "string" || !TOKEN_PATTERN.test(token)) throw codedError("INVALID_ARGUMENT");
  return token;
}

function createShareApi({ database, getWXContext, now = () => new Date(), createToken = () => randomUUID().replace(/-/g, "") }) {
  async function createPreview({ kind, preview } = {}) {
    const { OPENID: openid } = getWXContext();
    if (!openid) throw codedError("UNAUTHENTICATED");
    const token = validToken(createToken());
    const createdAt = now();
    const record = {
      _openid: openid,
      kind,
      preview: sanitizePreview(kind, preview),
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(createdAt.getTime() + PREVIEW_TTL_MS).toISOString()
    };
    await database.collection("share_previews").doc(token).set({ data: record });
    return token;
  }

  async function getPreview({ token } = {}) {
    const record = (await database.collection("share_previews").doc(validToken(token)).get())?.data;
    if (!record) throw codedError("PREVIEW_NOT_FOUND");
    if (Date.parse(record.expiresAt) <= now().getTime()) throw codedError("PREVIEW_EXPIRED");
    return { kind: record.kind, preview: sanitizePreview(record.kind, record.preview) };
  }

  return { createPreview, getPreview };
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

function getMiniCode(request, cloud) {
  return createMiniCodeService(cloud)(request);
}

async function main(event) {
  const cloud = require("wx-server-sdk");
  cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
  if (event?.action === "createPreview" || event?.action === "getPreview") {
    const api = createShareApi({ database: cloud.database(), getWXContext: () => cloud.getWXContext() });
    if (event.action === "createPreview") return { token: await api.createPreview(event.payload) };
    return api.getPreview(event.payload);
  }
  return { fileId: await getMiniCode(event, cloud) };
}

module.exports = { main, getMiniCode, createMiniCodeService, createShareApi, sanitizePreview, validateRequest };
