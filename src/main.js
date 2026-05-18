// --- TRACKING LOGIC ---
function calculateCheckDigit(digits) {
  if (digits.length !== 8) return 0;
  const weights = [8, 6, 4, 2, 3, 5, 9, 7];
  let sum = 0;
  for (let i = 0; i < 8; i++) sum += parseInt(digits[i]) * weights[i];
  const remainder = sum % 11;
  if (remainder === 0) return 5;
  if (remainder === 1) return 0;
  return 11 - remainder;
}

function formatTrackingNumber(prefix, digits, checkDigit) {
  const allDigits = digits + checkDigit.toString();
  return `${prefix.toUpperCase()} ${allDigits.substring(0, 4)} ${allDigits.substring(4, 8)} ${allDigits.substring(8, 9)} TH`;
}

function parseTracking(t) {
    if (!t) return { prefix: '', num: 0, full: '' };
    const clean = t.replace(/\s+/g, '');
    const match = clean.match(/^([A-Z]{2})(\d{8})(\d)([A-Z]{2})$/);
    if (match) return { prefix: match[1], num: parseInt(match[2]), full: clean };
    const simpleMatch = clean.match(/^([A-Z]+)(\d+)([A-Z]*)$/);
    if (simpleMatch) return { prefix: simpleMatch[1], num: parseInt(simpleMatch[2]), full: clean };
    return { prefix: clean, num: 0, full: clean };
}

// --- DB LOGIC (IndexedDB) ---
const DB_NAME = 'ThaiPostManifestDB';
const DB_VERSION = 2; // Incremented for archives store

function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains('data')) {
                db.createObjectStore('data');
            }
            if (!db.objectStoreNames.contains('archives')) {
                const archiveStore = db.createObjectStore('archives', { keyPath: 'id' });
                archiveStore.createIndex('date', 'date', { unique: false });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function saveToDB(key, val) {
    const db = await initDB();
    return new Promise((resolve) => {
        const tx = db.transaction('data', 'readwrite');
        tx.objectStore('data').put(val, key);
        tx.oncomplete = () => resolve();
    });
}

async function loadFromDB(key) {
    const db = await initDB();
    return new Promise((resolve) => {
        const tx = db.transaction('data', 'readonly');
        const req = tx.objectStore('data').get(key);
        req.onsuccess = () => resolve(req.result);
    });
}

async function saveArchive(archive) {
    const db = await initDB();
    return new Promise((resolve) => {
        const tx = db.transaction('archives', 'readwrite');
        tx.objectStore('archives').put(archive);
        tx.oncomplete = () => resolve();
    });
}

async function loadArchivesByMonth(monthStr) {
    const db = await initDB();
    return new Promise((resolve) => {
        const tx = db.transaction('archives', 'readonly');
        const store = tx.objectStore('archives');
        const index = store.index('date');
        
        // monthStr is "YYYY-MM"
        // range from "YYYY-MM-01" to "YYYY-MM-31T..."
        const range = IDBKeyRange.bound(monthStr + "-01T00:00:00.000Z", monthStr + "-31T23:59:59.999Z");
        const req = index.getAll(range);
        req.onsuccess = () => resolve(req.result || []);
    });
}

async function loadAllArchives() {
    const db = await initDB();
    return new Promise((resolve) => {
        const tx = db.transaction('archives', 'readonly');
        const req = tx.objectStore('archives').getAll();
        req.onsuccess = () => resolve(req.result || []);
    });
}

async function loadArchive(id) {
    const db = await initDB();
    return new Promise((resolve) => {
        const tx = db.transaction('archives', 'readonly');
        const req = tx.objectStore('archives').get(id);
        req.onsuccess = () => resolve(req.result);
    });
}

// --- PRICING DATA ---
const rates = {
  EMS: { tiers: [
    [20, 32], [100, 37], [250, 42], [500, 52], [1000, 67], [1500, 82], [2000, 97], [2500, 100], [3000, 105], [3500, 110], 
    [4000, 120], [4500, 120], [5000, 120], [5500, 130], [6000, 140], [6500, 150], [7000, 160], [7500, 170], [8000, 180], [8500, 190], 
    [9000, 200], [9500, 210], [10000, 220], [11000, 230], [12000, 240], [13000, 250], [14000, 260], [15000, 270], [16000, 280], [17000, 290], 
    [18000, 300], [19000, 310], [20000, 320], [21000, 330], [22000, 340], [23000, 350], [24000, 360], [25000, 380], [26000, 400], [27000, 420], 
    [28000, 440], [29000, 460], [30000, 480]
  ], ar: 12 },
  REG_ENVELOPE: { tiers: [[10, 18], [20, 19], [100, 24], [250, 30], [500, 36], [1000, 53], [2000, 75]], ar: 3 },
  REG_BOX: { tiers: [[500, 49], [1000, 60], [2000, 77]], ar: 3 },
  ECO: { tiers: [[20, 20], [100, 22], [250, 26], [500, 30], [1000, 40], [2000, 60], [4000, 80], [6000, 120], [10000, 160]], ar: 3 },
  PARCEL: { base: 25, baseWeight: 1000, perKg: 20, ar: 3 }
};

// --- SPECIAL EMS PRICING ---
const specialEmsTiers = [
    [1000, 17], [2000, 27], [3000, 37], [4000, 47], [5000, 57], [6000, 67], [7000, 77], [8000, 87], [9000, 97], [10000, 107],
    [11000, 112], [12000, 117], [13000, 122], [14000, 127], [15000, 132], [16000, 137], [17000, 142], [18000, 147], [19000, 152], [20000, 157], [30000, 157]
];

const SPECIAL_EMS_OFFSETS = {
    'A1': 0, 'A2': 1, 'A3': 2, 'A4': 3, 'A5': 4, 'A6': 5, 'A7': 6, 'A8': 7, 'A9': 8, 'A10': 9, 'A11': 11, 'A12': 13
};

function isSpecialEmsActive() {
    if (!settings.specialEmsEnabled) return false;
    const licenseVal = (settings.license || '').trim();
    const hasThp = /THP-/i.test(licenseVal);
    
    if (settings.paymentType === 'เงินสด') {
        return hasThp;
    } else if (settings.paymentType === 'เงินเชื่อ') {
        const cleanLicense = licenseVal.replace(/THP-\d+/gi, '').replace(/THP-/gi, '').trim();
        return hasThp && cleanLicense.length > 0;
    }
    return false;
}

function calculateSpecialEmsFee(weight, packageName = 'A12') {
    let baseA1 = 17;
    for (let [tier, price] of specialEmsTiers) {
        if (weight <= tier) {
            baseA1 = price;
            break;
        }
        baseA1 = price;
    }
    
    if (weight > 30000) {
        const extraKg = Math.ceil((weight - 30000) / 1000);
        baseA1 += extraKg * 15;
    }
    
    const offset = SPECIAL_EMS_OFFSETS[packageName] || 0;
    return baseA1 + offset;
}

const REMOTE_AREAS = {
    "20120": 1, "20150": 2, "21160": 3, "23000": 4, "23120": 5, "23170": 6, "50250": 7, "50310": 7, "50350": 7,
    "55130": 8, "55220": 8, "57170": 9, "57180": 9, "57260": 9, "57310": 9, "57340": 9, "58000": 10, "58110": 10,
    "58120": 10, "58130": 10, "58140": 10, "58150": 10, "63150": 11, "63170": 11, "71180": 12, "71240": 12,
    "81130": 13, "81150": 14, "81210": 15, "82000": 16, "82160": 17, "83000": 18, "83100": 18, "83110": 18,
    "83120": 18, "83130": 18, "83150": 18, "84140": 19, "84310": 19, "84320": 19, "84330": 19, "84220": 20,
    "84280": 22, "84360": 23, "85000": 24, "91000": 25, "91110": 27, "92110": 29, "92120": 31,
    "94000": 32, "94110": 32, "94120": 32, "94130": 32, "94140": 32, "94150": 32, "94160": 32, "94170": 32,
    "94180": 32, "94190": 32, "94220": 32, "94230": 32, "95000": 33, "95110": 33, "95120": 33, "95130": 33,
    "95140": 33, "95150": 33, "95160": 33, "95170": 33, "96000": 34, "96110": 34, "96120": 34, "96130": 34,
    "96140": 34, "96150": 34, "96160": 34, "96170": 34, "96180": 34, "96190": 34, "96210": 34, "96220": 34
};

const PARTIAL_REMOTE_ZIPS = ["20150", "21160", "23000", "23120", "81130", "81210", "82000", "84220", "85000", "91000", "91110", "92110", "92120"];

// --- APP STATE ---
let shipments = [];
let history = [];
let historyIndex = 0;
let currentServiceTab = 'EMS';
let settings = { company: '', address: '', phone: '', license: '', fuelSurcharge: true, paymentType: 'เงินสด', defaultPrefixes: {}, showSignatureNames: false, responsibleName: '', senderName: '', logo: null, logoWidth: 150, logoAlign: 'left', postOffice: 'ไปรษณีย์กลาง 10501', meterDescending: 0, meterAscending: 0, homeZip: '', specialEmsEnabled: false, specialEmsPackage: 'A12' };
let editingArchiveId = null;
let currentView = 'dashboard';
let currentWeightUnit = 'g';
let bulkBackup = { ar: null, ins: null, 'ar-track': null };

const prefixInput = document.getElementById('prefix');
const prefixDropdownToggle = document.getElementById('prefix-dropdown-toggle');
const prefixDropdownList = document.getElementById('prefix-dropdown-list');
const savePrefixBtn = document.getElementById('save-prefix-btn');
const deletePrefixBtn = document.getElementById('delete-prefix-btn');
const prefixHelpText = document.getElementById('prefix-help-text');
const digitsInput = document.getElementById('digits');
const digitsEndInput = document.getElementById('digits-end');
const batchCountInput = document.getElementById('batch-count');
const bulkToggle = document.getElementById('bulk-mode-toggle');
const bulkInputsGroup = document.getElementById('bulk-inputs');
const num8StartInput = document.getElementById('num8-start');
const num8Counter = document.getElementById('num8-counter');
const num8Warn = document.getElementById('num8-warn');
const singleTrackingGroup = document.getElementById('single-tracking-group');

const recipientInput = document.getElementById('recipient');
const destInput = document.getElementById('destination');
const customServiceGroup = document.getElementById('custom-service-group');
const customServiceNameInput = document.getElementById('custom-service-name');
const customServiceManualInput = document.getElementById('custom-service-manual');
const weightInput = document.getElementById('weight');
const feeInput = document.getElementById('fee');
const feeUnitLabel = document.getElementById('fee-unit-label');
const shipmentList = document.getElementById('shipment-list');

const optAR = document.getElementById('opt-ar');
const optInsurance = document.getElementById('opt-insurance');
const insuranceVal = document.getElementById('insurance-val');
const optRemote = document.getElementById('is-remote-check');

const addBtn = document.getElementById('add-btn');
const undoBtn = document.getElementById('undo-btn');
const redoBtn = document.getElementById('redo-btn');
const printBtn = document.getElementById('print-btn');
const dispatchBtn = document.getElementById('dispatch-btn');
const nextNumBtn = document.getElementById('next-num-btn');
const serviceTitle = document.getElementById('service-title');

// Settings Elements
const settingsBtn = document.getElementById('settings-btn');
const settingsModal = document.getElementById('settings-modal');
const saveSettingsBtn = document.getElementById('save-settings-btn');
const closeSettingsBtn = document.getElementById('close-settings-btn');

const setSpecialEmsEnabled = document.getElementById('set-special-ems-enabled');
const setSpecialEmsPackage = document.getElementById('set-special-ems-package');
const adminSpecialEmsFields = document.getElementById('admin-special-ems-fields');
const adminSettingsSection = document.getElementById('admin-settings-section');
const appVersionTrigger = document.getElementById('app-version-trigger');
const specialEmsBadge = document.getElementById('special-ems-badge');
const specialEmsPkgName = document.getElementById('special-ems-pkg-name');

// Nav & Views
const navDashboard = document.getElementById('nav-dashboard');
const navArchive = document.getElementById('nav-archive');
const viewDashboard = document.getElementById('view-dashboard');
const viewArchive = document.getElementById('view-archive');

// Archive Elements
const reportMonthInput = document.getElementById('report-month');
const archiveList = document.getElementById('archive-list');
const exportCsvBtn = document.getElementById('export-csv-btn');

// NEW Elements
const regTypeGroup = document.getElementById('reg-type-group');
const regTypeInput = document.getElementById('reg-type');
const emsDimGroup = document.getElementById('ems-dim-group');
const loadingOverlay = document.getElementById('loading-overlay');
const dimW = document.getElementById('dim-w');
const dimL = document.getElementById('dim-l');
const dimH = document.getElementById('dim-h');
const jumboBadge = document.getElementById('jumbo-badge');
const volumetricWeightStatus = document.getElementById('volumetric-weight-status');
const setFuelSurcharge = document.getElementById('set-fuel-surcharge');
const optArTracking = document.getElementById('opt-ar-tracking');
const optArTrackingRow = document.getElementById('opt-ar-tracking-row');
const optInsuranceRow = document.getElementById('opt-insurance-row');
const optArRow = document.getElementById('opt-ar-row');

// --- HELPERS ---
const THAI_NUM_MAP = {
    'ๅ': '1', '/': '2', '-': '3', 'ภ': '4', 'ถ': '5', 'ุ': '6', 'ึ': '7', 'ค': '8', 'ต': '9', 'จ': '0',
    '๑': '1', '๒': '2', '๓': '3', '๔': '4', '๕': '5', '๖': '6', '๗': '7', '๘': '8', '๙': '9', '๐': '0',
    '๏': '0', '๚': '1', '๛': '2' // Uncommon but possible
};

function sanitizeNumeric(val, allowDecimal = false) {
    let result = '';
    for (let char of val) {
        result += THAI_NUM_MAP[char] || char;
    }
    if (allowDecimal) {
        return result.replace(/[^0-9.]/g, '').replace(/(\..*?)\..*/g, '$1');
    }
    return result.replace(/\D/g, '');
}
function getServiceType(p) {
  if (currentServiceTab === 'CUSTOM') return 'CUSTOM';
  p = p.toUpperCase();
  if (p.startsWith('E')) return 'EMS';
  if (p.startsWith('R')) return 'REG';
  if (p.startsWith('P')) return 'PARCEL';
  if (p.startsWith('O')) return 'ECO';
  return 'EMS';
}

function calculateBaseFee(type, weight, options = {}) {
    let baseFee = 0;
    if (type === 'CUSTOM') return parseFloat(feeInput.value) || 0; 
    
    if (type === 'EMS' && isSpecialEmsActive()) {
        const pkg = settings.specialEmsPackage || 'A12';
        baseFee = calculateSpecialEmsFee(weight, pkg);
    } else if (type === 'PARCEL') {
        baseFee = rates.PARCEL.base;
        if (weight > rates.PARCEL.baseWeight) {
            baseFee += Math.ceil((weight - rates.PARCEL.baseWeight) / 1000) * rates.PARCEL.perKg;
        }
    } else {
        let actualType = type;
        if (type === 'REG') {
            actualType = (options.regType === 'BOX') ? 'REG_BOX' : 'REG_ENVELOPE';
        }
        
        const serviceTable = rates[actualType];
        if (serviceTable && serviceTable.tiers) {
            for (let [tier, price] of serviceTable.tiers) {
                if (weight <= tier) {
                    baseFee = price;
                    break;
                }
                baseFee = price;
            }
        }
    }
    
    // Advice of Receipt (AR) logic
    if (options.ar || options.arTracking) {
        if (type === 'EMS') {
            baseFee += 12;
        } else if (type === 'REG') {
            baseFee += options.arTracking ? 8 : 3;
        } else if (type === 'PARCEL' || type === 'ECO') {
            baseFee += 3;
        }
    }
    
    if (options.insurance && type === 'EMS') {
        const v = parseFloat(options.insuranceVal) || 0;
        // Insurance must be between 2,100 and 50,000
        if (v >= 2100) {
            if (v <= 20000) {
                // Formula: 15 (Handling) + (5 THB per 500 THB of value)
                baseFee += 15 + Math.ceil(v / 500) * 5;
            } else {
                // Formula: 215 (Base for 20k) + (10 THB per 500 THB of remaining value)
                const cappedV = Math.min(v, 50000);
                baseFee += 215 + Math.ceil((cappedV - 20000) / 500) * 10;
            }
        }
    }
    
    // Remote Area Surcharge (+20 THB) - v5.1.0
    if (options.isRemote) {
        baseFee += 20;
    }

    return baseFee;
}

function isRemoteArea(zip) {
    return !!REMOTE_AREAS[zip];
}

function isEMSGroup(shipment) {
    const svc = shipment.serviceType;
    if (svc === 'EMS') return true;
    if (svc === 'CUSTOM' && shipment.customServiceName && shipment.customServiceName.toUpperCase().includes('EMS')) return true;
    return false;
}

async function updateHistory() {
  if (historyIndex < history.length - 1) history = history.slice(0, historyIndex + 1);
  history.push(JSON.parse(JSON.stringify(shipments)));
  historyIndex++;
  if (history.length > 50) { history.shift(); historyIndex--; }
  
  await saveToDB('shipments', shipments);
  await saveToDB('history', history);
  await saveToDB('historyIndex', historyIndex);
  await saveToDB('editingArchiveId', editingArchiveId);
  updateHistoryButtons();
  
  // If we are editing, change the dispatch button text to indicate update
  if (editingArchiveId) {
      dispatchBtn.innerHTML = '💾 บันทึกการแก้ไข (Update)';
      dispatchBtn.style.background = '#10b981';
  } else {
      dispatchBtn.innerHTML = '✅ ปิดยอดและพิมพ์ใบสรุป';
      dispatchBtn.style.background = '#10b981';
  }
}

function updateHistoryButtons() {
  undoBtn.disabled = historyIndex === 0;
  redoBtn.disabled = historyIndex === history.length - 1;
  undoBtn.style.opacity = undoBtn.disabled ? '0.5' : '1';
  redoBtn.style.opacity = redoBtn.disabled ? '0.5' : '1';
}

function updateSummary() {
  const filtered = shipments.filter(s => s.serviceType === currentServiceTab);
  
  const totalItems = filtered.length;
  const totalFee = filtered.reduce((s, x) => s + (parseFloat(x.fee) || 0), 0);
  
  document.getElementById('total-items').textContent = totalItems.toLocaleString();
  document.getElementById('total-fee').textContent = totalFee.toLocaleString() + ' บาท';

  ['EMS', 'REG', 'ECO', 'PARCEL', 'CUSTOM'].forEach(svc => {
      const count = shipments.filter(s => s.serviceType === svc).length;
      const counterEl = document.getElementById(`count-${svc.toLowerCase()}`);
      if(counterEl) counterEl.textContent = count;
  });
  
  updateMeterStatus();
}

function updateMeterStatus() {
    const isMeter = settings.paymentType === 'เครื่องประทับไปรษณียากร';
    const statusBar = document.getElementById('meter-status-bar');
    const descVal = document.getElementById('meter-descending-val');
    const lowWarn = document.getElementById('meter-low-warn');
    
    if (isMeter) {
        statusBar.classList.remove('hidden');
        descVal.textContent = (settings.meterDescending || 0).toLocaleString();
        lowWarn.style.display = (settings.meterDescending < 1000) ? 'block' : 'none';
    } else {
        statusBar.classList.add('hidden');
    }
}

function renderShipments() {
  shipmentList.innerHTML = '';

  const filtered = shipments.map((s, originalIdx) => ({ ...s, originalIdx }))
                           .filter(s => s.serviceType === currentServiceTab);

  let prevPrefix = null;
  let prevNum = null;
  let prevStep = 1;

  filtered.forEach((s, displayIdx) => {
    const i = s.originalIdx;
    const trackData = parseTracking(s.trackingFormatted);
    let isNewGroup = false;

    if (trackData) {
        if (prevPrefix !== null) {
            // Check for prefix change or gap based on PREVIOUS item's step
            if (trackData.prefix !== prevPrefix || trackData.num !== prevNum + prevStep) {
                isNewGroup = true;
            }
        }
        prevPrefix = trackData.prefix;
        prevNum = trackData.num;
        
        // Determine step for the NEXT item
        prevStep = 1;
        if (s.serviceType === 'EMS' && s.options?.ar) prevStep = 2;
        else if (s.serviceType === 'REG' && s.options?.arTracking) prevStep = 2;
    }

    const displayTracking = (!isNewGroup) ? s.trackingFormatted : `<u>${s.trackingFormatted.substring(0, 2)}</u>${s.trackingFormatted.substring(2)}`;

    const zipMatch = s.destination.match(/\d{5}/);
    const zip = zipMatch ? zipMatch[0] : null;
    const isAlwaysRemote = zip && !!REMOTE_AREAS[zip] && !PARTIAL_REMOTE_ZIPS.includes(zip);
    const isIslandPotential = zip && PARTIAL_REMOTE_ZIPS.includes(zip);
    const isActuallyRemote = isAlwaysRemote || (isIslandPotential && s.isIsland);

    const isRemoteActive = s.options?.isRemote || isActuallyRemote;
    const base = calculateBaseFee(s.serviceType, s.weight, s.options || {});
    const isPriceNormalWithSurcharge = (!isActuallyRemote && !s.options?.isRemote && (parseFloat(s.fee) === base + 20));
    const priceClass = (isPriceNormalWithSurcharge && s.serviceType !== 'CUSTOM') ? 'price-warn' : '';

    const svcDisplay = s.serviceType === 'CUSTOM' ? (s.customServiceName || 'กำหนดเอง') : s.serviceType;

      const isVolWeight = s.options?.useVolWeight && s.options?.dimensions;
      const volWeightTitle = isVolWeight ? `title="น้ำหนักคิดจากปริมาตร: กว้าง ${s.options.dimensions.w} * ยาว ${s.options.dimensions.l} * สูง ${s.options.dimensions.h} ซม."` : '';
      const volWeightStyle = isVolWeight ? 'font-weight: 800; text-decoration: underline dotted; cursor: help; color: #1e3a8a;' : '';

      const tr = document.createElement('tr');
      tr.innerHTML = `
      <td>${displayIdx + 1}</td>
      <td class="editable-cell" contenteditable="true" data-field="recipient" data-index="${i}" data-placeholder="ระบุผู้รับ...">${s.recipient || ''}</td>
      <td class="editable-cell" data-index="${i}">
        <div contenteditable="true" data-field="destination" data-index="${i}" data-placeholder="ระบุปลายทาง..." style="outline:none; width: 100%;">
            ${highlightPostcode(s.destination, isRemoteActive)}
        </div>
      </td>
      <td class="editable-cell tracking-cell" contenteditable="true" data-field="trackingFormatted" data-index="${i}" style="font-weight: 600; white-space: pre; outline: none;">${displayTracking}</td>
      <td class="services-cell">
        <div style="display: flex; gap: 8px; flex-wrap: nowrap; justify-content: center;">
            <label class="svc-mini" title="ตอบรับ (AR)"><input type="checkbox" ${s.options?.ar ? 'checked' : ''} onchange="toggleRowService(${i}, 'ar', this.checked)"> AR</label>
            ${s.serviceType === 'REG' ? `<label class="svc-mini" title="ตอบรับ Tracking (8 บาท)"><input type="checkbox" ${s.options?.arTracking ? 'checked' : ''} onchange="toggleRowService(${i}, 'arTracking', this.checked)"> AR Track</label>` : ''}
            ${s.serviceType === 'EMS' ? `
                <div style="display: flex; align-items: center; gap: 4px;">
                    <label class="svc-mini" title="ประกัน"><input type="checkbox" ${s.options?.insurance ? 'checked' : ''} onchange="toggleRowService(${i}, 'insurance', this.checked)"> 🛡️</label>
                    ${s.options?.insurance ? `<input type="text" class="mini-input ${ (s.options.insuranceVal > 50000) ? 'error-input' : '' }" style="width: 60px; font-size: 0.75rem; padding: 2px;" value="${(parseFloat(s.options.insuranceVal) || 0).toLocaleString()}" oninput="this.value = sanitizeNumeric(this.value); updateRowInsuranceVal(${i}, this.value)" onblur="validateRowInsurance(${i}, this)">` : ''}
                </div>
            ` : ''}
            ${(s.serviceType !== 'PARCEL' && s.serviceType !== 'REG' && s.destination.includes('เกาะ')) ? `<label class="svc-mini" title="พื้นที่ห่างไกล"><input type="checkbox" ${s.options?.isRemote ? 'checked' : ''} onchange="toggleRowService(${i}, 'isRemote', this.checked)"> 🏝️</label>` : ''}
        </div>
      </td>
      <td class="editable-cell" contenteditable="true" data-field="weight" data-index="${i}" style="${volWeightStyle}" ${volWeightTitle}>${parseFloat(s.weight) > 0 ? parseFloat(s.weight).toLocaleString() : ''}</td>
      <td class="editable-cell ${priceClass}" contenteditable="true" data-field="fee" data-index="${i}" title="${priceClass ? 'พื้นที่ปกติ แต่มีการบวกเพิ่ม 20 บาท?' : ''}">${(parseFloat(s.weight) > 0 || s.serviceType === 'CUSTOM') ? parseFloat(s.fee).toLocaleString() : ''}</td>
      <td contenteditable="false"><button class="btn-icon delete-btn" data-index="${i}">ลบ</button></td>
    `;
    shipmentList.appendChild(tr);
  });

  document.querySelectorAll('.delete-btn').forEach(btn => {
    btn.onclick = async (e) => {
      const idx = e.currentTarget.dataset.index;
      shipments.splice(idx, 1);
      await updateHistory();
      renderShipments();
      updateSummary();
    };
  });

  document.querySelectorAll('.editable-cell[contenteditable="true"]').forEach(cell => {
    cell.oninput = async (e) => {
        const field = e.target.dataset.field;
        const idx = e.target.dataset.index;
        let val = e.target.innerText.replace(' บาท', '').trim();
        
        if (field === 'weight' || field === 'fee') {
            const sanitized = sanitizeNumeric(val, field === 'fee');
            if (val !== sanitized) {
                // Save cursor position
                const selection = window.getSelection();
                const range = selection.getRangeAt(0);
                const offset = range.startOffset;
                
                e.target.innerText = sanitized;
                val = sanitized;
                
                // Restore cursor (simple approach)
                try {
                    const newRange = document.createRange();
                    newRange.setStart(e.target.childNodes[0], Math.min(offset, sanitized.length));
                    newRange.collapse(true);
                    selection.removeAllRanges();
                    selection.addRange(newRange);
                } catch(err) {}
            }
        }
        shipments[idx][field] = val;
    };
    
    cell.onkeydown = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            e.target.blur();
        }
    };

    cell.onblur = async (e) => {
        const field = e.target.dataset.field;
        const idx = e.target.dataset.index;
        const s = shipments[idx];
        
        let needsRender = false;
        if ((field === 'fee' || field === 'weight') && s.serviceType !== 'CUSTOM') {
            const oldFee = s.fee;
            
            // If weight was changed, recalculate fee first
            if (field === 'weight') {
                const w = parseFloat(s.weight) || 0;
                const base = calculateBaseFee(s.serviceType, w, s.options || {});
                let total = base;
                if (s.options?.isRemote) total += 20;
                if (settings.fuelSurcharge && (s.serviceType === 'EMS' || s.serviceType === 'ECO')) total += 3;
                s.fee = total;
            }
            
            applySmartPricing(idx);
            if (s.fee !== oldFee) needsRender = true;
        } else if (field === 'destination') {
            if (s.serviceType !== 'CUSTOM') applySmartPricing(idx);
            needsRender = true;
        } else if (field === 'trackingFormatted') {
            let raw = (s.trackingFormatted || '').replace(/\s+/g, '').toUpperCase();
            const match = raw.match(/^([A-Z]{2})(\d{8})(\d)([A-Z]{2})$/);
            if (match) {
                s.trackingFormatted = formatTrackingNumber(match[1], match[2], match[3]);
            } else {
                const simpleMatch = raw.match(/^([A-Z]{2})(\d{8})([A-Z]{2})$/);
                if (simpleMatch) {
                    const cd = calculateCheckDigit(simpleMatch[2]);
                    s.trackingFormatted = formatTrackingNumber(simpleMatch[1], simpleMatch[2], cd);
                }
            }
            
            const promptVal = prompt(
                "ต้องการให้ระบบจัดลำดับเลขพัสดุของรายการถัดๆ ไปโดยอัตโนมัติด้วยหรือไม่ เพื่อป้องกันการใช้เลขซ้ำ?\n\n" +
                "• กด 'ตกลง' (OK) เพื่อจัดลำดับใหม่ทั้งหมดจนถึงรายการสุดท้าย\n" +
                "• พิมพ์ตัวเลข (เช่น 5) เพื่อจัดลำดับเฉพาะ 5 รายการถัดไป\n" +
                "• กด 'ยกเลิก' (Cancel) เพื่อแก้ไขเฉพาะรายการนี้รายการเดียว",
                ""
            );
            if (promptVal !== null) {
                const limit = parseInt(promptVal.trim());
                recalculateTabSequencesFrom(s.serviceType, parseInt(idx), isNaN(limit) ? null : limit);
            }
            needsRender = true;
        }
        
        updateSummary();
        await updateHistory();
        if (needsRender) renderShipments();
    }
  });
}

