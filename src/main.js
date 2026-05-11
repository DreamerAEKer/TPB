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
  EMS: { tiers: [[10, 32], [20, 32], [100, 37], [250, 42], [500, 52], [1000, 67], [2000, 97], [5000, 197]], ar: 12 },
  EMS_JUMBO: { tiers: [[5000, 250], [10000, 350], [15000, 450], [20000, 550], [25000, 650], [30000, 750]], ar: 12 },
  REG_ENVELOPE: { tiers: [[10, 18], [20, 19], [100, 24], [250, 30], [500, 36], [1000, 53], [2000, 75]], ar: 3 },
  REG_BOX: { tiers: [[10, 22], [20, 22], [100, 26], [250, 32], [500, 38], [1000, 55], [2000, 77]], ar: 3 },
  ECO: { tiers: [[10, 20], [20, 20], [100, 22], [250, 26], [500, 30], [1000, 40], [2000, 60]], ar: 3 },
  PARCEL: { base: 25, baseWeight: 1000, perKg: 20, ar: 3 }
};

const REMOTE_ALWAYS_ZIPCODES = new Set(['20150', '21160', '23000', '23120', '23170', '50250', '50310', '50350', '55130', '55220', '57170', '57180', '57260', '57310', '57340', '58000', '58110', '58120', '58130', '58140', '58150', '63150', '63170', '71180', '71240', '81210', '82000', '83000', '83100', '83110', '83120', '83130', '83150', '84140', '84310', '85000', '91000', '91110', '92110', '92120', '94000', '94110', '94120', '94130', '94140', '94150', '94160', '94170', '94180', '94190', '94220', '94230', '95000', '95110', '95120', '95130', '95140', '95150', '95160', '95170', '96000', '96110', '96120', '96130', '96140', '96150', '96160', '96170', '96180', '96190', '96210', '96220']);
const REMOTE_ISLAND_ZIPCODES = new Set(['20120', '81130', '81150', '82160', '84220', '84280', '84320', '84330', '84360']);

// --- APP STATE ---
let shipments = [];
let history = [];
let historyIndex = 0;
let currentServiceTab = 'EMS';
let settings = { company: '', address: '', phone: '', license: '', fuelSurcharge: false };
let editingArchiveId = null;
let currentView = 'dashboard';

// --- DOM ELEMENTS ---
const prefixInput = document.getElementById('prefix');
const digitsInput = document.getElementById('digits');
const digitsEndInput = document.getElementById('digits-end');
const batchCountInput = document.getElementById('batch-count');
const bulkToggle = document.getElementById('bulk-mode-toggle');
const batchEndGroup = document.getElementById('batch-end-group');

const recipientInput = document.getElementById('recipient');
const destInput = document.getElementById('destination');
const customServiceGroup = document.getElementById('custom-service-group');
const customServiceNameInput = document.getElementById('custom-service-name');
const weightInput = document.getElementById('weight');
const feeInput = document.getElementById('fee');
const feeUnitLabel = document.getElementById('fee-unit-label');
const shipmentList = document.getElementById('shipment-list');

const optAR = document.getElementById('opt-ar');
const optInsurance = document.getElementById('opt-insurance');
const insuranceVal = document.getElementById('insurance-val');
const optRemote = document.getElementById('opt-remote');

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
const dimW = document.getElementById('dim-w');
const dimL = document.getElementById('dim-l');
const dimH = document.getElementById('dim-h');
const jumboBadge = document.getElementById('jumbo-badge');
const setFuelSurcharge = document.getElementById('set-fuel-surcharge');
const optArTracking = document.getElementById('opt-ar-tracking');
const optArTrackingRow = document.getElementById('opt-ar-tracking-row');
const optInsuranceRow = document.getElementById('opt-insurance-row');
const optArRow = document.getElementById('opt-ar-row');

