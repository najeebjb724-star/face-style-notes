const { randomUUID } = require("node:crypto");
const { assertAccountWritable } = require("./cloud-guards");

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
    await database.runTransaction(async transaction => {
      await assertAccountWritable(transaction, openid);
      await transaction.collection("share_previews").doc(token).set({ data: record });
    });
    return token;
  }

  async function getPreview({ token } = {}) {
    const record = (await database.collection("share_previews").doc(validToken(token)).get())?.data;
    if (!record) throw codedError("PREVIEW_NOT_FOUND");
    if (Date.parse(record.expiresAt) <= now().getTime()) throw codedError("PREVIEW_EXPIRED");
    return { kind: record.kind, preview: sanitizePreview(record.kind, record.preview) };
  }

  async function linkMiniCode({ token, fileId } = {}) {
    if (typeof fileId !== "string" || !fileId.startsWith("cloud://")) throw codedError("INVALID_ARGUMENT");
    const update = async source => {
      const reference = source.collection("share_previews").doc(validToken(token));
      const record = (await reference.get())?.data;
      if (!record) throw codedError("PREVIEW_NOT_FOUND");
      await assertAccountWritable(source, record._openid);
      const miniCodeFileIds = [...new Set([...(record.miniCodeFileIds || []), fileId])];
      await reference.set({ data: { ...record, miniCodeFileIds } });
    };
    if (typeof database.runTransaction === "function") return database.runTransaction(update);
    return update(database);
  }

  async function beginMiniCodeUpload({ token } = {}) {
    const jobId = `share-upload-${randomUUID()}`;
    await database.runTransaction(async transaction => {
      const preview = (await transaction.collection("share_previews").doc(validToken(token)).get())?.data;
      if (!preview) throw codedError("PREVIEW_NOT_FOUND");
      await assertAccountWritable(transaction, preview._openid);
      await transaction.collection("deletion_jobs").doc(jobId).set({ data: { kind: "share-upload", accountCleanup: true, _openid: preview._openid, token, state: "uploading", auditIds: [], createdAt: now().toISOString() } });
    });
    return jobId;
  }

  async function finishMiniCodeUpload({ jobId, fileId, rollbackFailed = false } = {}) {
    await database.runTransaction(async transaction => {
      const reference = transaction.collection("deletion_jobs").doc(jobId);
      const current = (await reference.get())?.data;
      if (!current || current.kind !== "share-upload") return;
      if (rollbackFailed) await reference.update({ data: { kind: "account-file", fileId, state: "pending", attempts: 0, dueAt: now().toISOString(), updatedAt: now().toISOString() } });
      else await reference.update({ data: { state: "deleted", updatedAt: now().toISOString() } });
    });
  }

  return { createPreview, getPreview, linkMiniCode, beginMiniCodeUpload, finishMiniCodeUpload };
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

async function getMiniCodeForPreview(event, cloud, api) {
  const isPreviewToken = TOKEN_PATTERN.test(event?.scene || "");
  if (isPreviewToken) await api.getPreview({ token: event.scene });
  const uploadJobId = isPreviewToken && api.beginMiniCodeUpload ? await api.beginMiniCodeUpload({ token: event.scene }) : null;
  let fileId;
  try { fileId = await getMiniCode(event, cloud); }
  catch (error) {
    if (uploadJobId) await api.finishMiniCodeUpload({ jobId: uploadJobId });
    throw error;
  }
  if (!isPreviewToken) return fileId;
  try {
    await api.linkMiniCode({ token: event.scene, fileId });
    if (uploadJobId) await api.finishMiniCodeUpload({ jobId: uploadJobId, fileId });
  } catch (error) {
    let rolledBack = false;
    try {
      const result = await cloud.deleteFile({ fileList: [fileId] });
      rolledBack = result?.fileList?.some(item => item.fileID === fileId && item.status === 0) === true;
    } catch (rollbackError) {
      error.rollbackError = rollbackError;
    }
    if (!rolledBack) error.rollbackFailed = true;
    if (uploadJobId) await api.finishMiniCodeUpload({ jobId: uploadJobId, fileId, rollbackFailed: !rolledBack });
    throw error;
  }
  return fileId;
}

function createMain(cloud) {
  return async function shareMain(event = {}) {
    const api = createShareApi({ database: cloud.database(), getWXContext: () => cloud.getWXContext() });
    if (event.action === "createPreview") return { token: await api.createPreview(event.payload) };
    if (event.action === "getPreview") return api.getPreview(event.payload);
    if (event.action) throw codedError("INVALID_ARGUMENT");
    validToken(event.scene);
    return { fileId: await getMiniCodeForPreview(event, cloud, api) };
  };
}

async function main(event) {
  const cloud = require("wx-server-sdk");
  cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
  return createMain(cloud)(event);
}

module.exports = { main, createMain, getMiniCode, getMiniCodeForPreview, createMiniCodeService, createShareApi, sanitizePreview, validateRequest };
