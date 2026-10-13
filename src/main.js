/**
 * Universal Scanner Application Orchestrator
 * Connects camera streams, optical decoders, OCR engine, MobileNet classifier,
 * specialized parsers, code generators, tools, and local history.
 */

import { assessImageQuality, enhanceDocumentImage, rotateCanvas } from './services/imageAnalysis.js';
import { runOCR, terminateOCR } from './services/ocrEngine.js';
import { classifyObject, isMobileNetLoaded, getMobileNetModel } from './services/objectClassifier.js';
import { lookupBarcodeProduct, extractProductLabelData, createResearchLinks } from './parsers/productParser.js';
import { analyzePayload } from './parsers/urlSafety.js';
import { parseMRZ } from './parsers/mrzParser.js';
import { parsePaymentCard } from './parsers/paymentCardParser.js';
import { parseReceipt, exportReceiptToCSV } from './parsers/receiptParser.js';
import { fuseEvidence } from './services/evidenceFusion.js';
import { getHistory, saveHistoryEntry, deleteHistoryItem, clearAllHistory, exportHistoryJSON, exportHistoryCSV } from './services/historyStorage.js';
import { calculateContrastRatio, validateQRContrast, generateLinearBarcode } from './services/codeGenerator.js';

// Application State
const state = {
  activeTab: 'scan',
  scanMode: 'auto', // 'auto', 'code', 'doc', 'object'
  isCameraActive: false,
  html5QrCode: null,
  torchOn: false,
  facingMode: 'environment',
  currentResult: null,
  capturedCanvas: null,
  capturedImageUrl: null,
  lowPowerMode: false,
  qrCodeInstance: null,
  generatorType: 'qr', // 'qr' or 'barcode'
  qrContentType: 'text',
  barcodeFormat: 'CODE128',
  toolsImageCanvas: null,
  toolsEnhancedCanvas: null
};

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
  initApp();
});

function initApp() {
  initNavigation();
  initScanControls();
  initGenerator();
  initHistoryTab();
  initToolsTab();
  initSettingsTab();
  loadSavedSettings();
}

// --- NAVIGATION ---
function initNavigation() {
  const navButtons = document.querySelectorAll('.nav-item');
  navButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      switchTab(tab);
    });
  });
}

export function switchTab(tab) {
  state.activeTab = tab;
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  document.querySelectorAll('.tab-view').forEach(view => {
    view.classList.toggle('active', view.id === `tab-${tab}`);
  });

  // If leaving scan tab, stop camera to save battery
  if (tab !== 'scan' && state.isCameraActive) {
    stopCamera();
  }

  // Refresh tab-specific views
  if (tab === 'history') {
    renderHistory();
  } else if (tab === 'settings') {
    updateSettingsDisplay();
  }
}

// --- SCANNER & CAMERA CONTROLS ---
function initScanControls() {
  const startBtn = document.getElementById('btnStartCamera');
  if (startBtn) startBtn.addEventListener('click', () => startCamera());

  const captureBtn = document.getElementById('btnCaptureStill');
  if (captureBtn) captureBtn.addEventListener('click', () => captureAndAnalyze());

  const torchBtn = document.getElementById('btnToggleTorch');
  if (torchBtn) torchBtn.addEventListener('click', () => toggleTorch());

  const switchCamBtn = document.getElementById('btnSwitchCamera');
  if (switchCamBtn) switchCamBtn.addEventListener('click', () => switchCamera());

  const closeCamBtn = document.getElementById('btnCloseCamera');
  if (closeCamBtn) closeCamBtn.addEventListener('click', () => stopCamera());

  const fileInput = document.getElementById('scanFileInput');
  if (fileInput) {
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (file) handleImageFile(file);
      e.target.value = '';
    });
  }

  const mobileCamInput = document.getElementById('scanMobileCameraInput');
  if (mobileCamInput) {
    mobileCamInput.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (file) handleImageFile(file);
      e.target.value = '';
    });
  }

  // Instant demo test buttons
  const demoButtons = document.querySelectorAll('.demo-btn');
  demoButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const demoType = btn.dataset.demo;
      runDemoScan(demoType);
    });
  });

  // Engine Mode Selector Chips (Auto, Code, Document, Object)
  const modeChips = document.querySelectorAll('.mode-chip');
  modeChips.forEach(chip => {
    chip.addEventListener('click', () => {
      modeChips.forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      state.scanMode = chip.dataset.mode;
      updateScannerModeHint();
    });
  });

  // Result bottom sheet close & action buttons
  const closeSheetBtn = document.getElementById('btnCloseResult');
  if (closeSheetBtn) closeSheetBtn.addEventListener('click', () => closeResultSheet());

  const saveHistoryBtn = document.getElementById('btnSaveResult');
  if (saveHistoryBtn) {
    saveHistoryBtn.addEventListener('click', () => {
      if (state.currentResult) {
        saveHistoryEntry(state.currentResult);
        showToast('Saved to local history');
        saveHistoryBtn.disabled = true;
        saveHistoryBtn.textContent = 'Saved in History';
      }
    });
  }
}