// --- HELPERS ---
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
    
    if (type === 'PARCEL') {
        baseFee = rates.PARCEL.base;
        if (weight > rates.PARCEL.baseWeight) {
            baseFee += Math.ceil((weight - rates.PARCEL.baseWeight) / 1000) * rates.PARCEL.perKg;
        }
    } else {
        let actualType = type;
        if (type === 'REG') {
            actualType = (options.regType === 'BOX') ? 'REG_BOX' : 'REG_ENVELOPE';
        } else if (type === 'EMS' && options.isJumbo) {
            actualType = 'EMS_JUMBO';
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
        const v = options.insuranceVal || 0;
        if (v <= 20000) baseFee += 15 + Math.ceil(v / 500) * 5;
        else baseFee += 215 + Math.ceil((v - 20000) / 500) * 10;
    }
    return baseFee;
}

function isRemoteArea(zip, isIsland = false) {
    if (REMOTE_ALWAYS_ZIPCODES.has(zip)) return true;
    if (REMOTE_ISLAND_ZIPCODES.has(zip) && isIsland) return true;
    return false;
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
      dispatchBtn.style.background = '#0ea5e9';
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
  const totalFee = filtered.reduce((s, x) => s + parseFloat(x.fee || 0), 0);
  
  document.getElementById('total-items').textContent = totalItems.toLocaleString();
  document.getElementById('total-fee').textContent = totalFee.toLocaleString();

  ['EMS', 'REG', 'ECO', 'PARCEL', 'CUSTOM'].forEach(svc => {
      const count = shipments.filter(s => s.serviceType === svc).length;
      const counterEl = document.getElementById(`count-${svc.toLowerCase()}`);
      if(counterEl) counterEl.textContent = count;
  });
}

