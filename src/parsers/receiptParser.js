/**
 * Deterministic Receipt & Invoice Parser
 * Extracts merchant, date, currency, line items, tax, and total.
 * Verifies arithmetic consistency (sum of line items vs parsed total).
 */

const CURRENCY_SYMBOLS = {
  '$': 'USD/CAD/AUD',
  '€': 'EUR',
  '£': 'GBP',
  '¥': 'JPY/CNY',
  'CHF': 'CHF',
  '₹': 'INR',
  '₦': 'NGN',
  'R$': 'BRL',
  'kr': 'SEK/NOK/DKK'
};

const GENERIC_MERCHANT_IGNORE = [
  'RECEIPT', 'TAX INVOICE', 'INVOICE', 'WELCOME', 'THANK YOU', 'CUSTOMER COPY',
  'MERCHANT COPY', 'SALE', 'CASH RECEIPT', 'OFFICIAL RECEIPT', 'ORDER', 'TOTAL',
  'SUBTOTAL', 'ITEMS', 'REGISTER', 'CHECK', 'TABLE', 'GUEST', 'DATE', 'TIME'
];

/**
 * Parses raw OCR text into structured receipt data
 * @param {string} text
 * @returns {object|null}
 */
export function parseReceipt(text) {
  if (!text || typeof text !== 'string') return null;

  const lines = text
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0);

  if (lines.length < 2) return null;

  // 1. Currency Detection
  let detectedCurrency = '$';
  for (const sym of Object.keys(CURRENCY_SYMBOLS)) {
    if (text.includes(sym)) {
      detectedCurrency = sym;
      break;
    }
  }

  // 2. Merchant Detection (look at first 5 lines for a likely business name)
  let merchant = 'Unknown Merchant';
  for (let i = 0; i < Math.min(5, lines.length); i++) {
    const candidate = lines[i].replace(/[^\w\s&'-]/g, '').trim();
    const upper = candidate.toUpperCase();
    if (
      candidate.length >= 3 &&
      candidate.length <= 40 &&
      !GENERIC_MERCHANT_IGNORE.some(g => upper === g || upper.startsWith(g + ' ') || upper.endsWith(' ' + g)) &&
      !/^\d+$/.test(candidate) &&
      !/\d{1,2}[\/\-\.]\d{1,2}/.test(candidate)
    ) {
      merchant = candidate;
      break;
    }
  }

  // 3. Date Detection
  let receiptDate = null;
  const datePatterns = [
    /\b(20\d{2}[-\/.](?:0[1-9]|1[0-2])[-\/.](?:0[1-9]|[12]\d|3[01]))\b/, // 2024-05-18
    /\b((?:0[1-9]|[12]\d|3[01])[-\/.](?:0[1-9]|1[0-2])[-\/.]20\d{2})\b/, // 18/05/2024
    /\b((?:0[1-9]|1[0-2])[-\/.](?:0[1-9]|[12]\d|3[01])[-\/.]20\d{2})\b/, // 05/18/2024
    /\b((?:0[1-9]|[12]\d|3[01])\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+20\d{2})\b/i // 18 May 2024
  ];
  for (const line of lines) {
    for (const pattern of datePatterns) {
      const match = line.match(pattern);
      if (match) {
        receiptDate = match[1];
        break;
      }
    }
    if (receiptDate) break;
  }

  // 4. Line Items & Amounts Extraction
  const lineItems = [];
  let subtotal = null;
  let tax = null;
  let discount = null;
  let total = null;

  // Regex to extract price at end of line: e.g. "Coffee Latte 4.50" or "2x Bagel $6.00"
  // Handles: 4.50, 14,99, 1,250.00
  const priceRegex = /(?:[\$€£¥₹₦]?\s*)(\d{1,4}(?:[,\.]\d{2}))(?:\s*[A-Z*]*)?$/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const upper = line.toUpperCase();

    // Check for Total keywords
    if (/\b(?:GRAND\s+TOTAL|TOTAL\s+DUE|TOTAL|AMOUNT\s+DUE|BALANCE)\b/i.test(upper)) {
      const pMatch = line.match(priceRegex);
      if (pMatch) {
        total = parsePriceNumber(pMatch[1]);
        continue;
      }
    }

    // Check for Subtotal
    if (/\b(?:SUBTOTAL|SUB\s*TOTAL|NET\s+AMOUNT)\b/i.test(upper)) {
      const pMatch = line.match(priceRegex);
      if (pMatch) {
        subtotal = parsePriceNumber(pMatch[1]);
        continue;
      }
    }

    // Check for Tax/VAT/GST
    if (/\b(?:TAX|VAT|GST|HST)\b/i.test(upper)) {
      const pMatch = line.match(priceRegex);
      if (pMatch) {
        tax = parsePriceNumber(pMatch[1]);
        continue;
      }
    }

    // Check for Discount
    if (/\b(?:DISCOUNT|COUPON|SAVINGS)\b/i.test(upper)) {
      const pMatch = line.match(priceRegex);
      if (pMatch) {
        discount = parsePriceNumber(pMatch[1]);
        continue;
      }
    }

    // Regular line item candidate: Description + Price
    const match = line.match(priceRegex);
    if (match) {
      const price = parsePriceNumber(match[1]);
      let desc = line.substring(0, match.index).trim();
      // Remove leading bullet/number or trailing dashes
      desc = desc.replace(/^[\d\.\-\*#]+\s+/, '').replace(/[\.\-_:]+$/, '').trim();

      // Filter out non-item lines like card numbers, dates, addresses, barcodes
      if (
        desc.length >= 2 &&
        desc.length <= 50 &&
        !GENERIC_MERCHANT_IGNORE.some(g => desc.toUpperCase() === g) &&
        !/\b(?:CHANGE|CASH|VISA|MASTERCARD|CARD|DEBIT|CREDIT|AUTH|APPROVAL|INVOICE)\b/i.test(desc)
      ) {
        // Check for quantity prefix like "2x " or "3 "
        let qty = 1;
        const qtyMatch = desc.match(/^(\d+)\s*(?:x|\*|@)\s*/i);
        if (qtyMatch) {
          qty = parseInt(qtyMatch[1], 10);
          desc = desc.replace(/^(\d+)\s*(?:x|\*|@)\s*/i, '');
        }

        lineItems.push({
          description: desc || 'Item',
          quantity: qty,
          price: price,
          total: price
        });
      }
    }
  }

  // 5. Arithmetic Consistency Check
  const sumOfItems = lineItems.reduce((acc, item) => acc + item.price, 0);
  const roundedSum = Math.round(sumOfItems * 100) / 100;

  // Fallback: if total wasn't found but we have items, use sum or max
  if (total === null && roundedSum > 0) {
    total = roundedSum;
  }

  let arithmeticConfidence = 'Incomplete';
  let diff = 0;
  if (total !== null && roundedSum > 0) {
    diff = Math.abs(total - roundedSum);
    if (diff < 0.05) {
      arithmeticConfidence = 'Exact (100% Match)';
    } else if (tax !== null && Math.abs(total - (roundedSum + tax)) < 0.1) {
      arithmeticConfidence = 'Exact (Items + Tax Matches Total)';
    } else if (diff < 2.0) {
      arithmeticConfidence = `Close match (Diff: ${detectedCurrency}${diff.toFixed(2)})`;
    } else {
      arithmeticConfidence = `Partial line items (Diff: ${detectedCurrency}${diff.toFixed(2)})`;
    }
  }

  return {
    type: 'Receipt',
    merchant,
    date: receiptDate || 'Not detected',
    currency: detectedCurrency,
    lineItems,
    itemsCount: lineItems.length,
    subtotal: subtotal !== null ? subtotal : roundedSum,
    tax: tax !== null ? tax : 0,
    discount: discount !== null ? discount : 0,
    total: total !== null ? total : roundedSum,
    sumOfItems: roundedSum,
    arithmeticConfidence,
    rawTextLength: text.length
  };
}

function parsePriceNumber(str) {
  if (!str) return 0;
  // Replace comma with dot if comma is decimal separator (e.g. 12,50)
  let clean = str.replace(/[^\d,\.]/g, '');
  if (clean.includes(',') && !clean.includes('.')) {
    clean = clean.replace(',', '.');
  } else if (clean.includes(',') && clean.includes('.')) {
    // 1,250.00
    clean = clean.replace(/,/g, '');
  }
  const val = parseFloat(clean);
  return isNaN(val) ? 0 : Math.round(val * 100) / 100;
}

/**
 * Generates CSV string for receipt line items
 */
export function exportReceiptToCSV(receipt) {
  if (!receipt) return '';
  const rows = [
    ['Merchant', receipt.merchant],
    ['Date', receipt.date],
    ['Currency', receipt.currency],
    ['Arithmetic Status', receipt.arithmeticConfidence],
    [],
    ['Item Description', 'Quantity', 'Price', 'Total']
  ];

  for (const item of receipt.lineItems) {
    rows.push([item.description, item.quantity, item.price.toFixed(2), item.total.toFixed(2)]);
  }

  rows.push([]);
  rows.push(['Subtotal', '', '', (receipt.subtotal || 0).toFixed(2)]);
  rows.push(['Tax / VAT', '', '', (receipt.tax || 0).toFixed(2)]);
  if (receipt.discount > 0) {
    rows.push(['Discount', '', '', `-${receipt.discount.toFixed(2)}`]);
  }
  rows.push(['GRAND TOTAL', '', '', (receipt.total || 0).toFixed(2)]);

  return rows
    .map(row => row.map(val => `"${String(val ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n');
}
