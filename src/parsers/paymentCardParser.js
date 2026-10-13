/**
 * Payment Card Parser with Strict Privacy Guardrails
 * Identifies card networks, runs Luhn algorithm check, extracts expiry candidate,
 * and masks card numbers by default.
 * NEVER extracts, stores, or logs CVV/CVC or PIN codes.
 */

// Luhn Algorithm (Mod 10)
export function validateLuhn(numberString) {
  const digits = numberString.replace(/\D/g, '');
  if (digits.length < 12 || digits.length > 19) return false;

  let sum = 0;
  let shouldDouble = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let digit = parseInt(digits.charAt(i), 10);
    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    shouldDouble = !shouldDouble;
  }
  return sum % 10 === 0;
}

// Card Network Brand Matchers
const NETWORKS = [
  { name: 'Visa', icon: '💳', pattern: /^4\d{12}(\d{3})?(\d{3})?$/ },
  { name: 'Mastercard', icon: '💳', pattern: /^(5[1-5]\d{4}|222[1-9]\d{2}|22[3-9]\d{3}|2[3-6]\d{4}|27[01]\d{3}|2720\d{2})\d{10}$/ },
  { name: 'American Express', icon: '💳', pattern: /^3[47]\d{13}$/ },
  { name: 'Discover', icon: '💳', pattern: /^(6011|65\d{2}|64[4-9]\d|622[1-9]\d)\d{10,12}$/ },
  { name: 'JCB', icon: '💳', pattern: /^(352[89]|35[3-8]\d)\d{12}$/ },
  { name: 'Diners Club', icon: '💳', pattern: /^(30[0-5]\d|36\d{2}|38\d{2})\d{10}$/ },
  { name: 'UnionPay', icon: '💳', pattern: /^62\d{14,17}$/ },
  { name: 'Maestro', icon: '💳', pattern: /^(5018|5020|5038|5893|6304|6759|6761|6762|6763)\d{8,15}$/ }
];

export function identifyCardNetwork(rawDigits) {
  const digits = rawDigits.replace(/\D/g, '');
  for (const net of NETWORKS) {
    if (net.pattern.test(digits)) {
      return net.name;
    }
  }
  // Fallback prefix heuristic
  if (digits.startsWith('4')) return 'Visa';
  if (/^5[1-5]/.test(digits) || /^2[2-7]/.test(digits)) return 'Mastercard';
  if (/^3[47]/.test(digits)) return 'American Express';
  if (digits.startsWith('6011') || digits.startsWith('65')) return 'Discover';
  if (digits.startsWith('35')) return 'JCB';
  return 'Unknown Network';
}

/**
 * Privacy Masking: "4532 0151 1234 5678" -> "•••• •••• •••• 5678"
 */
export function maskCardNumber(rawDigits) {
  const digits = rawDigits.replace(/\D/g, '');
  if (digits.length < 4) return '••••';
  const last4 = digits.slice(-4);
  if (digits.length === 15) {
    // Amex 4-6-5
    return `•••• •••••• •${last4}`;
  }
  // Standard 16 digits
  return `•••• •••• •••• ${last4}`;
}

/**
 * Searches OCR text for payment card candidates
 * @param {string} text
 * @returns {object|null}
 */
export function parsePaymentCard(text) {
  if (!text) return null;

  // Clean text lines
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  // 1. Look for sequences of 13-19 digits (with or without spaces or dashes)
  // Example: 4532 0151 8912 3456 or 4532-0151-8912-3456
  const cardCandidateRegex = /(?:\b\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?\d{1,7}\b|\b\d{13,19}\b)/g;
  let foundCardNumber = null;
  let isLuhnValid = false;
  let matchedLine = '';

  for (const line of lines) {
    const matches = line.match(cardCandidateRegex);
    if (matches) {
      for (const m of matches) {
        const raw = m.replace(/\D/g, '');
        if (raw.length >= 13 && raw.length <= 19) {
          const luhn = validateLuhn(raw);
          if (luhn) {
            foundCardNumber = raw;
            isLuhnValid = true;
            matchedLine = line;
            break;
          } else if (!foundCardNumber) {
            // Keep as weak candidate if no Luhn match found yet
            foundCardNumber = raw;
            matchedLine = line;
          }
        }
      }
    }
    if (isLuhnValid) break;
  }

  if (!foundCardNumber) return null;

  const network = identifyCardNetwork(foundCardNumber);

  // 2. Look for Expiration Date: MM/YY, MM/YYYY, or "VALID THRU 12/28"
  let expiryDate = null;
  const expiryRegex = /(?:VALID\s*THRU|EXP(?:IRY)?|EXPIRES)?\s*[:\s]?\s*([0-1][0-9])[\/\-\.]([2-3][0-9]|[2][0][2-3][0-9])/i;
  for (const line of lines) {
    const expMatch = line.match(expiryRegex);
    if (expMatch) {
      const month = parseInt(expMatch[1], 10);
      if (month >= 1 && month <= 12) {
        let year = expMatch[2];
        if (year.length === 4) year = year.slice(2);
        expiryDate = `${String(month).padStart(2, '0')}/${year}`;
        break;
      }
    }
  }

  // 3. Cardholder Name Candidate: Uppercase line of 2-3 words, no numbers, not containing bank words
  let cardholderCandidate = null;
  const bankWords = ['VISA', 'MASTERCARD', 'BANK', 'DEBIT', 'CREDIT', 'CARD', 'VALID', 'THRU', 'EXPIRES', 'AUTHORIZED'];
  for (const line of lines) {
    if (line === matchedLine) continue;
    const clean = line.replace(/[^A-Za-z\s]/g, '').trim();
    const words = clean.split(/\s+/);
    if (words.length >= 2 && words.length <= 4 && words.every(w => w.length >= 2 && w === w.toUpperCase())) {
      const containsBankWord = words.some(w => bankWords.includes(w));
      if (!containsBankWord) {
        cardholderCandidate = clean;
        break;
      }
    }
  }

  return {
    type: 'Payment Card',
    network,
    maskedNumber: maskCardNumber(foundCardNumber),
    last4Digits: foundCardNumber.slice(-4),
    expiryDate: expiryDate || 'Not detected',
    cardholderName: cardholderCandidate || 'Not detected',
    isLuhnValid,
    cvvNotice: 'CVV/PIN codes are never extracted or stored for your security.',
    privacyNotice: 'Stored locally. Full card number is masked and never uploaded.'
  };
}