function renderShipments() {
  shipmentList.innerHTML = '';

  const filtered = shipments.map((s, originalIdx) => ({ ...s, originalIdx }))
                           .filter(s => s.serviceType === currentServiceTab);

  filtered.forEach((s, displayIdx) => {
    const i = s.originalIdx;
    const zipMatch = s.destination.match(/\d{5}/);
    const zip = zipMatch ? zipMatch[0] : null;
    const isAlwaysRemote = zip && REMOTE_ALWAYS_ZIPCODES.has(zip);
    const isIslandPotential = zip && REMOTE_ISLAND_ZIPCODES.has(zip);
    const isActuallyRemote = isAlwaysRemote || (isIslandPotential && s.isIsland);

    const baseFee = calculateBaseFee(s.serviceType, s.weight, s.options || {});
    const isPriceNormalWithSurcharge = parseFloat(s.fee) === (baseFee + 20);
    const priceClass = (!isActuallyRemote && isPriceNormalWithSurcharge && s.serviceType !== 'CUSTOM') ? 'price-warn' : '';

    const svcDisplay = s.serviceType === 'CUSTOM' ? (s.customServiceName || 'กำหนดเอง') : s.serviceType;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${displayIdx + 1}</td>
      <td class="editable-cell" contenteditable="true" data-field="recipient" data-index="${i}" data-placeholder="ระบุนามผู้รับ...">${s.recipient || ''}</td>
      <td class="editable-cell" data-index="${i}">
        <div contenteditable="true" data-field="destination" data-index="${i}" data-placeholder="ระบุปลายทาง..." style="outline:none; width: 100%;">
            ${highlightPostcode(s.destination, isActuallyRemote)}
        </div>
        ${isIslandPotential ? `<label class="island-check"><input type="checkbox" ${s.isIsland ? 'checked' : ''} onchange="toggleIsland(${i}, this.checked)"> เป็นเกาะ</label>` : ''}
      </td>
      <td class="tracking-cell">
        <div style="font-size: 0.85rem; color: #6b7280; margin-bottom: 2px;">${svcDisplay}</div>
        <div style="font-weight: 600;">${s.trackingFormatted}</div>
      </td>
      <td>${s.weight} กรัม</td>
      <td class="editable-cell ${priceClass}" contenteditable="true" data-field="fee" data-index="${i}" title="${priceClass ? 'พื้นที่ปกติ แต่มีการบวกเพิ่ม 20 บาท?' : ''}">${s.fee} ฿</td>
      <td><button class="btn-icon delete-btn" data-index="${i}">ลบ</button></td>
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
        const val = e.target.innerText.replace(' ฿', '').trim();
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
        if (field === 'fee' && s.serviceType !== 'CUSTOM') {
            const oldFee = s.fee;
            applySmartPricing(idx);
            if (s.fee !== oldFee) needsRender = true;
        } else if (field === 'destination') {
            if (s.serviceType !== 'CUSTOM') applySmartPricing(idx);
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
        return isRemote ? `<span class="remote-highlight">${match}</span>` : match;
    });
}

window.toggleIsland = async (i, checked) => {
    shipments[i].isIsland = checked;
    applySmartPricing(i);
    renderShipments();
    updateSummary();
    await updateHistory();
};

function applySmartPricing(i) {
    const s = shipments[i];
    if(s.serviceType === 'CUSTOM') return;
    
    const zipMatch = s.destination.match(/\d{5}/);
    const zip = zipMatch ? zipMatch[0] : null;
    const canHaveRemote = (s.serviceType !== 'PARCEL' && s.serviceType !== 'REG' && s.serviceType !== 'CUSTOM');
    const isActuallyRemote = zip && isRemoteArea(zip, s.isIsland) && canHaveRemote;
    const base = calculateBaseFee(s.serviceType, s.weight, s.options || {});
    const currentFee = parseFloat(s.fee);

    if (isActuallyRemote && currentFee === base) {
        s.fee = base + 20;
    }
}

function updatePreview() {
  const w = parseFloat(weightInput.value) || 0;
  
  // Show/Hide sub-type groups based on active tab (currentServiceTab)
  const activeSvc = currentServiceTab;
  regTypeGroup.style.display = (activeSvc === 'REG') ? 'block' : 'none';
  emsDimGroup.style.display = (activeSvc === 'EMS') ? 'block' : 'none';
  optInsuranceRow.style.display = (activeSvc === 'EMS') ? 'flex' : 'none';
  optArTrackingRow.style.display = (activeSvc === 'REG') ? 'flex' : 'none';
  
  // Rule: Parcel and REG do not have remote surcharge
  const canHaveRemote = (activeSvc !== 'PARCEL' && activeSvc !== 'REG' && activeSvc !== 'CUSTOM');
  const destinationZip = destInput.value.match(/\d{5}/);
  const zip = destinationZip ? destinationZip[0] : null;
  const badge = document.getElementById('remote-status-badge');
  
  const isAlwaysRemote = zip && REMOTE_ALWAYS_ZIPCODES.has(zip) && canHaveRemote;
  const isIslandPotential = zip && REMOTE_ISLAND_ZIPCODES.has(zip) && canHaveRemote;
  
  if (isAlwaysRemote || isIslandPotential) {
      optRemote.checked = true;
      badge.classList.remove('hidden');
      badge.querySelector('span:last-child').textContent = isAlwaysRemote ? 'บวกพื้นที่ห่างไกล (+20 ฿)' : 'พบรหัสพื้นที่เกาะ (+20 ฿)';
  } else {
      optRemote.checked = false;
      badge.classList.add('hidden');
  }

  // Fuel Surcharge Note
  const fuelBadge = document.getElementById('fuel-surcharge-badge');
  if (settings.fuelSurcharge && (activeSvc === 'EMS' || activeSvc === 'ECO')) {
      fuelBadge.classList.remove('hidden');
  } else {
      fuelBadge.classList.add('hidden');
  }

  // Insurance detail depends on both EMS tab and checkbox
  document.getElementById('insurance-detail').style.display = (optInsurance.checked && activeSvc === 'EMS') ? 'flex' : 'none';

  // EMS Jumbo Detection (Only on EMS tab)
  let isJumbo = false;
  if (activeSvc === 'EMS') {
      const w = parseFloat(dimW.value) || 0;
      const l = parseFloat(dimL.value) || 0;
      const h = parseFloat(dimH.value) || 0;
      const total = w + l + h;
      const maxSide = Math.max(w, l, h);
      
      if (maxSide > 60 && total <= 120) isJumbo = true;
      if (maxSide > 60 && maxSide <= 120 && total <= 240) isJumbo = true;
      jumboBadge.style.display = isJumbo ? 'block' : 'none';
  }

  if (activeSvc !== 'CUSTOM') {
      const base = calculateBaseFee(activeSvc, w, { 
        ar: optAR.checked, 
        arTracking: optArTracking.checked,
        insurance: optInsurance.checked, 
        insuranceVal: parseFloat(insuranceVal.value),
        regType: regTypeInput.value,
        isJumbo: isJumbo
      });
      let total = base;
      if (optRemote.checked) total += 20;
      
      if (settings.fuelSurcharge && (activeSvc === 'EMS' || activeSvc === 'ECO')) {
          total += 3;
      }
      feeInput.value = total;
  }
}

function syncBatchInputs(source) {
    let startStr = digitsInput.value.replace(/\D/g, '');
    if (currentServiceTab === 'CUSTOM') startStr = digitsInput.value;
    
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
        }
        
        if (currentServiceTab === 'CUSTOM') {
             const match = digitsInput.value.match(/(\d+)$/);
             if (match) {
                 const numLen = match[1].length;
                 const baseStr = digitsInput.value.substring(0, match.index);
                 const endN = parseInt(match[1]) + count - 1;
                 digitsEndInput.value = baseStr + endN.toString().padStart(numLen, '0');
             } else {
                 digitsEndInput.value = digitsInput.value; 
             }
        } else {
             digitsEndInput.value = (startNum + count - 1).toString().padStart(8, '0');
        }
    }
}

