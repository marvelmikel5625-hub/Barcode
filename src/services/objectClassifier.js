/**
 * Lazy-loaded Pretrained MobileNet Image Classifier
 * Evaluates general objects (furniture, electronics, clothing, vehicles, animals, food)
 * using standard pretrained MobileNet v2 with TensorFlow.js.
 * Loaded ONLY when Object classification is selected.
 */

let mobileNetModel = null;
let isModelLoading = false;
let modelLoadPromise = null;

const TFJS_CDN_URL = 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js';
const MOBILENET_CDN_URL = 'https://cdn.jsdelivr.net/npm/@tensorflow-models/mobilenet@2.1.1/dist/mobilenet.min.js';

function loadScript(src) {
  return new Promise((resolve, reject) => {
    // If script already exists
    if (document.querySelector(`script[src="${src}"]`)) {
      return resolve();
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
    document.head.appendChild(script);
  });
}

/**
 * Loads MobileNet model with progress reporting
 * @param {function} onProgress
 * @returns {Promise<any>}
 */
export async function getMobileNetModel(onProgress = () => {}) {
  if (mobileNetModel) return mobileNetModel;
  if (modelLoadPromise) return modelLoadPromise;

  modelLoadPromise = (async () => {
    try {
      onProgress({ status: 'Loading TensorFlow.js Runtime...', progress: 0.2 });
      if (!window.tf) {
        await loadScript(TFJS_CDN_URL);
      }

      onProgress({ status: 'Downloading MobileNet Weights (~9MB)...', progress: 0.5 });
      if (!window.mobilenet) {
        await loadScript(MOBILENET_CDN_URL);
      }

      onProgress({ status: 'Initializing Neural Network Graph...', progress: 0.8 });
      // MobileNet v2 (alpha 1.0, 224x224)
      mobileNetModel = await window.mobilenet.load({
        version: 2,
        alpha: 1.0
      });

      onProgress({ status: 'Model Ready', progress: 1.0 });
      return mobileNetModel;
    } catch (err) {
      modelLoadPromise = null;
      throw new Error(`MobileNet load failed: ${err.message}. Check network connection.`);
    }
  })();

  return modelLoadPromise;
}

/**
 * Classifies an image source (canvas, image, video)
 * @param {HTMLCanvasElement|HTMLImageElement} source
 * @param {function} onProgress
 * @returns {Promise<{ label: string, score: number, rawPredictions: Array<{ className: string, probability: number }> }>}
 */
export async function classifyObject(source, onProgress = () => {}) {
  const model = await getMobileNetModel(onProgress);
  onProgress({ status: 'Running Visual Inference...', progress: 0.9 });

  // Classify returns top 3 predictions
  const predictions = await model.classify(source, 3);
  if (!predictions || predictions.length === 0) {
    return {
      label: 'Unknown Object',
      score: 0,
      rawPredictions: []
    };
  }

  const top = predictions[0];
  return {
    label: top.className,
    score: top.probability,
    rawPredictions: predictions
  };
}

/**
 * Checks if model is currently cached in memory
 */
export function isMobileNetLoaded() {
  return Boolean(mobileNetModel);
}
