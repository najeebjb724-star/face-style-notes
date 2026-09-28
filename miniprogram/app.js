const { getCloudEnv } = require("./config/env");

function getRuntimeCloudEnv() {
  const version = typeof wx.getAccountInfoSync === "function"
    ? wx.getAccountInfoSync().miniProgram.envVersion
    : "develop";
  return getCloudEnv(version);
}

App({
  onLaunch() {
    const cloudEnv = getRuntimeCloudEnv();
    if (cloudEnv && wx.cloud) {
      wx.cloud.init({
        env: cloudEnv,
        traceUser: true
      });
    }
  }
});
