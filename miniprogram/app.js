const { getCloudEnv } = require("./config/env");

const cloudEnv = getCloudEnv("develop");

App({
  onLaunch() {
    if (cloudEnv && wx.cloud) {
      wx.cloud.init({
        env: cloudEnv,
        traceUser: true
      });
    }
  }
});
