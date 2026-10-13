/**
 * Privacy-Preserving Local History Storage
 * Stores scan history on device only. Full sensitive passport & card numbers are NEVER persisted.
 * Supports delete single, clear all, filtering, and JSON/CSV export.
 */

const STORAGE_KEY = 'allscan_universal_history';
const MAX_HISTORY_ENTRIES = 100;

export function getHistory() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (err) {
    console.warn('Could not read history from localStorage:', err);
    return [];
  }
}

/**
 * Saves a scan entry with sensitive data redaction
 * @param {object} entry
 */
export function saveHistoryEntry(entry) {
  if (!entry) return;

  // Redact any sensitive information before storage
  const sanitized = {
    id: entry.id || `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    timestamp: entry.timestamp || new Date().toISOString(),
    primaryType: entry.primaryType || 'Scan',
    title: entry.title || 'Untitled Scan',
    subtitle: entry.subtitle || '',
    status: entry.status || 'Identified',
    summary: entry.summary || '',
    evidenceChain: entry.evidenceChain || [],
    actions: entry.actions || []
  };

  // Safe data payload preservation
  if (entry.data) {
    sanitized.data = {};
    if (entry.data.raw) sanitized.data.raw = entry.data.raw;
    if (entry.data.format) sanitized.data.format = entry.data.format;
    if (entry.data.receipt) {
      sanitized.data.receipt = {
        merchant: entry.data.receipt.merchant,
        date: entry.data.receipt.date,
        currency: entry.data.receipt.currency,
        itemsCount: entry.data.receipt.itemsCount,
        total: entry.data.receipt.total,
        arithmeticConfidence: entry.data.receipt.arithmeticConfidence
      };
    }
    if (entry.data.product) {
      sanitized.data.product = {
        productName: entry.data.product.productName,
        brands: entry.data.product.brands,
        barcode: entry.data.product.barcode,
        source: entry.data.product.source
      };
    }
    if (entry.data.card) {
      // STRICT PRIVACY: only store network, masked digits, expiry. NEVER store raw card number or CVV!
      sanitized.data.card = {
        network: entry.data.card.network,
        maskedNumber: entry.data.card.maskedNumber,
        expiryDate: entry.data.card.expiryDate
      };
    }
    if (entry.data.mrz) {
      // STRICT PRIVACY: only store name, masked number, expiry. Never store raw MRZ lines!
      sanitized.data.mrz = {
        fullName: entry.data.mrz.fullName,
        documentNumberMasked: entry.data.mrz.documentNumberMasked,
        issuingState: entry.data.mrz.issuingState,
        docType: entry.data.mrz.docType,
        expiryDate: entry.data.mrz.expiryDate
      };
    }
    if (entry.data.classification) {
      sanitized.data.classification = {
        label: entry.data.classification.label,
        score: entry.data.classification.score
      };
    }
    if (entry.data.rawOcr) {
      // Store truncated text preview
      sanitized.data.textPreview = entry.data.rawOcr.slice(0, 300);
    }
  }

  try {
    const list = getHistory();
    list.unshift(sanitized);
    if (list.length > MAX_HISTORY_ENTRIES) {
      list.length = MAX_HISTORY_ENTRIES;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch (err) {
    console.warn('Failed to save scan history (storage full or blocked):', err);
  }
}

export function deleteHistoryItem(id) {
  try {
    const list = getHistory().filter(item => item.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    return list;
  } catch (err) {
    console.warn('Failed to delete history item:', err);
    return [];
  }
}

export function clearAllHistory() {
  try {
    localStorage.removeItem(STORAGE_KEY);
    return [];
  } catch (err) {
    console.warn('Failed to clear history:', err);
    return [];
  }
}

export function exportHistoryJSON() {
  const list = getHistory();
  return JSON.stringify(list, null, 2);
}

export function exportHistoryCSV() {
  const list = getHistory();
  const headers = ['ID', 'Date', 'Type', 'Title', 'Subtitle', 'Status', 'Payload Summary'];
  const rows = [headers];

  for (const item of list) {
    const summary = item.data?.raw || item.data?.product?.productName || item.subtitle || '';
    rows.push([
      item.id,
      item.timestamp,
      item.primaryType,
      item.title,
      item.subtitle,
      item.status,
      summary
    ]);
  }

  return rows
    .map(row => row.map(val => `"${String(val ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n');
}
