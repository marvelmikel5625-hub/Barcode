/**
 * URL and Payload Safety Validator
 * Analyzes scanned QR/barcode payloads for safety, homograph attacks,
 * protocols, and structured schemas (Wi-Fi, vCard, Mailto, Tel, Geo).
 */

export function analyzePayload(rawText) {
  if (!rawText || typeof rawText !== 'string') {
    return {
      category: 'Unknown',
      displayTitle: 'Empty Payload',
      safeToOpen: false,
      details: {}
    };
  }

  const trimmed = rawText.trim();

  // 1. Wi-Fi Configuration
  if (trimmed.startsWith('WIFI:')) {
    return parseWifiPayload(trimmed);
  }

  // 2. vCard Contact
  if (trimmed.startsWith('BEGIN:VCARD')) {
    return parseVcardPayload(trimmed);
  }

  // 3. Email (mailto: or raw email)
  if (trimmed.toLowerCase().startsWith('mailto:') || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return parseEmailPayload(trimmed);
  }

  // 4. Telephone / SMS
  if (trimmed.toLowerCase().startsWith('tel:') || trimmed.toLowerCase().startsWith('sms:')) {
    return parseTelPayload(trimmed);
  }

  // 5. Geographic location (geo:)
  if (trimmed.toLowerCase().startsWith('geo:')) {
    return parseGeoPayload(trimmed);
  }

  // 6. Web URL (http:// or https://)
  if (/^https?:\/\//i.test(trimmed)) {
    return parseUrlPayload(trimmed);
  }

  // 7. Domain without scheme (e.g. "www.example.com" or "example.org/path")
  if (/^(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(?:\/[^\s]*)?$/.test(trimmed)) {
    return parseUrlPayload(`https://${trimmed}`);
  }

  // 8. Plain Text / Serial Number / Raw Data
  return {
    category: 'Text',
    displayTitle: 'Plain Text / Data',
    content: trimmed,
    safeToOpen: false,
    safetyRating: 'Safe (Local Data)',
    details: {
      length: trimmed.length,
      lines: trimmed.split('\n').length
    }
  };
}

function parseUrlPayload(urlString) {
  try {
    const url = new URL(urlString);
    const hostname = url.hostname.toLowerCase();
    const isHttps = url.protocol === 'https:';

    // Check for IP address hostname
    const isIpHost = /^(\d{1,3}\.){3}\d{1,3}$/.test(hostname) || hostname.startsWith('[') || hostname.includes(':');

    // Check for Punycode / IDN
    const isPunycode = hostname.includes('xn--');

    // Suspicious extensions
    const pathname = url.pathname.toLowerCase();
    const suspiciousExt = /\.(exe|apk|bat|cmd|scr|msi|dmg|vbs|ps1|sh)$/i.test(pathname);

    let safetyRating = 'Standard Web Link';
    let safetyNotice = 'Standard encrypted web link. Click to visit destination.';
    let riskLevel = 'low';

    if (suspiciousExt) {
      safetyRating = 'High Caution: Direct Executable Download';
      safetyNotice = 'This link points to an executable file download. Verify source before opening.';
      riskLevel = 'high';
    } else if (isPunycode) {
      safetyRating = 'Caution: Internationalized Domain (Punycode)';
      safetyNotice = 'This link uses special internationalized characters which could resemble other domain names.';
      riskLevel = 'medium';
    } else if (isIpHost) {
      safetyRating = 'Caution: Direct IP Address';
      safetyNotice = 'This link uses a raw numerical IP address instead of a standard domain name.';
      riskLevel = 'medium';
    } else if (!isHttps) {
      safetyRating = 'Warning: Unencrypted HTTP';
      safetyNotice = 'This link is not encrypted (http instead of https). Data in transit could be monitored.';
      riskLevel = 'medium';
    }

    return {
      category: 'URL',
      displayTitle: hostname,
      url: url.href,
      protocol: url.protocol,
      hostname: hostname,
      pathname: url.pathname,
      search: url.search,
      isHttps,
      riskLevel,
      safetyRating,
      safetyNotice,
      safeToOpen: riskLevel !== 'high'
    };
  } catch (err) {
    return {
      category: 'Malformed URL',
      displayTitle: 'Invalid Link Format',
      content: urlString,
      safeToOpen: false,
      riskLevel: 'high',
      safetyRating: 'Invalid Link',
      safetyNotice: 'Could not parse as a standard web URL.'
    };
  }
}

function parseWifiPayload(raw) {
  // Format: WIFI:T:WPA;S:NetworkName;P:Password;H:true;;
  const extract = (key) => {
    const match = raw.match(new RegExp(`${key}:([^;]*);`));
    return match ? match[1] : '';
  };

  const ssid = extract('S');
  const type = extract('T') || 'WPA';
  const pass = extract('P');
  const hidden = extract('H') === 'true';

  return {
    category: 'Wi-Fi',
    displayTitle: `Wi-Fi: ${ssid || 'Unknown Network'}`,
    ssid,
    authType: type,
    hasPassword: Boolean(pass),
    maskedPassword: pass ? '••••••••' : '(None / Open)',
    rawPassword: pass,
    isHidden: hidden,
    safetyRating: 'Network Configuration',
    safetyNotice: 'Credentials are kept local on your device.',
    safeToOpen: false
  };
}

function parseVcardPayload(raw) {
  const getField = (tag) => {
    const m = raw.match(new RegExp(`(?:^|\\n)${tag}[^:]*:(.*)`, 'i'));
    return m ? m[1].trim() : '';
  };

  const fullName = getField('FN') || getField('N');
  const phone = getField('TEL');
  const email = getField('EMAIL');
  const org = getField('ORG');
  const url = getField('URL');

  return {
    category: 'Contact (vCard)',
    displayTitle: fullName || 'Contact Card',
    fullName,
    phone,
    email,
    org,
    url,
    safetyRating: 'Contact Information',
    safetyNotice: 'Local contact card payload.',
    safeToOpen: false
  };
}

function parseEmailPayload(raw) {
  let to = raw;
  let subject = '';
  let body = '';

  if (raw.toLowerCase().startsWith('mailto:')) {
    try {
      const u = new URL(raw);
      to = u.pathname;
      subject = u.searchParams.get('subject') || '';
      body = u.searchParams.get('body') || '';
    } catch {
      to = raw.replace(/^mailto:/i, '');
    }
  }

  return {
    category: 'Email',
    displayTitle: `Email to: ${to}`,
    to,
    subject,
    body,
    safetyRating: 'Email Draft',
    safeToOpen: true
  };
}

function parseTelPayload(raw) {
  const num = raw.replace(/^(?:tel|sms):/i, '');
  return {
    category: raw.toLowerCase().startsWith('sms') ? 'SMS' : 'Phone Call',
    displayTitle: `Phone: ${num}`,
    number: num,
    safetyRating: 'Telephone Number',
    safeToOpen: true
  };
}

function parseGeoPayload(raw) {
  // geo:37.7749,-122.4194
  const coords = raw.replace(/^geo:/i, '').split(';')[0];
  const [lat, lng] = coords.split(',');
  return {
    category: 'Location',
    displayTitle: `Coordinates: ${lat}, ${lng}`,
    latitude: lat,
    longitude: lng,
    mapLink: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${lat},${lng}`)}`,
    safetyRating: 'Geographic Location',
    safeToOpen: true
  };
}