function highlightPostcode(text, isRemote) {
    if (!text) return '';
    return text.replace(/(\d{5})/, (match) => {
        return isRemote ? `<strong>${match}</strong>` : match;
    });
}

function recalculateTabSequencesFrom(tab, startOriginalIdx, countLimit = null) {
    const filtered = shipments.map((s, originalIdx) => ({ ...s, originalIdx }))
                             .filter(s => s.serviceType === tab);
    
    const startIndex = filtered.findIndex(item => item.originalIdx === startOriginalIdx);
    if (startIndex === -1 || startIndex >= filtered.length) return;
    
    let currentItem = filtered[startIndex];
    let trackData = parseTracking(currentItem.trackingFormatted);
    if (!trackData || !trackData.prefix) return;
    
    let prevPrefix = trackData.prefix;
    let prevNum = trackData.num;
    let prevStep = (currentItem.serviceType === 'EMS' && currentItem.options?.ar) ? 2 
                 : (currentItem.serviceType === 'REG' && currentItem.options?.arTracking) ? 2 
                 : 1;
                 
    let endIdx = filtered.length;
    if (countLimit !== null && countLimit > 0) {
        endIdx = Math.min(startIndex + 1 + countLimit, filtered.length);
    }
                 
    for (let j = startIndex + 1; j < endIdx; j++) {
        const item = filtered[j];
        const nextNum = prevNum + prevStep;
        const numStr = nextNum.toString().padStart(8, '0');
        const cd = calculateCheckDigit(numStr);
        const newTracking = formatTrackingNumber(prevPrefix, numStr, cd);
        
        shipments[item.originalIdx].trackingFormatted = newTracking;
        
        prevNum = nextNum;
        prevStep = (item.serviceType === 'EMS' && item.options?.ar) ? 2 
                 : (item.serviceType === 'REG' && item.options?.arTracking) ? 2 
                 : 1;
    }
}

window.toggleRowService = async (i, serviceType, checked) => {
    const s = shipments[i];
    if (!s.options) s.options = {};
    
    let isARChange = false;
    if (serviceType === 'ar') {
        s.options.ar = checked;
        if (checked) s.options.arTracking = false;
        isARChange = true;
    } else if (serviceType === 'arTracking') {
        s.options.arTracking = checked;
        if (checked) s.options.ar = false;
        isARChange = true;
    } else if (serviceType === 'insurance') {
        if (checked) {
            let currentVal = s.options.insuranceVal || 2000;
            if (currentVal < 2000) {
                const inputVal = prompt("ระบุจำนวนเงินรับประกัน (2,000 - 50,000 บาท):", "2000");
                const parsed = parseFloat(sanitizeNumeric(inputVal || ""));
                if (!inputVal || isNaN(parsed) || parsed < 2000) {
                    alert("จำเป็นต้องระบุจำนวนเงินรับประกันเพื่อใช้บริการนี้ (ขั้นต่ำ 2,000 บาท)");
                    renderShipments();
                    return;
                }
                currentVal = parsed;
            }
            s.options.insurance = true;
            s.options.insuranceVal = currentVal;
        } else {
            s.options.insurance = false;
        }
    } else if (serviceType === 'isRemote') {
        s.options.isRemote = checked;
    }
    
    // Recalculate fee
    const base = calculateBaseFee(s.serviceType, s.weight, s.options);
    let total = base;
    if (s.options.isRemote) total += 20;
    if (settings.fuelSurcharge && (s.serviceType === 'EMS' || s.serviceType === 'ECO')) total += 3;
    
    // Store metadata for bolding in manifest
    s.isVolumetric = !!s.useVolWeight;
    s.isRemoteBold = !!s.optRemote;
    
    s.fee = total;
    
    if (isARChange) {
        const msg = checked
            ? "⚠️ เมื่อเปิดใช้งานบริการตอบรับ รายการนี้จะใช้เลขพัสดุถัดไปด้วยสำหรับใบตอบรับ (รวมเป็น 2 เลข)\n\n" +
              "ต้องการให้ระบบจัดลำดับเลขพัสดุของรายการถัดๆ ไปในตารางใหม่โดยอัตโนมัติ เพื่อไม่ให้มีการใช้เลขซ้ำกันหรือไม่?\n\n" +
              "• กด 'ตกลง' (OK) เพื่อจัดลำดับใหม่ทั้งหมดจนถึงรายการสุดท้าย\n" +
              "• พิมพ์ตัวเลข (เช่น 5) เพื่อจัดลำดับเฉพาะ 5 รายการถัดไป\n" +
              "• กด 'ยกเลิก' (Cancel) เพื่อปล่อยแถวอื่นไว้เหมือนเดิม"
            : "⚠️ เมื่อปิดใช้งานบริการตอบรับ รายการนี้จะเปลี่ยนกลับมาใช้เลขเดี่ยว\n\n" +
              "ต้องการให้ระบบจัดลำดับเลขพัสดุของรายการถัดๆ ไปในตารางใหม่โดยอัตโนมัติ เพื่อกระชับคิวเลขพัสดุหรือไม่?\n\n" +
              "• กด 'ตกลง' (OK) เพื่อจัดลำดับใหม่ทั้งหมดจนถึงรายการสุดท้าย\n" +
              "• พิมพ์ตัวเลข (เช่น 5) เพื่อจัดลำดับเฉพาะ 5 รายการถัดไป\n" +
              "• กด 'ยกเลิก' (Cancel) เพื่อปล่อยแถวอื่นไว้เหมือนเดิม";
              
        const promptVal = prompt(msg, "");
        if (promptVal !== null) {
            const limit = parseInt(promptVal.trim());
            recalculateTabSequencesFrom(s.serviceType, i, isNaN(limit) ? null : limit);
        }
    }
    
    renderShipments();
    updateSummary();
    await updateHistory();
};

window.updateRowInsuranceVal = async (i, val) => {
    const s = shipments[i];
    const parsed = parseFloat(val.toString().replace(/,/g, '')) || 0;
    s.options.insuranceVal = parsed;
    
    // Recalculate fee
    const base = calculateBaseFee(s.serviceType, s.weight, s.options);
    let total = base;
    if (s.options.isRemote) total += 20;
    if (settings.fuelSurcharge && (s.serviceType === 'EMS' || s.serviceType === 'ECO')) total += 3;
    s.fee = total;

    updateSummary();
    await updateHistory();
    // No full render here to avoid losing focus while typing
    const feeCell = document.querySelector(`td.editable-cell[data-field="fee"][data-index="${i}"]`);
    if (feeCell) feeCell.innerText = parseFloat(total).toLocaleString();

    // Highlight input if exceeds limit
    const input = document.querySelector(`tr td input.mini-input[oninput*="updateRowInsuranceVal(${i},"]`);
    if (input) {
        if (parsed > 50000) {
            input.classList.add('error-input');
            input.title = "⚠️ วงเงินรับประกันสูงสุดไม่เกิน 50,000 บาท";
        } else {
            input.classList.remove('error-input');
            input.title = "";
        }
    }
};

window.validateRowInsurance = (i, input) => {
    const val = parseFloat(input.value.replace(/,/g, '')) || 0;
    if (val > 50000) {
        alert('⚠️ วงเงินรับประกันสูงสุดคือ 50,000 บาท ระบบจะปรับยอดเป็น 50,000 ให้อัตโนมัติ');
        input.value = "50,000";
        updateRowInsuranceVal(i, 50000);
    } else {
        input.value = val.toLocaleString();
        updateRowInsuranceVal(i, val);
    }
};

function applySmartPricing(i) {
    const s = shipments[i];
    if(s.serviceType === 'CUSTOM') return;
    
    const zipMatch = s.destination.match(/\d{5}/);
    const zip = zipMatch ? zipMatch[0] : null;
    const hasIslandText = s.destination.includes('เกาะ');
    const canHaveRemote = (s.serviceType !== 'PARCEL' && s.serviceType !== 'REG' && s.serviceType !== 'CUSTOM');
    const isActuallyRemote = zip && isRemoteArea(zip, s.isIsland || hasIslandText) && canHaveRemote && hasIslandText;
    const base = calculateBaseFee(s.serviceType, s.weight, s.options || {});
    const currentFee = parseFloat(s.fee);

    if (isActuallyRemote && currentFee === base) {
        s.fee = base + 20;
    }
}

window.toggleRemoteSurcharge = () => {
    optRemote.checked = !optRemote.checked;
    window.isManualRemoteOverride = true;
    updatePreview();
};

