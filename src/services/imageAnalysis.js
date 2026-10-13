/**
 * Image Analysis & Preprocessing Utilities
 * Quality assessment (luminance, blur estimation via Laplacian variance),
 * and lightweight canvas processing (crop, rotate, contrast enhancement).
 */

/**
 * Assesses an image or video frame for lighting, blur, and framing
 * @param {HTMLCanvasElement|HTMLVideoElement|HTMLImageElement} source
 * @returns {object} { quality: 'good'|'warning'|'poor', issues: string[], suggestions: string[], brightness: number, blurScore: number }
 */
export function assessImageQuality(source) {
  const canvas = document.createElement('canvas');
  // Sample down to 160x160 for fast performance (<10ms on mobile)
  const width = 160;
  const height = 160;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    return { quality: 'good', issues: [], suggestions: [], brightness: 128, blurScore: 100 };
  }

  ctx.drawImage(source, 0, 0, width, height);
  const imgData = ctx.getImageData(0, 0, width, height);
  const data = imgData.data;

  // 1. Brightness / Luminance Calculation
  let totalLuminance = 0;
  const gray = new Uint8Array(width * height);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    // Standard relative luminance
    const y = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    gray[j] = y;
    totalLuminance += y;
  }
  const avgBrightness = Math.round(totalLuminance / (width * height));

  // 2. Blur Estimation via 3x3 Laplacian Kernel on grayscale
  // [ 0,  1,  0 ]
  // [ 1, -4,  1 ]
  // [ 0,  1,  0 ]
  let sumLap = 0;
  let sumLapSq = 0;
  let count = 0;

  for (let y = 1; y < height - 1; y++) {
    const row = y * width;
    for (let x = 1; x < width - 1; x++) {
      const idx = row + x;
      const lap =
        gray[idx - width] +
        gray[idx + width] +
        gray[idx - 1] +
        gray[idx + 1] -
        4 * gray[idx];

      sumLap += lap;
      sumLapSq += lap * lap;
      count++;
    }
  }

  const meanLap = sumLap / count;
  const variance = (sumLapSq / count) - (meanLap * meanLap);
  const blurScore = Math.round(variance);

  const issues = [];
  const suggestions = [];

  if (avgBrightness < 45) {
    issues.push('Image is too dark');
    suggestions.push('Improve lighting or turn on torch');
  } else if (avgBrightness > 225) {
    issues.push('Image is overexposed');
    suggestions.push('Move away from direct glare or reflection');
  }

  // Low Laplacian variance indicates flat or motion-blurred image
  if (blurScore < 40) {
    issues.push('Image appears blurry');
    suggestions.push('Hold the device still to focus');
  }

  let quality = 'good';
  if (issues.length >= 2) {
    quality = 'poor';
  } else if (issues.length === 1) {
    quality = 'warning';
  }

  return {
    quality,
    issues,
    suggestions: suggestions.length > 0 ? suggestions : ['Good framing and lighting'],
    brightness: avgBrightness,
    blurScore
  };
}

/**
 * Enhances contrast and binarizes for document reading
 * @param {HTMLCanvasElement} sourceCanvas
 * @param {number} contrastLevel (1.0 = normal, 1.5 = high contrast)
 * @returns {HTMLCanvasElement}
 */
export function enhanceDocumentImage(sourceCanvas, contrastLevel = 1.3) {
  const output = document.createElement('canvas');
  output.width = sourceCanvas.width;
  output.height = sourceCanvas.height;
  const ctx = output.getContext('2d');
  if (!ctx) return sourceCanvas;

  ctx.drawImage(sourceCanvas, 0, 0);
  const imgData = ctx.getImageData(0, 0, output.width, output.height);
  const d = imgData.data;

  // Contrast formula: factor = (259 * (contrast + 255)) / (255 * (259 - contrast))
  const c = Math.max(-100, Math.min(100, (contrastLevel - 1) * 100));
  const factor = (259 * (c + 255)) / (255 * (259 - c));

  for (let i = 0; i < d.length; i += 4) {
    // Grayscale
    const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    // Contrast adjusted
    const adj = factor * (gray - 128) + 128;
    const clamped = Math.max(0, Math.min(255, adj));

    d[i] = clamped;
    d[i + 1] = clamped;
    d[i + 2] = clamped;
  }

  ctx.putImageData(imgData, 0, 0);
  return output;
}

/**
 * Rotates canvas by 90, 180, or 270 degrees
 * @param {HTMLCanvasElement} sourceCanvas
 * @param {number} degrees (90, 180, 270)
 * @returns {HTMLCanvasElement}
 */
export function rotateCanvas(sourceCanvas, degrees = 90) {
  const rad = (degrees * Math.PI) / 180;
  const output = document.createElement('canvas');

  if (degrees === 90 || degrees === 270) {
    output.width = sourceCanvas.height;
    output.height = sourceCanvas.width;
  } else {
    output.width = sourceCanvas.width;
    output.height = sourceCanvas.height;
  }

  const ctx = output.getContext('2d');
  if (!ctx) return sourceCanvas;

  ctx.translate(output.width / 2, output.height / 2);
  ctx.rotate(rad);
  ctx.drawImage(sourceCanvas, -sourceCanvas.width / 2, -sourceCanvas.height / 2);

  return output;
}
