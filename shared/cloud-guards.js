function assertOwnedRecord(record, openid) {
  if (!openid || !record || record._openid !== openid) {
    const error = new Error("FORBIDDEN");
    error.code = "FORBIDDEN";
    throw error;
  }
}

const { createHash } = require("node:crypto");

function accountDeletionId(openid) {
  return `account-delete-${createHash("sha256").update(openid).digest("hex")}`;
}

async function assertAccountWritable(source, openid) {
  let marker;
  try {
    marker = (await source.collection("deletion_jobs").doc(accountDeletionId(openid)).get())?.data || null;
  } catch (error) {
    if (error?.code !== "DATABASE_DOCUMENT_NOT_EXIST" && error?.errCode !== -502005
      && !/not[ _-]?exist/i.test(error?.message || "")) throw error;
  }
  if (marker?.state === "deleting") {
    const error = new Error("ACCOUNT_DELETION_IN_PROGRESS");
    error.code = "ACCOUNT_DELETION_IN_PROGRESS";
    throw error;
  }
}

module.exports = { accountDeletionId, assertAccountWritable, assertOwnedRecord };