function updatePreview() {
  const rawW = parseFloat(weightInput.value) || 0;
  const w = (currentWeightUnit === 'kg') ? Math.round(rawW * 1000) : rawW;
  
  // Show/Hide sub-type groups based on active tab (currentServiceTab)
  const activeSvc = currentServiceTab;
  const selectedCustomSvc = customServiceNameInput.value;
  const isOrdinary = activeSvc === 'CUSTOM' && (selectedCustomSvc === 'จดหมาย ในประเทศ' || selectedCustomSvc === 'สิ่งพิมพ์ ในประเทศ');

  const bulkOrdinaryPanel = document.getElementById('bulk-ordinary-panel');
  const prefixContainerGroup = document.getElementById('prefix-container-group');
  const bulkToggleGroup = document.getElementById('bulk-toggle-group');
  const weightGroup = document.getElementById('weight-group');
  const feeGroup = document.getElementById('fee-group');
  const singleTrackingGroup = document.getElementById('single-tracking-group');
  const bulkInputs = document.getElementById('bulk-inputs');
  const optionsGroup = document.querySelector('.options-group');
  const singleOnlyEls = document.querySelectorAll('.single-only');

  if (isOrdinary) {
      if (bulkOrdinaryPanel) bulkOrdinaryPanel.style.display = 'flex';
      if (prefixContainerGroup) prefixContainerGroup.style.display = 'none';
      if (bulkToggleGroup) bulkToggleGroup.style.display = 'none';
      if (singleTrackingGroup) singleTrackingGroup.style.display = 'none';
      if (bulkInputs) bulkInputs.style.display = 'none';
      singleOnlyEls.forEach(el => el.style.display = 'none');
      if (weightGroup) weightGroup.style.display = 'none';
      if (optionsGroup) optionsGroup.style.display = 'none';
      if (feeGroup) feeGroup.style.display = 'none';
  } else {
      if (bulkOrdinaryPanel) bulkOrdinaryPanel.style.display = 'none';
      if (prefixContainerGroup) prefixContainerGroup.style.display = 'flex';
      if (bulkToggleGroup) bulkToggleGroup.style.display = '';
      if (bulkToggle.checked) {
          if (singleTrackingGroup) singleTrackingGroup.style.display = 'none';
          if (bulkInputs) bulkInputs.style.display = 'block';
          singleOnlyEls.forEach(el => el.style.display = 'none');
      } else {
          if (singleTrackingGroup) singleTrackingGroup.style.display = 'block';
          if (bulkInputs) bulkInputs.style.display = 'none';
          singleOnlyEls.forEach(el => el.style.display = 'block');
      }
      if (weightGroup) weightGroup.style.display = '';
      if (optionsGroup) optionsGroup.style.display = '';
      if (feeGroup) feeGroup.style.display = '';
  }

  regTypeGroup.style.display = (activeSvc === 'REG') ? 'block' : 'none';
  emsDimGroup.style.display = (activeSvc === 'EMS') ? 'block' : 'none';
  
  // Insurance row MUST show for EMS always
  if (optInsuranceRow) {
      optInsuranceRow.style.display = (activeSvc === 'EMS') ? 'flex' : 'none';
  }
  
  if (optArTrackingRow) {
      optArTrackingRow.style.display = (activeSvc === 'REG') ? 'flex' : 'none';
  }
  
  // Rule: Parcel and REG do not have remote surcharge
  const canHaveRemote = (activeSvc !== 'PARCEL' && activeSvc !== 'REG' && activeSvc !== 'CUSTOM');
  const destinationZip = destInput.value.match(/\d{5}/);
  const zip = destinationZip ? destinationZip[0] : null;
  const badge = document.getElementById('remote-status-badge');
  
  // Track zip changes to reset manual override
  const group = zip ? REMOTE_AREAS[zip] : null;
  const homeGroup = settings.homeZip ? REMOTE_AREAS[settings.homeZip] : null;
  const isRemoteAreaZip = !!group;
  const sameGroup = group && homeGroup && group === homeGroup;

  const remoteStatusBadge = document.getElementById('remote-status-badge');
  const remoteCheckContainer = document.getElementById('remote-check-container');
  const remoteLabelHint = document.getElementById('remote-label-hint');
  
  if (zip !== window.lastZipForRemote || !window.isManualRemoteOverride) {
      if (zip !== window.lastZipForRemote) {
          window.isManualRemoteOverride = false;
          window.lastZipForRemote = zip;
      }
      
      // Auto-set if it's a remote area and NOT same group
      if (isRemoteAreaZip && !sameGroup) {
          const isIsland = PARTIAL_REMOTE_ZIPS.includes(zip);
          if (isIsland && ((activeSvc === 'EMS' && settings.excludeIslandEMS) || (activeSvc === 'ECO' && settings.excludeIslandEco))) {
              optRemote.checked = false;
          } else {
              optRemote.checked = true;
          }
      } else {
          optRemote.checked = false;
      }
  }

  if (isRemoteAreaZip && !sameGroup) {
      if (PARTIAL_REMOTE_ZIPS.includes(zip)) {
          // Partial remote (Island potential) -> Show checkbox (Auto-checked) and hide badge to avoid redundancy
          remoteCheckContainer.classList.remove('hidden');
          remoteLabelHint.textContent = '(เฉพาะพื้นที่ - ติ๊กออกหากไม่ใช่เกาะ)';
          remoteStatusBadge.classList.add('hidden');
      } else {
          // Clear remote area -> Hide checkbox, show badge instead
          remoteCheckContainer.classList.add('hidden');
          remoteStatusBadge.classList.remove('hidden');
          remoteStatusBadge.querySelector('.badge-text').textContent = 'บวกพื้นที่ห่างไกล (+20 บาท)';
      }
      
      // Secondary check: if it's partial and user unchecked it, badge should definitely be hidden
      if (!optRemote.checked) {
          remoteStatusBadge.classList.add('hidden');
      }
  } else {
      remoteCheckContainer.classList.add('hidden');
      remoteStatusBadge.classList.add('hidden');
  }

  // Fuel Surcharge Note
  const fuelBadge = document.getElementById('fuel-surcharge-badge');
  if (settings.fuelSurcharge && (activeSvc === 'EMS' || activeSvc === 'ECO')) {
      fuelBadge.classList.remove('hidden');
  } else {
      fuelBadge.classList.add('hidden');
  }

  // Insurance detail depends on both EMS tab and checkbox
  const isInsActive = optInsurance.checked && activeSvc === 'EMS';
  const insDetail = document.getElementById('insurance-detail');
  insDetail.style.display = isInsActive ? 'flex' : 'none';
  
  if (isInsActive) {
      const insV = parseFloat(insuranceVal.value) || 0;
      const insWarn = document.getElementById('ins-warn');
      
      if (insV < 2100 || insV > 50000) {
          insuranceVal.style.borderColor = '#ef4444';
          insuranceVal.style.backgroundColor = '#fef2f2';
          if (insWarn) insWarn.style.display = 'block';
      } else {
          insuranceVal.style.borderColor = '#86efac';
          insuranceVal.style.backgroundColor = 'white';
          if (insWarn) insWarn.style.display = 'none';
      }
  }

  let isLarge = false;
  let volWeight = 0;
  let useVolWeight = false;
  let calcWeight = w;

  if (activeSvc === 'EMS') {
      const wDim = parseFloat(dimW.value) || 0;
      const lDim = parseFloat(dimL.value) || 0;
      const hDim = parseFloat(dimH.value) || 0;
      const total = wDim + lDim + hDim;
      const maxSide = Math.max(wDim, lDim, hDim);
      
      // Large item logic: side > 60cm or sum > 120cm
      if (maxSide > 60 || total > 120) isLarge = true;
      jumboBadge.style.display = isLarge ? 'block' : 'none';

      // Volumetric weight calculation (W * L * H / 6 in grams)
      volWeight = Math.ceil((wDim * lDim * hDim) / 6);
      if (volWeight > w && volWeight > 0) {
          useVolWeight = true;
          calcWeight = volWeight;
          if (volumetricWeightStatus) volumetricWeightStatus.style.display = 'block';
      } else {
          if (volumetricWeightStatus) volumetricWeightStatus.style.display = 'none';
      }
      
      const volWarnBadge = document.getElementById('vol-warn-badge');
      if (volWarnBadge) {
          // Warning for both Actual weight and Volumetric weight exceeding 30kg
          volWarnBadge.style.display = (w > 30000 || volWeight > 30000) ? 'block' : 'none';
      }
      
      const dimLimitBadge = document.getElementById('dim-limit-badge');
      if (dimLimitBadge) {
          dimLimitBadge.style.display = (total > 240) ? 'block' : 'none';
      }
  } else {
      if (volumetricWeightStatus) volumetricWeightStatus.style.display = 'none';
  }

  if (activeSvc !== 'CUSTOM') {
      const base = calculateBaseFee(activeSvc, calcWeight, { 
        ar: optAR.checked, 
        arTracking: optArTracking.checked,
        insurance: optInsurance.checked, 
        insuranceVal: parseFloat(insuranceVal.value),
        regType: regTypeInput.value
      });
      let total = base;
      if (optRemote.checked) total += 20;
      
      if (settings.fuelSurcharge && (activeSvc === 'EMS' || activeSvc === 'ECO')) {
          total += 3;
      }

      // Rule: If weight is 0 and it's not CUSTOM, fee is empty
      if (w === 0 && activeSvc !== 'CUSTOM') {
          feeInput.value = '';
          feeInput.style.color = '#888';
      } else {
          feeInput.value = total;
          feeInput.style.color = 'inherit';
      }
  }

  // Toggle Special EMS Badge
  if (specialEmsBadge && specialEmsPkgName) {
      if (activeSvc === 'EMS' && isSpecialEmsActive() && w > 0) {
          specialEmsBadge.style.display = 'block';
          specialEmsPkgName.textContent = settings.specialEmsPackage || 'A12';
      } else {
          specialEmsBadge.style.display = 'none';
      }
  }

  let isWeightOverLimit = false;
  if (activeSvc === 'REG' && calcWeight > 2000) {
      isWeightOverLimit = true;
  } else if (activeSvc === 'ECO' && calcWeight > 10000) {
      isWeightOverLimit = true;
  } else if (activeSvc === 'PARCEL' && calcWeight > 20000) {
      isWeightOverLimit = true;
  } else if (activeSvc === 'EMS' && calcWeight > 30000) {
      isWeightOverLimit = true;
  } else if (activeSvc === 'CUSTOM' && calcWeight > 30000) {
      isWeightOverLimit = true;
  }

  if (isWeightOverLimit && w > 0) {
      weightInput.style.borderColor = '#ef4444';
      weightInput.style.backgroundColor = '#fef2f2';
  } else {
      weightInput.style.borderColor = '';
      weightInput.style.backgroundColor = '';
  }
}

function syncBatchInputs(source) {
    const inputEl = (bulkToggle && bulkToggle.checked) ? num8StartInput : digitsInput;
    let startStr = inputEl.value.replace(/\D/g, '');
    if (currentServiceTab === 'CUSTOM') startStr = inputEl.value;
    
    const startNum = parseInt(startStr);
    if (isNaN(startNum)) return;

    if (source === 'end') {
        let endStr = digitsEndInput.value.replace(/\D/g, '');
        if (currentServiceTab === 'CUSTOM') endStr = digitsEndInput.value;
        const endNum = parseInt(endStr);
        if (!isNaN(endNum) && endNum >= startNum) {
            batchCountInput.value = endNum - startNum + 1;
        }
    } else if (source === 'count') {
        let count = parseInt(batchCountInput.value);
        if (isNaN(count) || count < 1) {
            count = 1;
            batchCountInput.value = 1; // Sync UI to prevent showing 0 or empty
        }
        
        if (currentServiceTab === 'CUSTOM') {
             const match = inputEl.value.match(/(\d+)$/);
             if (match) {
                 const numLen = match[1].length;
                 const baseStr = inputEl.value.substring(0, match.index);
                 const endN = parseInt(match[1]) + count - 1;
                 digitsEndInput.value = baseStr + endN.toString().padStart(numLen, '0');
             } else {
                 digitsEndInput.value = inputEl.value; 
             }
        } else {
             digitsEndInput.value = (startNum + count - 1).toString().padStart(8, '0');
        }
    }
}

function generateShipmentNote(s) {
    const notes = [];
    
    // AR/AR Track logic: show last 4 digits + space + check digit instead of text
    if (s.options?.ar || s.options?.arTracking) {
        const track = s.trackingFormatted || '';
        // Match 4 digits, then 1 digit before TH
        const match = track.replace(/\s+/g, '').match(/(\d{4})(\d)TH$/);
        if (match) {
            notes.push(`${match[1]} ${match[2]}`);
        }
    }

    if (s.options?.insurance) notes.push(`🛡️ ${(parseFloat(s.options.insuranceVal)||0).toLocaleString()}`);
    if (s.serviceType === 'REG') {
        if (s.options?.regType === 'BOX') notes.push("หีบห่อ");
    }
    if (s.options?.isSpecialEms) {
        notes.push(`✨ ${s.options.specialEmsPackage || 'A12'}`);
    }
    return notes.join(", ");
}
function generateLogoHtml(show = true) {
    if (!settings.logo || !show) return '';
    let align = 'flex-start';
    if (settings.logoAlign === 'center') align = 'center';
    if (settings.logoAlign === 'right') align = 'flex-end';
    
    return `
        <div style="position: absolute; top: 2mm; left: 10mm; right: 10mm; display: flex; justify-content: ${align}; z-index: 100;">
            <img src="${settings.logo}" style="width: ${settings.logoWidth}px; max-height: 8mm; object-fit: contain;">
        </div>
    `;
}

function generateMeterLineHtml() {
    if (settings.paymentType !== 'เครื่องประทับไปรษณียากร') return '';
    return `
        <div style="margin-top: 2mm; border-top: 1px dashed #ccc; padding-top: 1mm; font-size: 10pt; display: flex; justify-content: space-between;">
            <div>เลขเครื่องประทับ: <b>${settings.license || ''}</b></div>
            <div style="display: flex; gap: 10mm;">
                <span>คงเหลือ: <b>${(settings.meterDescending || 0).toLocaleString()}</b> บาท</span>
                <span>สะสม: <b>${(settings.meterAscending || 0).toLocaleString()}</b> บาท</span>
            </div>
        </div>
    `;
}

// --- PRINTING LOGIC ---
function generatePrintPages(itemsToPrint, titleSuffix = "", copies = 1) {
    const ITEMS_PER_PAGE = 25;
    const totalPages = Math.ceil(itemsToPrint.length / ITEMS_PER_PAGE) || 1;
    let combinedHtml = '';

    // Pre-calculate decorations for all items to maintain consistency across pages
    let prevPrefixGlobal = null;
    let prevNumGlobal = null;
    let isIndentedGlobal = false;

    const itemsWithIndent = itemsToPrint.map(s => {
        const trackData = parseTracking(s.trackingFormatted);
        const isARTrack8 = (s.serviceType === 'REG' && s.options?.arTracking);
        
        if (trackData) {
            if (prevPrefixGlobal !== null) {
                let step = 1;
                if (s.serviceType === 'EMS' && s.options?.ar) step = 2;
                else if (s.serviceType === 'REG' && s.options?.arTracking) step = 2;

                if (trackData.prefix !== prevPrefixGlobal || trackData.num !== prevNumGlobal + step) {
                    isIndentedGlobal = !isIndentedGlobal;
                }
            }
            prevPrefixGlobal = trackData.prefix;
            prevNumGlobal = trackData.num;
        }
        
        const displayTracking = (!isIndentedGlobal) ? s.trackingFormatted : `<u>${s.trackingFormatted.substring(0, 2)}</u>${s.trackingFormatted.substring(2)}`;
        return { ...s, displayTracking };
    });
    
    const company = settings.company || '......................................';
    const phone = settings.phone || '......................................';
    const address = settings.address || '............................................................................';
    const license = settings.license || 'พ. ...... / 2569';
    
    for (let p = 0; p < totalPages; p++) {
        const pageItems = itemsWithIndent.slice(p * ITEMS_PER_PAGE, (p + 1) * ITEMS_PER_PAGE);
        let rowsHtml = '';
        
        for (let i = 0; i < ITEMS_PER_PAGE; i++) {
            if (i < pageItems.length) {
                const s = pageItems[i];
                
                const displayRecipient = s.recipient || '';
                const displayDestination = highlightPostcode(s.destination, s.options?.isRemote);
                const isWeightEmpty = !s.weight || s.weight == 0;
                
                const displayWeight = s.isOrdinaryBulk ? `*${s.unitFee}` : (isWeightEmpty ? '' : s.weight);
                const displayFee = s.isOrdinaryBulk ? (parseFloat(s.fee) || 0).toLocaleString() : (isWeightEmpty ? '' : parseFloat(s.fee).toLocaleString());
                const trackingCellContent = s.isOrdinaryBulk ? '' : s.displayTracking;
                
                rowsHtml += `
                    <tr style="height: 24px;">
                        <td style="padding: 1px 4px; text-align: center;">${p * ITEMS_PER_PAGE + i + 1}</td>
                        <td style="text-align: left; padding: 1px 4px;">${displayRecipient}</td>
                        <td style="text-align: left; padding: 1px 4px;">${displayDestination}</td>
                        <td style="padding: 1px 4px; text-align: left; font-weight: bold;">${trackingCellContent}</td>
                        <td style="padding: 1px 4px; text-align: center;">${s.isOrdinaryBulk ? displayWeight : (displayWeight ? parseFloat(displayWeight).toLocaleString() : '')}</td>
                        <td style="padding: 1px 4px; text-align: center;">${displayFee}</td>
                        <td style="padding: 1px 4px; font-size: 8pt; text-align: center;">${generateShipmentNote(s)}</td>
                    </tr>
                `;
            } else {
                rowsHtml += `<tr style="height: 24px;"><td style="padding: 1px 4px; text-align: center;">&nbsp;</td><td></td><td></td><td></td><td></td><td></td><td></td></tr>`;
            }
        }
        
        const pageTotalItems = pageItems.reduce((sum, item) => sum + (item.isOrdinaryBulk ? (parseInt(item.quantity) || 1) : 1), 0);
        const pageTotalFee = pageItems.reduce((sum, item) => sum + ((!item.weight || item.weight == 0) && !item.isOrdinaryBulk ? 0 : (parseFloat(item.fee) || 0)), 0);
        const grandTotalItems = itemsToPrint.reduce((sum, item) => sum + (item.isOrdinaryBulk ? (parseInt(item.quantity) || 1) : 1), 0);
        const grandTotalFee = itemsToPrint.reduce((sum, item) => sum + ((!item.weight || item.weight == 0) && !item.isOrdinaryBulk ? 0 : (parseFloat(item.fee) || 0)), 0);

        const pageHtml = `
            <div class="print-page">
                ${generateLogoHtml(true)}
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-top: 4mm; margin-bottom: 4px;">
                    <div style="line-height: 1.5;">
                        <div style="font-size: 11pt;">บริษัท <b>${company}</b></div>
                        <div style="font-size: 11pt;">โทรศัพท์ <b>${phone}</b></div>
                    </div>
                    <div style="text-align: right;">
                        <h2 style="margin: 0; font-size: 14pt;">ใบนำส่งสิ่งของทางไปรษณีย์ โดยชำระค่าบริการเป็น${settings.paymentType || 'เงินสด'}</h2>
                        ${titleSuffix ? `<div style="font-size: 12pt; font-weight: bold;">(${titleSuffix})</div>` : ''}
                        <div style="font-size: 11pt; margin-top: 5px;">วันที่ ........................................ ฝากส่งครั้งที่ ........... ใบที่ <b>${p + 1} / ${totalPages}</b></div>
                        <div style="font-size: 11pt;"><span style="font-weight: bold; font-size: 12pt;">${settings.postOffice || 'ไปรษณีย์กลาง 10501'}</span> ใบอนุญาตพิเศษที่ <b>${license}</b></div>
                    </div>
                </div>
                <div style="margin-bottom: 2px;">
                    <table style="width: 100%; border-collapse: collapse; text-align: center; font-size: 11pt; table-layout: fixed;" border="1">
                        <thead style="background: #f0f0f0;">
                            <tr>
                                <th style="padding: 6px; width: 40px; text-align: center;">ลำดับ</th>
                                <th style="padding: 6px; width: auto; text-align: center;">ผู้รับ</th>
                                <th style="padding: 6px; width: 100px; text-align: center;">ปลายทาง</th>
                                <th style="padding: 6px; width: 160px; text-align: center;">เลขที่สิ่งของ 13 หลัก</th>
                                <th style="padding: 6px; width: 70px; text-align: center;">น้ำหนัก<br>(กรัม)</th>
                                <th style="padding: 6px; width: 80px; text-align: center;">ค่าบริการ<br>(บาท)</th>
                                <th style="padding: 6px; width: 100px; text-align: center;">หมายเหตุ</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${rowsHtml}
                            ${totalPages > 1 ? `
                            <tr style="background: #fafafa; font-weight: bold;">
                                <td colspan="3" style="padding: 4px; text-align: right;">รวมหน้านี้</td>
                                <td style="padding: 4px;">${pageTotalItems} ชิ้น</td>
                                <td colspan="1"></td>
                                <td style="padding: 4px;">${pageTotalFee > 0 ? pageTotalFee.toLocaleString() + ' บาท' : ''}</td>
                                <td></td>
                            </tr>
                            ` : ''}
                            ${(p === totalPages - 1) ? `
                            <tr style="background: #f8fafc; font-weight: bold; border-top: 2px solid #000; font-size: 12pt;">
                                <td colspan="3" style="padding: 4px; text-align: right;">รวมทั้งสิ้น</td>
                                <td style="padding: 4px;">${grandTotalItems} ชิ้น</td>
                                <td colspan="1"></td>
                                <td style="padding: 4px; border-bottom: 3px double #000;">${grandTotalFee > 0 ? grandTotalFee.toLocaleString() + ' บาท' : ''}</td>
                                <td></td>
                            </tr>
                            ` : ''}
                        </tbody>
                    </table>
                </div>
                <div style="display: flex; justify-content: space-between; margin-top: 15px; font-size: 9pt; page-break-inside: avoid;">
                    <div style="width: 32%; text-align: center; border: 1px solid #eee; padding: 4px; border-radius: 4px;">
                        <div style="font-weight: bold; margin-bottom: 28px;">รับผิดชอบฝากส่ง</div>
                        <div style="margin-bottom: 3px;">.........................................</div>
                        <div>( ${settings.showSignatureNames ? (settings.responsibleName || '..............................') : '..............................'} )</div>
                    </div>
                    <div style="width: 32%; text-align: center; border: 1px solid #eee; padding: 4px; border-radius: 4px;">
                        <div style="font-weight: bold; margin-bottom: 28px;">ผู้นำส่ง</div>
                        <div style="margin-bottom: 3px;">.........................................</div>
                        <div>( ${settings.senderName || '..............................'} )</div>
                    </div>
                    <div style="width: 32%; text-align: center; border: 1px solid #eee; padding: 4px; border-radius: 4px;">
                        <div style="font-weight: bold; margin-bottom: 28px;">เจ้าหน้าที่รับฝาก</div>
                        <div style="margin-bottom: 3px;">.........................................</div>
                        <div style="font-weight: bold; font-size: 10pt;">${(settings.postOffice && settings.postOffice.trim()) ? settings.postOffice : 'ไปรษณีย์กลาง 10501'}</div>
                    </div>
                </div>
                ${generateMeterLineHtml()}
            </div>
        `;
        for (let c = 0; c < copies; c++) {
            combinedHtml += pageHtml;
        }
    }
    return combinedHtml;
}