function updateScannerModeHint() {
  const hintEl = document.getElementById('scanModeHint');
  if (!hintEl) return;
  const hints = {
    auto: 'Auto: Scans codes, text, receipts, cards, or objects automatically',
    code: 'Code Mode: Optimized for QR, Barcode, EAN, UPC',
    doc: 'Document Mode: Text extraction, receipts, invoices, ID documents',
    object: 'Object Mode: Visual classification with MobileNet classifier'
  };
  hintEl.textContent = hints[state.scanMode] || hints.auto;
}

async function startCamera() {
  const emptyPrompt = document.getElementById('cameraPromptCard');
  const liveControls = document.getElementById('liveCameraControls');
  const liveVideoWrapper = document.getElementById('liveVideoWrapper');
  const permNotice = document.getElementById('cameraPermissionNotice');

  // Check if mediaDevices API is supported in the current environment
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    if (permNotice) permNotice.classList.remove('hidden');
    showToast('Live camera is restricted in this browser frame. Use Snap Photo or Pick Image.');
    return;
  }

  try {
    if (emptyPrompt) emptyPrompt.classList.add('hidden');
    if (liveControls) liveControls.classList.remove('hidden');
    if (liveVideoWrapper) liveVideoWrapper.classList.remove('hidden');

    if (!window.Html5Qrcode) {
      showToast('Camera decoder library still loading. Please retry.');
      return;
    }

    state.html5QrCode = new Html5Qrcode('qr-video-region');
    const config = {
      fps: state.lowPowerMode ? 5 : 10,
      qrbox: { width: 250, height: 250 },
      aspectRatio: 1.0
    };

    await state.html5QrCode.start(
      { facingMode: state.facingMode },
      config,
      onCodeScannedSuccess,
      onCodeScanError
    );

    state.isCameraActive = true;
    if (permNotice) permNotice.classList.add('hidden');
    startQualityGuidanceLoop();
  } catch (err) {
    // Log as graceful diagnostic warning instead of error to avoid triggering error overlays
    console.warn('Camera stream could not be started (permission denied or restricted):', err?.message || err);
    state.isCameraActive = false;
    if (liveControls) liveControls.classList.add('hidden');
    if (emptyPrompt) emptyPrompt.classList.remove('hidden');
    if (liveVideoWrapper) liveVideoWrapper.classList.add('hidden');

    if (permNotice) {
      permNotice.classList.remove('hidden');
    }

    if (err.name === 'NotAllowedError' || String(err).includes('Permission')) {
      showToast('Camera access restricted. Use Snap Photo, Pick Image, or Demo Samples.');
    } else {
      showToast('Unable to open live camera. Try uploading an image or selecting a demo.');
    }
  }
}

/**
 * Instant Demo Scans for testing engines without needing physical hardware camera
 */
async function runDemoScan(type) {
  showProcessingIndicator(`Loading ${type} demo sample...`);

  if (type === 'qr') {
    const fused = fuseEvidence({
      codeResult: { text: 'WIFI:T:WPA;S:Cafe_Free_WiFi;P:latte_espresso_99;;', format: 'QR_CODE' },
      ocrText: null,
      classification: null,
      productLookup: null
    });
    hideProcessingIndicator();
    displayScanResult(fused, null);
    return;
  }

  if (type === 'receipt') {
    const sampleReceiptText = `
BLUE BOTTLE COFFEE
123 MARKET STREET, SAN FRANCISCO
DATE: 2024-05-18

Espresso Single    3.50
Almond Croissant   4.75
Iced Cold Brew     5.25

SUBTOTAL  13.50
TAX        1.15
TOTAL     14.65
THANK YOU FOR VISITING!
    `;
    const fused = fuseEvidence({
      codeResult: null,
      ocrText: sampleReceiptText,
      classification: null,
      productLookup: null
    });
    hideProcessingIndicator();
    displayScanResult(fused, null);
    return;
  }

  if (type === 'passport') {
    const mrzSample = `
P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<
L898902C36UTO7408122F1204159ZE184226B<<<<<10
    `;
    const fused = fuseEvidence({
      codeResult: null,
      ocrText: mrzSample,
      classification: null,
      productLookup: null
    });
    hideProcessingIndicator();
    displayScanResult(fused, null);
    return;
  }

  if (type === 'card') {
    const sampleCard = `
FIRST NATIONAL BANK
4532 0151 1283 0366
VALID THRU 10/28
JOHN DOE
    `;
    const fused = fuseEvidence({
      codeResult: null,
      ocrText: sampleCard,
      classification: null,
      productLookup: null
    });
    hideProcessingIndicator();
    displayScanResult(fused, null);
    return;
  }

  if (type === 'product') {
    const barcode = '3017620422003';
    let productLookup = null;
    try {
      productLookup = await lookupBarcodeProduct(barcode);
    } catch {}
    const fused = fuseEvidence({
      codeResult: { text: barcode, format: 'EAN_13' },
      ocrText: null,
      classification: null,
      productLookup
    });
    hideProcessingIndicator();
    displayScanResult(fused, null);
    return;
  }
}

