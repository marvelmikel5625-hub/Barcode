/**
 * QR & Barcode Generator Service
 * Generates custom QR codes and Linear Barcodes (Code 128, EAN-13, UPC, Code 39)
 * Computes WCAG contrast ratio for scan reliability validation.
 */

// Calculate relative luminance of hex color
function getLuminance(hex) {
  const rgb = hex.replace('#', '');
  const r = parseInt(rgb.substring(0, 2), 16) / 255;
  const g = parseInt(rgb.substring(2, 4), 16) / 255;
  const b = parseInt(rgb.substring(4, 6), 16) / 255;

  const toLinear = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/**
 * Computes WCAG contrast ratio between two hex colors
 * @returns {number} contrast ratio (1 to 21)
 */
export function calculateContrastRatio(fgHex, bgHex) {
  try {
    const l1 = getLuminance(fgHex);
    const l2 = getLuminance(bgHex);
    const brightest = Math.max(l1, l2);
    const darkest = Math.min(l1, l2);
    return (brightest + 0.05) / (darkest + 0.05);
  } catch {
    return 21;
  }
}

let jsBarcodeLoaded = false;
function loadJsBarcode() {
  if (window.JsBarcode) return Promise.resolve(window.JsBarcode);
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js';
    script.async = true;
    script.onload = () => {
      jsBarcodeLoaded = true;
      resolve(window.JsBarcode);
    };
    script.onerror = () => reject(new Error('Failed to load JsBarcode'));
    document.head.appendChild(script);
  });
}

/**
 * Generates a Linear Barcode into an SVG or Canvas element
 * @param {HTMLCanvasElement|SVGElement} targetElement
 * @param {string} text
 * @param {string} format ('CODE128', 'EAN13', 'UPC', 'CODE39')
 * @param {object} options
 */
export async function generateLinearBarcode(targetElement, text, format = 'CODE128', options = {}) {
  await loadJsBarcode();
  if (!window.JsBarcode) throw new Error('JsBarcode unavailable');

  window.JsBarcode(targetElement, text, {
    format: format,
    lineColor: options.fgColor || '#000000',
    background: options.bgColor || '#ffffff',
    width: options.width || 2,
    height: options.height || 80,
    displayValue: options.displayValue !== false,
    fontSize: 14,
    margin: 10
  });
}

/**
 * Validates QR code contrast and returns guidance
 * @param {string} fgColor
 * @param {string} bgColor
 * @returns {{ ratio: number, isReliable: boolean, warning: string|null }}
 */
export function validateQRContrast(fgColor, bgColor) {
  const ratio = Math.round(calculateContrastRatio(fgColor, bgColor) * 10) / 10;
  if (ratio < 3.0) {
    return {
      ratio,
      isReliable: false,
      warning: `Critical: Contrast ratio is only ${ratio}:1. Most scanner cameras will fail to decode this code.`
    };
  }
  if (ratio < 4.5) {
    return {
      ratio,
      isReliable: false,
      warning: `Caution: Low contrast (${ratio}:1). May struggle in dim lighting or on budget smartphone cameras.`
    };
  }
  return {
    ratio,
    isReliable: true,
    warning: null
  };
}