// --- PRINTING LOGIC ---
function generatePrintPages(itemsToPrint, container, titleSuffix = "") {
    const ITEMS_PER_PAGE = 30;
    const totalPages = Math.ceil(itemsToPrint.length / ITEMS_PER_PAGE) || 1;
    
    const company = settings.company || '......................................';
    const address = settings.address || '........................................';
    const phone = settings.phone || '..................';
    const license = settings.license || 'พ. ...... / 2563';
    
    for (let p = 0; p < totalPages; p++) {
        const pageItems = itemsToPrint.slice(p * ITEMS_PER_PAGE, (p + 1) * ITEMS_PER_PAGE);
        let rowsHtml = '';
        
        for (let i = 0; i < ITEMS_PER_PAGE; i++) {
            if (i < pageItems.length) {
                const s = pageItems[i];
                rowsHtml += `
                    <tr>
                        <td style="padding: 3px 4px;">${p * ITEMS_PER_PAGE + i + 1}</td>
                        <td style="text-align: left; padding: 3px 4px;">${s.recipient || ''}</td>
                        <td style="text-align: left; padding: 3px 4px;">${s.destination || ''}</td>
                        <td style="font-family: monospace; font-size: 11pt; padding: 3px 4px;">${s.trackingFormatted}</td>
                        <td style="padding: 3px 4px;">${s.options?.insurance ? s.options.insuranceVal : ''}</td>
                        <td style="padding: 3px 4px;">${s.weight}</td>
                        <td style="padding: 3px 4px;">${s.fee}</td>
                        <td style="padding: 3px 4px;"></td>
                    </tr>
                `;
            } else {
                rowsHtml += `<tr><td style="padding: 3px 4px;">&nbsp;</td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>`;
            }
        }
        
        const pageHtml = `
            <div class="print-page">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 5px;">
                    <div>
                        <div style="font-size: 11pt;">บริษัท <b>${company}</b></div>
                        <div style="font-size: 11pt;">ที่อยู่ <b>${address}</b></div>
                        <div style="font-size: 11pt;">โทรศัพท์ <b>${phone}</b></div>
                    </div>
                    <div style="text-align: right;">
                        <h2 style="margin: 0; font-size: 14pt;">ใบนำส่งสิ่งของทางไปรษณีย์ โดยชำระค่าบริการเป็นเงินเชื่อ</h2>
                        ${titleSuffix ? `<div style="font-size: 12pt; font-weight: bold;">(${titleSuffix})</div>` : ''}
                        <div style="font-size: 11pt; margin-top: 5px;">ใบอนุญาตพิเศษที่ <b>${license}</b></div>
                        <div style="font-size: 11pt;">วันที่ ........................................ ฝากส่งครั้งที่ ........... ใบที่ <b>${p + 1} / ${totalPages}</b></div>
                    </div>
                </div>
                <div style="margin-bottom: 5px; font-size: 11pt;">
                    เรียน หัวหน้าทำการไปรษณีย์กลาง ขอนำส่งไปรษณียภัณฑ์ตามรายการดังนี้
                </div>
                <div style="flex: 1;">
                    <table style="width: 100%; border-collapse: collapse; text-align: center; font-size: 11pt;" border="1">
                        <thead style="background: #f0f0f0;">
                            <tr>
                                <th rowspan="2" style="padding: 4px;">ลำดับที่</th>
                                <th rowspan="2" style="padding: 4px;">นามผู้รับ</th>
                                <th rowspan="2" style="padding: 4px;">ปลายทาง<br>รหัสไปรษณีย์</th>
                                <th rowspan="2" style="padding: 4px; width: 150px;">เลขที่สิ่งของ 13 หลัก</th>
                                <th colspan="3" style="padding: 4px;">การรับประกัน และค่าบริการ</th>
                                <th rowspan="2" style="padding: 4px;">หมายเหตุ</th>
                            </tr>
                            <tr>
                                <th style="padding: 4px;">รับประกัน<br>(บาท)</th>
                                <th style="padding: 4px;">น้ำหนัก<br>(กรัม)</th>
                                <th style="padding: 4px;">ค่าบริการ<br>(บาท)</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${rowsHtml}
                        </tbody>
                    </table>
                </div>
                <div style="display: flex; justify-content: space-between; margin-top: 10px; font-size: 11pt; border-top: 1px dashed #ccc; padding-top: 10px;">
                    <div style="width: 50%;">
                        <div style="margin-bottom: 8px;">ลงชื่อ ........................................................ ผู้รับผิดชอบฝากส่ง</div>
                        <div style="margin-bottom: 8px;">(........................................................)</div>
                        <div style="margin-bottom: 0;">ลงชื่อ ........................................................ ผู้จัดส่ง</div>
                    </div>
                    <div style="width: 45%; text-align: right;">
                        <div style="margin-bottom: 5px;">ผู้ตรวจสอบและรับฝากไว้แล้ว</div>
                        <div style="margin-bottom: 5px;">ลงชื่อ ........................................................</div>
                        <div style="margin-bottom: 5px;">เจ้าหน้าที่รับฝาก</div>
                        <div style="margin-top: 5px; font-size: 10pt;">ไปรษณีย์กลาง 10501</div>
                    </div>
                </div>
            </div>
        `;
        container.innerHTML += pageHtml;
    }
}

