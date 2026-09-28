const STORAGE_KEY = "offline-checkins";
const PERMANENT_BUSINESS_ERRORS = new Set([
  "ACCOUNT_DELETION_IN_PROGRESS",
  "CHALLENGE_NOT_ACTIVE",
  "FORBIDDEN",
  "INVALID_ARGUMENT"
]);

function invalidArgument() {
  const error = new Error("INVALID_ARGUMENT");
  error.code = "INVALID_ARGUMENT";
  return error;
}

function createOfflineCheckIns(storage) {
  if (!storage
    || typeof storage.getStorageSync !== "function"
    || typeof storage.setStorageSync !== "function") {
    throw invalidArgument();
  }

  let inFlight = null;

  function readQueue() {
    const stored = storage.getStorageSync(STORAGE_KEY);
    return Array.isArray(stored) ? stored : [];
  }

  function writeQueue(queue) {
    storage.setStorageSync(STORAGE_KEY, queue);
  }

  function enqueueCheckIn(command) {
    if (!command || typeof command !== "object" || typeof command.id !== "string" || !command.id) {
      throw invalidArgument();
    }
    const queue = readQueue();
    if (queue.some(item => item.id === command.id)) return false;
    writeQueue([...queue, { ...command }]);
    return true;
  }

  function flushCheckIns(send) {
    if (typeof send !== "function") throw invalidArgument();
    if (inFlight) return inFlight;

    async function drain() {
      while (true) {
        const current = readQueue()[0];
        if (!current) return;

        let acknowledgement;
        try {
          acknowledgement = await send({ ...current });
        } catch (error) {
          if (!PERMANENT_BUSINESS_ERRORS.has(error?.code)) throw error;
          acknowledgement = { ok: true };
        }
        if (!acknowledgement || acknowledgement.ok !== true) {
          const error = new Error("CHECKIN_NOT_ACKNOWLEDGED");
          error.code = "CHECKIN_NOT_ACKNOWLEDGED";
          throw error;
        }
        const latest = readQueue();
        const acknowledgedIndex = latest.findIndex(item => item.id === current.id);
        if (acknowledgedIndex !== -1) {
          writeQueue(latest.filter((_, index) => index !== acknowledgedIndex));
        }
      }
    }

    inFlight = drain().finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  return { enqueueCheckIn, flushCheckIns };
}

function miniProgramStorage() {
  const runtime = globalThis.wx;
  if (!runtime) throw invalidArgument();
  return runtime;
}

const defaultQueue = createOfflineCheckIns({
  getStorageSync(key) {
    return miniProgramStorage().getStorageSync(key);
  },
  setStorageSync(key, value) {
    miniProgramStorage().setStorageSync(key, value);
  }
});

module.exports = {
  enqueueCheckIn: defaultQueue.enqueueCheckIn,
  flushCheckIns: defaultQueue.flushCheckIns,
  createOfflineCheckIns
};