async function stopCamera() {
  if (state.html5QrCode && state.isCameraActive) {
    try {
      await state.html5QrCode.stop();
      state.html5QrCode.clear();
    } catch {}
  }
  state.isCameraActive = false;
  state.torchOn = false;

  const liveControls = document.getElementById('liveCameraControls');
  const emptyPrompt = document.getElementById('cameraPromptCard');
  const liveVideoWrapper = document.getElementById('liveVideoWrapper');

  if (liveControls) liveControls.classList.add('hidden');
  if (emptyPrompt) emptyPrompt.classList.remove('hidden');
  if (liveVideoWrapper) liveVideoWrapper.classList.add('hidden');
}

async function toggleTorch() {
  if (!state.isCameraActive || !state.html5QrCode) return;
  try {
    state.torchOn = !state.torchOn;
    await state.html5QrCode.applyVideoConstraints({
      advanced: [{ torch: state.torchOn }]
    });
    const torchBtn = document.getElementById('btnToggleTorch');
    if (torchBtn) {
      torchBtn.classList.toggle('active', state.torchOn);
      torchBtn.textContent = state.torchOn ? '🔦 Torch On' : '🔦 Torch';
    }
    showToast(state.torchOn ? 'Torch enabled' : 'Torch disabled');
  } catch (err) {
    showToast('Torch control not supported on this device/camera.');
  }
}

async function switchCamera() {
  if (!state.isCameraActive) return;
  state.facingMode = state.facingMode === 'environment' ? 'user' : 'environment';
  await stopCamera();
  await startCamera();
}

let lastScanTime = 0;
let lastDecodedText = null;

async function onCodeScannedSuccess(decodedText, decodedResult) {
  // Throttle continuous detections to avoid duplicate spam
  const now = Date.now();
  if (decodedText === lastDecodedText && now - lastScanTime < 3500) {
    return;
  }
  lastScanTime = now;
  lastDecodedText = decodedText;

  // Haptic feedback if available
  if (navigator.vibrate) navigator.vibrate(50);

  // Grab snapshot canvas from video element
  const video = document.querySelector('#qr-video-region video');
  let snapshotCanvas = null;
  if (video && video.videoWidth > 0) {
    snapshotCanvas = document.createElement('canvas');
    snapshotCanvas.width = video.videoWidth;
    snapshotCanvas.height = video.videoHeight;
    const ctx = snapshotCanvas.getContext('2d');
    ctx.drawImage(video, 0, 0);
  }

  showProcessingIndicator('Optical code detected! Analyzing payload...');

  // If linear barcode with numbers, attempt Open Food Facts lookup
  let productLookup = null;
  if (/^\d{8,14}$/.test(decodedText.trim())) {
    showProcessingIndicator('Checking Open Food Facts database...');
    try {
      productLookup = await lookupBarcodeProduct(decodedText.trim());
    } catch {}
  }

  const format = decodedResult?.result?.format?.formatName || 'Optical Code';

  const fused = fuseEvidence({
    codeResult: { text: decodedText, format },
    ocrText: null,
    classification: null,
    productLookup
  });

  hideProcessingIndicator();
  displayScanResult(fused, snapshotCanvas);
}

function onCodeScanError() {
  // Continuous frame error, ignore
}

// Live Image Quality Guidance Loop
let qualityInterval = null;
function startQualityGuidanceLoop() {
  if (qualityInterval) clearInterval(qualityInterval);
  qualityInterval = setInterval(() => {
    if (!state.isCameraActive) {
      clearInterval(qualityInterval);
      return;
    }
    const video = document.querySelector('#qr-video-region video');
    if (!video || video.readyState < 2) return;

    const assessment = assessImageQuality(video);
    const badge = document.getElementById('liveQualityBadge');
    if (badge) {
      if (assessment.quality === 'good') {
        badge.className = 'quality-badge good';
        badge.textContent = 'Framing: Good';
      } else if (assessment.quality === 'warning') {
        badge.className = 'quality-badge warning';
        badge.textContent = assessment.suggestions[0] || 'Adjust position';
      } else {
        badge.className = 'quality-badge poor';
        badge.textContent = assessment.suggestions[0] || 'Hold still / lighting';
      }
    }
  }, 1200);
}

// --- STILL CAPTURE & MULTI-ENGINE PIPELINE ---
async function captureAndAnalyze() {
  const video = document.querySelector('#qr-video-region video');
  if (!video || video.videoWidth === 0) {
    showToast('Video stream not ready. Please try again.');
    return;
  }

  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0);

  await processCapturedCanvas(canvas);
}

async function handleImageFile(file) {
  if (!file || !file.type.startsWith('image/')) {
    showToast('Please select a valid image file (PNG, JPG, WebP).');
    return;
  }

  showProcessingIndicator('Loading selected image...');
  const img = new Image();
  const url = URL.createObjectURL(file);
  img.src = url;

  img.onload = async () => {
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    URL.revokeObjectURL(url);
    await processCapturedCanvas(canvas);
  };

  img.onerror = () => {
    hideProcessingIndicator();
    showToast('Could not load image. File may be corrupted.');
  };
}

/**
 * Universal Processing Pipeline for Captured Canvas
 */
