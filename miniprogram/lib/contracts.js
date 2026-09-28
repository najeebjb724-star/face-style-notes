const CONNECTION_ERROR_MESSAGE = "暂时无法连接，请稍后重试";

function createConnectionError() {
  return {
    code: "CLOUD_UNAVAILABLE",
    message: CONNECTION_ERROR_MESSAGE
  };
}

module.exports = {
  CONNECTION_ERROR_MESSAGE,
  createConnectionError
};
