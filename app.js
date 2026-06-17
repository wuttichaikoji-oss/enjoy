const STORAGE_KEY = 'rubberBillJaoJoyV3';
const PREVIOUS_STORAGE_KEYS = ['rubberBillJaoJoyV2', 'rubberBillV1'];
const FIREBASE_VERSION = '10.12.5';
const CLOUD_ROOT_COLLECTION = 'rubberSitpin';
const CLOUD_COLLECTIONS = ['customers', 'factories', 'prices', 'purchases', 'sales', 'stockAdjustments'];
const DEFAULT_FIREBASE_CONFIG = {
  apiKey: "AIzaSyDntNUq_uLtPqkpp_MN2YDc6J2f_b-7n3A",
  authDomain: "enjoy-5eff3.firebaseapp.com",
  projectId: "enjoy-5eff3",
  storageBucket: "enjoy-5eff3.firebasestorage.app",
  messagingSenderId: "285653213272",
  appId: "1:285653213272:web:fffa3bdf0bc7ac92562a2d",
  measurementId: "G-KYJKPXTZYS"
};
const DEFAULT_FIREBASE_CONFIG_TEXT = JSON.stringify(DEFAULT_FIREBASE_CONFIG, null, 2);

const THB = new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB' });
const NUM = new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const LEGACY_SHOP_NAMES = ['รับซื้อยาง เจ้จอย', 'รับซื้อยาง เจ๊จอย'];
const NEW_SHOP_NAME = 'สิทธิ์-ปิ่น น้ำยางสด';

function migrateShopName(name) {
  const value = String(name || '').trim();
  if (!value || LEGACY_SHOP_NAMES.includes(value)) return NEW_SHOP_NAME;
  return value;
}

const defaultState = {
  settings: {
    shopName: NEW_SHOP_NAME,
    shopAddress: '',
    shopPhone: '',
    defaultStaff: '',
    receiptSize: '80',
    roundingMode: 'none',
    firebaseConfigText: DEFAULT_FIREBASE_CONFIG_TEXT,
    firebaseShopCode: 'sitpin-main',
    cloudSyncEnabled: true,
    lastCloudSyncAt: ''
  },
  customers: [],
  factories: [],
  prices: [],
  purchases: [],
  sales: [],
  stockAdjustments: []
};

let state = loadState();
state.settings.shopName = migrateShopName(state.settings.shopName);
applyFirebaseDefaults();
let lastPurchaseId = null;
let lastSaleId = null;
let firebaseCtx = null;
let cloudUnsubscribes = [];
let cloudSaveTimer = null;
let isApplyingCloud = false;
let isConnectingCloud = false;

const $ = (id) => document.getElementById(id);

function normalizeState(parsed = {}) {
  return {
    settings: { ...defaultState.settings, ...(parsed.settings || {}), shopName: migrateShopName(parsed.settings?.shopName), firebaseShopCode: parsed.settings?.firebaseShopCode || defaultState.settings.firebaseShopCode },
    customers: parsed.customers || [],
    factories: parsed.factories || [],
    prices: parsed.prices || [],
    purchases: parsed.purchases || parsed.bills || [],
    sales: parsed.sales || [],
    stockAdjustments: parsed.stockAdjustments || []
  };
}

function migrateV1(old = {}) {
  return {
    ...structuredClone(defaultState),
    settings: { ...defaultState.settings, ...(old.settings || {}), shopName: NEW_SHOP_NAME, firebaseShopCode: old.settings?.firebaseShopCode || defaultState.settings.firebaseShopCode },
    customers: old.customers || [],
    factories: [],
    prices: (old.prices || []).map((p) => ({
      id: p.id || uid('price'),
      date: p.date,
      latexBuyDrc: p.latexDrc || 0,
      cupBuyKg: p.cupKg || 0,
      cupBuyDrc: p.cupDrc || 0,
      latexSaleDrc: 0,
      cupSaleKg: 0,
      cupSaleDrc: 0,
      createdAt: p.createdAt || new Date().toISOString()
    })),
    purchases: old.bills || [],
    sales: [],
    stockAdjustments: []
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return normalizeState(JSON.parse(raw));

    const v2Raw = localStorage.getItem('rubberBillJaoJoyV2');
    if (v2Raw) return normalizeState(JSON.parse(v2Raw));

    const v1Raw = localStorage.getItem('rubberBillV1');
    if (v1Raw) return migrateV1(JSON.parse(v1Raw));

    return structuredClone(defaultState);
  } catch (error) {
    console.error(error);
    return structuredClone(defaultState);
  }
}

function saveLocalState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function applyFirebaseDefaults() {
  let changed = false;
  if (!state.settings.firebaseConfigText) {
    state.settings.firebaseConfigText = DEFAULT_FIREBASE_CONFIG_TEXT;
    changed = true;
  }
  if (!state.settings.firebaseShopCode || state.settings.firebaseShopCode === 'jaojoy-main') {
    state.settings.firebaseShopCode = defaultState.settings.firebaseShopCode;
    changed = true;
  }
  if (changed && state.settings.cloudSyncEnabled !== true) {
    state.settings.cloudSyncEnabled = true;
  }
  if (changed) saveLocalState();
}

function saveState() {
  saveLocalState();
  renderCloudStatus();
  if (!isApplyingCloud && state.settings.cloudSyncEnabled) scheduleCloudPush();
}

function parseFirebaseConfig(text) {
  let clean = String(text || '').trim();
  if (!clean) throw new Error('กรุณาวาง Firebase Config ก่อน');
  clean = clean
    .replace(/^const\s+firebaseConfig\s*=\s*/m, '')
    .replace(/^var\s+firebaseConfig\s*=\s*/m, '')
    .replace(/^let\s+firebaseConfig\s*=\s*/m, '')
    .replace(/;\s*$/m, '')
    .trim();
  try {
    let cfg;
    try {
      cfg = JSON.parse(clean);
    } catch (_) {
      cfg = Function(`"use strict"; return (${clean});`)();
    }
    if (!cfg.apiKey || !cfg.projectId) throw new Error('Firebase Config ต้องมี apiKey และ projectId');
    return cfg;
  } catch (error) {
    throw new Error(error.message || 'Firebase Config JSON ไม่ถูกต้อง');
  }
}

function cleanShopCode(value) {
  return String(value || 'sitpin-main').trim().replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 60) || 'sitpin-main';
}

function renderCloudStatus(extraText = '') {
  const connected = !!firebaseCtx && state.settings.cloudSyncEnabled;
  const label = connected ? `Cloud Sync: ${firebaseCtx.shopCode}` : (state.settings.cloudSyncEnabled ? 'Cloud: ยังไม่เชื่อม' : 'Local only');
  ['cloudStatus', 'cloudStatusHeader'].forEach((id) => {
    const el = $(id);
    if (!el) return;
    el.textContent = label;
    el.classList.toggle('cloud', connected);
    el.classList.toggle('local', !connected);
  });
  const last = $('cloudLastSync');
  if (last) last.textContent = extraText || (state.settings.lastCloudSyncAt ? `ซิงก์ล่าสุด: ${new Date(state.settings.lastCloudSyncAt).toLocaleString('th-TH')}` : 'ยังไม่ได้ซิงก์ Cloud');
}

