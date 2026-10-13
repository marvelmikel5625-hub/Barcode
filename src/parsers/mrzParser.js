/**
 * ICAO Doc 9303 Machine Readable Zone (MRZ) Parser
 * Supports TD1 (ID cards, 3 lines of 30 chars), TD2 (2 lines of 36 chars),
 * and TD3 (Passports, 2 lines of 44 chars).
 * Includes 7-3-1 weight check digit verification and default sensitive data masking.
 */

// ICAO 7-3-1 weighting table
const WEIGHTS = [7, 3, 1];

function getCharValue(char) {
  if (!char) return 0;
  const c = char.toUpperCase();
  if (c === '<') return 0;
  if (c >= '0' && c <= '9') return c.charCodeAt(0) - 48;
  if (c >= 'A' && c <= 'Z') return c.charCodeAt(0) - 55;
  return 0;
}

export function computeCheckDigit(str) {
  let sum = 0;
  for (let i = 0; i < str.length; i++) {
    const val = getCharValue(str[i]);
    const weight = WEIGHTS[i % 3];
    sum += val * weight;
  }
  return String(sum % 10);
}

export function verifyCheckDigit(str, expectedDigit) {
  if (!expectedDigit) return false;
  return computeCheckDigit(str) === expectedDigit;
}

/**
 * Mask sensitive document number for privacy
 * Example: "AB1234567" -> "AB•••••67"
 */
export function maskDocumentNumber(docNum) {
  if (!docNum || docNum.length <= 4) return '••••';
  const visibleStart = Math.min(2, Math.floor(docNum.length / 4));
  const visibleEnd = 2;
  const maskedLength = Math.max(3, docNum.length - visibleStart - visibleEnd);
  return (
    docNum.slice(0, visibleStart) +
    '•'.repeat(maskedLength) +
    docNum.slice(docNum.length - visibleEnd)
  );
}

function cleanMrzString(str) {
  return str.replace(/</g, ' ').trim().replace(/\s+/g, ' ');
}

function parseDateYYMMDD(yymmdd, isBirth = false) {
  if (!yymmdd || yymmdd.length !== 6 || !/^\d{6}$/.test(yymmdd)) return null;
  const yy = parseInt(yymmdd.substring(0, 2), 10);
  const mm = parseInt(yymmdd.substring(2, 4), 10);
  const dd = parseInt(yymmdd.substring(4, 6), 10);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;

  const currentYear = new Date().getFullYear() % 100;
  let fullYear;
  if (isBirth) {
    fullYear = yy > currentYear ? 1900 + yy : 2000 + yy;
  } else {
    // Expiry date
    fullYear = yy <= currentYear + 30 ? 2000 + yy : 1900 + yy;
  }
  const paddedMonth = String(mm).padStart(2, '0');
  const paddedDay = String(dd).padStart(2, '0');
  return `${fullYear}-${paddedMonth}-${paddedDay}`;
}

/**
 * Parses raw MRZ lines into structured record
 * @param {string[]} lines
 * @returns {object|null}
 */
export function parseMRZ(rawLines) {
  if (!rawLines || !Array.isArray(rawLines)) return null;

  // Clean lines: uppercase, keep only valid MRZ chars (A-Z, 0-9, <)
  const lines = rawLines
    .map(l => l.toUpperCase().replace(/[^A-Z0-9<]/g, ''))
    .filter(l => l.length >= 25);

  if (lines.length === 2 && lines[0].length === 44 && lines[1].length === 44) {
    return parseTD3(lines[0], lines[1]);
  }

  if (lines.length === 3 && lines[0].length === 30 && lines[1].length === 30 && lines[2].length === 30) {
    return parseTD1(lines[0], lines[1], lines[2]);
  }

  if (lines.length === 2 && lines[0].length === 36 && lines[1].length === 36) {
    return parseTD2(lines[0], lines[1]);
  }

  return null;
}

// TD3: Passport (2 x 44)
function parseTD3(l1, l2) {
  const docType = l1.substring(0, 2).replace(/</g, '');
  const issuingState = l1.substring(2, 5).replace(/</g, '');

  // Name parsing: Surname<<Given<Names
  const namePart = l1.substring(5);
  const nameParts = namePart.split('<<');
  const surname = cleanMrzString(nameParts[0] || '');
  const givenNames = cleanMrzString((nameParts[1] || '').replace(/</g, ' '));

  // Line 2
  const docNumberRaw = l2.substring(0, 9);
  const docNumber = docNumberRaw.replace(/</g, '');
  const docNumCheck = l2[9];
  const isDocNumValid = verifyCheckDigit(docNumberRaw, docNumCheck);

  const nationality = l2.substring(10, 13).replace(/</g, '');
  const birthRaw = l2.substring(13, 19);
  const birthCheck = l2[19];
  const isBirthValid = verifyCheckDigit(birthRaw, birthCheck);

  const sexChar = l2[20];
  const sex = sexChar === 'M' ? 'Male' : sexChar === 'F' ? 'Female' : 'Unspecified';

  const expiryRaw = l2.substring(21, 27);
  const expiryCheck = l2[27];
  const isExpiryValid = verifyCheckDigit(expiryRaw, expiryCheck);

  const personalNumberRaw = l2.substring(28, 42);
  const personalNumber = personalNumberRaw.replace(/</g, '');
  const personalCheck = l2[42];

  const compositeCheck = l2[43];
  // Composite check digit verifies docNum+check+birth+check+expiry+check+personal+check
  const compositeString = l2.substring(0, 10) + l2.substring(13, 20) + l2.substring(21, 43);
  const isCompositeValid = verifyCheckDigit(compositeString, compositeCheck);

  return {
    format: 'TD3 (Passport)',
    docType: docType.startsWith('P') ? 'Passport' : docType,
    issuingState,
    surname,
    givenNames,
    fullName: `${givenNames} ${surname}`.trim(),
    documentNumberMasked: maskDocumentNumber(docNumber),
    documentNumberRaw: docNumber, // kept in-memory for user review, not saved to history
    nationality,
    dateOfBirth: parseDateYYMMDD(birthRaw, true),
    sex,
    expiryDate: parseDateYYMMDD(expiryRaw, false),
    isExpired: expiryRaw ? Boolean(parseDateYYMMDD(expiryRaw, false) && new Date(parseDateYYMMDD(expiryRaw, false)) < new Date()) : false,
    validation: {
      docNumberCheck: isDocNumValid,
      birthCheck: isBirthValid,
      expiryCheck: isExpiryValid,
      compositeCheck: isCompositeValid,
      allChecksPass: isDocNumValid && isBirthValid && isExpiryValid && isCompositeValid
    },
    privacyDisclaimer: 'Extracted locally. Identity credentials are never verified or sent to any server.'
  };
}