async function processCapturedCanvas(canvas) {
  state.capturedCanvas = canvas;
  state.capturedImageUrl = canvas.toDataURL('image/jpeg', 0.85);

  showProcessingIndicator('Analyzing image quality...');
  const quality = assessImageQuality(canvas);

  let codeResult = null;
  let ocrResult = null;
  let classificationResult = null;
  let productLookup = null;

  // 1. First attempt: Optical Code Decoding
  if (state.scanMode === 'auto' || state.scanMode === 'code') {
    showProcessingIndicator('Scanning for QR and barcodes...');
    try {
      if (window.Html5Qrcode) {
        // Html5Qrcode scanFile API
        const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg'));
        const file = new File([blob], 'capture.jpg', { type: 'image/jpeg' });
        const html5Qr = new Html5Qrcode('qr-scratch-reader');
        try {
          const text = await html5Qr.scanFile(file, true);
          codeResult = { text, format: 'Decoded Code' };
        } catch {}
        html5Qr.clear();
      }
    } catch {}
  }

  // If barcode found, check Open Food Facts
  if (codeResult && /^\d{8,14}$/.test(codeResult.text.trim())) {
    showProcessingIndicator('Checking product catalog...');
    try {
      productLookup = await lookupBarcodeProduct(codeResult.text.trim());
    } catch {}
  }

  // 2. Second attempt: OCR for Text & Documents (Receipts, Cards, Passports, Labels)
  if (!codeResult || state.scanMode === 'doc' || state.scanMode === 'auto') {
    if (state.scanMode !== 'code') {
      showProcessingIndicator('Running OCR on captured text...');
      try {
        // Enhance document contrast for better OCR accuracy
        const enhanced = enhanceDocumentImage(canvas, 1.25);
        const ocrData = await runOCR(enhanced, {}, (p) => {
          showProcessingIndicator(p.status);
        });
        if (ocrData && ocrData.text && ocrData.text.trim().length > 8) {
          ocrResult = ocrData.text;
        }
      } catch (err) {
        console.warn('OCR error during capture:', err);
      }
    }
  }

  // 3. Third attempt: MobileNet Object Classifier (if no code/text, or if in object mode)
  if (state.scanMode === 'object' || (!codeResult && (!ocrResult || ocrResult.length < 20))) {
    if (state.scanMode !== 'code') {
      showProcessingIndicator('Evaluating object classifier...');
      try {
        classificationResult = await classifyObject(canvas, (p) => {
          showProcessingIndicator(p.status);
        });
      } catch (err) {
        console.warn('Object classification error:', err);
      }
    }
  }

  hideProcessingIndicator();

  // Fuse all evidence gathered
  const fused = fuseEvidence({
    codeResult,
    ocrText: ocrResult,
    classification: classificationResult,
    productLookup
  });

  displayScanResult(fused, canvas);
}

// --- DISPLAY SCAN RESULT SHEET ---
function displayScanResult(result, canvas) {
  state.currentResult = result;

  const sheet = document.getElementById('resultSheet');
  const badge = document.getElementById('resultStatusBadge');
  const typeTag = document.getElementById('resultTypeTag');
  const title = document.getElementById('resultTitle');
  const subtitle = document.getElementById('resultSubtitle');
  const evidenceList = document.getElementById('resultEvidenceList');
  const uncertaintyBox = document.getElementById('resultUncertaintyBox');
  const uncertaintyList = document.getElementById('resultUncertaintyList');
  const previewImg = document.getElementById('resultPreviewImage');
  const dynamicActions = document.getElementById('resultDynamicActions');
  const saveBtn = document.getElementById('btnSaveResult');

  if (saveBtn) {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save to History';
  }

  // Status Badge
  if (badge) {
    badge.className = `status-pill ${result.status.toLowerCase().replace(/\s+/g, '-')}`;
    badge.textContent = result.status;
  }

  if (typeTag) typeTag.textContent = result.primaryType;
  if (title) title.textContent = result.title;
  if (subtitle) subtitle.textContent = result.subtitle;

  // Preview Image
  if (previewImg && canvas) {
    previewImg.src = canvas.toDataURL('image/jpeg', 0.8);
    previewImg.classList.remove('hidden');
  } else if (previewImg) {
    previewImg.classList.add('hidden');
  }

  // Evidence Chain
  if (evidenceList) {
    evidenceList.innerHTML = '';
    result.evidenceChain.forEach(ev => {
      const li = document.createElement('li');
      li.textContent = ev;
      evidenceList.appendChild(li);
    });
  }

  // Uncertainty Box
  if (uncertaintyBox && uncertaintyList) {
    if (result.uncertaintyNotes && result.uncertaintyNotes.length > 0) {
      uncertaintyBox.classList.remove('hidden');
      uncertaintyList.innerHTML = '';
      result.uncertaintyNotes.forEach(note => {
        const li = document.createElement('li');
        li.textContent = note;
        uncertaintyList.appendChild(li);
      });
    } else {
      uncertaintyBox.classList.add('hidden');
    }
  }

  // Dynamic Actions
  if (dynamicActions) {
    dynamicActions.innerHTML = '';
    renderDynamicActionButtons(dynamicActions, result);
  }

  if (sheet) {
    sheet.classList.remove('hidden');
    sheet.scrollIntoView({ behavior: 'smooth' });
  }
}