async function loadFirebaseModules() {
  const appMod = await import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-app.js`);
  const authMod = await import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-auth.js`);
  const fsMod = await import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-firestore.js`);
  return { appMod, authMod, fsMod };
}

async function connectFirebaseFromSettings() {
  if (isConnectingCloud) return;
  isConnectingCloud = true;
  renderCloudStatus('กำลังเชื่อม Firebase...');
  try {
    state.settings.firebaseConfigText = $('firebaseConfigText').value.trim();
    state.settings.firebaseShopCode = cleanShopCode($('firebaseShopCode').value);
    state.settings.cloudSyncEnabled = true;
    saveLocalState();
    await initFirebaseCloud();
    await pushFullStateToCloud();
    subscribeCloudRealtime();
    renderCloudStatus('เชื่อม Firebase แล้ว');
    toast('เชื่อม Firebase แล้ว');
  } catch (error) {
    state.settings.cloudSyncEnabled = false;
    saveLocalState();
    renderCloudStatus(error.message || 'เชื่อม Firebase ไม่สำเร็จ');
    toast(error.message || 'เชื่อม Firebase ไม่สำเร็จ');
  } finally {
    isConnectingCloud = false;
  }
}

async function initFirebaseCloud() {
  const config = parseFirebaseConfig(state.settings.firebaseConfigText);
  const shopCode = cleanShopCode(state.settings.firebaseShopCode);
  const { appMod, authMod, fsMod } = await loadFirebaseModules();
  const appName = `rubber-sitpin-${shopCode}`;
  const existing = appMod.getApps().find((app) => app.name === appName);
  const app = existing || appMod.initializeApp(config, appName);
  const auth = authMod.getAuth(app);
  if (!auth.currentUser) await authMod.signInAnonymously(auth);
  const db = fsMod.getFirestore(app);
  firebaseCtx = { app, auth, db, shopCode, fsMod };
  return firebaseCtx;
}

function cloudPath(collectionName, id) {
  return firebaseCtx.fsMod.doc(firebaseCtx.db, CLOUD_ROOT_COLLECTION, firebaseCtx.shopCode, collectionName, id);
}

function metaPath() {
  return firebaseCtx.fsMod.doc(firebaseCtx.db, CLOUD_ROOT_COLLECTION, firebaseCtx.shopCode, 'meta', 'settings');
}

function sanitizeForFirestore(item) {
  return JSON.parse(JSON.stringify(item || {}));
}

function scheduleCloudPush() {
  if (!firebaseCtx || !state.settings.cloudSyncEnabled) return;
  clearTimeout(cloudSaveTimer);
  cloudSaveTimer = setTimeout(() => pushFullStateToCloud().catch((err) => {
    console.warn(err);
    renderCloudStatus(err.message || 'ซิงก์ Cloud ไม่สำเร็จ');
  }), 900);
}

async function pushFullStateToCloud() {
  if (!firebaseCtx || !state.settings.cloudSyncEnabled) return;
  const { fsMod } = firebaseCtx;
  const safeSettings = { ...state.settings, firebaseConfigText: '', updatedAt: new Date().toISOString() };
  await fsMod.setDoc(metaPath(), safeSettings, { merge: true });
  for (const name of CLOUD_COLLECTIONS) {
    const items = state[name] || [];
    for (const item of items) {
      if (!item.id) item.id = uid(name);
      await fsMod.setDoc(cloudPath(name, item.id), sanitizeForFirestore(item), { merge: true });
    }
  }
  state.settings.lastCloudSyncAt = new Date().toISOString();
  saveLocalState();
  renderCloudStatus();
}

function subscribeCloudRealtime() {
  if (!firebaseCtx) return;
  unsubscribeCloud();
  const { fsMod } = firebaseCtx;

  cloudUnsubscribes.push(fsMod.onSnapshot(metaPath(), (snap) => {
    if (!snap.exists()) return;
    const cloudSettings = snap.data();
    isApplyingCloud = true;
    const keep = {
      firebaseConfigText: state.settings.firebaseConfigText,
      firebaseShopCode: state.settings.firebaseShopCode,
      cloudSyncEnabled: state.settings.cloudSyncEnabled,
      lastCloudSyncAt: state.settings.lastCloudSyncAt
    };
    state.settings = { ...defaultState.settings, ...state.settings, ...cloudSettings, ...keep };
    saveLocalState();
    isApplyingCloud = false;
    renderAll();
  }, (error) => renderCloudStatus(error.message || 'อ่าน Cloud settings ไม่สำเร็จ')));

  CLOUD_COLLECTIONS.forEach((name) => {
    const ref = fsMod.collection(firebaseCtx.db, CLOUD_ROOT_COLLECTION, firebaseCtx.shopCode, name);
    cloudUnsubscribes.push(fsMod.onSnapshot(ref, (snap) => {
      isApplyingCloud = true;
      state[name] = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => String(b.createdAt || b.date || '').localeCompare(String(a.createdAt || a.date || '')));
      saveLocalState();
      isApplyingCloud = false;
      renderAll();
      renderCloudStatus();
    }, (error) => renderCloudStatus(error.message || `อ่าน Cloud ${name} ไม่สำเร็จ`)));
  });
}

function unsubscribeCloud() {
  cloudUnsubscribes.forEach((fn) => { try { fn(); } catch (_) {} });
  cloudUnsubscribes = [];
}

async function pullCloudOnce() {
  if (!firebaseCtx) await initFirebaseCloud();
  const { fsMod } = firebaseCtx;
  isApplyingCloud = true;
  const meta = await fsMod.getDoc(metaPath());
  if (meta.exists()) {
    const keep = {
      firebaseConfigText: state.settings.firebaseConfigText,
      firebaseShopCode: state.settings.firebaseShopCode,
      cloudSyncEnabled: state.settings.cloudSyncEnabled,
      lastCloudSyncAt: new Date().toISOString()
    };
    state.settings = { ...defaultState.settings, ...state.settings, ...meta.data(), ...keep };
  }
  for (const name of CLOUD_COLLECTIONS) {
    const snap = await fsMod.getDocs(fsMod.collection(firebaseCtx.db, CLOUD_ROOT_COLLECTION, firebaseCtx.shopCode, name));
    state[name] = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }
  isApplyingCloud = false;
  state.settings.lastCloudSyncAt = new Date().toISOString();
  saveLocalState();
  renderAll();
  subscribeCloudRealtime();
  toast('ดึงข้อมูลจาก Cloud แล้ว');
}

async function cloudDeleteRecord(name, id) {
  if (!firebaseCtx || !state.settings.cloudSyncEnabled || !id) return;
  try { await firebaseCtx.fsMod.deleteDoc(cloudPath(name, id)); } catch (error) { console.warn(error); }
}

async function clearCloudData() {
  if (!firebaseCtx || !state.settings.cloudSyncEnabled) return;
  const { fsMod } = firebaseCtx;
  for (const name of CLOUD_COLLECTIONS) {
    const snap = await fsMod.getDocs(fsMod.collection(firebaseCtx.db, CLOUD_ROOT_COLLECTION, firebaseCtx.shopCode, name));
    for (const d of snap.docs) await fsMod.deleteDoc(d.ref);
  }
}

function disconnectFirebase() {
  unsubscribeCloud();
  firebaseCtx = null;
  state.settings.cloudSyncEnabled = false;
  saveLocalState();
  renderCloudStatus('ปิด Cloud Sync แล้ว');
  toast('ปิด Cloud Sync แล้ว');
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function currentTime() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

function uid(prefix = 'id') {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function n(value) {
  const num = parseFloat(value);
  return Number.isFinite(num) ? num : 0;
}

function safeText(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
}

function roundPay(amount) {
  const mode = state.settings.roundingMode;
  if (mode === 'baht') return Math.round(amount);
  if (mode === 'five') return Math.floor(amount / 5) * 5;
  return amount;
}

function productLabel(type) {
  return { latex: 'น้ำยางสด', cup: 'ขี้ยาง / ยางก้อนถ้วย', scrap: 'เศษยาง' }[type] || type;
}

function methodLabel(method) {
  return method === 'drc' ? 'คิดแบบ DRC' : 'คิดตามกิโลกรัม';
}

function paymentLabel(method, kind = 'purchase') {
  if (kind === 'sale') return { cash: 'เงินสด', transfer: 'โอน', credit: 'ค้างรับ' }[method] || method;
  return { cash: 'เงินสด', transfer: 'โอน', credit: 'ค้างจ่าย' }[method] || method;
}

function statusLabel(status, kind = 'purchase') {
  if (kind === 'sale') return { received: 'รับเงินแล้ว', pending: 'ค้างรับ', cancelled: 'ยกเลิก' }[status] || status;
  return { paid: 'จ่ายแล้ว', pending: 'ค้างจ่าย', cancelled: 'ยกเลิก' }[status] || status;
}

function statCard(label, value, sub = '', cls = '') {
  return `<div class="card stat ${cls}"><small>${label}</small><strong>${value}</strong><div class="sub">${sub}</div></div>`;
}

function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => el.classList.remove('show'), 2300);
}

function switchTab(tabId) {
  document.querySelectorAll('.tab-btn').forEach((btn) => btn.classList.toggle('active', btn.dataset.tab === tabId));
  document.querySelectorAll('.tab-panel').forEach((panel) => panel.classList.toggle('active', panel.id === tabId));
  renderAll();
}

function getPriceForDate(date) {
  return state.prices.find((p) => p.date === date) || state.prices.slice().sort((a, b) => b.date.localeCompare(a.date))[0] || null;
}

function applyDefaultPurchasePrice(force = false) {
  const price = getPriceForDate($('purchaseDate').value || todayISO());
  if (!price) return;
  const type = $('purchaseProduct').value;
  const method = $('purchaseMethod').value;
  if (type === 'latex' && method === 'drc' && (force || !$('purchasePriceDrc100').value)) $('purchasePriceDrc100').value = price.latexBuyDrc || '';
  if (type === 'cup' && method === 'kg' && (force || !$('purchasePriceKg').value)) $('purchasePriceKg').value = price.cupBuyKg || '';
  if (type === 'cup' && method === 'drc' && (force || !$('purchasePriceDrc100').value)) $('purchasePriceDrc100').value = price.cupBuyDrc || '';
  if (type === 'scrap' && method === 'kg' && (force || !$('purchasePriceKg').value)) $('purchasePriceKg').value = price.cupBuyKg || '';
}

function applyDefaultSalePrice(force = false) {
  const price = getPriceForDate($('saleDate').value || todayISO());
  if (!price) return;
  const type = $('saleProduct').value;
  const method = $('saleMethod').value;
  if (type === 'latex' && method === 'drc' && (force || !$('salePriceDrc100').value)) $('salePriceDrc100').value = price.latexSaleDrc || price.latexBuyDrc || '';
  if (type === 'cup' && method === 'kg' && (force || !$('salePriceKg').value)) $('salePriceKg').value = price.cupSaleKg || price.cupBuyKg || '';
  if (type === 'cup' && method === 'drc' && (force || !$('salePriceDrc100').value)) $('salePriceDrc100').value = price.cupSaleDrc || price.cupBuyDrc || '';
  if (type === 'scrap' && method === 'kg' && (force || !$('salePriceKg').value)) $('salePriceKg').value = price.cupSaleKg || price.cupBuyKg || '';
}

function updatePurchaseVisibility() {
  const type = $('purchaseProduct').value;
  if (type === 'latex') {
    $('purchaseMethod').value = 'drc';
    [...$('purchaseMethod').options].forEach((option) => option.disabled = option.value === 'kg');
  } else {
    [...$('purchaseMethod').options].forEach((option) => option.disabled = false);
  }
  const method = $('purchaseMethod').value;
  document.querySelectorAll('.purchase-drc-field').forEach((el) => el.classList.toggle('hidden', method !== 'drc'));
  document.querySelectorAll('.purchase-kg-field').forEach((el) => el.classList.toggle('hidden', method !== 'kg'));
  applyDefaultPurchasePrice();
  calculatePurchasePreview();
}

function updateSaleVisibility() {
  const type = $('saleProduct').value;
  if (type === 'latex') {
    $('saleMethod').value = 'drc';
    [...$('saleMethod').options].forEach((option) => option.disabled = option.value === 'kg');
  } else {
    [...$('saleMethod').options].forEach((option) => option.disabled = false);
  }
  const method = $('saleMethod').value;
  document.querySelectorAll('.sale-drc-field').forEach((el) => el.classList.toggle('hidden', method !== 'drc'));
  document.querySelectorAll('.sale-kg-field').forEach((el) => el.classList.toggle('hidden', method !== 'kg'));
  applyDefaultSalePrice();
  fillSaleCostSuggestion();
  calculateSalePreview();
}

function calculateTransaction({ grossWeight, tareWeight, method, drcPercent, priceDrc100, pricePerKg, deductions = 0, expenses = 0 }) {
  const netWeight = Math.max(grossWeight - tareWeight, 0);
  let dryWeight = 0;
  let effectiveKgPrice = 0;
  let grossAmount = 0;

  if (method === 'drc') {
    dryWeight = netWeight * drcPercent / 100;
    effectiveKgPrice = priceDrc100 * drcPercent / 100;
    grossAmount = dryWeight * priceDrc100;
  } else {
    effectiveKgPrice = pricePerKg;
    grossAmount = netWeight * pricePerKg;
  }

  const netAmountBeforeRound = Math.max(grossAmount - deductions - expenses, 0);
  const netAmount = roundPay(netAmountBeforeRound);

  return { netWeight, dryWeight, effectiveKgPrice, grossAmount, netAmountBeforeRound, netAmount };
}

function calculatePurchaseFromForm() {
  const grossWeight = n($('purchaseGross').value);
  const tareWeight = n($('purchaseTare').value);
  const method = $('purchaseMethod').value;
  const drcPercent = n($('purchaseDrc').value);
  const priceDrc100 = n($('purchasePriceDrc100').value);
  const pricePerKg = n($('purchasePriceKg').value);
  const transportDeduct = n($('purchaseTransportDeduct').value);
  const debtDeduct = n($('purchaseDebtDeduct').value);
  const otherDeduct = n($('purchaseOtherDeduct').value);
  const totalDeduct = transportDeduct + debtDeduct + otherDeduct;
  const calc = calculateTransaction({ grossWeight, tareWeight, method, drcPercent, priceDrc100, pricePerKg, deductions: totalDeduct });
  return { grossWeight, tareWeight, method, drcPercent, priceDrc100, pricePerKg, transportDeduct, debtDeduct, otherDeduct, totalDeduct, ...calc, netPay: calc.netAmount, grossAmount: calc.grossAmount };
}

function calculatePurchasePreview() {
  const result = calculatePurchaseFromForm();
  $('purchaseNet').value = NUM.format(result.netWeight);
  $('purchaseEffectiveKg').value = result.method === 'drc' ? THB.format(result.effectiveKgPrice) : '';
  $('purchaseDry').value = result.method === 'drc' ? NUM.format(result.dryWeight) : '';
  $('purchaseGrossAmountPreview').textContent = THB.format(result.grossAmount);
  $('purchaseDeductPreview').textContent = THB.format(result.totalDeduct);
  $('purchaseNetPayPreview').textContent = THB.format(result.netPay);
}

function avgCostPerKg(productType) {
  const purchases = activePurchases().filter((p) => p.productType === productType && p.netWeight > 0);
  const totalWeight = purchases.reduce((sum, p) => sum + (p.netWeight || 0), 0);
  const totalCost = purchases.reduce((sum, p) => sum + (p.netPay || 0), 0);
  return totalWeight > 0 ? totalCost / totalWeight : 0;
}

function fillSaleCostSuggestion(force = false) {
  const cost = avgCostPerKg($('saleProduct').value);
  if (force || !$('saleCostKg').value) $('saleCostKg').value = cost ? cost.toFixed(2) : '';
  $('saleCostHint').textContent = cost ? `ต้นทุนเฉลี่ยแนะนำ ${THB.format(cost)} / กก.` : 'ยังไม่มีต้นทุนซื้อของสินค้าประเภทนี้';
}

function calculateSaleFromForm() {
  const grossWeight = n($('saleGross').value);
  const tareWeight = n($('saleTare').value);
  const method = $('saleMethod').value;
  const drcPercent = n($('saleDrc').value);
  const priceDrc100 = n($('salePriceDrc100').value);
  const pricePerKg = n($('salePriceKg').value);
  const saleExpense = n($('saleExpense').value);
  const costPerKg = n($('saleCostKg').value);
  const calc = calculateTransaction({ grossWeight, tareWeight, method, drcPercent, priceDrc100, pricePerKg });
  const costAmount = calc.netWeight * costPerKg;
  const netSale = roundPay(Math.max(calc.grossAmount - saleExpense, 0));
  const profit = netSale - costAmount;
  return { grossWeight, tareWeight, method, drcPercent, priceDrc100, pricePerKg, saleExpense, costPerKg, costAmount, profit, netSale, ...calc, netAmount: netSale };
}

function calculateSalePreview() {
  const result = calculateSaleFromForm();
  $('saleNet').value = NUM.format(result.netWeight);
  $('saleEffectiveKg').value = result.method === 'drc' ? THB.format(result.effectiveKgPrice) : '';
  $('saleDry').value = result.method === 'drc' ? NUM.format(result.dryWeight) : '';
  $('saleGrossAmountPreview').textContent = THB.format(result.grossAmount);
  $('saleCostPreview').textContent = THB.format(result.costAmount + result.saleExpense);
  $('saleProfitPreview').textContent = THB.format(result.profit);
}

function generateNumber(prefix, date, collection) {
  const count = collection.filter((item) => item.date === date).length + 1;
  return `${prefix}-${date.replaceAll('-', '')}-${String(count).padStart(3, '0')}`;
}

async function imageFileToDataUrl(input) {
  const file = input.files && input.files[0];
  if (!file) return '';
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const max = 900;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.72));
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function validateTransaction(calc, kind) {
  if (calc.grossWeight <= 0) throw new Error('กรุณาใส่น้ำหนักรวม');
  if (calc.tareWeight > calc.grossWeight) throw new Error('หักถังมากกว่าน้ำหนักรวมไม่ได้');
  if (calc.method === 'drc') {
    if (calc.drcPercent <= 0 || calc.drcPercent > 100) throw new Error('กรุณาใส่ DRC ระหว่าง 0-100%');
    if (calc.priceDrc100 <= 0) throw new Error('กรุณาใส่ราคา DRC 100');
  }
  if (calc.method === 'kg' && calc.pricePerKg <= 0) throw new Error('กรุณาใส่ราคาต่อกิโลกรัม');
  if (kind === 'sale' && calc.netWeight > stockByProduct()[ $('saleProduct').value ].netWeight + 0.0001) {
    const ok = confirm('น้ำหนักขายมากกว่าสต๊อกคงเหลือ ต้องการบันทึกต่อหรือไม่?');
    if (!ok) throw new Error('ยกเลิกการบันทึกบิลขาย');
  }
}

async function readPurchaseForm() {
  const calc = calculatePurchaseFromForm();
  validateTransaction(calc, 'purchase');
  const date = $('purchaseDate').value || todayISO();
  const customerName = $('purchaseCustomer').value.trim();
  if (!customerName) throw new Error('กรุณาใส่ชื่อชาวสวน');
  const imageData = await imageFileToDataUrl($('purchaseImage'));
  return {
    id: uid('purchase'),
    billNo: generateNumber('PB', date, state.purchases),
    date,
    time: $('purchaseTime').value || currentTime(),
    customerName,
    productType: $('purchaseProduct').value,
    method: $('purchaseMethod').value,
    ...calc,
    deductNote: $('purchaseDeductNote').value.trim(),
    paymentMethod: $('purchasePaymentMethod').value,
    status: $('purchaseStatus').value,
    note: $('purchaseNote').value.trim(),
    imageData,
    staffName: state.settings.defaultStaff || '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

async function readSaleForm() {
  const calc = calculateSaleFromForm();
  validateTransaction(calc, 'sale');
  const date = $('saleDate').value || todayISO();
  const factoryName = $('saleFactory').value.trim();
  if (!factoryName) throw new Error('กรุณาใส่ชื่อโรงงาน');
  const imageData = await imageFileToDataUrl($('saleImage'));
  return {
    id: uid('sale'),
    billNo: generateNumber('SB', date, state.sales),
    date,
    time: $('saleTime').value || currentTime(),
    factoryName,
    productType: $('saleProduct').value,
    method: $('saleMethod').value,
    ...calc,
    paymentMethod: $('salePaymentMethod').value,
    status: $('saleStatus').value,
    note: $('saleNote').value.trim(),
    imageData,
    staffName: state.settings.defaultStaff || '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function resetPurchaseForm(keepCustomer = false) {
  const customer = $('purchaseCustomer').value;
  $('purchaseForm').reset();
  $('purchaseDate').value = todayISO();
  $('purchaseTime').value = currentTime();
  $('purchaseTare').value = '0';
  $('purchaseTransportDeduct').value = '0';
  $('purchaseDebtDeduct').value = '0';
  $('purchaseOtherDeduct').value = '0';
  $('purchaseProduct').value = 'latex';
  $('purchaseMethod').value = 'drc';
  $('purchaseStatus').value = 'paid';
  if (keepCustomer) $('purchaseCustomer').value = customer;
  updatePurchaseVisibility();
}

function resetSaleForm(keepFactory = false) {
  const factory = $('saleFactory').value;
  $('saleForm').reset();
  $('saleDate').value = todayISO();
  $('saleTime').value = currentTime();
  $('saleTare').value = '0';
  $('saleExpense').value = '0';
  $('saleProduct').value = 'latex';
  $('saleMethod').value = 'drc';
  $('saleStatus').value = 'received';
  if (keepFactory) $('saleFactory').value = factory;
  updateSaleVisibility();
}

async function savePurchase({ print = false } = {}) {
  try {
    const bill = await readPurchaseForm();
    state.purchases.unshift(bill);
    ensureCustomer(bill.customerName);
    saveState();
    lastPurchaseId = bill.id;
    toast('บันทึกบิลซื้อแล้ว');
    resetPurchaseForm(true);
    renderAll();
    if (print) printPurchase(bill.id);
    return bill;
  } catch (error) {
    toast(error.message || 'บันทึกบิลซื้อไม่สำเร็จ');
    return null;
  }
}

async function saveSale({ print = false } = {}) {
  try {
    const bill = await readSaleForm();
    state.sales.unshift(bill);
    ensureFactory(bill.factoryName);
    saveState();
    lastSaleId = bill.id;
    toast('บันทึกบิลขายแล้ว');
    resetSaleForm(true);
    renderAll();
    if (print) printSale(bill.id);
    return bill;
  } catch (error) {
    toast(error.message || 'บันทึกบิลขายไม่สำเร็จ');
    return null;
  }
}

function ensureCustomer(name) {
  const clean = name.trim();
  if (!clean) return;
  const exists = state.customers.some((c) => c.name.toLowerCase() === clean.toLowerCase());
  if (!exists) state.customers.unshift({ id: uid('customer'), name: clean, phone: '', zone: '', createdAt: new Date().toISOString() });
}

function ensureFactory(name) {
  const clean = name.trim();
  if (!clean) return;
  const exists = state.factories.some((f) => f.name.toLowerCase() === clean.toLowerCase());
  if (!exists) state.factories.unshift({ id: uid('factory'), name: clean, phone: '', address: '', createdAt: new Date().toISOString() });
}

function saveCustomerFromPurchase() {
  const name = $('purchaseCustomer').value.trim();
  if (!name) return toast('กรุณาใส่ชื่อชาวสวนก่อน');
  ensureCustomer(name);
  saveState();
  renderCustomers();
  toast('เพิ่มชาวสวนแล้ว');
}

function saveFactoryFromSale() {
  const name = $('saleFactory').value.trim();
  if (!name) return toast('กรุณาใส่ชื่อโรงงานก่อน');
  ensureFactory(name);
  saveState();
  renderFactories();
  toast('เพิ่มโรงงานแล้ว');
}

function addCustomer(event) {
  event.preventDefault();
  const name = $('newCustomerName').value.trim();
  if (!name) return;
  const exists = state.customers.some((c) => c.name.toLowerCase() === name.toLowerCase());
  if (exists) return toast('มีชื่อนี้อยู่แล้ว');
  state.customers.unshift({ id: uid('customer'), name, phone: $('newCustomerPhone').value.trim(), zone: $('newCustomerZone').value.trim(), createdAt: new Date().toISOString() });
  saveState();
  event.target.reset();
  renderCustomers();
  toast('เพิ่มชาวสวนแล้ว');
}

function addFactory(event) {
  event.preventDefault();
  const name = $('newFactoryName').value.trim();
  if (!name) return;
  const exists = state.factories.some((f) => f.name.toLowerCase() === name.toLowerCase());
  if (exists) return toast('มีชื่อโรงงานนี้อยู่แล้ว');
  state.factories.unshift({ id: uid('factory'), name, phone: $('newFactoryPhone').value.trim(), address: $('newFactoryAddress').value.trim(), createdAt: new Date().toISOString() });
  saveState();
  event.target.reset();
  renderFactories();
  toast('เพิ่มโรงงานแล้ว');
}

function deleteCustomer(id) {
  if (!confirm('ลบรายชื่อชาวสวนนี้หรือไม่?')) return;
  state.customers = state.customers.filter((c) => c.id !== id);
  cloudDeleteRecord('customers', id);
  saveState();
  renderCustomers();
  toast('ลบรายชื่อแล้ว');
}

function deleteFactory(id) {
  if (!confirm('ลบรายชื่อโรงงานนี้หรือไม่?')) return;
  state.factories = state.factories.filter((f) => f.id !== id);
  cloudDeleteRecord('factories', id);
  saveState();
  renderFactories();
  toast('ลบรายชื่อโรงงานแล้ว');
}

function savePrice(event) {
  event.preventDefault();
  const price = {
    id: uid('price'),
    date: $('priceDate').value || todayISO(),
    latexBuyDrc: n($('defaultLatexBuyDrc').value),
    cupBuyKg: n($('defaultCupBuyKg').value),
    cupBuyDrc: n($('defaultCupBuyDrc').value),
    latexSaleDrc: n($('defaultLatexSaleDrc').value),
    cupSaleKg: n($('defaultCupSaleKg').value),
    cupSaleDrc: n($('defaultCupSaleDrc').value),
    createdAt: new Date().toISOString()
  };
  const oldPrices = state.prices.filter((p) => p.date === price.date);
  oldPrices.forEach((p) => cloudDeleteRecord('prices', p.id));
  state.prices = state.prices.filter((p) => p.date !== price.date);
  state.prices.unshift(price);
  state.prices.sort((a, b) => b.date.localeCompare(a.date));
  saveState();
  renderPrices();
  toast('บันทึกราคาแล้ว');
}

function saveSettings(event) {
  event.preventDefault();
  state.settings = {
    ...state.settings,
    shopName: migrateShopName($('shopName').value.trim() || NEW_SHOP_NAME),
    shopAddress: $('shopAddress').value.trim(),
    shopPhone: $('shopPhone').value.trim(),
    defaultStaff: $('defaultStaff').value.trim(),
    receiptSize: $('receiptSize').value,
    roundingMode: $('roundingMode').value
  };
  saveState();
  document.querySelector('h1').textContent = state.settings.shopName;
  calculatePurchasePreview();
  calculateSalePreview();
  toast('บันทึกตั้งค่าแล้ว');
}

function cancelPurchase(id) {
  const bill = state.purchases.find((b) => b.id === id);
  if (!bill) return;
  if (!confirm(`ยกเลิกบิลซื้อ ${bill.billNo} หรือไม่?`)) return;
  bill.status = 'cancelled';
  bill.updatedAt = new Date().toISOString();
  saveState();
  renderAll();
  toast('ยกเลิกบิลซื้อแล้ว');
}

function cancelSale(id) {
  const bill = state.sales.find((b) => b.id === id);
  if (!bill) return;
  if (!confirm(`ยกเลิกบิลขาย ${bill.billNo} หรือไม่?`)) return;
  bill.status = 'cancelled';
  bill.updatedAt = new Date().toISOString();
  saveState();
  renderAll();
  toast('ยกเลิกบิลขายแล้ว');
}

function duplicatePurchase(id) {
  const bill = state.purchases.find((b) => b.id === id);
  if (!bill) return;
  switchTab('purchase');
  $('purchaseCustomer').value = bill.customerName;
  $('purchaseProduct').value = bill.productType;
  $('purchaseMethod').value = bill.method;
  $('purchaseGross').value = bill.grossWeight;
  $('purchaseTare').value = bill.tareWeight;
  $('purchaseDrc').value = bill.drcPercent || '';
  $('purchasePriceDrc100').value = bill.priceDrc100 || '';
  $('purchasePriceKg').value = bill.pricePerKg || '';
  $('purchaseTransportDeduct').value = bill.transportDeduct || 0;
  $('purchaseDebtDeduct').value = bill.debtDeduct || 0;
  $('purchaseOtherDeduct').value = bill.otherDeduct || 0;
  $('purchaseDeductNote').value = bill.deductNote || '';
  $('purchasePaymentMethod').value = bill.paymentMethod;
  $('purchaseStatus').value = bill.status === 'cancelled' ? 'paid' : bill.status;
  $('purchaseNote').value = bill.note || '';
  updatePurchaseVisibility();
  toast('คัดลอกข้อมูลบิลซื้อมาแล้ว');
}

function duplicateSale(id) {
  const bill = state.sales.find((b) => b.id === id);
  if (!bill) return;
  switchTab('sale');
  $('saleFactory').value = bill.factoryName;
  $('saleProduct').value = bill.productType;
  $('saleMethod').value = bill.method;
  $('saleGross').value = bill.grossWeight;
  $('saleTare').value = bill.tareWeight;
  $('saleDrc').value = bill.drcPercent || '';
  $('salePriceDrc100').value = bill.priceDrc100 || '';
  $('salePriceKg').value = bill.pricePerKg || '';
  $('saleExpense').value = bill.saleExpense || 0;
  $('saleCostKg').value = bill.costPerKg || '';
  $('salePaymentMethod').value = bill.paymentMethod;
  $('saleStatus').value = bill.status === 'cancelled' ? 'received' : bill.status;
  $('saleNote').value = bill.note || '';
  updateSaleVisibility();
  toast('คัดลอกข้อมูลบิลขายมาแล้ว');
}

function activePurchases(items = state.purchases) {
  return items.filter((item) => item.status !== 'cancelled');
}

function activeSales(items = state.sales) {
  return items.filter((item) => item.status !== 'cancelled');
}

function filterByDateRange(items, from, to) {
  return items.filter((item) => (!from || item.date >= from) && (!to || item.date <= to));
}

function summarizePurchases(items) {
  const valid = activePurchases(items);
  return valid.reduce((acc, bill) => {
    acc.count += 1;
    acc.grossWeight += bill.grossWeight || 0;
    acc.netWeight += bill.netWeight || 0;
    acc.dryWeight += bill.dryWeight || 0;
    acc.grossAmount += bill.grossAmount || 0;
    acc.deduct += bill.totalDeduct || 0;
    acc.netPay += bill.netPay || 0;
    if (bill.status === 'pending' || bill.paymentMethod === 'credit') acc.payable += bill.netPay || 0;
    if (bill.paymentMethod === 'cash') acc.cash += bill.netPay || 0;
    if (bill.paymentMethod === 'transfer') acc.transfer += bill.netPay || 0;
    return acc;
  }, { count: 0, grossWeight: 0, netWeight: 0, dryWeight: 0, grossAmount: 0, deduct: 0, netPay: 0, payable: 0, cash: 0, transfer: 0 });
}

function summarizeSales(items) {
  const valid = activeSales(items);
  return valid.reduce((acc, bill) => {
    acc.count += 1;
    acc.grossWeight += bill.grossWeight || 0;
    acc.netWeight += bill.netWeight || 0;
    acc.dryWeight += bill.dryWeight || 0;
    acc.grossAmount += bill.grossAmount || 0;
    acc.expense += bill.saleExpense || 0;
    acc.costAmount += bill.costAmount || 0;
    acc.netSale += bill.netSale || bill.netAmount || 0;
    acc.profit += bill.profit || 0;
    if (bill.status === 'pending' || bill.paymentMethod === 'credit') acc.receivable += bill.netSale || bill.netAmount || 0;
    if (bill.paymentMethod === 'cash') acc.cash += bill.netSale || bill.netAmount || 0;
    if (bill.paymentMethod === 'transfer') acc.transfer += bill.netSale || bill.netAmount || 0;
    return acc;
  }, { count: 0, grossWeight: 0, netWeight: 0, dryWeight: 0, grossAmount: 0, expense: 0, costAmount: 0, netSale: 0, profit: 0, receivable: 0, cash: 0, transfer: 0 });
}

function stockByProduct() {
  const base = {
    latex: { productType: 'latex', buyWeight: 0, sellWeight: 0, adjustWeight: 0, netWeight: 0, dryWeight: 0, cost: 0 },
    cup: { productType: 'cup', buyWeight: 0, sellWeight: 0, adjustWeight: 0, netWeight: 0, dryWeight: 0, cost: 0 },
    scrap: { productType: 'scrap', buyWeight: 0, sellWeight: 0, adjustWeight: 0, netWeight: 0, dryWeight: 0, cost: 0 }
  };
  activePurchases().forEach((p) => {
    const row = base[p.productType] || base.scrap;
    row.buyWeight += p.netWeight || 0;
    row.dryWeight += p.dryWeight || 0;
    row.cost += p.netPay || 0;
  });
  activeSales().forEach((s) => {
    const row = base[s.productType] || base.scrap;
    row.sellWeight += s.netWeight || 0;
    row.dryWeight -= s.dryWeight || 0;
  });
  state.stockAdjustments.forEach((a) => {
    const row = base[a.productType] || base.scrap;
    row.adjustWeight += a.type === 'add' ? a.kg : -a.kg;
  });
  Object.values(base).forEach((row) => {
    row.netWeight = row.buyWeight - row.sellWeight + row.adjustWeight;
    row.avgCost = row.buyWeight > 0 ? row.cost / row.buyWeight : 0;
    row.stockValue = Math.max(row.netWeight, 0) * row.avgCost;
  });
  return base;
}

function addStockAdjustment(event) {
  event.preventDefault();
  const kg = n($('stockAdjustKg').value);
  if (kg <= 0) return toast('กรุณาใส่จำนวนกิโลกรัม');
  state.stockAdjustments.unshift({
    id: uid('stock'),
    date: todayISO(),
    time: currentTime(),
    productType: $('stockProduct').value,
    type: $('stockAdjustType').value,
    kg,
    note: $('stockAdjustNote').value.trim(),
    createdAt: new Date().toISOString()
  });
  saveState();
  event.target.reset();
  renderStock();
  renderDashboard();
  toast('บันทึกปรับสต๊อกแล้ว');
}

function deleteStockAdjustment(id) {
  if (!confirm('ลบรายการปรับสต๊อกนี้หรือไม่?')) return;
  state.stockAdjustments = state.stockAdjustments.filter((a) => a.id !== id);
  cloudDeleteRecord('stockAdjustments', id);
  saveState();
  renderStock();
  renderDashboard();
  toast('ลบรายการปรับสต๊อกแล้ว');
}

function renderDashboard() {
  const date = $('dashboardDate').value || todayISO();
  $('dashboardDate').value = date;
  const p = summarizePurchases(state.purchases.filter((bill) => bill.date === date));
  const s = summarizeSales(state.sales.filter((bill) => bill.date === date));
  $('dashboardCards').innerHTML = [
    statCard('ซื้อวันนี้', THB.format(p.netPay), `${p.count} บิล · ${NUM.format(p.netWeight)} กก.`, 'good'),
    statCard('ขายวันนี้', THB.format(s.netSale), `${s.count} บิล · ${NUM.format(s.netWeight)} กก.`, 'sale'),
    statCard('กำไรโดยประมาณ', THB.format(s.profit), `หลังค่าขนส่งขาย ${THB.format(s.expense)}`, s.profit >= 0 ? 'good' : 'danger'),
    statCard('ค้างจ่าย / ค้างรับ', `${THB.format(p.payable)} / ${THB.format(s.receivable)}`, 'ชาวสวน / โรงงาน', 'danger')
  ].join('');

  $('latestPurchases').innerHTML = state.purchases.slice(0, 6).map((bill) => `
    <div class="item">
      <div><strong>${safeText(bill.billNo)}</strong><br><span>${safeText(bill.customerName)} · ${productLabel(bill.productType)}</span></div>
      <div><strong>${THB.format(bill.netPay || 0)}</strong><br><span class="badge ${bill.status}">${statusLabel(bill.status)}</span></div>
    </div>
  `).join('') || '<div class="empty-state">ยังไม่มีบิลซื้อ</div>';

  $('latestSales').innerHTML = state.sales.slice(0, 6).map((bill) => `
    <div class="item">
      <div><strong>${safeText(bill.billNo)}</strong><br><span>${safeText(bill.factoryName)} · ${productLabel(bill.productType)}</span></div>
      <div><strong>${THB.format(bill.netSale || 0)}</strong><br><span class="badge ${bill.status}">${statusLabel(bill.status, 'sale')}</span></div>
    </div>
  `).join('') || '<div class="empty-state">ยังไม่มีบิลขาย</div>';

  renderSmallStock('dashboardStock');
  $('dashboardProfit').innerHTML = `
    <div class="profit-row"><span>ยอดขายสุทธิวันนี้</span><strong>${THB.format(s.netSale)}</strong></div>
    <div class="profit-row"><span>ต้นทุนโดยประมาณ</span><strong>${THB.format(s.costAmount)}</strong></div>
    <div class="profit-row"><span>ค่าใช้จ่ายขาย</span><strong>${THB.format(s.expense)}</strong></div>
    <div class="profit-row ${s.profit >= 0 ? 'good' : 'bad'}"><span>กำไรโดยประมาณ</span><strong>${THB.format(s.profit)}</strong></div>
  `;
}

function renderSmallStock(targetId) {
  const rows = Object.values(stockByProduct());
  $(targetId).innerHTML = `
    <table>
      <thead><tr><th>สินค้า</th><th>ซื้อเข้า</th><th>ขายออก</th><th>คงเหลือ</th></tr></thead>
      <tbody>${rows.map((r) => `
        <tr><td>${productLabel(r.productType)}</td><td>${NUM.format(r.buyWeight)} กก.</td><td>${NUM.format(r.sellWeight)} กก.</td><td><strong>${NUM.format(r.netWeight)} กก.</strong></td></tr>
      `).join('')}</tbody>
    </table>`;
}

function renderPurchases() {
  const date = $('purchaseFilterDate').value || '';
  const query = ($('purchaseSearch').value || '').toLowerCase().trim();
  const rows = state.purchases.filter((bill) => {
    const matchDate = !date || bill.date === date;
    const matchQuery = !query || bill.billNo.toLowerCase().includes(query) || bill.customerName.toLowerCase().includes(query);
    return matchDate && matchQuery;
  });
  $('purchaseList').innerHTML = rows.length ? `
    <table>
      <thead><tr><th>บิล</th><th>วันที่</th><th>ชาวสวน</th><th>สินค้า</th><th>น้ำหนักสุทธิ</th><th>ราคา/วิธี</th><th>ยอดจ่าย</th><th>สถานะ</th><th>รูป</th><th>จัดการ</th></tr></thead>
      <tbody>${rows.map((bill) => `
        <tr class="${bill.status === 'cancelled' ? 'cancelled' : ''}">
          <td><strong>${safeText(bill.billNo)}</strong></td>
          <td>${bill.date}<br>${bill.time || ''}</td>
          <td>${safeText(bill.customerName)}</td>
          <td>${productLabel(bill.productType)}<br><span class="badge purchase">${methodLabel(bill.method)}</span></td>
          <td>${NUM.format(bill.netWeight || 0)} กก.${bill.method === 'drc' ? `<br>DRC ${NUM.format(bill.drcPercent || 0)}%` : ''}</td>
          <td>${bill.method === 'drc' ? `DRC100 ${THB.format(bill.priceDrc100 || 0)}` : `${THB.format(bill.pricePerKg || 0)}/กก.`}</td>
          <td><strong>${THB.format(bill.netPay || 0)}</strong></td>
          <td><span class="badge ${bill.status}">${statusLabel(bill.status)}</span></td>
          <td>${bill.imageData ? `<button class="link-btn" onclick="showDetail('purchase','${bill.id}')">ดูรูป</button>` : '-'}</td>
          <td><div class="row-actions">
            <button onclick="showDetail('purchase','${bill.id}')">ดู</button>
            <button onclick="printPurchase('${bill.id}')">พิมพ์</button>
            <button onclick="duplicatePurchase('${bill.id}')">คัดลอก</button>
            ${bill.status !== 'cancelled' ? `<button class="danger-lite" onclick="cancelPurchase('${bill.id}')">ยกเลิก</button>` : ''}
          </div></td>
        </tr>
      `).join('')}</tbody>
    </table>` : '<div class="empty-state">ยังไม่มีบิลซื้อ</div>';
}

function renderSales() {
  const date = $('saleFilterDate').value || '';
  const query = ($('saleSearch').value || '').toLowerCase().trim();
  const rows = state.sales.filter((bill) => {
    const matchDate = !date || bill.date === date;
    const matchQuery = !query || bill.billNo.toLowerCase().includes(query) || bill.factoryName.toLowerCase().includes(query);
    return matchDate && matchQuery;
  });
  $('saleList').innerHTML = rows.length ? `
    <table>
      <thead><tr><th>บิล</th><th>วันที่</th><th>โรงงาน</th><th>สินค้า</th><th>น้ำหนักสุทธิ</th><th>ยอดขาย</th><th>กำไร</th><th>สถานะ</th><th>รูป</th><th>จัดการ</th></tr></thead>
      <tbody>${rows.map((bill) => `
        <tr class="${bill.status === 'cancelled' ? 'cancelled' : ''}">
          <td><strong>${safeText(bill.billNo)}</strong></td>
          <td>${bill.date}<br>${bill.time || ''}</td>
          <td>${safeText(bill.factoryName)}</td>
          <td>${productLabel(bill.productType)}<br><span class="badge sale">${methodLabel(bill.method)}</span></td>
          <td>${NUM.format(bill.netWeight || 0)} กก.${bill.method === 'drc' ? `<br>DRC ${NUM.format(bill.drcPercent || 0)}%` : ''}</td>
          <td><strong>${THB.format(bill.netSale || 0)}</strong></td>
          <td><strong>${THB.format(bill.profit || 0)}</strong></td>
          <td><span class="badge ${bill.status}">${statusLabel(bill.status, 'sale')}</span></td>
          <td>${bill.imageData ? `<button class="link-btn" onclick="showDetail('sale','${bill.id}')">ดูรูป</button>` : '-'}</td>
          <td><div class="row-actions">
            <button onclick="showDetail('sale','${bill.id}')">ดู</button>
            <button onclick="printSale('${bill.id}')">พิมพ์</button>
            <button onclick="duplicateSale('${bill.id}')">คัดลอก</button>
            ${bill.status !== 'cancelled' ? `<button class="danger-lite" onclick="cancelSale('${bill.id}')">ยกเลิก</button>` : ''}
          </div></td>
        </tr>
      `).join('')}</tbody>
    </table>` : '<div class="empty-state">ยังไม่มีบิลขาย</div>';
}

function renderCustomers() {
  const options = state.customers.map((c) => `<option value="${safeText(c.name)}"></option>`).join('');
  $('customerOptions').innerHTML = options;
  $('customerList').innerHTML = state.customers.length ? `
    <table>
      <thead><tr><th>ชื่อ</th><th>เบอร์โทร</th><th>โซน</th><th>จำนวนบิล</th><th>น้ำหนักรวม</th><th>ยอดเงินรวม</th><th>ค้างจ่าย</th><th>จัดการ</th></tr></thead>
      <tbody>${state.customers.map((c) => {
        const bills = activePurchases().filter((p) => p.customerName.toLowerCase() === c.name.toLowerCase());
        const s = summarizePurchases(bills);
        return `<tr><td><strong>${safeText(c.name)}</strong></td><td>${safeText(c.phone || '-')}</td><td>${safeText(c.zone || '-')}</td><td>${s.count}</td><td>${NUM.format(s.netWeight)} กก.</td><td>${THB.format(s.netPay)}</td><td>${THB.format(s.payable)}</td><td><button class="danger-btn" onclick="deleteCustomer('${c.id}')">ลบ</button></td></tr>`;
      }).join('')}</tbody>
    </table>` : '<div class="empty-state">ยังไม่มีรายชื่อชาวสวน</div>';
}

function renderFactories() {
  const options = state.factories.map((f) => `<option value="${safeText(f.name)}"></option>`).join('');
  $('factoryOptions').innerHTML = options;
  $('factoryList').innerHTML = state.factories.length ? `
    <table>
      <thead><tr><th>ชื่อโรงงาน</th><th>เบอร์โทร</th><th>ที่อยู่/โซน</th><th>จำนวนบิล</th><th>น้ำหนักขาย</th><th>ยอดขายรวม</th><th>ค้างรับ</th><th>จัดการ</th></tr></thead>
      <tbody>${state.factories.map((f) => {
        const bills = activeSales().filter((s) => s.factoryName.toLowerCase() === f.name.toLowerCase());
        const sum = summarizeSales(bills);
        return `<tr><td><strong>${safeText(f.name)}</strong></td><td>${safeText(f.phone || '-')}</td><td>${safeText(f.address || '-')}</td><td>${sum.count}</td><td>${NUM.format(sum.netWeight)} กก.</td><td>${THB.format(sum.netSale)}</td><td>${THB.format(sum.receivable)}</td><td><button class="danger-btn" onclick="deleteFactory('${f.id}')">ลบ</button></td></tr>`;
      }).join('')}</tbody>
    </table>` : '<div class="empty-state">ยังไม่มีรายชื่อโรงงาน</div>';
}

function renderPrices() {
  const selected = state.prices.find((p) => p.date === $('priceDate').value);
  $('defaultLatexBuyDrc').value = selected?.latexBuyDrc || '';
  $('defaultCupBuyKg').value = selected?.cupBuyKg || '';
  $('defaultCupBuyDrc').value = selected?.cupBuyDrc || '';
  $('defaultLatexSaleDrc').value = selected?.latexSaleDrc || '';
  $('defaultCupSaleKg').value = selected?.cupSaleKg || '';
  $('defaultCupSaleDrc').value = selected?.cupSaleDrc || '';
  $('priceHistory').innerHTML = state.prices.length ? `
    <table>
      <thead><tr><th>วันที่</th><th>น้ำยางซื้อ DRC100</th><th>ขี้ยางซื้อ/กก.</th><th>ขี้ยางซื้อ DRC100</th><th>น้ำยางขาย DRC100</th><th>ขี้ยางขาย/กก.</th><th>ขี้ยางขาย DRC100</th></tr></thead>
      <tbody>${state.prices.map((p) => `
        <tr><td>${p.date}</td><td>${THB.format(p.latexBuyDrc || 0)}</td><td>${THB.format(p.cupBuyKg || 0)}</td><td>${THB.format(p.cupBuyDrc || 0)}</td><td>${THB.format(p.latexSaleDrc || 0)}</td><td>${THB.format(p.cupSaleKg || 0)}</td><td>${THB.format(p.cupSaleDrc || 0)}</td></tr>
      `).join('')}</tbody>
    </table>` : '<div class="empty-state">ยังไม่มีประวัติราคา</div>';
}

function renderStock() {
  const rows = Object.values(stockByProduct());
  const totalWeight = rows.reduce((sum, r) => sum + r.netWeight, 0);
  const totalValue = rows.reduce((sum, r) => sum + r.stockValue, 0);
  $('stockCards').innerHTML = [
    statCard('สต๊อกคงเหลือรวม', `${NUM.format(totalWeight)} กก.`, 'จากซื้อเข้า - ขายออก + ปรับสต๊อก', 'good'),
    statCard('มูลค่าสต๊อกประมาณ', THB.format(totalValue), 'ใช้ต้นทุนเฉลี่ยจากบิลซื้อ', 'good'),
    statCard('ซื้อเข้ารวม', `${NUM.format(rows.reduce((s, r) => s + r.buyWeight, 0))} กก.`, 'ทุกรายการที่ยังไม่ยกเลิก'),
    statCard('ขายออกรวม', `${NUM.format(rows.reduce((s, r) => s + r.sellWeight, 0))} กก.`, 'ทุกรายการที่ยังไม่ยกเลิก', 'sale')
  ].join('');
  $('stockTable').innerHTML = `
    <table>
      <thead><tr><th>สินค้า</th><th>ซื้อเข้า</th><th>ขายออก</th><th>ปรับสต๊อก</th><th>คงเหลือ</th><th>ต้นทุนเฉลี่ย</th><th>มูลค่าโดยประมาณ</th></tr></thead>
      <tbody>${rows.map((r) => `
        <tr><td>${productLabel(r.productType)}</td><td>${NUM.format(r.buyWeight)} กก.</td><td>${NUM.format(r.sellWeight)} กก.</td><td>${NUM.format(r.adjustWeight)} กก.</td><td><strong>${NUM.format(r.netWeight)} กก.</strong></td><td>${THB.format(r.avgCost)}/กก.</td><td>${THB.format(r.stockValue)}</td></tr>
      `).join('')}</tbody>
    </table>`;
  $('stockAdjustList').innerHTML = state.stockAdjustments.length ? `
    <table>
      <thead><tr><th>วันที่</th><th>สินค้า</th><th>ประเภท</th><th>จำนวน</th><th>หมายเหตุ</th><th>จัดการ</th></tr></thead>
      <tbody>${state.stockAdjustments.map((a) => `
        <tr><td>${a.date}<br>${a.time}</td><td>${productLabel(a.productType)}</td><td>${a.type === 'add' ? 'เพิ่ม' : 'ลด'}</td><td>${NUM.format(a.kg)} กก.</td><td>${safeText(a.note || '-')}</td><td><button class="danger-btn" onclick="deleteStockAdjustment('${a.id}')">ลบ</button></td></tr>
      `).join('')}</tbody>
    </table>` : '<div class="empty-state">ยังไม่มีประวัติปรับสต๊อก</div>';
}

function groupRows(items, keyGetter, summarizeFn, nameLabel) {
  const map = new Map();
  items.forEach((item) => {
    const key = keyGetter(item) || '-';
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  });
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], 'th')).map(([name, rows]) => ({ name, ...summarizeFn(rows), nameLabel }));
}

function renderReports() {
  const from = $('reportFrom').value || todayISO();
  const to = $('reportTo').value || from;
  $('reportFrom').value = from;
  $('reportTo').value = to;
  const purchases = filterByDateRange(state.purchases, from, to);
  const sales = filterByDateRange(state.sales, from, to);
  const p = summarizePurchases(purchases);
  const s = summarizeSales(sales);
  $('reportCards').innerHTML = [
    statCard('ยอดซื้อ', THB.format(p.netPay), `${p.count} บิล · ${NUM.format(p.netWeight)} กก.`, 'good'),
    statCard('ยอดขาย', THB.format(s.netSale), `${s.count} บิล · ${NUM.format(s.netWeight)} กก.`, 'sale'),
    statCard('กำไรโดยประมาณ', THB.format(s.profit), `ต้นทุน ${THB.format(s.costAmount)} · ค่าใช้จ่าย ${THB.format(s.expense)}`, s.profit >= 0 ? 'good' : 'danger'),
    statCard('ค้างจ่าย / ค้างรับ', `${THB.format(p.payable)} / ${THB.format(s.receivable)}`, 'ชาวสวน / โรงงาน', 'danger')
  ].join('');

  const purchaseByProduct = groupRows(activePurchases(purchases), (b) => productLabel(b.productType), summarizePurchases, 'สินค้า');
  $('purchaseReportTable').innerHTML = purchaseByProduct.length ? `
    <table><thead><tr><th>สินค้า</th><th>จำนวนบิล</th><th>น้ำหนักสุทธิ</th><th>เนื้อยางแห้ง</th><th>ยอดซื้อ</th><th>หักรวม</th><th>ค้างจ่าย</th></tr></thead>
    <tbody>${purchaseByProduct.map((r) => `<tr><td>${r.name}</td><td>${r.count}</td><td>${NUM.format(r.netWeight)} กก.</td><td>${NUM.format(r.dryWeight)} กก.</td><td>${THB.format(r.netPay)}</td><td>${THB.format(r.deduct)}</td><td>${THB.format(r.payable)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty-state">ไม่มีข้อมูลซื้อในช่วงวันที่นี้</div>';

  const saleByProduct = groupRows(activeSales(sales), (b) => productLabel(b.productType), summarizeSales, 'สินค้า');
  $('saleReportTable').innerHTML = saleByProduct.length ? `
    <table><thead><tr><th>สินค้า</th><th>จำนวนบิล</th><th>น้ำหนักสุทธิ</th><th>ยอดขาย</th><th>ต้นทุน</th><th>ค่าใช้จ่าย</th><th>กำไร</th><th>ค้างรับ</th></tr></thead>
    <tbody>${saleByProduct.map((r) => `<tr><td>${r.name}</td><td>${r.count}</td><td>${NUM.format(r.netWeight)} กก.</td><td>${THB.format(r.netSale)}</td><td>${THB.format(r.costAmount)}</td><td>${THB.format(r.expense)}</td><td>${THB.format(r.profit)}</td><td>${THB.format(r.receivable)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty-state">ไม่มีข้อมูลขายในช่วงวันที่นี้</div>';

  const byCustomer = groupRows(activePurchases(purchases), (b) => b.customerName, summarizePurchases, 'ชาวสวน');
  $('customerReportTable').innerHTML = byCustomer.length ? `
    <table><thead><tr><th>ชาวสวน</th><th>จำนวนบิล</th><th>น้ำหนักสุทธิ</th><th>ยอดซื้อ</th><th>ค้างจ่าย</th></tr></thead>
    <tbody>${byCustomer.map((r) => `<tr><td>${safeText(r.name)}</td><td>${r.count}</td><td>${NUM.format(r.netWeight)} กก.</td><td>${THB.format(r.netPay)}</td><td>${THB.format(r.payable)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty-state">ไม่มีข้อมูลชาวสวนในช่วงวันที่นี้</div>';

  const byFactory = groupRows(activeSales(sales), (b) => b.factoryName, summarizeSales, 'โรงงาน');
  $('factoryReportTable').innerHTML = byFactory.length ? `
    <table><thead><tr><th>โรงงาน</th><th>จำนวนบิล</th><th>น้ำหนักขาย</th><th>ยอดขาย</th><th>กำไร</th><th>ค้างรับ</th></tr></thead>
    <tbody>${byFactory.map((r) => `<tr><td>${safeText(r.name)}</td><td>${r.count}</td><td>${NUM.format(r.netWeight)} กก.</td><td>${THB.format(r.netSale)}</td><td>${THB.format(r.profit)}</td><td>${THB.format(r.receivable)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty-state">ไม่มีข้อมูลโรงงานในช่วงวันที่นี้</div>';
}

function renderSettings() {
  $('shopName').value = migrateShopName(state.settings.shopName || NEW_SHOP_NAME);
  $('shopAddress').value = state.settings.shopAddress || '';
  $('shopPhone').value = state.settings.shopPhone || '';
  $('defaultStaff').value = state.settings.defaultStaff || '';
  $('receiptSize').value = state.settings.receiptSize || '80';
  $('roundingMode').value = state.settings.roundingMode || 'none';
  if ($('firebaseConfigText')) $('firebaseConfigText').value = state.settings.firebaseConfigText || '';
  if ($('firebaseShopCode')) $('firebaseShopCode').value = state.settings.firebaseShopCode || defaultState.settings.firebaseShopCode;
  document.querySelector('h1').textContent = migrateShopName(state.settings.shopName || NEW_SHOP_NAME);
  renderCloudStatus();
}

function detailRows(item, kind) {
  const sale = kind === 'sale';
  const rows = [
    ['เลขที่บิล', item.billNo],
    ['วันที่/เวลา', `${item.date} ${item.time || ''}`],
    [sale ? 'โรงงาน' : 'ชาวสวน', sale ? item.factoryName : item.customerName],
    ['สินค้า', productLabel(item.productType)],
    ['วิธีคำนวณ', methodLabel(item.method)],
    ['น้ำหนักรวม', `${NUM.format(item.grossWeight || 0)} กก.`],
    ['หักถัง/หักน้ำหนัก', `${NUM.format(item.tareWeight || 0)} กก.`],
    ['น้ำหนักสุทธิ', `${NUM.format(item.netWeight || 0)} กก.`]
  ];
  if (item.method === 'drc') {
    rows.push(['DRC', `${NUM.format(item.drcPercent || 0)}%`], ['ราคา DRC 100', THB.format(item.priceDrc100 || 0)], ['เนื้อยางแห้ง', `${NUM.format(item.dryWeight || 0)} กก.`]);
  } else {
    rows.push(['ราคาต่อกก.', THB.format(item.pricePerKg || 0)]);
  }
  if (sale) {
    rows.push(['ยอดขายก่อนหัก', THB.format(item.grossAmount || 0)], ['ค่าใช้จ่ายขาย', THB.format(item.saleExpense || 0)], ['ยอดขายสุทธิ', THB.format(item.netSale || 0)], ['ต้นทุนเฉลี่ย/กก.', THB.format(item.costPerKg || 0)], ['ต้นทุนรวม', THB.format(item.costAmount || 0)], ['กำไรโดยประมาณ', THB.format(item.profit || 0)], ['สถานะ', statusLabel(item.status, 'sale')]);
  } else {
    rows.push(['ยอดก่อนหัก', THB.format(item.grossAmount || 0)], ['รายการหักรวม', THB.format(item.totalDeduct || 0)], ['ยอดจ่ายสุทธิ', THB.format(item.netPay || 0)], ['สถานะ', statusLabel(item.status)]);
  }
  rows.push(['วิธีจ่าย/รับเงิน', paymentLabel(item.paymentMethod, kind)], ['หมายเหตุ', item.note || '-']);
  return rows;
}

function showDetail(kind, id) {
  const item = kind === 'sale' ? state.sales.find((b) => b.id === id) : state.purchases.find((b) => b.id === id);
  if (!item) return;
  $('modalContent').innerHTML = `
    <h2>${kind === 'sale' ? 'รายละเอียดบิลขาย' : 'รายละเอียดบิลซื้อ'}</h2>
    <div class="detail-grid">${detailRows(item, kind).map(([label, value]) => `<div><small>${safeText(label)}</small><strong>${safeText(value)}</strong></div>`).join('')}</div>
    ${item.imageData ? `<img class="detail-image" src="${item.imageData}" alt="รูปหลักฐาน" />` : ''}
  `;
  $('modal').classList.remove('hidden');
}

function closeModal() {
  $('modal').classList.add('hidden');
}

function receiptHtml(item, kind) {
  const size = state.settings.receiptSize || '80';
  const sale = kind === 'sale';
  const cls = size === 'a4' ? 'receipt a4' : `receipt size-${size}`;
  const title = sale ? 'ใบขายยางเข้าโรงงาน' : 'ใบรับซื้อยาง';
  const party = sale ? item.factoryName : item.customerName;
  const totalLabel = sale ? 'ยอดรับสุทธิ' : 'ยอดจ่ายสุทธิ';
  const totalValue = sale ? (item.netSale || item.netAmount || 0) : (item.netPay || 0);
  const costLines = sale ? `
    <div class="rrow"><span>ค่าใช้จ่ายขาย</span><strong>${THB.format(item.saleExpense || 0)}</strong></div>
    <div class="rrow"><span>ต้นทุนประมาณ</span><strong>${THB.format(item.costAmount || 0)}</strong></div>
    <div class="rrow"><span>กำไรประมาณ</span><strong>${THB.format(item.profit || 0)}</strong></div>` : `
    <div class="rrow"><span>หักค่ารถ</span><strong>${THB.format(item.transportDeduct || 0)}</strong></div>
    <div class="rrow"><span>หักหนี้/เบิก</span><strong>${THB.format(item.debtDeduct || 0)}</strong></div>
    <div class="rrow"><span>หักอื่น ๆ</span><strong>${THB.format(item.otherDeduct || 0)}</strong></div>`;
  return `
    <div class="${cls}">
      <img class="receipt-logo" src="assets/logo-thermal.png" alt="โลโก้ร้านสำหรับพิมพ์บิล" />
      <h2>${safeText(migrateShopName(state.settings.shopName || NEW_SHOP_NAME))}</h2>
      <div class="center muted">${safeText(state.settings.shopAddress || '')}</div>
      <div class="center muted">${state.settings.shopPhone ? `โทร ${safeText(state.settings.shopPhone)}` : ''}</div>
      <div class="line"></div>
      <div class="center"><strong>${title}</strong></div>
      <div class="rrow"><span>เลขที่</span><strong>${safeText(item.billNo)}</strong></div>
      <div class="rrow"><span>วันที่</span><strong>${item.date} ${item.time || ''}</strong></div>
      <div class="rrow"><span>${sale ? 'โรงงาน' : 'ชาวสวน'}</span><strong>${safeText(party)}</strong></div>
      <div class="rrow"><span>สินค้า</span><strong>${productLabel(item.productType)}</strong></div>
      <div class="rrow"><span>วิธีคำนวณ</span><strong>${methodLabel(item.method)}</strong></div>
      <div class="line"></div>
      <div class="rrow"><span>น้ำหนักรวม</span><strong>${NUM.format(item.grossWeight || 0)} กก.</strong></div>
      <div class="rrow"><span>หักถัง</span><strong>${NUM.format(item.tareWeight || 0)} กก.</strong></div>
      <div class="rrow"><span>น้ำหนักสุทธิ</span><strong>${NUM.format(item.netWeight || 0)} กก.</strong></div>
      ${item.method === 'drc' ? `
        <div class="rrow"><span>DRC</span><strong>${NUM.format(item.drcPercent || 0)}%</strong></div>
        <div class="rrow"><span>ราคา DRC100</span><strong>${THB.format(item.priceDrc100 || 0)}</strong></div>
        <div class="rrow"><span>เนื้อยางแห้ง</span><strong>${NUM.format(item.dryWeight || 0)} กก.</strong></div>` : `
        <div class="rrow"><span>ราคาต่อกก.</span><strong>${THB.format(item.pricePerKg || 0)}</strong></div>`}
      <div class="rrow"><span>ยอดก่อนหัก</span><strong>${THB.format(item.grossAmount || 0)}</strong></div>
      ${costLines}
      <div class="line"></div>
      <div class="rrow total"><span>${totalLabel}</span><strong>${THB.format(totalValue)}</strong></div>
      <div class="rrow"><span>สถานะ</span><strong>${statusLabel(item.status, kind)}</strong></div>
      <div class="rrow"><span>วิธีเงิน</span><strong>${paymentLabel(item.paymentMethod, kind)}</strong></div>
      ${item.note ? `<div class="line"></div><div>หมายเหตุ: ${safeText(item.note)}</div>` : ''}
      <div class="line"></div>
      <div class="center muted">ผู้ทำรายการ: ${safeText(item.staffName || state.settings.defaultStaff || '-')}</div>
      <div class="center muted">ขอบคุณค่ะ</div>
    </div>`;
}

function printPurchase(id) {
  const bill = state.purchases.find((b) => b.id === id);
  if (!bill) return toast('ไม่พบบิลซื้อ');
  $('printArea').innerHTML = receiptHtml(bill, 'purchase');
  window.print();
}

function printSale(id) {
  const bill = state.sales.find((b) => b.id === id);
  if (!bill) return toast('ไม่พบบิลขาย');
  $('printArea').innerHTML = receiptHtml(bill, 'sale');
  window.print();
}

function rowsToCsv(rows) {
  return rows.map((row) => row.map((cell) => `"${String(cell ?? '').replaceAll('"', '""')}"`).join(',')).join('\n');
}

function downloadText(filename, text, type = 'text/plain;charset=utf-8') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function exportPurchaseCsv() {
  const from = $('reportFrom').value || todayISO();
  const to = $('reportTo').value || from;
  const rows = [[
    'Bill No','Date','Time','Customer','Product','Method','Gross Weight','Tare','Net Weight','DRC','Price DRC100','Price/KG','Dry Weight','Gross Amount','Deductions','Net Pay','Payment','Status','Note'
  ], ...filterByDateRange(state.purchases, from, to).map((b) => [
    b.billNo, b.date, b.time, b.customerName, productLabel(b.productType), methodLabel(b.method), b.grossWeight, b.tareWeight, b.netWeight, b.drcPercent || '', b.priceDrc100 || '', b.pricePerKg || '', b.dryWeight || '', b.grossAmount || 0, b.totalDeduct || 0, b.netPay || 0, paymentLabel(b.paymentMethod), statusLabel(b.status), b.note || ''
  ])];
  downloadText(`purchase-${from}-to-${to}.csv`, '\ufeff' + rowsToCsv(rows), 'text/csv;charset=utf-8');
}

function exportSaleCsv() {
  const from = $('reportFrom').value || todayISO();
  const to = $('reportTo').value || from;
  const rows = [[
    'Bill No','Date','Time','Factory','Product','Method','Gross Weight','Tare','Net Weight','DRC','Price DRC100','Price/KG','Dry Weight','Gross Amount','Expense','Net Sale','Cost/KG','Cost Amount','Profit','Payment','Status','Note'
  ], ...filterByDateRange(state.sales, from, to).map((b) => [
    b.billNo, b.date, b.time, b.factoryName, productLabel(b.productType), methodLabel(b.method), b.grossWeight, b.tareWeight, b.netWeight, b.drcPercent || '', b.priceDrc100 || '', b.pricePerKg || '', b.dryWeight || '', b.grossAmount || 0, b.saleExpense || 0, b.netSale || 0, b.costPerKg || 0, b.costAmount || 0, b.profit || 0, paymentLabel(b.paymentMethod, 'sale'), statusLabel(b.status, 'sale'), b.note || ''
  ])];
  downloadText(`sale-${from}-to-${to}.csv`, '\ufeff' + rowsToCsv(rows), 'text/csv;charset=utf-8');
}

function exportJson() {
  downloadText(`sitpin-latex-backup-${todayISO()}.json`, JSON.stringify(state, null, 2), 'application/json;charset=utf-8');
}

function importJson(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      state = normalizeState(parsed);
      saveState();
      renderAll();
      toast('Import ข้อมูลแล้ว');
    } catch (error) {
      toast('ไฟล์ JSON ไม่ถูกต้อง');
    }
  };
  reader.readAsText(file);
}

async function resetData() {
  if (!confirm('ต้องการล้างข้อมูลทั้งหมดจริงหรือไม่?')) return;
  const shouldClearCloud = state.settings.cloudSyncEnabled && confirm('ต้องการล้างข้อมูลบน Cloud ของร้านนี้ด้วยหรือไม่?');
  if (shouldClearCloud) await clearCloudData();
  const keepCloud = {
    firebaseConfigText: state.settings.firebaseConfigText,
    firebaseShopCode: state.settings.firebaseShopCode,
    cloudSyncEnabled: state.settings.cloudSyncEnabled
  };
  state = { ...structuredClone(defaultState), settings: { ...structuredClone(defaultState.settings), ...keepCloud } };
  saveState();
  location.reload();
}

function renderAll() {
  renderSettings();
  renderDashboard();
  renderPurchases();
  renderSales();
  renderCustomers();
  renderFactories();
  renderPrices();
  renderStock();
  renderReports();
}

function bindEvents() {
  document.querySelectorAll('.tab-btn').forEach((btn) => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));

  $('purchaseForm').addEventListener('submit', async (e) => { e.preventDefault(); await savePurchase(); });
  $('savePrintPurchaseBtn').addEventListener('click', async () => savePurchase({ print: true }));
  $('clearPurchaseFormBtn').addEventListener('click', () => resetPurchaseForm());
  $('saveCustomerFromPurchaseBtn').addEventListener('click', saveCustomerFromPurchase);

  $('saleForm').addEventListener('submit', async (e) => { e.preventDefault(); await saveSale(); });
  $('savePrintSaleBtn').addEventListener('click', async () => saveSale({ print: true }));
  $('clearSaleFormBtn').addEventListener('click', () => resetSaleForm());
  $('saveFactoryFromSaleBtn').addEventListener('click', saveFactoryFromSale);

  $('customerForm').addEventListener('submit', addCustomer);
  $('factoryForm').addEventListener('submit', addFactory);
  $('priceForm').addEventListener('submit', savePrice);
  $('settingsForm').addEventListener('submit', saveSettings);
  $('stockAdjustForm').addEventListener('submit', addStockAdjustment);

  $('exportPurchaseCsvBtn').addEventListener('click', exportPurchaseCsv);
  $('exportSaleCsvBtn').addEventListener('click', exportSaleCsv);
  $('exportJsonBtn').addEventListener('click', exportJson);
  $('importJsonInput').addEventListener('change', (e) => importJson(e.target.files[0]));
  $('resetDataBtn').addEventListener('click', resetData);
  $('connectFirebaseBtn').addEventListener('click', connectFirebaseFromSettings);
  $('disconnectFirebaseBtn').addEventListener('click', disconnectFirebase);
  $('pushCloudBtn').addEventListener('click', async () => { try { if (!firebaseCtx) await initFirebaseCloud(); state.settings.cloudSyncEnabled = true; await pushFullStateToCloud(); subscribeCloudRealtime(); toast('ส่งข้อมูลขึ้น Cloud แล้ว'); } catch (error) { toast(error.message || 'ส่งข้อมูลขึ้น Cloud ไม่สำเร็จ'); } });
  $('pullCloudBtn').addEventListener('click', async () => { try { state.settings.firebaseConfigText = $('firebaseConfigText').value.trim(); state.settings.firebaseShopCode = cleanShopCode($('firebaseShopCode').value); state.settings.cloudSyncEnabled = true; saveLocalState(); await pullCloudOnce(); } catch (error) { toast(error.message || 'ดึงข้อมูลจาก Cloud ไม่สำเร็จ'); } });

  $('quickPrintLastPurchaseBtn').addEventListener('click', () => printPurchase(lastPurchaseId || state.purchases[0]?.id));
  $('quickPrintLastSaleBtn').addEventListener('click', () => printSale(lastSaleId || state.sales[0]?.id));
  $('modalCloseBtn').addEventListener('click', closeModal);
  $('modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });

  ['purchaseGross','purchaseTare','purchaseDrc','purchasePriceDrc100','purchasePriceKg','purchaseTransportDeduct','purchaseDebtDeduct','purchaseOtherDeduct'].forEach((id) => $(id).addEventListener('input', calculatePurchasePreview));
  ['purchaseProduct','purchaseMethod'].forEach((id) => $(id).addEventListener('change', () => { $('purchasePriceDrc100').value = ''; $('purchasePriceKg').value = ''; updatePurchaseVisibility(); }));
  $('purchaseDate').addEventListener('change', () => { $('purchasePriceDrc100').value = ''; $('purchasePriceKg').value = ''; applyDefaultPurchasePrice(true); calculatePurchasePreview(); });
  $('purchasePaymentMethod').addEventListener('change', () => { if ($('purchasePaymentMethod').value === 'credit') $('purchaseStatus').value = 'pending'; });

  ['saleGross','saleTare','saleDrc','salePriceDrc100','salePriceKg','saleExpense','saleCostKg'].forEach((id) => $(id).addEventListener('input', calculateSalePreview));
  ['saleProduct','saleMethod'].forEach((id) => $(id).addEventListener('change', () => { $('salePriceDrc100').value = ''; $('salePriceKg').value = ''; $('saleCostKg').value = ''; updateSaleVisibility(); }));
  $('saleDate').addEventListener('change', () => { $('salePriceDrc100').value = ''; $('salePriceKg').value = ''; applyDefaultSalePrice(true); calculateSalePreview(); });
  $('salePaymentMethod').addEventListener('change', () => { if ($('salePaymentMethod').value === 'credit') $('saleStatus').value = 'pending'; });

  ['dashboardDate','purchaseFilterDate','saleFilterDate','reportFrom','reportTo','priceDate'].forEach((id) => $(id).addEventListener('change', () => renderAll()));
  $('purchaseSearch').addEventListener('input', renderPurchases);
  $('saleSearch').addEventListener('input', renderSales);
}

function seedIfEmpty() {
  if (!state.prices.length) {
    state.prices.push({
      id: uid('price'),
      date: todayISO(),
      latexBuyDrc: 0,
      cupBuyKg: 0,
      cupBuyDrc: 0,
      latexSaleDrc: 0,
      cupSaleKg: 0,
      cupSaleDrc: 0,
      createdAt: new Date().toISOString()
    });
    saveState();
  }
}

function bootstrap() {
  seedIfEmpty();
  $('purchaseDate').value = todayISO();
  $('purchaseTime').value = currentTime();
  $('saleDate').value = todayISO();
  $('saleTime').value = currentTime();
  $('dashboardDate').value = todayISO();
  $('priceDate').value = todayISO();
  $('reportFrom').value = todayISO();
  $('reportTo').value = todayISO();
  bindEvents();
  resetPurchaseForm();
  resetSaleForm();
  renderAll();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
  if (state.settings.cloudSyncEnabled && state.settings.firebaseConfigText) {
    initFirebaseCloud().then(() => {
      subscribeCloudRealtime();
      renderCloudStatus('เชื่อม Cloud อัตโนมัติแล้ว');
    }).catch((error) => renderCloudStatus(error.message || 'เชื่อม Cloud อัตโนมัติไม่สำเร็จ'));
  }
}

bootstrap();
