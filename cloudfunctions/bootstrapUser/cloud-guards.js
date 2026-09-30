const { createHash } = require("node:crypto");

async function assertAccountWritable(source, openid) {
  const id = `account-delete-${createHash("sha256").update(openid).digest("hex")}`;
  let marker;
  try { marker = (await source.collection("deletion_jobs").doc(id).get())?.data || null; }
  catch (error) {
    if (error?.code !== "DATABASE_DOCUMENT_NOT_EXIST" && error?.errCode !== -502005
      && !/not[ _-]?exist/i.test(error?.message || "")) throw error;
  }
  if (marker?.state === "deleting") throw Object.assign(new Error("ACCOUNT_DELETION_IN_PROGRESS"), { code: "ACCOUNT_DELETION_IN_PROGRESS" });
}

module.exports = { assertAccountWritable };