function closeResultSheet() {
  const sheet = document.getElementById('resultSheet');
  if (sheet) sheet.classList.add('hidden');
  state.currentResult = null;
}

function renderDynamicActionButtons(container, result) {
  // Copy payload/text
  const copyBtn = document.createElement('button');
  copyBtn.className = 'btn btn-secondary';
  copyBtn.innerHTML = '📋 Copy Details';
  copyBtn.onclick = () => {
    let copyText = '';
    if (result.data.raw) copyText = result.data.raw;
    else if (result.data.rawOcr) copyText = result.data.rawOcr;
    else if (result.data.card) copyText = `${result.data.card.network} ${result.data.card.maskedNumber}`;
    else if (result.data.mrz) copyText = `${result.data.mrz.fullName} (${result.data.mrz.docType})`;
    else copyText = `${result.title} - ${result.subtitle}`;

    navigator.clipboard.writeText(copyText).then(() => {
      showToast('Copied to clipboard');
    }).catch(() => showToast('Failed to copy'));
  };
  container.appendChild(copyBtn);

  // Open URL (safe link with confirmation)
  if (result.data?.analysis?.url) {
    const openBtn = document.createElement('button');
    openBtn.className = 'btn btn-primary';
    openBtn.innerHTML = '🌐 Open Link';
    openBtn.onclick = () => {
      const url = result.data.analysis.url;
      if (confirm(`Open external destination?\n\n${url}`)) {
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    };
    container.appendChild(openBtn);
  }

  // Export Receipt to CSV
  if (result.data?.receipt) {
    const csvBtn = document.createElement('button');
    csvBtn.className = 'btn btn-outline';
    csvBtn.innerHTML = '📊 Export Receipt CSV';
    csvBtn.onclick = () => {
      const csv = exportReceiptToCSV(result.data.receipt);
      downloadTextFile(csv, `receipt_${Date.now()}.csv`, 'text/csv');
      showToast('CSV downloaded');
    };
    container.appendChild(csvBtn);
  }

  // Research Web links
  if (result.data?.researchLinks && result.data.researchLinks.length > 0) {
    const searchBtn = document.createElement('button');
    searchBtn.className = 'btn btn-outline';
    searchBtn.innerHTML = '🔍 Search Info on Web';
    searchBtn.onclick = () => {
      window.open(result.data.researchLinks[0].url, '_blank', 'noopener,noreferrer');
    };
    container.appendChild(searchBtn);
  }

  // Share action (native navigator.share if available)
  if (navigator.share) {
    const shareBtn = document.createElement('button');
    shareBtn.className = 'btn btn-secondary';
    shareBtn.innerHTML = '📤 Share';
    shareBtn.onclick = () => {
      navigator.share({
        title: result.title,
        text: `${result.title}\n${result.subtitle}\n${result.data.raw || ''}`
      }).catch(() => {});
    };
    container.appendChild(shareBtn);
  }
}

// --- GENERATOR TAB (QR & BARCODE) ---
function initGenerator() {
  const genTypeRadios = document.querySelectorAll('input[name="genMode"]');
  genTypeRadios.forEach(radio => {
    radio.addEventListener('change', (e) => {
      state.generatorType = e.target.value;
      const qrSection = document.getElementById('qrConfigSection');
      const barcodeSection = document.getElementById('barcodeConfigSection');
      if (qrSection && barcodeSection) {
        qrSection.classList.toggle('hidden', state.generatorType !== 'qr');
        barcodeSection.classList.toggle('hidden', state.generatorType !== 'barcode');
      }
      renderGeneratedCode();
    });
  });

  // QR Content Type buttons
  const qrTypeButtons = document.querySelectorAll('.gen-type-btn');
  qrTypeButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      qrTypeButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.qrContentType = btn.dataset.type;
      renderGeneratorFormFields(state.qrContentType);
      renderGeneratedCode();
    });
  });

  renderGeneratorFormFields('text');

  // Color inputs
  const fgInput = document.getElementById('genFgColor');
  const bgInput = document.getElementById('genBgColor');
  if (fgInput && bgInput) {
    const onColorChange = () => {
      const fg = fgInput.value;
      const bg = bgInput.value;
      const contrast = validateQRContrast(fg, bg);
      const warnEl = document.getElementById('contrastWarning');
      if (warnEl) {
        if (!contrast.isReliable && contrast.warning) {
          warnEl.textContent = contrast.warning;
          warnEl.classList.remove('hidden');
        } else {
          warnEl.classList.add('hidden');
        }
      }
      renderGeneratedCode();
    };
    fgInput.addEventListener('input', onColorChange);
    bgInput.addEventListener('input', onColorChange);
  }

  // Linear Barcode format selector
  const barcodeFormatSelect = document.getElementById('barcodeFormatSelect');
  if (barcodeFormatSelect) {
    barcodeFormatSelect.addEventListener('change', (e) => {
      state.barcodeFormat = e.target.value;
      renderGeneratedCode();
    });
  }

  const barcodeInput = document.getElementById('barcodeTextInput');
  if (barcodeInput) {
    barcodeInput.addEventListener('input', () => renderGeneratedCode());
  }

  // Download and Print buttons
  const downloadBtn = document.getElementById('btnDownloadCode');
  if (downloadBtn) {
    downloadBtn.addEventListener('click', () => downloadGeneratedCode());
  }

  const printBtn = document.getElementById('btnPrintCode');
  if (printBtn) {
    printBtn.addEventListener('click', () => printGeneratedCode());
  }
}