function generateSummarySheet(items, titleSuffix) {
    const groups = {};
    items.forEach(item => {
        const svc = item.customServiceName || item.serviceType;
        if (!groups[svc]) groups[svc] = [];
        groups[svc].push(item);
    });
    
    let rangeRows = '';
    let totalItemsAll = 0;
    const priceMap = {};
    
    for (const [svc, svcItems] of Object.entries(groups)) {
        totalItemsAll += svcItems.length;
        
        let start = svcItems[0].trackingFormatted;
        let end = svcItems[svcItems.length - 1].trackingFormatted;
        
        rangeRows += `
            <tr>
                <td style="padding: 8px;">${svc}</td>
                <td style="font-family: monospace; padding: 8px;">${start}</td>
                <td style="font-family: monospace; padding: 8px;">${end}</td>
                <td style="padding: 8px;">${svcItems.length}</td>
                <td style="padding: 8px;"></td>
            </tr>
        `;
        
        svcItems.forEach(item => {
            const fee = parseFloat(item.fee) || 0;
            if (!priceMap[fee]) priceMap[fee] = 0;
            priceMap[fee]++;
        });
    }
    
    const totalFee = items.reduce((sum, item) => sum + (parseFloat(item.fee) || 0), 0);
    
    let priceBreakdownHtml = Object.entries(priceMap)
        .sort((a,b) => parseFloat(a[0]) - parseFloat(b[0]))
        .map(([price, count]) => `<span style="display:inline-block; margin-right: 15px;">เรท <b>${price}฿</b> = ${count} ชิ้น</span>`)
        .join('');
        
    const company = settings.company || '......................................';
    const license = settings.license || '................';
    
    return `
        <div class="print-page">
            <center><h2 style="font-size: 18pt;">ใบสรุปการฝากส่งไปรษณียภัณฑ์ชำระค่าฝากส่งเป็นเงินเชื่อ<br><span style="color: #444; font-size: 16pt;">หมวด: ${titleSuffix}</span></h2></center>
            <div style="display: flex; justify-content: space-between; margin-bottom: 20px; font-size: 12pt;">
                <div>
                    <div>บริษัท <b>${company}</b></div>
                    <div>ใบอนุญาตพิเศษที่ <b>${license}</b></div>
                </div>
                <div>วันที่ ........................................</div>
            </div>
            
            <table style="width: 100%; border-collapse: collapse; text-align: center; font-size: 12pt; margin-bottom: 20px;" border="1">
                <thead style="background: #f0f0f0;">
                    <tr><th colspan="5" style="padding: 8px;">รายการเลขที่สิ่งของ ที่นำมาฝากส่งในวันนี้</th></tr>
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
                    <tr>
                        <th colspan="3" style="text-align: right; padding: 8px 15px;">รวมทั้งหมด</th>
                        <th style="padding: 8px;">${totalItemsAll}</th>
                        <th style="padding: 8px;"></th>
                    </tr>
                </tbody>
            </table>
            
            <div style="display: flex; gap: 20px; font-size: 12pt;">
                <div style="flex: 1;">
                    <table style="width: 100%; border-collapse: collapse; text-align: center;" border="1">
                        <tr><th colspan="2" style="background: #f0f0f0; padding: 8px;">รวมค่าบริการ (บาท)</th></tr>
                        <tr><td style="text-align: left; padding: 8px 15px;">ยอดยกมา</td><td style="padding: 8px;"></td></tr>
                        <tr><td style="text-align: left; padding: 8px 15px;">ยอดครั้งนี้</td><td style="padding: 8px;"><b>${totalFee.toLocaleString()}</b></td></tr>
                        <tr><td style="text-align: left; padding: 8px 15px;">ยอดยกไป</td><td style="padding: 8px;"></td></tr>
                    </table>
                </div>
                <div style="flex: 2;">
                    <div style="background: #fafafa; padding: 15px; border: 1px solid #ddd; border-radius: 8px; font-size: 11pt;">
                        <div style="margin-bottom: 8px;"><b>รายละเอียดชิ้นต่อราคา (อ้างอิง):</b></div>
                        ${priceBreakdownHtml}
                    </div>
                </div>
            </div>
            
            <div style="display: flex; justify-content: space-between; margin-top: 30px; font-size: 11pt; border-top: 1px dashed #ccc; padding-top: 15px;">
                <div style="width: 50%; text-align: center;">
                    <div style="margin-bottom: 10px;">ลงชื่อ ........................................................</div>
                    <div style="margin-bottom: 10px;">(........................................................)</div>
                    <div>ผู้รับผิดชอบในการฝากส่ง</div>
                </div>
                <div style="width: 45%; text-align: center;">
                    <div style="margin-bottom: 10px;">ลงชื่อ ........................................................</div>
                    <div style="margin-bottom: 10px;">เจ้าหน้าที่รับฝาก</div>
                </div>
            </div>
        </div>
    `;
}

