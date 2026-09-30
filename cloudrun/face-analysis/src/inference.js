const fs = require("node:fs/promises");
const path = require("node:path");
const { codedError, validateResult } = require("./validate");

require("@tensorflow/tfjs-node");
const faceapi = require("@vladmandic/face-api");

const MODEL_VERSION = "face-api-1.7.15+tfjs-node-4.16.0";
const MODEL_PATH = path.resolve(path.dirname(require.resolve("@vladmandic/face-api")), "..", "model");
const DETECTOR_OPTIONS = new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5, maxResults: 10 });

let modelPromise;
let modelLoaded = false;

async function loadModels() {
  if (!modelPromise) {
    modelPromise = (async () => {
      await faceapi.tf.setBackend("tensorflow");
      await faceapi.tf.ready();
      await Promise.all([
        faceapi.nets.ssdMobilenetv1.loadFromDisk(MODEL_PATH),
        faceapi.nets.faceLandmark68Net.loadFromDisk(MODEL_PATH)
      ]);
      modelLoaded = true;
    })().catch(error => {
      modelPromise = undefined;
      modelLoaded = false;
      throw error;
    });
  }
  await modelPromise;
}

async function inferBuffer(buffer, jobId) {
  await loadModels();
  const tensor = faceapi.tf.node.decodeImage(buffer, 3);
  try {
    const [height, width] = tensor.shape;
    const detections = await faceapi.detectAllFaces(tensor, DETECTOR_OPTIONS).withFaceLandmarks();
    if (detections.length === 0) throw codedError("NO_FACE");
    if (detections.length !== 1) throw codedError("MULTIPLE_FACES");

    const [{ detection, landmarks }] = detections;
    return validateResult({
      jobId,
      detectionScore: detection.score,
      points: landmarks.positions.map(point => ({ x: point.x, y: point.y })),
      faceBox: {
        x: detection.box.x,
        y: detection.box.y,
        width: detection.box.width,
        height: detection.box.height
      },
      imageSize: { width, height },
      modelVersion: MODEL_VERSION
    });
  } finally {
    tensor.dispose();
  }
}

async function inferFixture(filePath) {
  return inferBuffer(await fs.readFile(filePath), "fixture");
}

function isModelLoaded() {
  return modelLoaded;
}

module.exports = { inferBuffer, inferFixture, isModelLoaded, loadModels, validateResult };