function renderGeneratorFormFields(type) {
  const container = document.getElementById('genFormInputs');
  if (!container) return;

  const forms = {
    text: `<div class="form-group"><label class="form-label">Plain Text</label><textarea class="form-input" id="genInput1" rows="3" placeholder="Enter text...">Hello AllScan Universal!</textarea></div>`,
    url: `<div class="form-group"><label class="form-label">Website URL</label><input type="url" class="form-input" id="genInput1" value="https://example.com" placeholder="https://..."></div>`,
    wifi: `<div class="form-group"><label class="form-label">Network Name (SSID)</label><input type="text" class="form-input" id="genInput1" value="HomeWiFi"><label class="form-label" style="margin-top:8px;">Password</label><input type="text" class="form-input" id="genInput2" value="SecretPassword123"><label class="form-label" style="margin-top:8px;">Security</label><select class="form-input" id="genInput3"><option value="WPA">WPA / WPA2 / WPA3</option><option value="WEP">WEP</option><option value="nopass">Open</option></select></div>`,
    email: `<div class="form-group"><label class="form-label">Email Address</label><input type="email" class="form-input" id="genInput1" value="hello@example.com"><label class="form-label" style="margin-top:8px;">Subject</label><input type="text" class="form-input" id="genInput2" value="Universal Scanner Inquiry"></div>`,
    phone: `<div class="form-group"><label class="form-label">Phone Number</label><input type="tel" class="form-input" id="genInput1" value="+1234567890"></div>`,
    vcard: `<div class="form-group"><label class="form-label">Full Name</label><input type="text" class="form-input" id="genInput1" value="Jane Doe"><label class="form-label" style="margin-top:8px;">Telephone</label><input type="tel" class="form-input" id="genInput2" value="+1555123456"><label class="form-label" style="margin-top:8px;">Email</label><input type="email" class="form-input" id="genInput3" value="jane@doe.com"></div>`
  };

  container.innerHTML = forms[type] || forms.text;
  const inputs = container.querySelectorAll('input, textarea, select');
  inputs.forEach(input => input.addEventListener('input', () => renderGeneratedCode()));
}

function getGeneratorPayload() {
  const v1 = document.getElementById('genInput1')?.value || '';
  const v2 = document.getElementById('genInput2')?.value || '';
  const v3 = document.getElementById('genInput3')?.value || '';

  if (state.generatorType === 'barcode') {
    return document.getElementById('barcodeTextInput')?.value || '123456789012';
  }

  switch (state.qrContentType) {
    case 'text': return v1;
    case 'url': return v1;
    case 'wifi': return v1 ? `WIFI:T:${v3 || 'WPA'};S:${v1};P:${v2};;` : '';
    case 'email': return v1 ? `mailto:${v1}${v2 ? `?subject=${encodeURIComponent(v2)}` : ''}` : '';
    case 'phone': return v1 ? `tel:${v1}` : '';
    case 'vcard':
      if (!v1) return '';
      return `BEGIN:VCARD\nVERSION:3.0\nFN:${v1}\nTEL:${v2}\nEMAIL:${v3}\nEND:VCARD`;
    default: return v1;
  }
}

function renderGeneratedCode() {
  const preview = document.getElementById('codePreviewBox');
  if (!preview) return;
  preview.innerHTML = '';

  const payload = getGeneratorPayload();
  if (!payload) {
    preview.innerHTML = '<span style="color:var(--text-muted);">Enter content above to generate code</span>';
    return;
  }

  const fg = document.getElementById('genFgColor')?.value || '#000000';
  const bg = document.getElementById('genBgColor')?.value || '#FFFFFF';

  if (state.generatorType === 'barcode') {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.id = 'generatedBarcodeSvg';
    preview.appendChild(svg);
    generateLinearBarcode(svg, payload, state.barcodeFormat, { fgColor: fg, bgColor: bg })
      .catch(err => {
        preview.innerHTML = `<span style="color:var(--danger); font-size:12px;">Invalid barcode format or length for ${state.barcodeFormat}</span>`;
      });
  } else {
    // QR Code
    if (window.QRCode) {
      new window.QRCode(preview, {
        text: payload,
        width: 220,
        height: 220,
        colorDark: fg,
        colorLight: bg,
        correctLevel: window.QRCode.CorrectLevel.H
      });
    }
  }
}

function downloadGeneratedCode() {
  const canvas = document.querySelector('#codePreviewBox canvas');
  const img = document.querySelector('#codePreviewBox img');
  const svg = document.querySelector('#codePreviewBox svg');

  if (svg) {
    const svgData = new XMLSerializer().serializeToString(svg);
    const blob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `barcode_${Date.now()}.svg`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Barcode SVG downloaded');
    return;
  }

  if (canvas || img) {
    const url = canvas ? canvas.toDataURL('image/png') : img.src;
    const a = document.createElement('a');
    a.href = url;
    a.download = `qrcode_${Date.now()}.png`;
    a.click();
    showToast('QR Code PNG downloaded');
  }
}