function generateSummarySheet(items, titleSuffix, copies = 1) {
    const volWeightItems = items.filter(s => s.options?.dimensions && (s.options.dimensions.w || s.options.dimensions.l || s.options.dimensions.h));
    let qrCodeHtml = '';
    if (volWeightItems.length > 0) {
        const qrLines = volWeightItems.map(s => {
            const cleanTrack = s.trackingFormatted.replace(/\s+/g, '');
            const w = s.options.dimensions.w || 0;
            const l = s.options.dimensions.l || 0;
            const h = s.options.dimensions.h || 0;
            return `${cleanTrack}:${w}*${l}*${h}`;
        });
        const qrText = qrLines.join('\n');
        const onlineQrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(qrText)}`;
        const safeQrText = qrText.replace(/"/g, '&quot;').replace(/\n/g, '&#10;');
        
        let localQrDataUrl = '';
        if (typeof QRious !== 'undefined') {
            try {
                const qr = new QRious({
                    value: qrText,
                    size: 250,
                    level: 'M'
                });
                localQrDataUrl = qr.toDataURL();
            } catch (e) {
                console.error('Error generating local QR:', e);
            }
        }
        
        qrCodeHtml = `
            <div style="flex: 0.9; display: flex; flex-direction: column; align-items: center; justify-content: center; background: #fafafa; padding: 10px; border: 1px solid #ddd; border-radius: 8px; font-size: 10pt; box-sizing: border-box; text-align: center; height: 100%;">
                <div style="font-weight: bold; margin-bottom: 5px; color: #1e3a8a; font-size: 9.5pt;">QR ขนาด EMS ขนาดใหญ่ (${volWeightItems.length} ชิ้น)</div>
                <img src="${localQrDataUrl || onlineQrUrl}" 
                     data-qrtext="${safeQrText}" 
                     onerror="this.onerror=null; if(typeof QRious !== 'undefined'){ try { const qr = new QRious({value: this.getAttribute('data-qrtext'), size: 250, level: 'M'}); this.src = qr.toDataURL(); } catch(e){} }" 
                     style="width: 85px; height: 85px; object-fit: contain; border: 1px solid #eee; padding: 2px; background: white;" 
                     alt="QR Code EMS Dimensions">
                <div style="font-size: 7.5pt; color: #64748b; margin-top: 5px; line-height: 1.2;">สแกนเพื่ออ่านข้อมูล<br>กว้าง*ยาว*สูง</div>
            </div>
        `;
    }

    const groups = {};
    items.forEach(item => {
        const svc = item.customServiceName || item.serviceType;
        if (!groups[svc]) groups[svc] = [];
        groups[svc].push(item);
    });

    let rangeRows = '';
    let totalItemsAll = items.reduce((sum, s) => sum + (s.isOrdinaryBulk ? (parseInt(s.quantity) || 1) : 1), 0);
    let totalFee = 0;
    const priceMap = {};

    for (const [svc, svcItems] of Object.entries(groups)) {
        // Group consecutive items within this service
        const sorted = [...svcItems].sort((a, b) => a.trackingFormatted.localeCompare(b.trackingFormatted));
        const ranges = [];
        if (sorted.length > 0) {
            let currentRange = { start: sorted[0], end: sorted[0], count: 1 };
            for (let i = 1; i < sorted.length; i++) {
                const prev = parseTracking(sorted[i-1].trackingFormatted);
                const curr = parseTracking(sorted[i].trackingFormatted);
                
                const isSequential = prev && curr && prev.prefix === curr.prefix && curr.num === prev.num + 1;
                
                if (isSequential) {
                    currentRange.end = sorted[i];
                    currentRange.count++;
                } else {
                    ranges.push(currentRange);
                    currentRange = { start: sorted[i], end: sorted[i], count: 1 };
                }
            }
            ranges.push(currentRange);
        }

        ranges.forEach(r => {
            const cntStr = r.start.isOrdinaryBulk ? `${r.start.quantity} ชิ้น` : `${r.count} ชิ้น`;
            const startTrk = r.start.isOrdinaryBulk ? '-' : r.start.trackingFormatted;
            const endTrk = r.end.isOrdinaryBulk ? '-' : r.end.trackingFormatted;
            rangeRows += `
                <tr>
                    <td style="padding: 8px;">${svc}</td>
                    <td style="padding: 8px;">${startTrk}</td>
                    <td style="padding: 8px;">${endTrk}</td>
                    <td style="padding: 8px; text-align: center;">${cntStr}</td>
                    <td style="padding: 8px;"></td>
                </tr>
            `;
        });

        svcItems.forEach(s => {
            const f = parseFloat(s.fee) || 0;
            totalFee += f;
            const hasAR = s.options?.ar || s.options?.arTracking;
            if (s.isOrdinaryBulk) {
                const unitF = parseFloat(s.unitFee) || 0;
                const key = `@ ${unitF.toLocaleString()}`;
                priceMap[key] = (priceMap[key] || 0) + (parseInt(s.quantity) || 1);
            } else {
                const key = `@ ${f.toLocaleString()}${hasAR ? ' (AR)' : ''}`;
                priceMap[key] = (priceMap[key] || 0) + 1;
            }
        });
    }

    let priceBreakdownHtml = '';
    const sortedPrices = Object.keys(priceMap).sort((a, b) => {
        const valA = parseFloat(a.replace(/[^\d.]/g, '')) || 0;
        const valB = parseFloat(b.replace(/[^\d.]/g, '')) || 0;
        return valA - valB;
    });
    for (const desc of sortedPrices) {
        priceBreakdownHtml += `<div style="margin-bottom: 4px;">- ${desc}: <b>${priceMap[desc]}</b> ชิ้น</div>`;
    }
    
    // Calculate Official Service Stats (v5.5.0)
    const summaryStats = {
        ordinary: { count: 0, fee: 0 },
        printed: { count: 0, fee: 0 },
        registered: { count: 0, fee: 0 },
        eco: { count: 0, fee: 0 },
        epacket: { count: 0, fee: 0 },
        parcel: { count: 0, fee: 0 },
        others: { count: 0, fee: 0 }
    };

    items.forEach(item => {
        const fee = parseFloat(item.fee) || 0;
        const type = item.serviceType;
        const name = (item.customServiceName || '').toUpperCase();
        const trk = (item.trackingNum || '').trim().toUpperCase();
        const cnt = item.isOrdinaryBulk ? (parseInt(item.quantity) || 1) : 1;

        if (type === 'ECO' || (type === 'CUSTOM' && (name.includes('ECO') || name.includes('อีโค')))) {
            summaryStats.eco.count += cnt;
            summaryStats.eco.fee += fee;
        } else if (type === 'CUSTOM' && (name.includes('EPACKET') || name.includes('EPK') || trk.startsWith('L'))) {
            summaryStats.epacket.count += cnt;
            summaryStats.epacket.fee += fee;
        } else if (type === 'REG' || (type === 'CUSTOM' && (name.includes('REG') || name.includes('ลงทะเบียน') || trk.startsWith('R')))) {
            summaryStats.registered.count += cnt;
            summaryStats.registered.fee += fee;
        } else if (type === 'PARCEL' || (type === 'CUSTOM' && (name.includes('PARCEL') || name.includes('พัสดุ') || trk.startsWith('P')))) {
            summaryStats.parcel.count += cnt;
            summaryStats.parcel.fee += fee;
        } else if (type === 'ORD' || (type === 'CUSTOM' && (name.includes('ORD') || name.includes('ธรรมดา') || name.includes('จดหมาย')))) {
            summaryStats.ordinary.count += cnt;
            summaryStats.ordinary.fee += fee;
        } else if (type === 'PRINTED' || (type === 'CUSTOM' && (name.includes('PRINT') || name.includes('สิ่งตีพิมพ์') || name.includes('สิ่งพิมพ์')))) {
            summaryStats.printed.count += cnt;
            summaryStats.printed.fee += fee;
        } else {
            summaryStats.others.count += cnt;
            summaryStats.others.fee += fee;
        }
    });

    const valStr = (v) => v > 0 ? v.toLocaleString() : '';
    const feeStr = (f) => f > 0 ? f.toLocaleString() : '';

    const company = settings.company || '......................................';
    const address = settings.address || '............................................................................';
    const phone = settings.phone || '......................................';
    const license = settings.license || 'พ. ...... / 2569';
    const singleSheetHtml = `
        <div class="print-page">
            ${generateLogoHtml()}
            <div style="margin-top: 10mm; text-align: center;">
                <h2 style="font-size: 16pt; margin-bottom: 5px;">ใบสรุปการฝากส่งไปรษณียภัณฑ์ชำระค่าฝากส่งเป็น${settings.paymentType || 'เงินสด'}</h2>
                <div style="color: #444; font-size: 14pt; font-weight: bold; margin-bottom: 15px;">หมวด: ${titleSuffix}</div>
            </div>
            <div style="display: flex; justify-content: space-between; margin-bottom: 20px; font-size: 12pt;">
                <div style="line-height: 1.5;">
                    <div style="font-size: 11pt;">บริษัท <b>${company}</b></div>
                    <div style="font-size: 11pt;">ที่อยู่ <b>${address}</b></div>
                    <div style="font-size: 11pt;">โทรศัพท์ <b>${phone}</b></div>
                </div>
                <div style="text-align: right; font-size: 11pt;">
                    <div style="margin-bottom: 4px;">วันที่ ........................................</div>
                    <div style="display: flex; flex-direction: column; align-items: flex-end;">
                        <span style="font-weight: bold; font-size: 12pt;">${settings.postOffice || 'ไปรษณีย์กลาง 10501'}</span>
                        <span>ใบอนุญาตพิเศษที่ <b>${license}</b></span>
                    </div>
                </div>
            </div>
            <table style="width: 100%; border-collapse: collapse; text-align: center; font-size: 11.5pt; margin-bottom: 15px;" border="1">
                <thead style="background: #f0f0f0;">
                    <tr>
                        <th style="padding: 8px;">บริการ</th>
                        <th style="padding: 8px;">เลขที่เริ่มต้น</th>
                        <th style="padding: 8px;">เลขที่สุดท้าย</th>
                        <th style="padding: 8px;">จำนวนชิ้น</th>
                        <th style="padding: 8px;">หมายเหตุ</th>
                    </tr>
                </thead>
                <tbody>
                    ${rangeRows}
                    <tr style="font-weight: bold;">
                        <th colspan="3" style="text-align: right; padding: 8px 15px;">รวมทั้งหมด</th>
                        <th style="padding: 8px; text-align: center;">${totalItemsAll} ชิ้น</th>
                        <th style="padding: 8px;"></th>
                    </tr>
                </tbody>
            </table>
            <div style="display: flex; gap: 20px; font-size: 12pt; align-items: stretch;">
                <div style="flex: ${volWeightItems.length > 0 ? '1.3' : '1.5'};">
                    <div style="background: #fafafa; padding: 15px; border: 1px solid #ddd; border-radius: 8px; font-size: 11pt; height: 100%; box-sizing: border-box;">
                        <div style="margin-bottom: 8px;"><b>รายละเอียดชิ้นต่อราคา (อ้างอิง):</b></div>
                        ${priceBreakdownHtml}
                    </div>
                </div>
                ${qrCodeHtml}
                <div style="flex: 1; display: flex; flex-direction: column; justify-content: flex-end; align-items: flex-end; box-sizing: border-box; text-align: right; height: 100%;">
                     <div style="font-size: 14pt; font-weight: bold; border-bottom: 2px solid #000; padding-bottom: 5px;">
                        ยอดรวมสุทธิ: ${totalFee > 0 ? totalFee.toLocaleString() : '0'} บาท
                     </div>
                </div>
            </div>
            
            <!-- Official Service Classification Table (v5.5.0) -->
            ${titleSuffix !== 'กลุ่ม EMS' ? `
            <div style="margin-top: 15px; margin-bottom: 15px; page-break-inside: avoid;">
                <table style="width: 100%; border-collapse: collapse; font-size: 8.5pt; text-align: center; font-family: 'Sarabun', sans-serif; border: 1.5px solid black;">
                    <thead>
                        <tr style="background: #f8fafc; font-weight: bold;">
                            <th rowspan="2" style="padding: 4px; width: 30%; text-align: left; border: 1.5px solid black; font-size: 9pt;">รายการ</th>
                            <th colspan="2" style="padding: 4px; width: 28%; border: 1.5px solid black; font-size: 9pt;">ในประเทศ</th>
                            <th colspan="2" style="padding: 4px; width: 28%; border: 1.5px solid black; font-size: 9pt;">ต่างประเทศ</th>
                            <th rowspan="2" style="padding: 4px; width: 14%; border: 1.5px solid black; font-size: 9pt;">รวมเงินทั้งสิ้น<br>(1) + (2)</th>
                        </tr>
                        <tr style="background: #f8fafc; font-weight: bold;">
                            <th style="padding: 4px; width: 10%; border: 1.5px solid black;">ชิ้น</th>
                            <th style="padding: 4px; width: 18%; border: 1.5px solid black;">เงิน (1)</th>
                            <th style="padding: 4px; width: 10%; border: 1.5px solid black;">ชิ้น</th>
                            <th style="padding: 4px; width: 18%; border: 1.5px solid black;">เงิน (2)</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td style="padding: 2px 5px; text-align: left; font-weight: bold; border: 1px solid black;">จดหมายธรรมดา</td>
                            <td style="border: 1px solid black; font-weight: bold; font-size: 9.5pt;">${valStr(summaryStats.ordinary.count)}</td>
                            <td style="border: 1px solid black; font-weight: bold; font-size: 9.5pt;">${feeStr(summaryStats.ordinary.fee)}</td>
                            <td style="border: 1px solid black;"></td>
                            <td style="border: 1px solid black;"></td>
                            <td style="border: 1px solid black; font-weight: bold; font-size: 9.5pt;">${feeStr(summaryStats.ordinary.fee)}</td>
                        </tr>
                        <tr>
                            <td style="padding: 2px 5px; text-align: left; font-weight: bold; border: 1px solid black;">สิ่งตีพิมพ์</td>
                            <td style="border: 1px solid black; font-weight: bold; font-size: 9.5pt;">${valStr(summaryStats.printed.count)}</td>
                            <td style="border: 1px solid black; font-weight: bold; font-size: 9.5pt;">${feeStr(summaryStats.printed.fee)}</td>
                            <td style="border: 1px solid black;"></td>
                            <td style="border: 1px solid black;"></td>
                            <td style="border: 1px solid black; font-weight: bold; font-size: 9.5pt;">${feeStr(summaryStats.printed.fee)}</td>
                        </tr>
                        <tr>
                            <td style="padding: 2px 5px; text-align: left; font-weight: bold; border: 1px solid black;">ลงทะเบียน</td>
                            <td style="border: 1px solid black; font-weight: bold; font-size: 9.5pt;">${valStr(summaryStats.registered.count)}</td>
                            <td style="border: 1px solid black; font-weight: bold; font-size: 9.5pt;">${feeStr(summaryStats.registered.fee)}</td>
                            <td style="border: 1px solid black;"></td>
                            <td style="border: 1px solid black;"></td>
                            <td style="border: 1px solid black; font-weight: bold; font-size: 9.5pt;">${feeStr(summaryStats.registered.fee)}</td>
                        </tr>
                        <tr>
                            <td style="padding: 2px 5px; text-align: left; font-weight: bold; border: 1px solid black;">eCo-Post (ในประเทศ)</td>
                            <td style="border: 1px solid black; font-weight: bold; font-size: 9.5pt;">${valStr(summaryStats.eco.count)}</td>
                            <td style="border: 1px solid black; font-weight: bold; font-size: 9.5pt;">${feeStr(summaryStats.eco.fee)}</td>
                            <td style="border: 1px solid black;"></td>
                            <td style="border: 1px solid black;"></td>
                            <td style="border: 1px solid black; font-weight: bold; font-size: 9.5pt;">${feeStr(summaryStats.eco.fee)}</td>
                        </tr>
                        <tr>
                            <td style="padding: 2px 5px; text-align: left; font-weight: bold; border: 1px solid black;">ePacket (ต่างประเทศ)</td>
                            <td style="border: 1px solid black;"></td>
                            <td style="border: 1px solid black;"></td>
                            <td style="border: 1px solid black; font-weight: bold; font-size: 9.5pt;">${valStr(summaryStats.epacket.count)}</td>
                            <td style="border: 1px solid black; font-weight: bold; font-size: 9.5pt;">${feeStr(summaryStats.epacket.fee)}</td>
                            <td style="border: 1px solid black; font-weight: bold; font-size: 9.5pt;">${feeStr(summaryStats.epacket.fee)}</td>
                        </tr>
                        <tr>
                            <td style="padding: 2px 5px; text-align: left; font-weight: bold; border: 1px solid black;">พัสดุไปรษณีย์</td>
                            <td style="border: 1px solid black; font-weight: bold; font-size: 9.5pt;">${valStr(summaryStats.parcel.count)}</td>
                            <td style="border: 1px solid black; font-weight: bold; font-size: 9.5pt;">${feeStr(summaryStats.parcel.fee)}</td>
                            <td style="border: 1px solid black;"></td>
                            <td style="border: 1px solid black;"></td>
                            <td style="border: 1px solid black; font-weight: bold; font-size: 9.5pt;">${feeStr(summaryStats.parcel.fee)}</td>
                        </tr>
                        <tr>
                            <td style="padding: 2px 5px; text-align: left; font-weight: bold; border: 1px solid black;">อื่น ๆ</td>
                            <td style="border: 1px solid black; font-weight: bold; font-size: 9.5pt;">${valStr(summaryStats.others.count)}</td>
                            <td style="border: 1px solid black; font-weight: bold; font-size: 9.5pt;">${feeStr(summaryStats.others.fee)}</td>
                            <td style="border: 1px solid black;"></td>
                            <td style="border: 1px solid black;"></td>
                            <td style="border: 1px solid black; font-weight: bold; font-size: 9.5pt;">${feeStr(summaryStats.others.fee)}</td>
                        </tr>
                        <tr style="background: #fafafa; font-weight: bold; font-size: 9.5pt;">
                            <td style="padding: 3px 5px; text-align: left; border: 1.5px solid black;">ยอดรวม</td>
                            <td style="border: 1.5px solid black;">${valStr(summaryStats.ordinary.count + summaryStats.printed.count + summaryStats.registered.count + summaryStats.eco.count + summaryStats.parcel.count)}</td>
                            <td style="border: 1.5px solid black;">${feeStr(summaryStats.ordinary.fee + summaryStats.printed.fee + summaryStats.registered.fee + summaryStats.eco.fee + summaryStats.parcel.fee)}</td>
                            <td style="border: 1.5px solid black;">${valStr(summaryStats.epacket.count)}</td>
                            <td style="border: 1.5px solid black;">${feeStr(summaryStats.epacket.fee)}</td>
                            <td style="border: 1.5px solid black;">${totalFee > 0 ? totalFee.toLocaleString() : '0'}</td>
                        </tr>
                    </tbody>
                </table>
            </div>
            ` : ''}
            
            <div style="display: flex; justify-content: space-between; margin-top: auto; padding-top: 20px; font-size: 9pt; page-break-inside: avoid;">
                <div style="width: 32%; text-align: center; border: 1px solid #eee; padding: 4px; border-radius: 4px;">
                    <div style="font-weight: bold; margin-bottom: 28px;">รับผิดชอบฝากส่ง</div>
                    <div style="margin-bottom: 3px;">.........................................</div>
                    <div>( ${settings.showSignatureNames ? (settings.responsibleName || '..............................') : '..............................'} )</div>
                </div>
                <div style="width: 32%; text-align: center; border: 1px solid #eee; padding: 4px; border-radius: 4px;">
                    <div style="font-weight: bold; margin-bottom: 28px;">ผู้นำส่ง</div>
                    <div style="margin-bottom: 3px;">.........................................</div>
                    <div>( ${settings.senderName || '..............................'} )</div>
                </div>
                <div style="width: 32%; text-align: center; border: 1px solid #eee; padding: 4px; border-radius: 4px;">
                    <div style="font-weight: bold; margin-bottom: 28px;">เจ้าหน้าที่รับฝาก</div>
                    <div style="margin-bottom: 3px;">.........................................</div>
                    <div style="font-weight: bold; font-size: 10pt;">${(settings.postOffice && settings.postOffice.trim()) ? settings.postOffice : 'ไปรษณีย์กลาง 10501'}</div>
                </div>
            </div>
            ${generateMeterLineHtml()}
        </div>
    `;

    let result = '';
    for (let c = 0; c < copies; c++) {
        result += singleSheetHtml;
    }
    return result;
}

// --- EVENT HANDLERS ---

prefixInput.oninput = (e) => {
  if (currentServiceTab !== 'CUSTOM') {
      const thaiMap = {
        'พ': 'R', '่': 'J', 'ำ': 'E', 'ร': 'I', 'น': 'O', 'ย': 'P',
        'ะ': 'T', 'ั': 'Y', 'ี': 'U', 'เ': 'G', 'ห': 'H', 'ก': 'D',
        'ด': 'F', 'ส': 'L', 'ว': 'K', 'ง': 'O', 'ผ': 'Z', 'ป': 'X'
      };
      let m = '';
      for (let c of e.target.value) m += thaiMap[c] || c;
      e.target.value = m.replace(/[^a-zA-Z]/g, '').toUpperCase().substring(0, 2);
  }
  updatePreview();
  updatePrefixListUI();
};

digitsInput.oninput = (e) => {
  if (currentServiceTab !== 'CUSTOM') {
      e.target.value = sanitizeNumeric(e.target.value).substring(0, 8);
  }
  updatePreview();
  if (bulkToggle.checked) syncBatchInputs('count');
};

digitsEndInput.oninput = (e) => {
    if (currentServiceTab !== 'CUSTOM') e.target.value = sanitizeNumeric(e.target.value).substring(0, 8);
    syncBatchInputs('end');
};

batchCountInput.oninput = (e) => {
    e.target.value = sanitizeNumeric(e.target.value);
    syncBatchInputs('count');
};
weightInput.oninput = (e) => {
    e.target.value = sanitizeNumeric(e.target.value);
    updatePreview();
};
feeInput.oninput = (e) => {
    e.target.value = sanitizeNumeric(e.target.value, true);
    updatePreview();
};
optAR.onchange = updatePreview;
optInsurance.onchange = () => {
    if (optInsurance.checked) {
        const currentVal = parseFloat(insuranceVal.value) || 0;
        if (currentVal < 2100) insuranceVal.value = 2100;
    }
    updatePreview();
};
insuranceVal.oninput = (e) => {
    e.target.value = sanitizeNumeric(e.target.value);
    updatePreview();
};
insuranceVal.onblur = (e) => {
    const val = parseFloat(e.target.value.replace(/,/g, '')) || 0;
    if (val > 50000) {
        alert('⚠️ วงเงินรับประกันสูงสุดไม่เกิน 50,000 บาท ระบบจะปรับยอดเป็น 50,000 ให้อัตโนมัติ');
        e.target.value = "50,000";
        updatePreview();
    } else {
        e.target.value = val.toLocaleString();
    }
};
recipientInput.oninput = updatePreview;
destInput.oninput = (e) => {
    e.target.value = sanitizeNumeric(e.target.value);
    updatePreview();
};
optArTracking.onchange = updatePreview;
dimW.oninput = (e) => {
    e.target.value = sanitizeNumeric(e.target.value);
    updatePreview();
};
dimL.oninput = (e) => {
    e.target.value = sanitizeNumeric(e.target.value);
    updatePreview();
};
dimH.oninput = (e) => {
    e.target.value = sanitizeNumeric(e.target.value);
    updatePreview();
};
regTypeInput.onchange = updatePreview;

function getOrdinaryMailFee(serviceName, weight) {
    if (weight <= 0) return 0;
    if (serviceName.includes('จดหมาย')) {
        if (weight <= 10) return 5;
        if (weight <= 20) return 6;
        if (weight <= 100) return 11;
        if (weight <= 250) return 17;
        if (weight <= 500) return 23;
        if (weight <= 1000) return 40;
        if (weight <= 2000) return 62;
        return 62;
    } else if (serviceName.includes('สิ่งพิมพ์') || serviceName.includes('สิ่งตีพิมพ์')) {
        if (weight <= 50) return 4;
        if (weight <= 100) return 5;
        if (weight <= 250) return 8;
        if (weight <= 500) return 11;
        if (weight <= 1000) return 17;
        if (weight <= 2000) return 33;
        const kg = Math.ceil(weight / 1000);
        return kg * 16;
    }
    return 0;
}

customServiceNameInput.onchange = () => {
    customServiceManualInput.style.display = (customServiceNameInput.value === '') ? 'block' : 'none';
    const svc = customServiceNameInput.value;
    const bkkWInput = document.getElementById('ordinary-bkk-weight');
    const bkkFeeInput = document.getElementById('ordinary-bkk-fee');
    const upcWInput = document.getElementById('ordinary-upc-weight');
    const upcFeeInput = document.getElementById('ordinary-upc-fee');
    
    if (bkkWInput) {
        const w = parseFloat(bkkWInput.value) || 0;
        const fee = getOrdinaryMailFee(svc, w);
        if (bkkFeeInput) bkkFeeInput.value = fee > 0 ? fee : '';
    }
    if (upcWInput) {
        const w = parseFloat(upcWInput.value) || 0;
        const fee = getOrdinaryMailFee(svc, w);
        if (upcFeeInput) upcFeeInput.value = fee > 0 ? fee : '';
    }
    updatePreview();
};

const bkkWInput = document.getElementById('ordinary-bkk-weight');
const bkkQtyInput = document.getElementById('ordinary-bkk-qty');
const bkkFeeInput = document.getElementById('ordinary-bkk-fee');
const upcWInput = document.getElementById('ordinary-upc-weight');
const upcQtyInput = document.getElementById('ordinary-upc-qty');
const upcFeeInput = document.getElementById('ordinary-upc-fee');

if (bkkWInput) {
    bkkWInput.oninput = (e) => {
        e.target.value = sanitizeNumeric(e.target.value);
        const w = parseFloat(e.target.value) || 0;
        const svc = customServiceNameInput.value;
        const fee = getOrdinaryMailFee(svc, w);
        if (bkkFeeInput) {
            bkkFeeInput.value = fee > 0 ? fee : '';
        }
        updatePreview();
    };
}
if (upcWInput) {
    upcWInput.oninput = (e) => {
        e.target.value = sanitizeNumeric(e.target.value);
        const w = parseFloat(e.target.value) || 0;
        const svc = customServiceNameInput.value;
        const fee = getOrdinaryMailFee(svc, w);
        if (upcFeeInput) {
            upcFeeInput.value = fee > 0 ? fee : '';
        }
        updatePreview();
    };
}
if (bkkQtyInput) bkkQtyInput.oninput = (e) => { e.target.value = sanitizeNumeric(e.target.value); };
if (bkkFeeInput) bkkFeeInput.oninput = (e) => { e.target.value = sanitizeNumeric(e.target.value); };
if (upcQtyInput) upcQtyInput.oninput = (e) => { e.target.value = sanitizeNumeric(e.target.value); };
if (upcFeeInput) upcFeeInput.oninput = (e) => { e.target.value = sanitizeNumeric(e.target.value); };

customServiceManualInput.oninput = updatePreview;

addBtn.onclick = async (e) => {
  e.preventDefault();

  const selectedCustomSvc = customServiceNameInput.value;
  const isOrdinary = currentServiceTab === 'CUSTOM' && (selectedCustomSvc === 'จดหมาย ในประเทศ' || selectedCustomSvc === 'สิ่งพิมพ์ ในประเทศ');

  if (isOrdinary) {
      const bkkW = parseFloat(document.getElementById('ordinary-bkk-weight').value) || 0;
      const bkkQty = parseInt(document.getElementById('ordinary-bkk-qty').value) || 0;
      const bkkFee = parseFloat(document.getElementById('ordinary-bkk-fee').value) || 0;

      const upcW = parseFloat(document.getElementById('ordinary-upc-weight').value) || 0;
      const upcQty = parseInt(document.getElementById('ordinary-upc-qty').value) || 0;
      const upcFee = parseFloat(document.getElementById('ordinary-upc-fee').value) || 0;

      if (bkkQty === 0 && upcQty === 0) {
          alert('กรุณากรอกจำนวนฉบับอย่างน้อย 1 รายการ');
          return;
      }

      if (bkkQty > 0) {
          shipments.push({
              recipient: 'กรุงเทพฯ และปริมณฑล',
              destination: 'กรุงเทพฯ และปริมณฑล',
              serviceType: 'CUSTOM',
              customServiceName: selectedCustomSvc,
              weight: bkkW,
              isOrdinaryBulk: true,
              quantity: bkkQty,
              unitFee: bkkFee,
              trackingFormatted: '-',
              fee: bkkQty * bkkFee,
              options: {}
          });
      }

      if (upcQty > 0) {
          shipments.push({
              recipient: 'ต่างจังหวัด',
              destination: 'ต่างจังหวัด',
              serviceType: 'CUSTOM',
              customServiceName: selectedCustomSvc,
              weight: upcW,
              isOrdinaryBulk: true,
              quantity: upcQty,
              unitFee: upcFee,
              trackingFormatted: '-',
              fee: upcQty * upcFee,
              options: {}
          });
      }

      // Reset inputs
      document.getElementById('ordinary-bkk-weight').value = '';
      document.getElementById('ordinary-bkk-qty').value = '';
      document.getElementById('ordinary-bkk-fee').value = '';
      document.getElementById('ordinary-upc-weight').value = '';
      document.getElementById('ordinary-upc-qty').value = '';
      document.getElementById('ordinary-upc-fee').value = '';

      updateHistory();
      renderTable();
      updatePreview();
      return;
  }

  const p = prefixInput.value.trim().toUpperCase();
  const startD = (bulkToggle.checked ? num8StartInput.value : digitsInput.value).trim();
  const type = getServiceType(p);
  const rawW = parseFloat(weightInput.value) || 0;
  const w = (currentWeightUnit === 'kg') ? Math.round(rawW * 1000) : rawW;
  
  // Insurance Validation
  if (optInsurance.checked && type === 'EMS') {
      const insV = parseFloat(insuranceVal.value.replace(/,/g, '')) || 0;
      if (insV > 50000) {
          alert('⚠️ วงเงินรับประกันสูงสุดคือ 50,000 บาท ระบบจะปรับยอดเป็น 50,000 ให้อัตโนมัติ');
          insuranceVal.value = 50000;
          updatePreview();
      }
  }
  if (bulkToggle.checked) {
      const endD = digitsEndInput.value.trim();
      const count = parseInt(batchCountInput.value);
      
      if (!startD || !endD || isNaN(count)) return alert('กรุณากรอกข้อมูลลำดับให้ครบถ้วน');
      if (type !== 'CUSTOM' && (p.length !== 2 || startD.length !== 8 || endD.length !== 8)) return alert('รูปแบบเลข 8 หลักไม่ถูกต้อง');
      
      if (count > 100 && !confirm(`คุณกำลังจะเพิ่ม ${count} รายการ ต้องการดำเนินการต่อหรือไม่?`)) return;

      const step = (type === 'REG' && optArTracking.checked) ? 2 : 1;
      for (let i = 0; i < count; i++) {
          let trackingFormatted = '';
          if (type === 'CUSTOM') {
              const match = startD.match(/(\d+)$/);
              if (match) {
                 const numLen = match[1].length;
                 const baseStr = startD.substring(0, match.index);
                 const currentNum = parseInt(match[1]) + (i * step);
                 trackingFormatted = baseStr + currentNum.toString().padStart(numLen, '0');
              } else {
                 trackingFormatted = startD + (i > 0 ? `-${i}` : ''); 
              }
          } else {
              const currentNum = parseInt(startD) + (i * step);
              const d = currentNum.toString().padStart(8, '0');
              const cd = calculateCheckDigit(d);
              trackingFormatted = formatTrackingNumber(p, d, cd);
          }
          
          let isLarge = false;
          let useVolWeight = false;
          let finalWeight = w;
          if (type === 'EMS') {
              const wDim = parseFloat(dimW.value) || 0;
              const lDim = parseFloat(dimL.value) || 0;
              const hDim = parseFloat(dimH.value) || 0;
              const total = wDim + lDim + hDim;
              const maxSide = Math.max(wDim, lDim, hDim);
              
              if (maxSide > 60 || total > 120) isLarge = true;
              
              const volWeight = Math.ceil((wDim * lDim * hDim) / 6);
              if (volWeight > w) {
                  useVolWeight = true;
                  finalWeight = volWeight;
              }
              
              // 30kg Limit Hard Block for EMS
              if (finalWeight > 30000) {
                  alert(`⚠️ ไม่สามารถดำเนินการต่อได้: บริการ EMS มีน้ำหนักสูงสุดได้ไม่เกิน 30 กิโลกรัม`);
                  return;
              }
          } else if (type === 'REG') {
              // 2kg Limit Hard Block for Register
              if (finalWeight > 2000) {
                  alert(`⚠️ ไม่สามารถดำเนินการต่อได้: บริการลงทะเบียน (R) มีน้ำหนักสูงสุดได้ไม่เกิน 2 กิโลกรัม`);
                  return;
              }
          } else if (type === 'ECO') {
              // 10kg Limit Hard Block for eCo-Post
              if (finalWeight > 10000) {
                  alert(`⚠️ ไม่สามารถดำเนินการต่อได้: บริการ eCo-post มีน้ำหนักสูงสุดได้ไม่เกิน 10 กิโลกรัม`);
                  return;
              }
          } else if (type === 'PARCEL') {
              // 20kg Limit Hard Block for Parcel
              if (finalWeight > 20000) {
                  alert(`⚠️ ไม่สามารถดำเนินการต่อได้: บริการพัสดุไปรษณีย์ (P) มีน้ำหนักสูงสุดได้ไม่เกิน 20 กิโลกรัม`);
                  return;
              }
          } else if (type === 'CUSTOM') {
              // Warning but allow for CUSTOM if weight > 30kg
              if (finalWeight > 30000) {
                  if (!confirm(`⚠️ คำเตือน: รายการนี้มีน้ำหนักรวม (${(finalWeight/1000).toFixed(2)} กก.) เกิน 30 กก. ต้องการดำเนินการต่อหรือไม่?`)) {
                      return;
                  }
              }
          }

          shipments.push({
              recipient: '',
              destination: '',
              serviceType: type,
              customServiceName: type === 'CUSTOM' ? (customServiceNameInput.value || customServiceManualInput.value || 'กำหนดเอง') : null,
              weight: finalWeight,
              options: { 
                ar: optAR.checked, 
                arTracking: optArTracking.checked,
                insurance: optInsurance.checked, 
                insuranceVal: parseFloat(insuranceVal.value.replace(/,/g, '')),
                regType: regTypeInput.value,
                isLarge: isLarge,
                useVolWeight: useVolWeight,
                dimensions: { w: parseFloat(dimW.value), l: parseFloat(dimL.value), h: parseFloat(dimH.value) },
                isRemote: optRemote.checked,
                isSpecialEms: (type === 'EMS' && isSpecialEmsActive()),
                specialEmsPackage: settings.specialEmsPackage || 'A12'
              },
              isIsland: false,
              trackingFormatted: trackingFormatted,
              fee: (w > 0 || type === 'CUSTOM') ? (feeInput.value || '0').toString().replace(/[^0-9.]/g, '') : ''
          });
      }
      
      if (type !== 'CUSTOM') {
          const nextStartD = (parseInt(startD) + (count * step)).toString().padStart(8, '0');
          num8StartInput.value = nextStartD;
          digitsInput.value = nextStartD;
          num8StartInput.dispatchEvent(new Event('input'));
      }
  } else {
      if (!startD) return alert('กรุณากรอกข้อมูลเลขที่');
      if (type !== 'CUSTOM' && (p.length !== 2 || startD.length !== 8)) return alert('รูปแบบเลข 8 หลักไม่ถูกต้อง');
      
      let trackingFormatted = '';
      if (type === 'CUSTOM') {
          trackingFormatted = p + startD;
      } else {
          const cd = calculateCheckDigit(startD);
          trackingFormatted = formatTrackingNumber(p, startD, cd);
      }
      
      let isLarge = false;
      let useVolWeight = false;
      let finalWeight = w;
      if (type === 'EMS') {
          const wDim = parseFloat(dimW.value) || 0;
          const lDim = parseFloat(dimL.value) || 0;
          const hDim = parseFloat(dimH.value) || 0;
          const total = wDim + lDim + hDim;
          const maxSide = Math.max(wDim, lDim, hDim);
          
          if (maxSide > 60 || total > 120) isLarge = true;
          
          const volWeight = Math.ceil((wDim * lDim * hDim) / 6);
          if (volWeight > w) {
              useVolWeight = true;
              finalWeight = volWeight;
          }

          // 30kg Limit Hard Block for EMS
          if (finalWeight > 30000) {
              alert(`⚠️ ไม่สามารถดำเนินการต่อได้: บริการ EMS มีน้ำหนักสูงสุดได้ไม่เกิน 30 กิโลกรัม`);
              return;
          }
      } else if (type === 'REG') {
          // 2kg Limit Hard Block for Register
          if (finalWeight > 2000) {
              alert(`⚠️ ไม่สามารถดำเนินการต่อได้: บริการลงทะเบียน (R) มีน้ำหนักสูงสุดได้ไม่เกิน 2 กิโลกรัม`);
              return;
          }
      } else if (type === 'ECO') {
          // 10kg Limit Hard Block for eCo-Post
          if (finalWeight > 10000) {
              alert(`⚠️ ไม่สามารถดำเนินการต่อได้: บริการ eCo-post มีน้ำหนักสูงสุดได้ไม่เกิน 10 กิโลกรัม`);
              return;
          }
      } else if (type === 'PARCEL') {
          // 20kg Limit Hard Block for Parcel
          if (finalWeight > 20000) {
              alert(`⚠️ ไม่สามารถดำเนินการต่อได้: บริการพัสดุไปรษณีย์ (P) มีน้ำหนักสูงสุดได้ไม่เกิน 20 กิโลกรัม`);
              return;
          }
      } else if (type === 'CUSTOM') {
          // Warning but allow for CUSTOM if weight > 30kg
          if (finalWeight > 30000) {
              if (!confirm(`⚠️ คำเตือน: รายการนี้มีน้ำหนักรวม (${(finalWeight/1000).toFixed(2)} กก.) เกิน 30 กก. ต้องการดำเนินการต่อหรือไม่?`)) {
                  return;
              }
          }
      }

          shipments.push({
              recipient: recipientInput.value || '',
              destination: destInput.value || '',
              serviceType: type,
              customServiceName: type === 'CUSTOM' ? (customServiceNameInput.value || customServiceManualInput.value || 'กำหนดเอง') : null,
              weight: finalWeight,
              options: { 
                ar: optAR.checked, 
                arTracking: optArTracking.checked,
                insurance: optInsurance.checked, 
                insuranceVal: parseFloat(insuranceVal.value.replace(/,/g, '')),
                regType: regTypeInput.value,
                isLarge: isLarge,
                useVolWeight: useVolWeight,
                dimensions: { w: parseFloat(dimW.value), l: parseFloat(dimL.value), h: parseFloat(dimH.value) },
                isRemote: optRemote.checked,
                isSpecialEms: (type === 'EMS' && isSpecialEmsActive()),
                specialEmsPackage: settings.specialEmsPackage || 'A12'
              },
              isIsland: optRemote.checked && PARTIAL_REMOTE_ZIPS.includes(destInput.value.match(/\d{5}/)?.[0]),
              trackingFormatted: trackingFormatted,
              fee: (w > 0 || type === 'CUSTOM') ? (feeInput.value || '0').toString().replace(/[^0-9.]/g, '') : ''
          });
      
      if (type !== 'CUSTOM') {
          const step = (type === 'REG' && optArTracking.checked) ? 2 : 1;
          digitsInput.value = (parseInt(startD) + step).toString().padStart(8, '0');
      }
      recipientInput.value = '';
      destInput.value = '';
      weightInput.value = '';
      dimW.value = '0';
      dimL.value = '0';
      dimH.value = '0';
      optRemote.checked = false;
      updatePreview();
      
      setTimeout(() => {
          recipientInput.focus();
      }, 50);
  }

  if (currentServiceTab !== type) {
      currentServiceTab = type;
      document.querySelectorAll('.service-tab').forEach(t => {
          t.classList.toggle('active', t.dataset.service === type);
      });
      serviceTitle.textContent = `จัดการรายการ: ${type === 'CUSTOM' ? 'อื่นๆ' : type}`;
  }

  await updateHistory();
  renderShipments();
  updateSummary();
  updatePreview();
  
  // Scroll to bottom to show new items
  const container = document.querySelector('.table-container');
  if (container) container.scrollTop = container.scrollHeight;
  
  if (bulkToggle.checked) {
      syncBatchInputs('count');
      setTimeout(() => {
          const startField = document.getElementById('num8-start');
          if (startField) {
              startField.focus();
              startField.select();
          }
      }, 50);
  }
};

undoBtn.onclick = async () => {
  if (historyIndex > 0) {
    historyIndex--;
    shipments = JSON.parse(JSON.stringify(history[historyIndex]));
    await saveToDB('shipments', shipments);
    await saveToDB('historyIndex', historyIndex);
    renderShipments();
    updateSummary();
    updateHistoryButtons();
  }
};

redoBtn.onclick = async () => {
  if (historyIndex < history.length - 1) {
    historyIndex++;
    shipments = JSON.parse(JSON.stringify(history[historyIndex]));
    await saveToDB('shipments', shipments);
    await saveToDB('historyIndex', historyIndex);
    renderShipments();
    updateSummary();
    updateHistoryButtons();
  }
};

printBtn.onclick = () => {
  const filtered = shipments.filter(s => s.serviceType === currentServiceTab);
  if (!filtered.length) return alert(`ไม่มีรายการในหมวด ${currentServiceTab} สำหรับพิมพ์`);
  
  const printSection = document.getElementById('print-section');
  const paymentType = settings.paymentType || 'เงินสด';
  let manifestCopies = 1;
  
  if (paymentType === 'เงินเชื่อ') {
      manifestCopies = 3;
  } else if (paymentType === 'เครื่องประทับไปรษณียากร') {
      const isEMS = currentServiceTab === 'EMS' || (currentServiceTab === 'CUSTOM' && filtered.some(s => s.customServiceName && s.customServiceName.toUpperCase().includes('EMS')));
      manifestCopies = isEMS ? 2 : 1;
  }

  loadingOverlay.style.display = 'flex';
  
  // Use setTimeout to allow UI to show loader
  setTimeout(() => {
    printSection.innerHTML = generatePrintPages(filtered, currentServiceTab, manifestCopies);
    loadingOverlay.style.display = 'none';
    window.print();
  }, 100);
};

dispatchBtn.onclick = async () => {
    if (!shipments.length) return alert('ไม่มีรายการให้จัดส่ง/บันทึก');
    
    // Final check for insurance limit
    const invalidItem = shipments.find(s => s.options?.insurance && s.options?.insuranceVal > 50000);
    if (invalidItem) {
        alert(`⚠️ ไม่สามารถปิดยอดได้: ตรวจพบรายการ ${invalidItem.trackingFormatted} มีวงเงินรับประกันเกิน 50,000 บาท โปรดแก้ไขให้ถูกต้องก่อน`);
        return;
    }
    
    if (editingArchiveId) {
        if (!confirm('ยืนยันการบันทึกการแก้ไขของบิลเก่านี้? ข้อมูลในประวัติและรายงานจะถูกอัปเดต')) return;
        
        // Update existing archive
        const oldArchive = await loadArchive(editingArchiveId);
        if (oldArchive) {
            oldArchive.items = [...shipments];
            await saveArchive(oldArchive);
        }
        
    } else {
        if (!confirm('ยืนยันการปิดยอดและพิมพ์ใบสรุป?\nระบบจะจัดเรียงใบสรุปแยกหมวด EMS และ อื่นๆ พร้อมบันทึกเข้าระบบประวัติ')) return;
        
        // Create new archive
        const archiveId = 'M-' + Date.now();
        const dateStr = new Date().toISOString();
        
        // Handle Meter Update
        let meterBefore = null;
        let meterAfter = null;
        if (settings.paymentType === 'เครื่องประทับไปรษณียากร') {
            const totalFee = shipments.reduce((sum, item) => sum + (parseFloat(item.fee) || 0), 0);
            meterBefore = { desc: settings.meterDescending, asc: settings.meterAscending };
            
            settings.meterDescending -= totalFee;
            settings.meterAscending += totalFee;
            meterAfter = { desc: settings.meterDescending, asc: settings.meterAscending };
            
            await saveToDB('settings', settings);
            updateMeterStatus();
        }

        await saveArchive({
            id: archiveId,
            date: dateStr,
            items: [...shipments],
            paymentType: settings.paymentType,
            meterBefore,
            meterAfter
        });
    }
    
    // GENERATE SPLIT PRINT LAYOUT (EMS vs Others)
    const emsGroup = shipments.filter(s => isEMSGroup(s));
    const otherGroup = shipments.filter(s => !isEMSGroup(s));
    
    const printSection = document.getElementById('print-section');
    loadingOverlay.style.display = 'flex';
    
    setTimeout(() => {
        let finalHtml = '';
        const paymentType = settings.paymentType || 'เงินสด';

        if (emsGroup.length > 0) {
            let sumCopies = 1;
            let manCopies = 1;
            if (paymentType === 'เงินเชื่อ') { sumCopies = 2; manCopies = 3; }
            else if (paymentType === 'เครื่องประทับไปรษณียากร') { sumCopies = 3; manCopies = 2; }

            finalHtml += generateSummarySheet(emsGroup, "กลุ่ม EMS", sumCopies);
            finalHtml += generatePrintPages(emsGroup, "กลุ่ม EMS", manCopies);
        }
        
        if (otherGroup.length > 0) {
            let sumCopies = 1;
            let manCopies = 1;
            if (paymentType === 'เงินเชื่อ') { sumCopies = 2; manCopies = 3; }
            else if (paymentType === 'เครื่องประทับไปรษณียากร') { sumCopies = 3; manCopies = 1; }

            finalHtml += generateSummarySheet(otherGroup, "กลุ่มอื่นๆ", sumCopies);
            finalHtml += generatePrintPages(otherGroup, "กลุ่มอื่นๆ", manCopies);
        }
        
        printSection.innerHTML = finalHtml;
        loadingOverlay.style.display = 'none';
        window.print();
        
        // Clear / Reset
        setTimeout(async () => {
            const msg = editingArchiveId 
                ? 'บันทึกแก้ไขและพิมพ์เสร็จสิ้น ต้องการเคลียร์หน้าจอเพื่อเริ่มบิลใหม่เลยหรือไม่?' 
                : 'พิมพ์เสร็จสิ้นแล้ว ล้างรายการในระบบเพื่อเริ่มล็อตใหม่เลยหรือไม่?';
                
            if(confirm(msg)) {
                shipments = [];
                history = [[]];
                historyIndex = 0;
                editingArchiveId = null;
                await saveToDB('shipments', shipments);
                await saveToDB('history', history);
                await saveToDB('historyIndex', historyIndex);
                await saveToDB('editingArchiveId', editingArchiveId);
                renderShipments();
                updateSummary();
                updateHistoryButtons();
            }
        }, 1000);
    }, 100);
};

nextNumBtn.onclick = () => {
  const v = digitsInput.value;
  if (currentServiceTab !== 'CUSTOM' && v.length === 8) {
    const nextVal = (parseInt(v) + 1) % 100000000;
    digitsInput.value = nextVal.toString().padStart(8, '0');
    updatePreview();
    if (bulkToggle.checked) syncBatchInputs('count');
  }
};

// NEW: 8-digit tracking validation for bulk mode
if (num8StartInput) {
    num8StartInput.oninput = () => {
        const val = num8StartInput.value.replace(/\D/g, ''); // only digits
        num8StartInput.value = val;
        
        const len = val.length;
        num8Counter.textContent = `${len}/8 หลัก`;
        
        if (len === 8) {
            num8Counter.style.color = '#10b981'; // Green
            num8Warn.style.display = 'none';
            if (bulkToggle.checked) syncBatchInputs('count');
        } else {
            num8Counter.style.color = '#ef4444'; // Red
            num8Warn.style.display = 'block';
        }
    };
}

bulkToggle.onchange = () => {
    const isBulk = bulkToggle.checked;
    bulkInputsGroup.style.display = isBulk ? 'block' : 'none';
    singleTrackingGroup.style.display = isBulk ? 'none' : 'block';
    feeUnitLabel.style.display = isBulk ? 'inline' : 'none';
    document.querySelectorAll('.single-only').forEach(el => el.style.display = isBulk ? 'none' : 'block');
    
    if (isBulk) {
        // อนุมัติ: ถ้ามีการพิมพ์ เลข 8 หลักไว้ก่อนแล้ว ดึง ค่านั้นลงมาให้ด้วย
        if (digitsInput.value.length === 8) {
            num8StartInput.value = digitsInput.value;
            // Trigger input event to update validation UI
            num8StartInput.dispatchEvent(new Event('input'));
        }
        
        if (num8StartInput.value.length === 8) syncBatchInputs('count');
    }
    updatePreview();
};

// Service Tabs Switching
document.querySelectorAll('.service-tab').forEach(tab => {
    tab.onclick = () => {
        currentServiceTab = tab.dataset.service;
        document.querySelectorAll('.service-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        serviceTitle.textContent = `จัดการรายการ: ${currentServiceTab === 'CUSTOM' ? 'อื่นๆ' : currentServiceTab}`;
        
        const prefixes = settings.defaultPrefixes?.[currentServiceTab];
        if (prefixes && (Array.isArray(prefixes) ? prefixes.length > 0 : !!prefixes)) {
            const list = Array.isArray(prefixes) ? prefixes : [prefixes];
            prefixInput.value = list[0];
            prefixHelpText.style.display = 'none';
        } else {
            const fallbacks = { 'EMS': 'EX', 'REG': 'RX', 'PARCEL': 'PX', 'ECO': 'OX', 'CUSTOM': 'อื่นๆ' };
            prefixInput.value = fallbacks[currentServiceTab] || '';
            prefixHelpText.style.display = 'block';
        }
        updatePrefixListUI();
        
        customServiceGroup.style.display = (currentServiceTab === 'CUSTOM') ? 'block' : 'none';
        if (currentServiceTab === 'CUSTOM') {
            feeInput.placeholder = "ระบุค่าบริการ...";
            if (feeInput.value.startsWith('เริ่มต้น')) feeInput.value = '';
            feeInput.style.color = 'inherit';
        }
        
        recipientInput.value = '';
        destInput.value = '';
        weightInput.value = '';
        dimW.value = '0';
        dimL.value = '0';
        dimH.value = '0';
        insuranceVal.value = '2000';
        optAR.checked = false;
        optInsurance.checked = false;
        optArTracking.checked = false;
        optRemote.checked = false;
        
        renderShipments();
        updateSummary();
        updatePreview(); // Fix: Ensure UI fields hide/show immediately on tab change
    };
});

function updatePrefixListUI() {
    if (!settings.defaultPrefixes) settings.defaultPrefixes = {};
    let list = settings.defaultPrefixes[currentServiceTab] || [];
    if (!Array.isArray(list)) list = [list];
    
    // Update Custom Dropdown (Always shows all favorites)
    prefixDropdownList.innerHTML = list.map(p => `
        <div class="dropdown-item" onclick="selectPrefix('${p}')">${p}</div>
    `).join('');
    
    if (list.length === 0) {
        prefixDropdownList.innerHTML = '<div class="dropdown-item" style="font-size: 0.8rem; color: #94a3b8; font-style: italic;">ไม่มีรายการโปรด</div>';
    }
    
    // Toggle Save/Delete buttons based on current input value
    const currentVal = prefixInput.value.trim().toUpperCase();
    const isInList = list.includes(currentVal);
    
    if (currentVal) {
        savePrefixBtn.style.display = isInList ? 'none' : 'flex';
        deletePrefixBtn.style.display = isInList ? 'flex' : 'none';
    } else {
        savePrefixBtn.style.display = 'none';
        deletePrefixBtn.style.display = 'none';
    }
}

prefixDropdownToggle.onclick = (e) => {
    e.stopPropagation();
    const isVisible = prefixDropdownList.style.display === 'block';
    prefixDropdownList.style.display = isVisible ? 'none' : 'block';
};

document.addEventListener('click', () => {
    prefixDropdownList.style.display = 'none';
});

deletePrefixBtn.onclick = async () => {
    const val = prefixInput.value.trim().toUpperCase();
    if (!val) return;
    
    if (!confirm(`ยืนยันการลบหมวด "${val}" ออกจากรายการโปรด?`)) return;
    
    if (!settings.defaultPrefixes) settings.defaultPrefixes = {};
    let list = settings.defaultPrefixes[currentServiceTab] || [];
    if (!Array.isArray(list)) list = [list];
    
    const index = list.indexOf(val);
    if (index > -1) {
        list.splice(index, 1);
        settings.defaultPrefixes[currentServiceTab] = list;
        await saveToDB('settings', settings);
        updatePrefixListUI();
        
        // Visual feedback for deletion
        prefixInput.style.borderColor = '#ef4444';
        setTimeout(() => prefixInput.style.borderColor = '', 500);
    }
};

window.selectPrefix = (p) => {
    prefixInput.value = p;
    prefixDropdownList.style.display = 'none';
    updatePreview();
    updatePrefixListUI();
};

window.toggleWeightUnit = () => {
    const label = document.getElementById('weight-unit-label');
    const btn = document.getElementById('unit-toggle-btn');
    let val = parseFloat(weightInput.value) || 0;
    
    if (currentWeightUnit === 'g') {
        currentWeightUnit = 'kg';
        weightInput.value = (val / 1000);
        label.textContent = 'กิโลกรัม';
        btn.textContent = 'สลับเป็น G';
    } else {
        currentWeightUnit = 'g';
        weightInput.value = Math.round(val * 1000);
        label.textContent = 'กรัม';
        btn.textContent = 'สลับเป็น KG';
    }
    updatePreview();
    updatePrefixListUI();
};

// --- BULK SERVICE TOGGLE (Smart Logic v5.0.5) ---
window.toggleAllService = (type) => {
    const headerCheck = document.getElementById(`toggle-all-${type}`);
    const isChecked = headerCheck.checked;
    
    // Filter items in current tab
    const currentItems = shipments.filter(s => s.serviceType === currentServiceTab);
    
    if (isChecked) {
        // Mode: Select All
        // 1. Backup current states if not already backed up
        bulkBackup[type] = currentItems.map(s => ({ id: s.id, val: s.options?.[type === 'ar' ? 'ar' : (type === 'ins' ? 'insurance' : 'arTracking')] }));
        
        // 2. Apply TRUE to all
        currentItems.forEach(s => {
            if (!s.options) s.options = {};
            if (type === 'ar') s.options.ar = true;
            if (type === 'ar-track') s.options.arTracking = true;
            if (type === 'ins') s.options.insurance = true;
            s.fee = calculateBaseFee(s.serviceType, s.weight, s.options);
        });
    } else {
        // Mode: Unselect (Smart Logic v5.0.6)
        if (bulkBackup[type]) {
            if (confirm(`⚠️ คุณต้องการยกเลิกการเลือกบริการเสริมนี้ในทุกรายการของหมวด ${currentServiceTab} จริงๆ ใช่หรือไม่?\n\n(กด 'ยกเลิก/Cancel' เพื่อคืนค่าที่คุณเคยเลือกไว้ก่อนหน้า)`)) {
                // User said OK -> Clear All
                currentItems.forEach(s => {
                    if (!s.options) s.options = {};
                    if (type === 'ar') s.options.ar = false;
                    if (type === 'ar-track') s.options.arTracking = false;
                    if (type === 'ins') s.options.insurance = false;
                    s.fee = calculateBaseFee(s.serviceType, s.weight, s.options);
                });
                bulkBackup[type] = null; // Clear backup
            } else {
                // User said Cancel -> Restore from backup
                currentItems.forEach(s => {
                    const backup = bulkBackup[type].find(b => b.id === s.id);
                    if (backup) {
                        if (!s.options) s.options = {};
                        if (type === 'ar') s.options.ar = backup.val;
                        if (type === 'ar-track') s.options.arTracking = backup.val;
                        if (type === 'ins') s.options.insurance = backup.val;
                        s.fee = calculateBaseFee(s.serviceType, s.weight, s.options);
                    }
                });
                bulkBackup[type] = null; // Clear backup after restoration
                headerCheck.checked = false; // Keep unchecked since it might be a mixed state now
            }
        } else {
            // No backup exists (e.g. they uncheck a state that was already empty or manually filled)
            if (confirm(`⚠️ คุณต้องการยกเลิกการเลือกบริการเสริมนี้ในทุกรายการของหมวด ${currentServiceTab} จริงๆ ใช่หรือไม่?`)) {
                currentItems.forEach(s => {
                    if (!s.options) s.options = {};
                    if (type === 'ar') s.options.ar = false;
                    if (type === 'ar-track') s.options.arTracking = false;
                    if (type === 'ins') s.options.insurance = false;
                    s.fee = calculateBaseFee(s.serviceType, s.weight, s.options);
                });
            } else {
                headerCheck.checked = true;
                return;
            }
        }
    }
    
    saveToDB();
    renderShipments();
    updateSummary();
    saveHistory();
};

savePrefixBtn.onclick = async () => {
    const val = prefixInput.value.trim().toUpperCase();
    if (!val) return;
    
    if (!settings.defaultPrefixes) settings.defaultPrefixes = {};
    let list = settings.defaultPrefixes[currentServiceTab] || [];
    if (!Array.isArray(list)) list = [list];
    
    // Add to list if not exists
    if (!list.includes(val)) {
        list.unshift(val); // Add to front
        
        // Limit: 2 for standard, 10 for CUSTOM (reverted as requested)
        const max = (currentServiceTab === 'CUSTOM') ? 10 : 2;
        if (list.length > max) list = list.slice(0, max);
        
        settings.defaultPrefixes[currentServiceTab] = list;
        await saveToDB('settings', settings);
    }
    
    prefixHelpText.style.display = 'none';
    updatePrefixListUI();
    
    const oldBg = savePrefixBtn.style.background;
    savePrefixBtn.style.background = '#86efac';
    setTimeout(() => {
        savePrefixBtn.style.background = oldBg;
    }, 500);
};

// Settings Modal
settingsBtn.onclick = () => settingsModal.style.display = 'flex';
closeSettingsBtn.onclick = () => settingsModal.style.display = 'none';

window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && settingsModal.style.display === 'flex') {
        settingsModal.style.display = 'none';
    }
});

// Postal Service Guide Modal Initialization
const postalGuideBtn = document.getElementById('postal-guide-btn');
const postalGuideModal = document.getElementById('postal-guide-modal');
const closeGuideBtn = document.getElementById('close-guide-btn');

postalGuideBtn.onclick = () => {
    postalGuideModal.style.display = 'flex';
};

closeGuideBtn.onclick = () => {
    postalGuideModal.style.display = 'none';
};

postalGuideModal.onclick = (e) => {
    if (e.target === postalGuideModal) {
        postalGuideModal.style.display = 'none';
    }
};

window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && postalGuideModal.style.display === 'flex') {
        postalGuideModal.style.display = 'none';
    }
});

// Guide Modal Tabs Navigation
const guideTabs = document.querySelectorAll('.guide-tab');
const guideSections = document.querySelectorAll('.guide-section');

guideTabs.forEach(tab => {
    tab.onclick = () => {
        // Remove active class from all tabs
        guideTabs.forEach(t => {
            t.classList.remove('active');
            t.style.borderBottomColor = 'transparent';
            t.style.color = '#64748b';
        });
        
        // Add active class to clicked tab
        tab.classList.add('active');
        tab.style.borderBottomColor = 'var(--primary-color)';
        tab.style.color = 'var(--primary-color)';
        
        // Hide all sections
        guideSections.forEach(sec => sec.style.display = 'none');
        
        // Show selected section
        const targetSec = document.getElementById(`guide-sec-${tab.dataset.guide}`);
        if (targetSec) {
            targetSec.style.display = 'block';
        }
    };
});

// Brochure Toggle View Image Handler
const toggleViewBtns = document.querySelectorAll('.toggle-view-btn');
toggleViewBtns.forEach(btn => {
    btn.onclick = () => {
        const parentSec = btn.closest('.guide-section');
        const imgViewer = parentSec.querySelector('.brochure-img-viewer');
        if (imgViewer.style.display === 'none' || !imgViewer.style.display) {
            imgViewer.style.display = 'block';
            if (!btn.dataset.originalHtml) {
                btn.dataset.originalHtml = btn.innerHTML;
            }
            btn.innerHTML = '❌ ซ่อนรูปภาพแผ่นพับ';
            btn.style.backgroundColor = '#fee2e2';
            btn.style.color = '#ef4444';
            btn.style.borderColor = '#fecaca';
        } else {
            imgViewer.style.display = 'none';
            btn.innerHTML = btn.dataset.originalHtml || '📷 ดูโบรชัวร์ต้นฉบับ';
            btn.style.backgroundColor = '#eff6ff';
            btn.style.color = '#1d4ed8';
            btn.style.borderColor = '#bfdbfe';
        }
    };
});

saveSettingsBtn.onclick = async () => {
    settings.company = document.getElementById('set-company').value;
    settings.address = document.getElementById('set-address').value;
    settings.phone = document.getElementById('set-phone').value;
    settings.license = document.getElementById('set-license').value;
    settings.paymentType = document.getElementById('set-payment-type').value;
    settings.fuelSurcharge = setFuelSurcharge.checked;
    settings.postOffice = document.getElementById('set-post-office').value || 'ไปรษณีย์กลาง 10501';
    
    settings.showSignatureNames = document.getElementById('set-show-sig-names').checked;
    settings.responsibleName = document.getElementById('set-res-name').value;
    settings.senderName = document.getElementById('set-sender-name').value;
    settings.homeZip = document.getElementById('settings-home-zip').value;
    settings.excludeIslandEMS = document.getElementById('set-exclude-island-ems').checked;
    settings.excludeIslandEco = document.getElementById('set-exclude-island-eco').checked;
    
    settings.specialEmsEnabled = document.getElementById('set-special-ems-enabled').checked;
    settings.specialEmsPackage = document.getElementById('set-special-ems-package').value;

    settings.logoWidth = parseInt(document.getElementById('set-logo-width').value) || 150;
    settings.logoAlign = document.getElementById('set-logo-align').value;
    // Note: settings.logo is updated directly on file select
    
    settings.meterDescending = parseFloat(document.getElementById('set-meter-desc').value) || 0;
    settings.meterAscending = parseFloat(document.getElementById('set-meter-asc').value) || 0;

    // Recalculate remote surcharge and fees of all active shipments based on new settings
    for (let s of shipments) {
        if (s.serviceType === 'EMS') {
            if (!s.options) s.options = {};
            s.options.isSpecialEms = isSpecialEmsActive();
            s.options.specialEmsPackage = settings.specialEmsPackage || 'A12';
        }
        if (!s.options) s.options = {};
        const zipMatch = s.destination ? s.destination.match(/\d{5}/) : null;
        const zip = zipMatch ? zipMatch[0] : null;
        const isRemoteZip = zip && !!REMOTE_AREAS[zip];
        const homeZipGroup = settings.homeZip ? REMOTE_AREAS[settings.homeZip] : null;
        const zipGroup = zip ? REMOTE_AREAS[zip] : null;
        const sameGroup = zipGroup && homeZipGroup && zipGroup === homeZipGroup;

        if (isRemoteZip && !sameGroup) {
            const isIsland = PARTIAL_REMOTE_ZIPS.includes(zip);
            if (isIsland && ((s.serviceType === 'EMS' && settings.excludeIslandEMS) || (s.serviceType === 'ECO' && settings.excludeIslandEco))) {
                s.options.isRemote = false;
                s.isIsland = true;
            } else {
                s.options.isRemote = true;
                s.isIsland = isIsland;
            }
        } else {
            s.options.isRemote = false;
            s.isIsland = false;
        }

        // Recalculate fee
        let calcW = s.weight;
        if (s.options.dimensions) {
            const { w, l, h } = s.options.dimensions;
            if (w > 0 && l > 0 && h > 0) {
                const volWeight = Math.ceil((w * l * h) / 6000) * 1000;
                calcW = Math.max(s.weight, volWeight);
            }
        }
        let base = calculateBaseFee(s.serviceType, calcW, s.options);
        if (settings.fuelSurcharge && (s.serviceType === 'EMS' || s.serviceType === 'ECO')) {
            base += 3;
        }
        s.fee = base;
    }

    await saveToDB('settings', settings);
    await saveToDB('shipments', shipments);
    settingsModal.style.display = 'none';
    if (archiveFilterType) {
        archiveFilterType.value = settings.paymentType || 'เงินสด';
    }
    updatePreview();
    updateMeterStatus();
    renderShipments();
    updateSummary();
    renderStats();
    renderArchiveView();
    alert('บันทึกการตั้งค่าสำเร็จ');
};

function updateLicenseLabel(paymentType) {
    const label = document.getElementById('label-license');
    const input = document.getElementById('set-license');
    if (!label || !input) return;
    
    if (paymentType === 'เงินสด') {
        label.innerHTML = 'เลขสมาชิก Post Family (THP-XXXXXXXX)';
        input.placeholder = 'เช่น THP-12345678';
    } else if (paymentType === 'เงินเชื่อ') {
        label.innerHTML = 'ใบอนุญาตพิเศษที่';
        input.placeholder = 'เช่น พ. 123 / 2569';
    } else if (paymentType === 'เครื่องประทับไปรษณียากร') {
        label.innerHTML = 'ใบอนุญาตพิเศษที่ (มิเตอร์)';
        input.placeholder = 'เช่น พ. 123 / 2569';
    }
}

document.getElementById('set-payment-type').onchange = (e) => {
    const val = e.target.value;
    document.getElementById('meter-settings-fields').style.display = (val === 'เครื่องประทับไปรษณียากร') ? 'block' : 'none';
    updateLicenseLabel(val);
};

document.getElementById('set-meter-desc').oninput = (e) => {
    e.target.value = sanitizeNumeric(e.target.value, true);
};
document.getElementById('set-meter-asc').oninput = (e) => {
    e.target.value = sanitizeNumeric(e.target.value, true);
};

document.getElementById('set-show-sig-names').onchange = (e) => {
    document.getElementById('sig-names-fields').style.display = e.target.checked ? 'block' : 'none';
};

// Logo Upload Logic
document.getElementById('set-logo-file').onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (event) => {
        settings.logo = event.target.result;
        updateLogoPreview();
    };
    reader.readAsDataURL(file);
};

document.getElementById('set-logo-clear').onclick = () => {
    settings.logo = null;
    document.getElementById('set-logo-file').value = '';
    updateLogoPreview();
};

document.getElementById('set-logo-width').oninput = (e) => {
    const val = e.target.value;
    document.getElementById('logo-width-val').textContent = val + 'px';
    document.getElementById('logo-preview-img').style.width = val + 'px';
};

document.getElementById('set-logo-align').onchange = (e) => {
    const val = e.target.value;
    const container = document.getElementById('logo-preview-container');
    if (val === 'left') container.style.textAlign = 'left';
    else if (val === 'center') container.style.textAlign = 'center';
    else if (val === 'right') container.style.textAlign = 'right';
};

document.getElementById('export-data-btn').onclick = async () => {
    const db = await initDB();
    const archives = await loadAllArchives();
    const data = await new Promise((resolve) => {
        const tx = db.transaction('data', 'readonly');
        const store = tx.objectStore('data');
        const req = store.getAll();
        const keysReq = store.getAllKeys();
        req.onsuccess = () => {
            keysReq.onsuccess = () => {
                const result = {};
                keysReq.result.forEach((key, i) => result[key] = req.result[i]);
                resolve(result);
            };
        };
    });

    const backup = {
        version: "5.1.1",
        exportDate: new Date().toISOString(),
        settings: settings,
        archives: archives,
        data: data
    };

    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ThaiPost_Backup_${new Date().toISOString().substring(0,10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    alert('ส่งออกข้อมูลสำเร็จ! โปรดเก็บไฟล์นี้ไว้ในที่ปลอดภัย');
};

document.getElementById('import-data-btn').onclick = () => {
    document.getElementById('import-data-file').click();
};

document.getElementById('import-data-file').onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (!confirm('คำเตือน: การนำเข้าข้อมูลจะเขียนทับข้อมูลและการตั้งค่าปัจจุบันทั้งหมด!\n\nคุณต้องการดำเนินการต่อหรือไม่?')) {
        e.target.value = '';
        return;
    }

    const reader = new FileReader();
    reader.onload = async (event) => {
        try {
            const backup = JSON.parse(event.target.result);
            
            // Basic validation
            if (!backup.archives || !backup.settings || !backup.data) {
                throw new Error('รูปแบบไฟล์สำรองไม่ถูกต้อง');
            }

            const db = await initDB();
            
            // 1. Clear and Restore 'data' store (settings, shipments, history etc.)
            const txData = db.transaction('data', 'readwrite');
            const dataStore = txData.objectStore('data');
            await new Promise((resolve) => {
                dataStore.clear().onsuccess = () => {
                    for (const [key, val] of Object.entries(backup.data)) {
                        dataStore.put(val, key);
                    }
                    // Also explicitly ensure the current 'settings' from JSON are saved
                    dataStore.put(backup.settings, 'settings');
                    resolve();
                };
            });

            // 2. Clear and Restore 'archives' store
            const txArchive = db.transaction('archives', 'readwrite');
            const archiveStore = txArchive.objectStore('archives');
            await new Promise((resolve) => {
                archiveStore.clear().onsuccess = () => {
                    backup.archives.forEach(arc => archiveStore.put(arc));
                    resolve();
                };
            });

            alert('นำเข้าข้อมูลสำเร็จ! ระบบจะทำการรีโหลดหน้าเว็บบูรณะข้อมูลใหม่');
            location.reload();

        } catch (err) {
            console.error(err);
            alert('เกิดข้อผิดพลาดในการนำเข้าข้อมูล: ' + err.message);
        }
    };
    reader.readAsText(file);
    e.target.value = ''; // Reset for next selection
};


function updateLogoPreview() {
    const container = document.getElementById('logo-preview-container');
    const img = document.getElementById('logo-preview-img');
    const controls = document.getElementById('logo-controls');
    const clearBtn = document.getElementById('set-logo-clear');
    
    if (settings.logo) {
        img.src = settings.logo;
        img.style.width = settings.logoWidth + 'px';
        container.style.display = 'block';
        controls.style.display = 'block';
        clearBtn.style.display = 'inline-block';
        
        // Match align preview
        const val = settings.logoAlign;
        if (val === 'left') container.style.textAlign = 'left';
        else if (val === 'center') container.style.textAlign = 'center';
        else if (val === 'right') container.style.textAlign = 'right';
    } else {
        container.style.display = 'none';
        controls.style.display = 'none';
        clearBtn.style.display = 'none';
    }
}

// --- NAVIGATION & ARCHIVE VIEW ---
navDashboard.onclick = () => {
    navDashboard.style.borderBottomColor = 'var(--primary-color)';
    navDashboard.style.color = 'white';
    navArchive.style.borderBottomColor = 'transparent';
    navArchive.style.color = '#cbd5e1';
    viewDashboard.style.display = 'flex';
    viewArchive.style.display = 'none';
    currentView = 'dashboard';
};

navArchive.onclick = () => {
    navArchive.style.borderBottomColor = 'var(--primary-color)';
    navArchive.style.color = 'white';
    navDashboard.style.borderBottomColor = 'transparent';
    navDashboard.style.color = '#cbd5e1';
    viewDashboard.style.display = 'none';
    viewArchive.style.display = 'flex';
    currentView = 'archive';
    
    // set to current month if empty
    if (!reportMonthInput.value) {
        const now = new Date();
        reportMonthInput.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    }
    if (archiveFilterType) {
        archiveFilterType.value = settings.paymentType || 'เงินสด';
    }
    renderArchiveView();
    renderStats();
};

reportMonthInput.onchange = () => {
    renderArchiveView();
    renderStats();
};

const archiveFilterType = document.getElementById('archive-filter-type');
archiveFilterType.onchange = () => {
    renderArchiveView();
    renderStats();
};

async function renderStats() {
    const archives = await loadAllArchives();
    const monthStr = reportMonthInput.value; // "YYYY-MM"
    if (!monthStr) return; // Don't run if no month selected

    const statsPayment = document.getElementById('stats-payment-types');
    const statsYearly = document.getElementById('stats-yearly');
    if (!statsPayment || !statsYearly) return;
    
    // Monthly Stats
    const filterType = archiveFilterType.value;
    const monthlyArchives = archives.filter(a => a.date && a.date.startsWith(monthStr));
    const payGroup = { 'เงินสด': 0, 'เงินเชื่อ': 0, 'เครื่องประทับไปรษณียากร': 0 };
    
    monthlyArchives.forEach(a => {
        if (!a.items) return;
        const pType = a.paymentType || 'เงินสด'; // fallback
        const fee = a.items.reduce((s, item) => s + (parseFloat(item.fee) || 0), 0);
        if (payGroup.hasOwnProperty(pType)) payGroup[pType] += fee;
    });
    
    const filteredStats = (filterType === 'ทั้งหมด') 
        ? Object.entries(payGroup) 
        : Object.entries(payGroup).filter(([type]) => type === filterType);

    statsPayment.innerHTML = filteredStats.map(([type, total]) => `
        <div style="display: flex; justify-content: space-between; border-bottom: 1px solid #f1f5f9; padding: 4px 0;">
            <span style="font-weight: 600;">${type}:</span>
            <span style="color: #0f766e; font-weight: bold;">${total.toLocaleString()}</span>
        </div>
    `).join('');

    // Yearly Stats
    const currentYear = monthStr.substring(0, 4);
    const yearlyArchives = archives.filter(a => a.date && a.date.startsWith(currentYear));
    const yearTotal = yearlyArchives.reduce((s, a) => {
        if (!a.items) return s;
        return s + a.items.reduce((sum, item) => sum + (parseFloat(item.fee) || 0), 0);
    }, 0);
    const yearItems = yearlyArchives.reduce((s, a) => s + (a.items ? a.items.length : 0), 0);

    statsYearly.innerHTML = `
        <div style="background: #f8fafc; padding: 10px; border-radius: 6px;">
            <div style="font-size: 1.25rem; font-weight: bold; color: var(--primary-color);">${yearTotal.toLocaleString()}</div>
            <div style="font-size: 0.85rem; margin-top: 5px;">จำนวนชิ้นทั้งหมด: <b>${yearItems.toLocaleString()}</b> ชิ้น</div>
        </div>
    `;
}

async function renderArchiveView() {
    const monthStr = reportMonthInput.value; // "YYYY-MM"
    if (!monthStr) return;
    
    // Optimized: Only load data for this month from DB index
    let filtered = await loadArchivesByMonth(monthStr);
    
    const filterType = archiveFilterType.value;
    if (filterType !== 'ทั้งหมด') {
        filtered = filtered.filter(a => (a.paymentType || 'เงินสด') === filterType);
    }
    
    // group by day
    const dayGroups = {};
    filtered.forEach(a => {
        const day = a.date.substring(0, 10); // YYYY-MM-DD
        if (!dayGroups[day]) dayGroups[day] = [];
        dayGroups[day].push(a);
    });
    
    const days = Object.keys(dayGroups).sort();
    
    let totalEmsCount = 0, totalEmsFee = 0;
    let totalOtherCount = 0, totalOtherFee = 0;
    
    archiveList.innerHTML = '';
    
    if (days.length === 0) {
        archiveList.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 20px;">ไม่มีข้อมูลประวัติในเดือนนี้</td></tr>`;
    }
    
    days.forEach(day => {
        let dayEmsCount = 0, dayEmsFee = 0;
        let dayOtherCount = 0, dayOtherFee = 0;
        
        const batches = dayGroups[day];
        
        batches.forEach(b => {
            b.items.forEach(item => {
                const fee = parseFloat(item.fee) || 0;
                if (isEMSGroup(item)) {
                    dayEmsCount++;
                    dayEmsFee += fee;
                } else {
                    dayOtherCount++;
                    dayOtherFee += fee;
                }
            });
        });
        
        totalEmsCount += dayEmsCount;
        totalEmsFee += dayEmsFee;
        totalOtherCount += dayOtherCount;
        totalOtherFee += dayOtherFee;
        
        const dayTotalFee = dayEmsFee + dayOtherFee;
        
        const displayDate = new Date(day).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' });
        
        const tr = document.createElement('tr');
        tr.style.borderBottom = "1px solid #e2e8f0";
        tr.innerHTML = `
            <td style="text-align: center; padding: 12px; font-weight: 600;">${displayDate}</td>
            <td style="text-align: right; padding: 12px; color: #be123c;">${dayEmsCount.toLocaleString()}</td>
            <td style="text-align: right; padding: 12px; color: #be123c; border-right: 1px solid #e2e8f0;">${dayEmsFee.toLocaleString()}</td>
            <td style="text-align: right; padding: 12px; color: #0369a1;">${dayOtherCount.toLocaleString()}</td>
            <td style="text-align: right; padding: 12px; color: #0369a1; border-right: 1px solid #e2e8f0;">${dayOtherFee.toLocaleString()}</td>
            <td style="text-align: right; padding: 12px; font-weight: bold; color: #0f766e;">${dayTotalFee.toLocaleString()}</td>
            <td style="text-align: center; padding: 12px;">
                <select class="view-batch-select" style="padding: 4px; border-radius: 4px; border: 1px solid #ccc;">
                    <option value="">-- เลือกรายการบิล --</option>
                    ${batches.map((b, idx) => `<option value="${b.id}">บิลที่ ${idx + 1} (${b.items.length} รายการ)</option>`).join('')}
                </select>
                <button class="btn-icon edit-batch-btn" style="display: none; background: #e0f2fe; color: #0284c7; font-weight: bold; padding: 4px 10px; margin-left: 5px;">แก้ไข / พิมพ์</button>
            </td>
        `;
        
        const select = tr.querySelector('.view-batch-select');
        const editBtn = tr.querySelector('.edit-batch-btn');
        
        select.onchange = () => {
            editBtn.style.display = select.value ? 'inline-block' : 'none';
        };
        
        editBtn.onclick = async () => {
            const batchId = select.value;
            if (!batchId) return;
            const batch = batches.find(b => b.id === batchId);
            if (!batch) return;
            
            if (!confirm('ต้องการโหลดรายการนี้เข้าไปในแผงควบคุมหลัก เพื่อแก้ไขและพิมพ์ใช่หรือไม่?\n(ข้อมูลบิลปัจจุบันที่ยังไม่ปิดยอด จะถูกแทนที่)')) return;
            
            shipments = [...batch.items];
            history = [JSON.parse(JSON.stringify(shipments))];
            historyIndex = 0;
            editingArchiveId = batchId;
            
            await Promise.all([
                saveToDB('shipments', shipments),
                saveToDB('history', history),
                saveToDB('historyIndex', historyIndex),
                saveToDB('editingArchiveId', editingArchiveId)
            ]);
            
            // Re-sync global state to be safe
            await initApp(); 

            navDashboard.click(); // switch to dashboard view
            
            setTimeout(() => {
                renderShipments();
                updateSummary();
                updateHistoryButtons();
                updatePreview();
            }, 50);
        };
        
        archiveList.appendChild(tr);
    });
    
    document.getElementById('monthly-ems-count').textContent = totalEmsCount.toLocaleString();
    document.getElementById('monthly-ems-fee').textContent = totalEmsFee.toLocaleString();
    document.getElementById('monthly-other-count').textContent = totalOtherCount.toLocaleString();
    document.getElementById('monthly-other-fee').textContent = totalOtherFee.toLocaleString();
    document.getElementById('monthly-total-fee').textContent = (totalEmsFee + totalOtherFee).toLocaleString();
}

