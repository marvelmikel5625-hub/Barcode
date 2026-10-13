/**
 * Evidence Fusion Engine
 * Combines signals from Barcode Decoders, OCR, Specialized Parsers,
 * Pretrained Image Classifiers, and Product Lookups without inventing certainty.
 */

import { analyzePayload } from '../parsers/urlSafety.js';
import { parseReceipt } from '../parsers/receiptParser.js';
import { parseMRZ } from '../parsers/mrzParser.js';
import { parsePaymentCard } from '../parsers/paymentCardParser.js';
import { extractProductLabelData, createResearchLinks } from '../parsers/productParser.js';

/**
 * Fuses inputs from all active recognition pipelines into a unified result
 * @param {object} params
 * @param {object|null} params.codeResult - { text, format }
 * @param {string|null} params.ocrText - Raw text from OCR
 * @param {object|null} params.classification - { label, score, rawPredictions } from MobileNet
 * @param {object|null} params.productLookup - result from Open Food Facts
 * @returns {object}
 */
export function fuseEvidence({ codeResult, ocrText, classification, productLookup }) {
  const evidenceChain = [];
  const uncertaintyNotes = [];

  // --- 1. Priority: Valid Decoded QR or Barcode ---
  if (codeResult && codeResult.text) {
    const rawPayload = codeResult.text;
    const format = codeResult.format || 'QR_CODE';
    evidenceChain.push(`Decoded optical code format: ${format}`);

    const payloadAnalysis = analyzePayload(rawPayload);

    // If it's a linear barcode and we have a product database match
    if (productLookup && productLookup.found) {
      evidenceChain.push(`Matched in Open Food Facts database: ${productLookup.productName}`);
      return {
        status: 'Identified',
        primaryType: 'Product',
        title: productLookup.productName,
        subtitle: productLookup.brands || 'Identified Product',
        evidenceChain,
        uncertaintyNotes: ['Nutritional data retrieved from public database; verify against packaging.'],
        data: {
          barcode: codeResult.text,
          format,
          product: productLookup,
          researchLinks: createResearchLinks(`${productLookup.brands} ${productLookup.productName}`)
        },
        actions: ['copy_barcode', 'view_product_online', 'search_web']
      };
    }

    // Standard Code Result (URL, Wi-Fi, vCard, or Data)
    let status = 'Identified';
    let subtitle = `Format: ${format}`;
    if (payloadAnalysis.riskLevel === 'high') {
      uncertaintyNotes.push(payloadAnalysis.safetyNotice);
      status = 'Likely match';
    }

    return {
      status,
      primaryType: payloadAnalysis.category === 'URL' ? 'QR Code (Web Link)' : `Code (${payloadAnalysis.category})`,
      title: payloadAnalysis.displayTitle,
      subtitle,
      evidenceChain,
      uncertaintyNotes,
      data: {
        raw: rawPayload,
        format,
        analysis: payloadAnalysis
      },
      actions: payloadAnalysis.category === 'URL' ? ['open_url', 'copy_text', 'share'] : ['copy_text', 'share']
    };
  }

  // --- 2. Check OCR for Specialized Documents ---
  if (ocrText && ocrText.trim().length > 10) {
    const cleanOcr = ocrText.trim();
    evidenceChain.push(`Extracted ${cleanOcr.length} characters of printed text via OCR`);

    // A. Check for Passport MRZ
    const lines = cleanOcr.split('\n').map(l => l.trim()).filter(l => l.length >= 25);
    const mrz = parseMRZ(lines);
    if (mrz) {
      evidenceChain.push(`Recognized ${mrz.format} machine-readable zone with standard check digits`);
      if (!mrz.validation.allChecksPass) {
        uncertaintyNotes.push('One or more MRZ checksums failed. Check for camera reflections or misread characters.');
      }
      return {
        status: mrz.validation.allChecksPass ? 'Identified' : 'Likely match',
        primaryType: 'Passport / Travel Document',
        title: mrz.fullName || 'Identity Document',
        subtitle: `${mrz.issuingState} ${mrz.docType} (Masked)`,
        evidenceChain,
        uncertaintyNotes,
        data: {
          mrz,
          rawOcr: cleanOcr
        },
        actions: ['copy_masked_summary', 'export_text']
      };
    }

    // B. Check for Payment Card
    const card = parsePaymentCard(cleanOcr);
    if (card && card.isLuhnValid) {
      evidenceChain.push(`Identified ${card.network} card with valid Luhn checksum`);
      return {
        status: 'Identified',
        primaryType: 'Payment Card',
        title: `${card.network} (${card.maskedNumber})`,
        subtitle: `Expiry: ${card.expiryDate} • Cardholder: ${card.cardholderName}`,
        evidenceChain,
        uncertaintyNotes: ['Card details processed locally. Full number is masked for security.'],
        data: {
          card,
          rawOcr: cleanOcr
        },
        actions: ['copy_masked_number']
      };
    }

    // C. Check for Receipt / Invoice
    const receipt = parseReceipt(cleanOcr);
    if (receipt && (receipt.lineItems.length >= 2 || (receipt.total > 0 && receipt.merchant !== 'Unknown Merchant'))) {
      evidenceChain.push(`Found ${receipt.itemsCount} receipt line items for ${receipt.merchant}`);
      evidenceChain.push(`Arithmetic Status: ${receipt.arithmeticConfidence}`);
      if (receipt.arithmeticConfidence.includes('Partial') || receipt.arithmeticConfidence.includes('Diff')) {
        uncertaintyNotes.push('Some line items or discounts were partially read. Review extracted values.');
      }
      return {
        status: receipt.itemsCount >= 2 ? 'Identified' : 'Likely match',
        primaryType: 'Receipt / Invoice',
        title: receipt.merchant,
        subtitle: `Total: ${receipt.currency}${receipt.total.toFixed(2)} (${receipt.date})`,
        evidenceChain,
        uncertaintyNotes,
        data: {
          receipt,
          rawOcr: cleanOcr
        },
        actions: ['export_csv', 'copy_text', 'edit_receipt']
      };
    }

    // D. Check for Product Labels
    const labelData = extractProductLabelData(cleanOcr);
    if (labelData.modelCandidate || labelData.expiryCandidate) {
      if (labelData.modelCandidate) evidenceChain.push(`Detected model identifier: ${labelData.modelCandidate}`);
      if (labelData.expiryCandidate) evidenceChain.push(`Detected expiry/validity date: ${labelData.expiryCandidate}`);

      const title = labelData.modelCandidate ? `Device / Model ${labelData.modelCandidate}` : 'Product Label';
      return {
        status: 'Likely match',
        primaryType: 'Product Label',
        title,
        subtitle: labelData.expiryCandidate ? `Expiry: ${labelData.expiryCandidate}` : 'Extracted from packaging text',
        evidenceChain,
        uncertaintyNotes: ['Model extracted from visual text. Verify against official specs.'],
        data: {
          labelData,
          rawOcr: cleanOcr,
          researchLinks: createResearchLinks(labelData.modelCandidate || title)
        },
        actions: ['copy_text', 'search_web']
      };
    }

    // E. General Text Document
    return {
      status: 'Identified',
      primaryType: 'Text Document',
      title: cleanOcr.split('\n')[0].slice(0, 50) || 'Extracted Text',
      subtitle: `${cleanOcr.length} characters • ${cleanOcr.split('\n').length} lines`,
      evidenceChain,
      uncertaintyNotes: ['Optical Character Recognition may have occasional character substitutions.'],
      data: {
        rawOcr: cleanOcr,
        researchLinks: createResearchLinks(cleanOcr.slice(0, 60))
      },
      actions: ['copy_text', 'share', 'export_text']
    };
  }

  // --- 3. Visual Object Classification (MobileNet) ---
  if (classification && classification.label) {
    const rawLabel = classification.label;
    const scorePct = Math.round(classification.score * 100);
    evidenceChain.push(`Pretrained MobileNet model detected visual category: "${rawLabel}" (Model score: ${scorePct}%)`);

    // Honest uncertainty interpretation
    let status = 'Likely match';
    if (scorePct < 40) {
      status = 'Not enough evidence';
      uncertaintyNotes.push('Model score is below 40%. The image may be partially obstructed or ambiguous.');
    } else {
      uncertaintyNotes.push('MobileNet classifies visual appearance into broad ImageNet categories. It cannot verify specific brand or model without visible labels.');
    }

    // Human-friendly title
    const formattedTitle = rawLabel.split(',')[0].replace(/_/g, ' ');
    const title = formattedTitle.charAt(0).toUpperCase() + formattedTitle.slice(1);

    return {
      status,
      primaryType: 'Object',
      title,
      subtitle: `Visual classification (${scorePct}% score)`,
      evidenceChain,
      uncertaintyNotes,
      data: {
        classification,
        researchLinks: createResearchLinks(title)
      },
      actions: ['search_web', 'run_ocr', 'scan_again']
    };
  }

  // --- 4. Unknown / Inconclusive ---
  return {
    status: 'Not enough evidence',
    primaryType: 'Unknown',
    title: 'No Recognizable Pattern Found',
    subtitle: 'Could not detect valid codes, legible text, or known objects',
    evidenceChain: ['No optical codes detected in frame', 'No OCR text extracted', 'No high-confidence visual match'],
    uncertaintyNotes: [
      'Suggestions: Move closer to the subject',
      'Ensure bright, even lighting and avoid glare',
      'Hold still to reduce motion blur',
      'Try the Crop or Manual capture in Tools'
    ],
    data: {},
    actions: ['scan_again', 'upload_file']
  };
}
