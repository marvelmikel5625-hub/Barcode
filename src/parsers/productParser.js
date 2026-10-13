/**
 * Product Parser & Open Food Facts Integration
 * Free-first, legitimate public database integration for barcodes,
 * plus deterministic OCR label extraction (brand, model, batch, expiry dates).
 */

const OPEN_FOOD_FACTS_BASE = 'https://world.openfoodfacts.org/api/v2/product';

/**
 * Fetch product data from Open Food Facts by barcode
 * Respects terms with dedicated User-Agent header, timeout, and offline fallback.
 * @param {string} barcode
 * @returns {Promise<object|null>}
 */
export async function lookupBarcodeProduct(barcode) {
  if (!barcode || !/^\d{8,14}$/.test(barcode.trim())) {
    return null;
  }

  const cleanCode = barcode.trim();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 4500); // 4.5s max timeout

  try {
    const response = await fetch(`${OPEN_FOOD_FACTS_BASE}/${cleanCode}.json`, {
      method: 'GET',
      headers: {
        'User-Agent': 'UniversalScannerApp/1.0 (https://github.com/marvelmikel5625-hub/QR-Barcode-Scanner-Pro; nosirumichael291@gmail.com)'
      },
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    if (data.status === 1 && data.product) {
      const p = data.product;
      return {
        found: true,
        source: 'Open Food Facts (Public Database)',
        barcode: cleanCode,
        productName: p.product_name || p.product_name_en || 'Unknown Product Name',
        brands: p.brands || 'Unknown Brand',
        quantity: p.quantity || '',
        categories: p.categories ? p.categories.split(',').slice(0, 3).map(c => c.trim()).join(', ') : '',
        nutriScore: p.nutriscore_grade ? p.nutriscore_grade.toUpperCase() : null,
        imageUrl: p.image_front_small_url || p.image_url || null,
        ingredients: p.ingredients_text ? p.ingredients_text.slice(0, 300) : null,
        url: `https://world.openfoodfacts.org/product/${cleanCode}`,
        timestamp: new Date().toISOString()
      };
    }
    return {
      found: false,
      barcode: cleanCode,
      source: 'Open Food Facts',
      notice: 'Product code not found in Open Food Facts database.'
    };
  } catch (err) {
    clearTimeout(timeoutId);
    return {
      found: false,
      barcode: cleanCode,
      source: 'Offline / Network Unavailable',
      notice: err.name === 'AbortError' ? 'Lookup timed out.' : 'Network request failed or offline.'
    };
  }
}

/**
 * Extracts product metadata from OCR text
 * Looks for model numbers, expiry dates, lot/batch numbers, and candidate brand.
 * @param {string} text
 * @returns {object}
 */
export function extractProductLabelData(text) {
  if (!text) return { brandCandidate: null, modelCandidate: null, expiryCandidate: null, batchCandidate: null };

  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  // Model number pattern (e.g. "Model: A2894", "Model No: XYZ-100", "REF: 12345", "MN: ...")
  let modelCandidate = null;
  const modelRegex = /\b(?:MODEL|MOD|M\/N|MODEL\s*NO|REF|ITEM\s*NO)[\s.:#]+([A-Z0-9\-_]{3,15})\b/i;
  for (const line of lines) {
    const m = line.match(modelRegex);
    if (m) {
      modelCandidate = m[1];
      break;
    }
  }

  // If no labeled model, look for Apple/Samsung/Sony model style (e.g., A2894, SM-S918B, WH-1000XM5)
  if (!modelCandidate) {
    const techModelRegex = /\b(A\d{4}|SM-[A-Z]\d{3}[A-Z]?|WH-\d{4}[A-Z0-9]+)\b/;
    for (const line of lines) {
      const m = line.match(techModelRegex);
      if (m) {
        modelCandidate = m[1];
        break;
      }
    }
  }

  // Expiry Date (e.g. "EXP: 12/2026", "BEST BEFORE: 24/05/2025", "BB: 08/25", "USE BY ...")
  let expiryCandidate = null;
  const expRegex = /\b(?:EXP(?:IRY)?|BEST\s*BEFORE|B\.B\.|USE\s*BY|MFR|MFG)[\s.:]+(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}|\d{1,2}[\/\-\.]\d{2,4})\b/i;
  for (const line of lines) {
    const m = line.match(expRegex);
    if (m) {
      expiryCandidate = m[1];
      break;
    }
  }

  // Batch / Lot Number (e.g. "LOT: 24A91", "BATCH NO: 991204")
  let batchCandidate = null;
  const lotRegex = /\b(?:LOT|BATCH(?:\s*NO)?)[\s.:#]+([A-Z0-9\-]{3,12})\b/i;
  for (const line of lines) {
    const m = line.match(lotRegex);
    if (m) {
      batchCandidate = m[1];
      break;
    }
  }

  return {
    modelCandidate,
    expiryCandidate,
    batchCandidate
  };
}

/**
 * Creates genuine user-initiated search links
 */
export function createResearchLinks(query) {
  if (!query) return [];
  const q = encodeURIComponent(query.trim());
  return [
    { label: 'Google Search', url: `https://www.google.com/search?q=${q}` },
    { label: 'DuckDuckGo', url: `https://duckduckgo.com/?q=${q}` },
    { label: 'Amazon Search', url: `https://www.amazon.com/s?k=${q}` }
  ];
}