// --- EVENT HANDLERS ---
function toggleBulkMode() {
    const isBulk = bulkToggle.checked;
    batchEndGroup.style.display = isBulk ? 'block' : 'none';
    feeUnitLabel.style.display = isBulk ? 'inline' : 'none';
    document.querySelectorAll('.single-only').forEach(el => el.style.display = isBulk ? 'none' : 'block');
    if (isBulk) syncBatchInputs('count');
}

bulkToggle.addEventListener('change', toggleBulkMode);

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
};

digitsInput.oninput = (e) => {
  if (currentServiceTab !== 'CUSTOM') {
      e.target.value = e.target.value.replace(/\D/g, '').substring(0, 8);
  }
  updatePreview();
  if (bulkToggle.checked) syncBatchInputs('count');
};

digitsEndInput.oninput = (e) => {
    if (currentServiceTab !== 'CUSTOM') e.target.value = e.target.value.replace(/\D/g, '').substring(0, 8);
    syncBatchInputs('end');
};

batchCountInput.oninput = () => syncBatchInputs('count');
weightInput.oninput = updatePreview;
feeInput.oninput = updatePreview;
optAR.onchange = updatePreview;
optInsurance.onchange = updatePreview;
insuranceVal.oninput = updatePreview;
destInput.oninput = () => updatePreview();
optArTracking.onchange = updatePreview;
dimW.oninput = updatePreview;
dimL.oninput = updatePreview;
dimH.oninput = updatePreview;
regTypeInput.onchange = updatePreview;