function printGeneratedCode() {
  window.print();
}

// --- TOOLS TAB ---
function initToolsTab() {
  const toolsFileInput = document.getElementById('toolsFileInput');
  if (toolsFileInput) {
    toolsFileInput.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (file) loadToolsImage(file);
    });
  }

  const btnRotate = document.getElementById('btnToolRotate');
  if (btnRotate) {
    btnRotate.addEventListener('click', () => {
      if (!state.toolsImageCanvas) return;
      state.toolsImageCanvas = rotateCanvas(state.toolsImageCanvas, 90);
      renderToolsCanvas();
    });
  }

  const btnContrast = document.getElementById('btnToolContrast');
  if (btnContrast) {
    btnContrast.addEventListener('click', () => {
      if (!state.toolsImageCanvas) return;
      state.toolsImageCanvas = enhanceDocumentImage(state.toolsImageCanvas, 1.4);
      renderToolsCanvas();
      showToast('Contrast enhancement applied');
    });
  }

  const btnRunToolOcr = document.getElementById('btnToolRunOCR');
  if (btnRunToolOcr) {
    btnRunToolOcr.addEventListener('click', async () => {
      if (!state.toolsImageCanvas) {
        showToast('Please upload or load a document image first');
        return;
      }
      showProcessingIndicator('Running high-resolution OCR...');
      try {
        const res = await runOCR(state.toolsImageCanvas, {}, p => showProcessingIndicator(p.status));
        hideProcessingIndicator();
        const output = document.getElementById('toolOcrOutput');
        if (output) output.value = res.text;

        // Check if text is a receipt
        const receipt = parseReceipt(res.text);
        const receiptBox = document.getElementById('toolReceiptSummary');
        if (receiptBox) {
          if (receipt && receipt.lineItems.length > 0) {
            receiptBox.classList.remove('hidden');
            receiptBox.innerHTML = `
              <strong>Parsed Receipt:</strong> ${receipt.merchant} (${receipt.date})<br>
              <strong>Items Found:</strong> ${receipt.itemsCount} | <strong>Total:</strong> ${receipt.currency}${receipt.total.toFixed(2)}<br>
              <small>Arithmetic Status: ${receipt.arithmeticConfidence}</small>
            `;
          } else {
            receiptBox.classList.add('hidden');
          }
        }
      } catch (err) {
        hideProcessingIndicator();
        showToast('OCR failed. Check network or image quality.');
      }
    });
  }

  // Load Synthetic MRZ Test button
  const btnSyntheticMrz = document.getElementById('btnLoadSampleMrz');
  if (btnSyntheticMrz) {
    btnSyntheticMrz.addEventListener('click', () => {
      const sample = [
        'P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<',
        'L898902C36UTO7408122F1204159ZE184226B<<<<<10'
      ];
      const parsed = parseMRZ(sample);
      const display = document.getElementById('toolMrzOutput');
      if (display && parsed) {
        display.innerHTML = `
          <strong>Passport Holder:</strong> ${parsed.fullName}<br>
          <strong>Issuing Country:</strong> ${parsed.issuingState} | <strong>Nationality:</strong> ${parsed.nationality}<br>
          <strong>Masked Document #:</strong> ${parsed.documentNumberMasked}<br>
          <strong>Birth Date:</strong> ${parsed.dateOfBirth} | <strong>Sex:</strong> ${parsed.sex}<br>
          <strong>Expiry:</strong> ${parsed.expiryDate} (${parsed.isExpired ? 'Expired' : 'Valid'})<br>
          <strong>Checksums:</strong> ${parsed.validation.allChecksPass ? 'All 4 Checksums Valid' : 'Checksum Failed'}
        `;
        display.classList.remove('hidden');
      }
    });
  }
}

function loadToolsImage(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0);
      state.toolsImageCanvas = c;
      renderToolsCanvas();
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function renderToolsCanvas() {
  const container = document.getElementById('toolsCanvasContainer');
  if (!container || !state.toolsImageCanvas) return;
  container.innerHTML = '';
  const img = new Image();
  img.src = state.toolsImageCanvas.toDataURL('image/jpeg', 0.85);
  img.className = 'tools-preview-img';
  container.appendChild(img);
}