exportCsvBtn.onclick = () => {
    const rows = Array.from(archiveList.querySelectorAll('tr'));
    if (rows.length === 0 || (rows.length === 1 && rows[0].innerText.includes('ไม่มีข้อมูล'))) return alert('ไม่มีข้อมูลสำหรับ Export');
    
    let csv = "วันที่,EMS จำนวนชิ้น,EMS ค่าบริการ,อื่นๆ จำนวนชิ้น,อื่นๆ ค่าบริการ,ยอดรวม\n";
    rows.forEach(row => {
        const cols = row.querySelectorAll('td');
        if (cols.length >= 6) {
            const date = cols[0].innerText;
            const emsC = cols[1].innerText.replace(/,/g, '');
            const emsF = cols[2].innerText.replace(/,/g, '');
            const othC = cols[3].innerText.replace(/,/g, '');
            const othF = cols[4].innerText.replace(/,/g, '');
            const tot = cols[5].innerText.replace(/,/g, '');
            csv += `"${date}",${emsC},${emsF},${othC},${othF},${tot}\n`;
        }
    });
    
    const blob = new Blob(["\ufeff" + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `report_${reportMonthInput.value}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
};

// Initial setup
async function initApp() {
    shipments = await loadFromDB('shipments') || [];
    history = await loadFromDB('history') || [JSON.parse(JSON.stringify(shipments))];
    historyIndex = await loadFromDB('historyIndex') || 0;
    editingArchiveId = await loadFromDB('editingArchiveId') || null;
    
    const savedSettings = await loadFromDB('settings');
    if (savedSettings) {
        if (savedSettings.paymentType === 'เงินเชื่อ' && !localStorage.getItem('paymentTypeDefaultMigrated')) {
            savedSettings.paymentType = 'เงินสด';
            await saveToDB('settings', savedSettings);
        }
        settings = { ...settings, ...savedSettings };
        if (!settings.defaultPrefixes) settings.defaultPrefixes = {};
    }
    localStorage.setItem('paymentTypeDefaultMigrated', 'true');
    
    const prefixes = settings.defaultPrefixes?.[currentServiceTab];
    if (prefixes && (Array.isArray(prefixes) ? prefixes.length > 0 : !!prefixes)) {
        const list = Array.isArray(prefixes) ? prefixes : [prefixes];
        prefixInput.value = list[0];
        prefixHelpText.style.display = 'none';
    } else {
        const fallbacks = { 'EMS': 'EX', 'REG': 'RX', 'PARCEL': 'PX', 'ECO': 'OX', 'CUSTOM': 'อื่นๆ' };
        prefixInput.value = fallbacks[currentServiceTab] || '';
        prefixHelpText.style.display = 'block';
    }
    updatePrefixListUI();
    
    document.getElementById('set-license').value = settings.license || '';
    document.getElementById('set-payment-type').value = settings.paymentType || 'เงินสด';
    updateLicenseLabel(settings.paymentType || 'เงินสด');
    setFuelSurcharge.checked = settings.fuelSurcharge;
    document.getElementById('set-post-office').value = settings.postOffice || 'ไปรษณีย์กลาง 10501';
    document.getElementById('settings-home-zip').value = settings.homeZip || '';
    
    document.getElementById('set-show-sig-names').checked = settings.showSignatureNames || false;
    document.getElementById('set-res-name').value = settings.responsibleName || '';
    document.getElementById('set-sender-name').value = settings.senderName || '';
    document.getElementById('settings-home-zip').value = settings.homeZip || '';
    document.getElementById('sig-names-fields').style.display = settings.showSignatureNames ? 'block' : 'none';
    document.getElementById('set-exclude-island-ems').checked = settings.excludeIslandEMS || false;
    document.getElementById('set-exclude-island-eco').checked = settings.excludeIslandEco || false;
    
    document.getElementById('set-special-ems-enabled').checked = settings.specialEmsEnabled || false;
    document.getElementById('set-special-ems-package').value = settings.specialEmsPackage || 'A12';
    document.getElementById('admin-special-ems-fields').style.display = settings.specialEmsEnabled ? 'flex' : 'none';

    // Logo setup
    document.getElementById('set-logo-width').value = settings.logoWidth || 150;
    document.getElementById('logo-width-val').textContent = (settings.logoWidth || 150) + 'px';
    document.getElementById('set-logo-align').value = settings.logoAlign || 'left';
    updateLogoPreview();

    // Meter setup
    document.getElementById('set-meter-desc').value = settings.meterDescending || 0;
    document.getElementById('set-meter-asc').value = settings.meterAscending || 0;
    document.getElementById('meter-settings-fields').style.display = (settings.paymentType === 'เครื่องประทับไปรษณียากร') ? 'block' : 'none';

    if (!reportMonthInput.value) {
        const now = new Date();
        reportMonthInput.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    }
    
    // Auto-set archive filter to current global payment type
    if (archiveFilterType) {
        archiveFilterType.value = settings.paymentType || 'เงินสด';
    }
    
    updatePreview();
    renderShipments();
    updateSummary();
    updateHistoryButtons();
    updateMeterStatus();
    renderStats();
    
    // Setup Fluent Navigation (Enter Key)
    setupFluentNavigation();
    
    // set dispatch btn state if editing
    if (editingArchiveId) {
        dispatchBtn.innerHTML = '💾 บันทึกการแก้ไข (Update)';
        dispatchBtn.style.background = '#0ea5e9';
    }
    
    // Admin Settings UI Event Listeners
    if (setSpecialEmsEnabled && adminSpecialEmsFields) {
        setSpecialEmsEnabled.onchange = (e) => {
            adminSpecialEmsFields.style.display = e.target.checked ? 'flex' : 'none';
        };
    }
    
    if (appVersionTrigger) {
        appVersionTrigger.ondblclick = () => {
            const pass = prompt("กรุณากรอกรหัสผ่านผู้ดูแลระบบ (Admin Password) เพื่อแก้ไขการตั้งค่าขั้นสูง:");
            if (pass === 'admin1234' || pass === 'mraek') {
                if (adminSettingsSection) {
                    adminSettingsSection.style.display = 'block';
                }
                settingsModal.style.display = 'flex';
                alert("🔓 ปลดล็อคระบบการตั้งค่าขั้นสูงสำหรับ Admin เรียบร้อยแล้ว!");
            } else if (pass !== null) {
                alert("❌ รหัสผ่านไม่ถูกต้อง");
            }
        };
    }
}

function setupFluentNavigation() {
    const fields = [
        prefixInput, digitsInput, num8StartInput, digitsEndInput, batchCountInput,
        recipientInput, destInput, dimW, dimL, dimH, weightInput, feeInput
    ];

    fields.forEach((f, index) => {
        if (!f) return;
        f.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();

                // 1. BULK MODE Logic
                if (bulkToggle.checked) {
                    if (f === prefixInput) {
                        console.log(`[Fluent Navigation] Bulk: prefixInput -> num8StartInput`);
                        num8StartInput.focus();
                        num8StartInput.select();
                        return;
                    }
                    if (f === num8StartInput) {
                        console.log(`[Fluent Navigation] Bulk: num8StartInput -> batchCountInput`);
                        batchCountInput.focus();
                        batchCountInput.select();
                        return;
                    }
                    if (f === digitsEndInput) {
                        console.log(`[Fluent Navigation] Bulk: digitsEndInput -> weightInput`);
                        weightInput.focus();
                        weightInput.select();
                        return;
                    }
                    if (f === batchCountInput) {
                        console.log(`[Fluent Navigation] Bulk: batchCountInput -> weightInput`);
                        weightInput.focus();
                        weightInput.select();
                        return;
                    }
                    if (f === dimW) {
                        console.log(`[Fluent Navigation] Bulk: dimW -> dimL`);
                        dimL.focus();
                        dimL.select();
                        return;
                    }
                    if (f === dimL) {
                        console.log(`[Fluent Navigation] Bulk: dimL -> dimH`);
                        dimH.focus();
                        dimH.select();
                        return;
                    }
                    if (f === dimH) {
                        console.log(`[Fluent Navigation] Bulk: dimH -> weightInput`);
                        weightInput.focus();
                        weightInput.select();
                        return;
                    }
                    if (f === weightInput) {
                        if (currentServiceTab === 'CUSTOM') {
                            console.log(`[Fluent Navigation] Bulk: weightInput -> feeInput`);
                            feeInput.focus();
                            feeInput.select();
                        } else {
                            console.log(`[Fluent Navigation] Bulk: weightInput -> addBtn.click`);
                            addBtn.click();
                        }
                        return;
                    }
                    if (f === feeInput) {
                        console.log(`[Fluent Navigation] Bulk: feeInput -> addBtn.click`);
                        addBtn.click();
                        return;
                    }
                } 
                // 2. SINGLE MODE Logic
                else {
                    if (f === prefixInput) {
                        console.log(`[Fluent Navigation] Single: prefixInput -> digitsInput`);
                        digitsInput.focus();
                        digitsInput.select();
                        return;
                    }
                    if (f === digitsInput) {
                        console.log(`[Fluent Navigation] Single: digitsInput -> recipientInput`);
                        recipientInput.focus();
                        return;
                    }
                    if (f === recipientInput) {
                        console.log(`[Fluent Navigation] Single: recipientInput -> destInput`);
                        destInput.focus();
                        return;
                    }
                    if (f === destInput) {
                        console.log(`[Fluent Navigation] Single: destInput -> weightInput`);
                        weightInput.focus();
                        weightInput.select();
                        return;
                    }
                    if (f === dimW) {
                        console.log(`[Fluent Navigation] Single: dimW -> dimL`);
                        dimL.focus();
                        dimL.select();
                        return;
                    }
                    if (f === dimL) {
                        console.log(`[Fluent Navigation] Single: dimL -> dimH`);
                        dimH.focus();
                        dimH.select();
                        return;
                    }
                    if (f === dimH) {
                        console.log(`[Fluent Navigation] Single: dimH -> weightInput`);
                        weightInput.focus();
                        weightInput.select();
                        return;
                    }
                    if (f === weightInput) {
                        if (currentServiceTab === 'CUSTOM') {
                            console.log(`[Fluent Navigation] Single: weightInput -> feeInput`);
                            feeInput.focus();
                            feeInput.select();
                        } else {
                            console.log(`[Fluent Navigation] Single: weightInput -> addBtn.click`);
                            addBtn.click();
                        }
                        return;
                    }
                    if (f === feeInput) {
                        console.log(`[Fluent Navigation] Single: feeInput -> addBtn.click`);
                        addBtn.click();
                        return;
                    }
                }

                // Fallback: Navigation to next visible field
                let nextIdx = index + 1;
                while (nextIdx < fields.length) {
                    const nextField = fields[nextIdx];
                    if (nextField && nextField.offsetParent !== null) {
                        nextField.focus();
                        if (nextField.select) nextField.select();
                        return;
                    }
                    nextIdx++;
                }
            }
        });
    });
}

window.onload = initApp;

// --- BATCH OPERATIONS HELPER EVENT LISTENERS ---
const toggleBatchBtn = document.getElementById('toggle-batch-btn');
const batchHelperPanel = document.getElementById('batch-helper-panel');

if (toggleBatchBtn && batchHelperPanel) {
    toggleBatchBtn.onclick = () => {
        const isHidden = batchHelperPanel.style.display === 'none';
        batchHelperPanel.style.display = isHidden ? 'block' : 'none';
        toggleBatchBtn.style.background = isHidden ? '#eff6ff' : '#f8fafc';
        toggleBatchBtn.style.color = isHidden ? '#1d4ed8' : '#64748b';
        toggleBatchBtn.style.borderColor = isHidden ? '#bfdbfe' : '#cbd5e1';
    };
}

// Range selection toggle
const batchRangeType = document.getElementById('batch-range-type');
const batchRangeInputs = document.getElementById('batch-range-inputs');
if (batchRangeType && batchRangeInputs) {
    batchRangeType.onchange = (e) => {
        batchRangeInputs.style.display = e.target.value === 'range' ? 'flex' : 'none';
    };
}

// Enable/Disable input triggers
const checkboxesWithInputs = [
    { cb: 'batch-enable-weight', input: 'batch-weight-input' },
    { cb: 'batch-enable-ar', input: 'batch-ar-input' }
];

checkboxesWithInputs.forEach(({ cb, input }) => {
    const cbEl = document.getElementById(cb);
    const inputEl = document.getElementById(input);
    if (cbEl && inputEl) {
        cbEl.onchange = (e) => {
            inputEl.disabled = !e.target.checked;
            inputEl.style.background = e.target.checked ? '#ffffff' : '#f1f5f9';
        };
    }
});

// Insurance enable/disable trigger
const batchEnableIns = document.getElementById('batch-enable-ins');
const batchInsInput = document.getElementById('batch-ins-input');
const batchInsVal = document.getElementById('batch-ins-val');
if (batchEnableIns && batchInsInput && batchInsVal) {
    batchEnableIns.onchange = (e) => {
        const active = e.target.checked;
        batchInsInput.disabled = !active;
        batchInsInput.style.background = active ? '#ffffff' : '#f1f5f9';
        batchInsVal.disabled = !active;
        batchInsVal.style.background = active ? '#ffffff' : '#f1f5f9';
    };
}

// --- BATCH OPERATIONS HELPER APPLY LOGIC ---
async function applyBatchChanges() {
    if (!shipments || shipments.length === 0) {
        alert('❌ ไม่มีรายการพัสดุในตารางที่จะแก้ไข');
        return;
    }

    const enableWeight = document.getElementById('batch-enable-weight').checked;
    const enableAR = document.getElementById('batch-enable-ar').checked;
    const enableIns = document.getElementById('batch-enable-ins').checked;

    if (!enableWeight && !enableAR && !enableIns) {
        alert('⚠️ กรุณาเลือกอย่างน้อยหนึ่งตัวเลือก (น้ำหนัก, AR, หรือ การรับประกัน) เพื่อทำการปรับปรุงข้อมูลแบบกลุ่ม');
        return;
    }

    const rangeType = document.getElementById('batch-range-type').value;
    let startIdx = 1;
    let endIdx = shipments.length;

    if (rangeType === 'range') {
        const startVal = parseInt(document.getElementById('batch-start-idx').value);
        const endVal = parseInt(document.getElementById('batch-end-idx').value);

        if (isNaN(startVal) || isNaN(endVal) || startVal < 1 || endVal < 1 || startVal > endVal) {
            alert('❌ กรุณาระบุช่วงลำดับพัสดุ (จาก - ถึง) ให้ถูกต้องตามหลักคณิตศาสตร์');
            return;
        }

        if (startVal > shipments.length || endVal > shipments.length) {
            alert(`❌ ลำดับที่คุณระบุเกินจำนวนรายการพัสดุจริงในระบบ (ปัจจุบันมี ${shipments.length} รายการ)`);
            return;
        }

        startIdx = startVal;
        endIdx = endVal;
    }

    // Parsed options values
    const newWeight = enableWeight ? parseFloat(document.getElementById('batch-weight-input').value) || 0 : null;
    const newAR = enableAR ? (document.getElementById('batch-ar-input').value === 'true') : null;
    const newInsActive = enableIns ? (document.getElementById('batch-ins-input').value === 'true') : null;
    const newInsVal = enableIns ? parseFloat(document.getElementById('batch-ins-val').value) || 0 : null;

    if (enableWeight && isNaN(newWeight)) {
        alert('❌ กรุณาระบุน้ำหนักพัสดุให้เป็นตัวเลขที่ถูกต้อง');
        return;
    }
    if (enableIns && newInsActive && isNaN(newInsVal)) {
        alert('❌ กรุณาระบุวงเงินการรับประกันพัสดุให้เป็นตัวเลขที่ถูกต้อง');
        return;
    }

    let updatedCount = 0;

    // Standard arrays are 0-based, range indices are 1-based
    for (let i = startIdx - 1; i <= endIdx - 1; i++) {
        const s = shipments[i];
        if (!s) continue;
        if (!s.options) s.options = {};

        // 1. Update Weight
        if (enableWeight) {
            let calcWeight = newWeight;
            if (s.options.dimensions) {
                const { w, l, h } = s.options.dimensions;
                if (w > 0 && l > 0 && h > 0) {
                    const volWeight = Math.ceil((w * l * h) / 6000) * 1000;
                    if (volWeight > newWeight) {
                        s.options.useVolWeight = true;
                        calcWeight = volWeight;
                    } else {
                        s.options.useVolWeight = false;
                    }
                }
            }
            s.weight = newWeight;
        }

        // 2. Update AR
        if (enableAR) {
            s.options.ar = newAR;
            s.options.arTracking = false; // reset tracking-ar to standard
        }

        // 3. Update Insurance
        if (enableIns) {
            const maxIns = s.serviceType === 'EMS' ? 50000 : (s.serviceType === 'ECO' ? 0 : 5000);
            if (newInsActive && maxIns > 0) {
                s.options.insurance = true;
                s.options.insuranceVal = Math.min(newInsVal, maxIns);
            } else {
                s.options.insurance = false;
                s.options.insuranceVal = 0;
            }
        }

        // 4. Update remote & island surcharge status
        const zipMatch = s.destination ? s.destination.match(/\d{5}/) : null;
        const zip = zipMatch ? zipMatch[0] : null;
        const isRemoteZip = zip && !!REMOTE_AREAS[zip];
        const homeZipGroup = settings.homeZip ? REMOTE_AREAS[settings.homeZip] : null;
        const zipGroup = zip ? REMOTE_AREAS[zip] : null;
        const sameGroup = zipGroup && homeZipGroup && zipGroup === homeZipGroup;

        if (isRemoteZip && !sameGroup) {
            const isIsland = PARTIAL_REMOTE_ZIPS.includes(zip);
            if (isIsland && ((s.serviceType === 'EMS' && settings.excludeIslandEMS) || (s.serviceType === 'ECO' && settings.excludeIslandEco))) {
                s.options.isRemote = false;
                s.isIsland = true;
            } else {
                s.options.isRemote = true;
                s.isIsland = isIsland;
            }
        } else {
            s.options.isRemote = false;
            s.isIsland = false;
        }

        // 5. Recalculate Fee
        let calcW = s.weight;
        if (s.options.dimensions) {
            const { w, l, h } = s.options.dimensions;
            if (w > 0 && l > 0 && h > 0) {
                const volWeight = Math.ceil((w * l * h) / 6000) * 1000;
                calcW = Math.max(s.weight, volWeight);
            }
        }

        let base = calculateBaseFee(s.serviceType, calcW, s.options);
        
        // Add fuel surcharge if applicable
        if (settings.fuelSurcharge && (s.serviceType === 'EMS' || s.serviceType === 'ECO')) {
            base += 3;
        }

        s.fee = base;
        updatedCount++;
    }

    // Save and Refresh
    await updateHistory();
    updatePreview();
    renderShipments();
    updateSummary();
    updateMeterStatus();
    renderStats();

    alert(`🎉 ปรับปรุงข้อมูลแบบกลุ่มสำเร็จเรียบร้อยแล้ว จำนวน ${updatedCount} รายการ!`);
}

const batchApplyBtn = document.getElementById('batch-apply-btn');
if (batchApplyBtn) {
    batchApplyBtn.onclick = applyBatchChanges;
}