addBtn.onclick = async (e) => {
  e.preventDefault();
  const p = prefixInput.value.trim().toUpperCase();
  const startD = digitsInput.value.trim();
  const type = getServiceType(p);
  const w = parseFloat(weightInput.value) || 0;
  
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
          
          shipments.push({
              recipient: '',
              destination: '',
              serviceType: type,
              customServiceName: type === 'CUSTOM' ? (customServiceNameInput.value || 'กำหนดเอง') : null,
              weight: w,
              options: { 
                ar: optAR.checked, 
                arTracking: optArTracking.checked,
                insurance: optInsurance.checked, 
                insuranceVal: parseFloat(insuranceVal.value),
                regType: regTypeInput.value,
                isJumbo: jumboBadge.style.display === 'block',
                dimensions: { w: parseFloat(dimW.value), l: parseFloat(dimL.value), h: parseFloat(dimH.value) }
              },
              isIsland: false,
              trackingFormatted: trackingFormatted,
              fee: feeInput.value || 0
          });
      }
      
      if (type !== 'CUSTOM') {
          digitsInput.value = (parseInt(startD) + (count * step)).toString().padStart(8, '0');
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
      
          shipments.push({
              recipient: recipientInput.value || '',
              destination: destInput.value || '',
              serviceType: type,
              customServiceName: type === 'CUSTOM' ? (customServiceNameInput.value || 'กำหนดเอง') : null,
              weight: w,
              options: { 
                ar: optAR.checked, 
                arTracking: optArTracking.checked,
                insurance: optInsurance.checked, 
                insuranceVal: parseFloat(insuranceVal.value),
                regType: regTypeInput.value,
                isJumbo: jumboBadge.style.display === 'block',
                dimensions: { w: parseFloat(dimW.value), l: parseFloat(dimL.value), h: parseFloat(dimH.value) }
              },
              isIsland: optRemote.checked && REMOTE_ISLAND_ZIPCODES.has(destInput.value.match(/\d{5}/)?.[0]),
              trackingFormatted: trackingFormatted,
              fee: feeInput.value || 0
          });
      
      if (type !== 'CUSTOM') {
          const step = (type === 'REG' && optArTracking.checked) ? 2 : 1;
          digitsInput.value = (parseInt(startD) + step).toString().padStart(8, '0');
      }
      recipientInput.value = '';
      destInput.value = '';
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
  
  if (bulkToggle.checked) syncBatchInputs('count');
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
  printSection.innerHTML = '';
  generatePrintPages(filtered, printSection, currentServiceTab);
  window.print();
};

dispatchBtn.onclick = async () => {
    if (!shipments.length) return alert('ไม่มีรายการให้จัดส่ง/บันทึก');
    
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
        await saveArchive({
            id: archiveId,
            date: dateStr,
            items: [...shipments]
        });
    }
    
    // GENERATE SPLIT PRINT LAYOUT (EMS vs Others)
    const emsGroup = shipments.filter(s => isEMSGroup(s));
    const otherGroup = shipments.filter(s => !isEMSGroup(s));
    
    const printSection = document.getElementById('print-section');
    printSection.innerHTML = '';
    
    if (emsGroup.length > 0) {
        printSection.innerHTML += generateSummarySheet(emsGroup, "กลุ่ม EMS");
        generatePrintPages(emsGroup, printSection, "กลุ่ม EMS");
    }
    
    if (otherGroup.length > 0) {
        printSection.innerHTML += generateSummarySheet(otherGroup, "กลุ่มอื่นๆ");
        generatePrintPages(otherGroup, printSection, "กลุ่มอื่นๆ");
    }
    
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
};

