/**
 * Lazy-loaded Tesseract.js OCR Service
 * Loads OCR worker only when text recognition or document scanning is requested.
 * Includes progress feedback, worker lifecycle management, and error recovery.
 */

let tesseractWorker = null;
let isScriptLoading = false;
let scriptLoadPromise = null;

const TESSERACT_CDN_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';

function loadTesseractScript() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  if (scriptLoadPromise) return scriptLoadPromise;

  scriptLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = TESSERACT_CDN_URL;
    script.async = true;
    script.onload = () => {
      if (window.Tesseract) {
        resolve(window.Tesseract);
      } else {
        reject(new Error('Tesseract script loaded but window.Tesseract not found'));
      }
    };
    script.onerror = () => {
      scriptLoadPromise = null;
      reject(new Error('Failed to download Tesseract OCR engine. Check internet connection.'));
    };
    document.head.appendChild(script);
  });

  return scriptLoadPromise;
}

/**
 * Initializes or reuses the OCR Worker
 * @param {function} onProgress
 * @returns {Promise<any>}
 */
export async function getOCRWorker(onProgress = () => {}) {
  if (tesseractWorker) return tesseractWorker;

  onProgress({ status: 'Downloading OCR Engine (~2MB)', progress: 0.1 });
  const Tesseract = await loadTesseractScript();

  onProgress({ status: 'Initializing OCR Worker', progress: 0.3 });
  tesseractWorker = await Tesseract.createWorker('eng', 1, {
    logger: m => {
      if (m.status && typeof m.progress === 'number') {
        const pct = Math.round(m.progress * 100);
        let humanStatus = m.status;
        if (m.status === 'loading tesseract core') humanStatus = 'Loading OCR Core';
        else if (m.status === 'initializing api') humanStatus = 'Initializing Language Model';
        else if (m.status === 'recognizing text') humanStatus = `Recognizing Text (${pct}%)`;

        onProgress({ status: humanStatus, progress: m.progress });
      }
    }
  });

  return tesseractWorker;
}

/**
 * Runs OCR on an image source (canvas, image element, or data URL)
 * @param {HTMLCanvasElement|HTMLImageElement|string} source
 * @param {object} options
 * @param {function} onProgress
 * @returns {Promise<{ text: string, confidence: number, lines: string[] }>}
 */
export async function runOCR(source, options = {}, onProgress = () => {}) {
  try {
    const worker = await getOCRWorker(onProgress);
    onProgress({ status: 'Processing Image...', progress: 0.5 });

    const ret = await worker.recognize(source);
    const text = ret.data.text || '';
    const confidence = ret.data.confidence || 0;
    const lines = text
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean);

    onProgress({ status: 'OCR Complete', progress: 1.0 });

    return {
      text,
      confidence,
      lines,
      wordsCount: ret.data.words ? ret.data.words.length : lines.length
    };
  } catch (err) {
    onProgress({ status: `OCR Error: ${err.message}`, progress: 0 });
    throw err;
  }
}

/**
 * Terminates the OCR worker to free memory when idle
 */
export async function terminateOCR() {
  if (tesseractWorker) {
    try {
      await tesseractWorker.terminate();
    } catch {}
    tesseractWorker = null;
  }
}
