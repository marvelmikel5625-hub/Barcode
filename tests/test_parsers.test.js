import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { computeCheckDigit, verifyCheckDigit, maskDocumentNumber, parseMRZ } from '../src/parsers/mrzParser.js';
import { validateLuhn, identifyCardNetwork, maskCardNumber, parsePaymentCard } from '../src/parsers/paymentCardParser.js';
import { parseReceipt, exportReceiptToCSV } from '../src/parsers/receiptParser.js';
import { analyzePayload } from '../src/parsers/urlSafety.js';
import { extractProductLabelData } from '../src/parsers/productParser.js';
import { fuseEvidence } from '../src/services/evidenceFusion.js';

describe('MRZ Parser (ICAO Doc 9303)', () => {
  test('Check digit 7-3-1 calculation', () => {
    // "520700810" -> check digit
    const check = computeCheckDigit('520700810');
    assert.strictEqual(typeof check, 'string');
    assert.strictEqual(verifyCheckDigit('520700810', check), true);
  });

  test('Document number privacy masking', () => {
    const masked = maskDocumentNumber('AB1234567');
    assert.ok(masked.startsWith('AB'));
    assert.ok(masked.includes('•'));
    assert.ok(masked.endsWith('67'));
    assert.ok(!masked.includes('12345'));
  });

  test('Parses standard TD3 synthetic passport MRZ', () => {
    const line1 = 'P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<';
    const line2 = 'L898902C36UTO7408122F1204159ZE184226B<<<<<10';
    const result = parseMRZ([line1, line2]);

    assert.ok(result);
    assert.strictEqual(result.format, 'TD3 (Passport)');
    assert.strictEqual(result.surname, 'ERIKSSON');
    assert.strictEqual(result.givenNames, 'ANNA MARIA');
    assert.strictEqual(result.issuingState, 'UTO');
    assert.strictEqual(result.sex, 'Female');
    assert.strictEqual(result.dateOfBirth, '1974-08-12');
    assert.strictEqual(result.documentNumberMasked.includes('•'), true);
  });
});

describe('Payment Card Parser', () => {
  test('Luhn algorithm verification', () => {
    // Standard synthetic test card numbers (test fixtures)
    assert.strictEqual(validateLuhn('4532015112830366'), true);
    assert.strictEqual(validateLuhn('4532015112830367'), false); // bad checksum
  });

  test('Card network identification', () => {
    assert.strictEqual(identifyCardNetwork('4532015112830366'), 'Visa');
    assert.strictEqual(identifyCardNetwork('5555555555554444'), 'Mastercard');
    assert.strictEqual(identifyCardNetwork('378282246310005'), 'American Express');
  });

  test('Strict number masking and zero CVV extraction', () => {
    const masked = maskCardNumber('4532015112830366');
    assert.strictEqual(masked, '•••• •••• •••• 0366');

    const sampleText = `
      FIRST NATIONAL BANK
      4532 0151 1283 0366
      VALID THRU 10/28
      JOHN DOE
      CVV: 999
    `;
    const card = parsePaymentCard(sampleText);
    assert.ok(card);
    assert.strictEqual(card.network, 'Visa');
    assert.strictEqual(card.maskedNumber, '•••• •••• •••• 0366');
    assert.strictEqual(card.expiryDate, '10/28');
    assert.strictEqual(card.cardholderName, 'JOHN DOE');
    // Ensure CVV is not extracted as a card attribute
    assert.strictEqual(card.cvv, undefined);
  });
});

describe('Receipt Parser', () => {
  test('Extracts line items, merchant, and checks arithmetic', () => {
    const sampleReceipt = `
      BLUE BOTTLE COFFEE
      123 MARKET ST, SAN FRANCISCO
      DATE: 2024-05-18
      
      Espresso Single   3.50
      Almond Croissant  4.75
      Iced Cold Brew    5.25
      
      SUBTOTAL  13.50
      TAX        1.15
      TOTAL     14.65
      
      THANK YOU FOR VISITING!
    `;
    const receipt = parseReceipt(sampleReceipt);
    assert.ok(receipt);
    assert.strictEqual(receipt.merchant, 'BLUE BOTTLE COFFEE');
    assert.strictEqual(receipt.date, '2024-05-18');
    assert.strictEqual(receipt.lineItems.length, 3);
    assert.strictEqual(receipt.subtotal, 13.5);
    assert.strictEqual(receipt.tax, 1.15);
    assert.strictEqual(receipt.total, 14.65);
    assert.ok(receipt.arithmeticConfidence.includes('Exact') || receipt.arithmeticConfidence.includes('Matches'));

    // Test CSV export
    const csv = exportReceiptToCSV(receipt);
    assert.ok(csv.includes('"BLUE BOTTLE COFFEE"'));
    assert.ok(csv.includes('"Almond Croissant"'));
    assert.ok(csv.includes('"14.65"'));
  });
});

describe('URL and Payload Safety Analyzer', () => {
  test('Detects safe HTTPS web link', () => {
    const analysis = analyzePayload('https://example.com/products/all');
    assert.strictEqual(analysis.category, 'URL');
    assert.strictEqual(analysis.isHttps, true);
    assert.strictEqual(analysis.riskLevel, 'low');
  });

  test('Flags unencrypted HTTP and raw IP', () => {
    const analysis = analyzePayload('http://192.168.1.1/admin');
    assert.strictEqual(analysis.category, 'URL');
    assert.strictEqual(analysis.isHttps, false);
    assert.strictEqual(analysis.riskLevel, 'medium');
  });

  test('Parses Wi-Fi payload safely', () => {
    const analysis = analyzePayload('WIFI:T:WPA;S:MyGuestNetwork;P:SuperSecretPass;;');
    assert.strictEqual(analysis.category, 'Wi-Fi');
    assert.strictEqual(analysis.ssid, 'MyGuestNetwork');
    assert.strictEqual(analysis.maskedPassword, '••••••••');
  });
});

describe('Evidence Fusion Engine', () => {
  test('Fuses code result into Identified status', () => {
    const fused = fuseEvidence({
      codeResult: { text: 'https://myshop.com', format: 'QR_CODE' },
      ocrText: null,
      classification: null,
      productLookup: null
    });
    assert.strictEqual(fused.status, 'Identified');
    assert.strictEqual(fused.primaryType, 'QR Code (Web Link)');
  });

  test('Fuses visual object classification with confidence reporting', () => {
    const fused = fuseEvidence({
      codeResult: null,
      ocrText: null,
      classification: { label: 'cellular telephone, mobile phone', score: 0.88 },
      productLookup: null
    });
    assert.strictEqual(fused.status, 'Likely match');
    assert.strictEqual(fused.primaryType, 'Object');
    assert.ok(fused.title.toLowerCase().includes('cellular telephone'));
    assert.ok(fused.evidenceChain[0].includes('88%'));
  });
});

import { calculateContrastRatio, validateQRContrast } from '../src/services/codeGenerator.js';

describe('QR Contrast Validator', () => {
  test('High contrast black on white is verified reliable', () => {
    const check = validateQRContrast('#000000', '#FFFFFF');
    assert.strictEqual(check.isReliable, true);
    assert.ok(check.ratio >= 15);
    assert.strictEqual(check.warning, null);
  });

  test('Low contrast yellow on white warns user honestly', () => {
    const check = validateQRContrast('#FFFF00', '#FFFFFF');
    assert.strictEqual(check.isReliable, false);
    assert.ok(check.warning.includes('Low contrast') || check.warning.includes('Critical'));
  });
});

