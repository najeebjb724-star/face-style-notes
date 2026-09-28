const cloudEnvs = {
  develop: "cloud1-d0gi550jk9a2f9337",
  trial: "cloud1-d0gi550jk9a2f9337",
  release: ""
};

function getCloudEnv(version) {
  return cloudEnvs[version] || "";
}

module.exports = { getCloudEnv };
