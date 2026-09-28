const cloudEnvs = {
  develop: "",
  trial: "",
  release: ""
};

function getCloudEnv(version) {
  return cloudEnvs[version] || "";
}

module.exports = { getCloudEnv };
