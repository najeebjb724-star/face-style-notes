function assertOwnedRecord(record, openid) {
  if (!openid || !record || record._openid !== openid) {
    const error = new Error("FORBIDDEN");
    error.code = "FORBIDDEN";
    throw error;
  }
}

module.exports = { assertOwnedRecord };