// --- HISTORY TAB ---
function initHistoryTab() {
  const searchInput = document.getElementById('historySearchInput');
  if (searchInput) {
    searchInput.addEventListener('input', () => renderHistory());
  }

  const filterChips = document.querySelectorAll('.history-filter-chip');
  filterChips.forEach(chip => {
    chip.addEventListener('click', () => {
      filterChips.forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      renderHistory();
    });
  });

  const clearBtn = document.getElementById('btnClearHistory');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      if (confirm('Permanently clear all scan history from this browser?')) {
        clearAllHistory();
        renderHistory();
        showToast('Scan history cleared');
      }
    });
  }

  const exportCsvBtn = document.getElementById('btnExportHistoryCsv');
  if (exportCsvBtn) {
    exportCsvBtn.addEventListener('click', () => {
      const csv = exportHistoryCSV();
      downloadTextFile(csv, `allscan_history_${Date.now()}.csv`, 'text/csv');
      showToast('History CSV exported');
    });
  }

  const exportJsonBtn = document.getElementById('btnExportHistoryJson');
  if (exportJsonBtn) {
    exportJsonBtn.addEventListener('click', () => {
      const json = exportHistoryJSON();
      downloadTextFile(json, `allscan_history_${Date.now()}.json`, 'application/json');
      showToast('History JSON exported');
    });
  }
}

function renderHistory() {
  const listContainer = document.getElementById('historyListContainer');
  if (!listContainer) return;

  const searchQuery = document.getElementById('historySearchInput')?.value.toLowerCase() || '';
  const activeChip = document.querySelector('.history-filter-chip.active')?.dataset.type || 'all';

  const history = getHistory();
  const filtered = history.filter(item => {
    if (activeChip !== 'all') {
      const type = item.primaryType.toLowerCase();
      if (!type.includes(activeChip)) return false;
    }
    if (searchQuery) {
      const text = `${item.title} ${item.subtitle} ${item.primaryType}`.toLowerCase();
      if (!text.includes(searchQuery)) return false;
    }
    return true;
  });

  if (filtered.length === 0) {
    listContainer.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📭</div>
        <div class="empty-title">No Scan Records</div>
        <div class="empty-text">Your scans are stored privately on this device.</div>
      </div>
    `;
    return;
  }

  listContainer.innerHTML = '';
  filtered.forEach(item => {
    const card = document.createElement('div');
    card.className = 'history-item-card';

    const dateStr = new Date(item.timestamp).toLocaleDateString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    card.innerHTML = `
      <div class="history-item-header">
        <span class="history-item-type">${item.primaryType}</span>
        <span class="history-item-date">${dateStr}</span>
      </div>
      <div class="history-item-title">${item.title}</div>
      <div class="history-item-subtitle">${item.subtitle}</div>
      <div class="history-item-actions">
        <button class="btn btn-sm btn-outline" data-action="view">View</button>
        <button class="btn btn-sm btn-ghost" data-action="delete" title="Delete">🗑</button>
      </div>
    `;

    card.querySelector('[data-action="view"]').onclick = () => {
      displayScanResult(item, null);
    };

    card.querySelector('[data-action="delete"]').onclick = () => {
      deleteHistoryItem(item.id);
      renderHistory();
      showToast('Item deleted');
    };

    listContainer.appendChild(card);
  });
}

// --- SETTINGS TAB ---
function initSettingsTab() {
  const lowPowerToggle = document.getElementById('toggleLowPower');
  if (lowPowerToggle) {
    lowPowerToggle.addEventListener('change', (e) => {
      state.lowPowerMode = e.target.checked;
      localStorage.setItem('allscan_low_power', state.lowPowerMode ? 'true' : 'false');
      showToast(state.lowPowerMode ? 'Low-Power Mode Enabled (5 FPS)' : 'Standard Performance Enabled');
    });
  }

  const btnPreloadModel = document.getElementById('btnPreloadMobileNet');
  if (btnPreloadModel) {
    btnPreloadModel.addEventListener('click', async () => {
      showProcessingIndicator('Downloading MobileNet model weights (~9MB)...');
      try {
        await getMobileNetModel((p) => showProcessingIndicator(p.status));
        hideProcessingIndicator();
        showToast('MobileNet model downloaded and cached in memory!');
        updateSettingsDisplay();
      } catch (err) {
        hideProcessingIndicator();
        showToast('Download failed. Please check internet connection.');
      }
    });
  }
}

function loadSavedSettings() {
  const lowPower = localStorage.getItem('allscan_low_power') === 'true';
  state.lowPowerMode = lowPower;
  const toggle = document.getElementById('toggleLowPower');
  if (toggle) toggle.checked = lowPower;
}

function updateSettingsDisplay() {
  const mobilenetStatus = document.getElementById('settingsMobilenetStatus');
  if (mobilenetStatus) {
    mobilenetStatus.textContent = isMobileNetLoaded() ? 'Cached in Memory (Ready)' : 'Not Loaded (Loads on-demand)';
  }

  const history = getHistory();
  const historyCount = document.getElementById('settingsHistoryCount');
  if (historyCount) {
    historyCount.textContent = `${history.length} scans stored locally`;
  }
}

// --- UI HELPERS ---
function showProcessingIndicator(message = 'Processing...') {
  const modal = document.getElementById('processingIndicatorModal');
  const text = document.getElementById('processingIndicatorText');
  if (modal && text) {
    text.textContent = message;
    modal.classList.remove('hidden');
  }
}

function hideProcessingIndicator() {
  const modal = document.getElementById('processingIndicatorModal');
  if (modal) modal.classList.add('hidden');
}

export function showToast(msg) {
  const old = document.querySelector('.toast');
  if (old) old.remove();

  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}

function downloadTextFile(content, filename, mimeType = 'text/plain') {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