// TD1: ID Card (3 x 30)
function parseTD1(l1, l2, l3) {
  const docType = l1.substring(0, 2).replace(/</g, '');
  const issuingState = l1.substring(2, 5).replace(/</g, '');
  const docNumberRaw = l1.substring(5, 14);
  const docNumber = docNumberRaw.replace(/</g, '');
  const docNumCheck = l1[14];
  const isDocNumValid = verifyCheckDigit(docNumberRaw, docNumCheck);

  const birthRaw = l2.substring(0, 6);
  const birthCheck = l2[6];
  const isBirthValid = verifyCheckDigit(birthRaw, birthCheck);
  const sexChar = l2[7];
  const sex = sexChar === 'M' ? 'Male' : sexChar === 'F' ? 'Female' : 'Unspecified';

  const expiryRaw = l2.substring(8, 14);
  const expiryCheck = l2[14];
  const isExpiryValid = verifyCheckDigit(expiryRaw, expiryCheck);
  const nationality = l2.substring(15, 18).replace(/</g, '');

  const nameParts = l3.split('<<');
  const surname = cleanMrzString(nameParts[0] || '');
  const givenNames = cleanMrzString((nameParts[1] || '').replace(/</g, ' '));

  return {
    format: 'TD1 (Identity Card)',
    docType: docType.startsWith('I') ? 'ID Card' : docType,
    issuingState,
    surname,
    givenNames,
    fullName: `${givenNames} ${surname}`.trim(),
    documentNumberMasked: maskDocumentNumber(docNumber),
    documentNumberRaw: docNumber,
    nationality,
    dateOfBirth: parseDateYYMMDD(birthRaw, true),
    sex,
    expiryDate: parseDateYYMMDD(expiryRaw, false),
    isExpired: expiryRaw ? Boolean(parseDateYYMMDD(expiryRaw, false) && new Date(parseDateYYMMDD(expiryRaw, false)) < new Date()) : false,
    validation: {
      docNumberCheck: isDocNumValid,
      birthCheck: isBirthValid,
      expiryCheck: isExpiryValid,
      allChecksPass: isDocNumValid && isBirthValid && isExpiryValid
    },
    privacyDisclaimer: 'Extracted locally. Identity credentials are never verified or sent to any server.'
  };
}

// TD2: Intermediate Document (2 x 36)
function parseTD2(l1, l2) {
  const docType = l1.substring(0, 2).replace(/</g, '');
  const issuingState = l1.substring(2, 5).replace(/</g, '');
  const nameParts = l1.substring(5).split('<<');
  const surname = cleanMrzString(nameParts[0] || '');
  const givenNames = cleanMrzString((nameParts[1] || '').replace(/</g, ' '));

  const docNumberRaw = l2.substring(0, 9);
  const docNumber = docNumberRaw.replace(/</g, '');
  const docNumCheck = l2[9];
  const isDocNumValid = verifyCheckDigit(docNumberRaw, docNumCheck);

  const nationality = l2.substring(10, 13).replace(/</g, '');
  const birthRaw = l2.substring(13, 19);
  const birthCheck = l2[19];
  const isBirthValid = verifyCheckDigit(birthRaw, birthCheck);

  const sexChar = l2[20];
  const sex = sexChar === 'M' ? 'Male' : sexChar === 'F' ? 'Female' : 'Unspecified';

  const expiryRaw = l2.substring(21, 27);
  const expiryCheck = l2[27];
  const isExpiryValid = verifyCheckDigit(expiryRaw, expiryCheck);

  return {
    format: 'TD2 (Travel Document)',
    docType,
    issuingState,
    surname,
    givenNames,
    fullName: `${givenNames} ${surname}`.trim(),
    documentNumberMasked: maskDocumentNumber(docNumber),
    documentNumberRaw: docNumber,
    nationality,
    dateOfBirth: parseDateYYMMDD(birthRaw, true),
    sex,
    expiryDate: parseDateYYMMDD(expiryRaw, false),
    validation: {
      docNumberCheck: isDocNumValid,
      birthCheck: isBirthValid,
      expiryCheck: isExpiryValid,
      allChecksPass: isDocNumValid && isBirthValid && isExpiryValid
    },
    privacyDisclaimer: 'Extracted locally. Identity credentials are never verified or sent to any server.'
  };
}