nextNumBtn.onclick = () => {
  const v = digitsInput.value;
  if (currentServiceTab !== 'CUSTOM' && v.length === 8) {
    digitsInput.value = (parseInt(v) + 1).toString().padStart(8, '0');
    updatePreview();
    if (bulkToggle.checked) syncBatchInputs('count');
  }
};

// Service Tabs Switching
document.querySelectorAll('.service-tab').forEach(tab => {
    tab.onclick = () => {
        currentServiceTab = tab.dataset.service;
        document.querySelectorAll('.service-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        serviceTitle.textContent = `จัดการรายการ: ${currentServiceTab === 'CUSTOM' ? 'อื่นๆ' : currentServiceTab}`;
        
        customServiceGroup.style.display = (currentServiceTab === 'CUSTOM') ? 'block' : 'none';
        
        renderShipments();
        updateSummary();
        updatePreview(); // Fix: Ensure UI fields hide/show immediately on tab change
    };
});

// Settings Modal
settingsBtn.onclick = () => settingsModal.style.display = 'flex';
closeSettingsBtn.onclick = () => settingsModal.style.display = 'none';
saveSettingsBtn.onclick = async () => {
    settings.company = document.getElementById('set-company').value;
    settings.address = document.getElementById('set-address').value;
    settings.phone = document.getElementById('set-phone').value;
    settings.license = document.getElementById('set-license').value;
    settings.fuelSurcharge = setFuelSurcharge.checked;
    await saveToDB('settings', settings);
    settingsModal.style.display = 'none';
    updatePreview();
    alert('บันทึกการตั้งค่าสำเร็จ');
};

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
    renderArchiveView();
};

reportMonthInput.onchange = renderArchiveView;

async function renderArchiveView() {
    const monthStr = reportMonthInput.value; // "YYYY-MM"
    if (!monthStr) return;
    
    const allArchives = await loadAllArchives();
    
    // filter by month
    const filtered = allArchives.filter(a => a.date.startsWith(monthStr));
    
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
            <td style="text-align: right; padding: 12px; color: #be123c; border-right: 1px solid #e2e8f0;">${dayEmsFee.toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
            <td style="text-align: right; padding: 12px; color: #0369a1;">${dayOtherCount.toLocaleString()}</td>
            <td style="text-align: right; padding: 12px; color: #0369a1; border-right: 1px solid #e2e8f0;">${dayOtherFee.toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
            <td style="text-align: right; padding: 12px; font-weight: bold; color: #0f766e;">${dayTotalFee.toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
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
            
            await saveToDB('shipments', shipments);
            await saveToDB('history', history);
            await saveToDB('historyIndex', historyIndex);
            await saveToDB('editingArchiveId', editingArchiveId);
            
            navDashboard.click(); // switch tab
            
            renderShipments();
            updateSummary();
            updateHistoryButtons();
        };
        
        archiveList.appendChild(tr);
    });
    
    document.getElementById('monthly-ems-count').textContent = totalEmsCount.toLocaleString();
    document.getElementById('monthly-ems-fee').textContent = totalEmsFee.toLocaleString(undefined, {minimumFractionDigits: 2});
    document.getElementById('monthly-other-count').textContent = totalOtherCount.toLocaleString();
    document.getElementById('monthly-other-fee').textContent = totalOtherFee.toLocaleString(undefined, {minimumFractionDigits: 2});
    document.getElementById('monthly-total-fee').textContent = (totalEmsFee + totalOtherFee).toLocaleString(undefined, {minimumFractionDigits: 2});
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
    if (savedSettings) settings = savedSettings;
    
    document.getElementById('set-license').value = settings.license || '';
    setFuelSurcharge.checked = settings.fuelSurcharge || false;

    updatePreview();
    renderShipments();
    updateSummary();
    updateHistoryButtons();
    
    // set dispatch btn state if editing
    if (editingArchiveId) {
        dispatchBtn.innerHTML = '💾 บันทึกการแก้ไข (Update)';
        dispatchBtn.style.background = '#0ea5e9';
    }
}

window.onload = initApp;
