/* =========================================================
   INZTAMOTO ERP — APPLICATION LOGIC
   Firebase (auto field) + Cloudinary (upload gambar)
   ========================================================= */

// ============================================
// 1. MASUKKAN KONFIGURASI FIREBASE ANDA DI SINI
// ============================================
const firebaseConfig = window.__INZTAMOTO_ENV__?.firebase || {
  apiKey: "",
  authDomain: "",
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: ""
};

// ============================================
// 2. MASUKKAN KONFIGURASI CLOUDINARY ANDA DI SINI
// ============================================
const CLOUDINARY_CLOUD_NAME = window.__INZTAMOTO_ENV__?.cloudinary?.cloudName || "";
const CLOUDINARY_UPLOAD_PRESET = window.__INZTAMOTO_ENV__?.cloudinary?.uploadPreset || "";

/* =========================================================
   INISIALISASI FIREBASE
   ========================================================= */
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

/* =========================================================
   FLAG MENCEGAH DOBLE INIT
   ========================================================= */
let appInitialized = false;

/* =========================================================
   KONSTANTA
   ========================================================= */
const SKU_MAP = {
  'Tail Bag': 'INZ-TAIL', 'Side Bag': 'INZ-SIDE', 'Duffel Bag': 'INZ-DUFF',
  'Tank Bag': 'INZ-TANK', 'Tool Bag': 'INZ-TOOL', 'Dry Bag': 'INZ-DRY',
  'Pannier Bag': 'INZ-PAN', 'Accessories': 'INZ-ACC'
};

const CHANNELS = ['Website', 'Shopee', 'Tokopedia', 'WhatsApp', 'Offline Store'];

const EXPEDITIONS = ['Shopee Express', 'J&T', 'JNE', 'SiCepat', 'Anteraja', 'Ninja', 'POS', 'Lainnya'];

const SEED_CATEGORIES = [
  { name: 'Tail Bag', slug: 'tail-bag', description: 'Tas bagasi belakang motor' },
  { name: 'Side Bag', slug: 'side-bag', description: 'Tas samping motor' },
  { name: 'Duffel Bag', slug: 'duffel-bag', description: 'Tas duffel untuk touring' }
];

const SEED_PRODUCTS = [
  { name: 'Tail Bag Urban X1', categoryName: 'Tail Bag', description: 'Tail bag premium untuk harian', costPrice: 85000, sellingPrice: 165000, stock: 45, status: 'active', featured: true },
  { name: 'Side Bag Navigator', categoryName: 'Side Bag', description: 'Side bag waterproof dengan buckle premium', costPrice: 95000, sellingPrice: 195000, stock: 32, status: 'active', featured: true },
  { name: 'Duffel Bag Expedition 40L', categoryName: 'Duffel Bag', description: 'Duffel bag 40L tahan air', costPrice: 150000, sellingPrice: 295000, stock: 18, status: 'active', featured: true }
];

const DEMO_USERS = [
  { name: 'Rizky InztaMoto', email: 'admin@inztamoto.com', role: 'Owner', status: 'Aktif' },
  { name: 'Sari Admin', email: 'sari@inztamoto.com', role: 'Admin', status: 'Aktif' },
  { name: 'Budi Warehouse', email: 'budi@inztamoto.com', role: 'Warehouse', status: 'Aktif' }
];

/* =========================================================
   STATE MANAGEMENT
   ========================================================= */
const state = {
  user: null,
  products: [],
  categories: [],
  sales: [],
  production: [],
  stockMovements: [],
  productionPurchases: [],
  users: [...DEMO_USERS],
  currentPage: 'dashboard',
  prod: { search: '', filter: 'all', catFilter: 'all', sort: { field: 'sku', dir: 'asc' }, page: 1, perPage: 8 },
  prodOrder: { search: '', filter: 'all', page: 1, perPage: 8 },
  sale: { search: '', channel: 'all', page: 1, perPage: 8 },
  pp: { search: '', week: '', status: 'all', page: 1, perPage: 10 },
  charts: {},
  tempImageData: null,
  listeners: []
};

/* =========================================================
   UTILITAS
   ========================================================= */
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const today = new Date().toISOString().split('T')[0];
const fmt = n => (n || 0).toLocaleString('id-ID');
const fmtRp = n => 'Rp ' + (n || 0).toLocaleString('id-ID');
const pct = (a, b) => b > 0 ? Math.round(a / b * 100) : 0;
const calcProfit = (sp, cp) => (sp || 0) - (cp || 0);
const calcMargin = (sp, cp) => sp > 0 ? Math.round(((sp - cp) / sp) * 100) : 0;
const getCatName = id => { const c = state.categories.find(x => x.id === id); return c ? c.name : '-'; };
const findProduct = (id, name) =>
  state.products.find(x => x.id === id) ||
  (name ? state.products.find(x => x.name === name) : null);

/* parsePrice — konversi input harga ke angka bersih
   "250000"     -> 250000
   "Rp 250.000" -> 250000
   ""           -> 0  */
function parsePrice(val) {
  if (val === null || val === undefined) return 0;
  return parseInt(String(val).replace(/[^0-9]/g, ''), 10) || 0;
}

/* Hapus semua undefined/null secara rekursif — aman untuk Firestore */
function sanitize(obj) {
  if (obj === null || obj === undefined) return '';
  if (typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) {
    return obj
      .map(item => sanitize(item))
      .filter(item => item !== undefined && item !== null);
  }
  const clean = {};
  for (const key of Object.keys(obj)) {
    const val = obj[key];
    if (val !== undefined && val !== null) {
      clean[key] = sanitize(val);
    }
  }
  return clean;
}

function getCategorySkuCode(cat) {
  if (!cat) return 'XX';
  if (cat.skuCode && cat.skuCode.trim()) {
    return cat.skuCode.trim().toUpperCase().slice(0, 2);
  }
  // Fallback dari nama: ambil inisial 2 kata pertama
  const words = cat.name.trim().split(/\s+/);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return cat.name.slice(0, 2).toUpperCase();
}

function generateSKU(categoryId, excludeProductId) {
  const cat = state.categories.find(c => c.id === categoryId);
  if (!cat) return 'INZ-XX-01';

  // Priority: skuCode field → SKU_MAP lama → generate dari nama
  var prefix;
  if (cat.skuCode && cat.skuCode.trim()) {
    prefix = 'INZ-' + cat.skuCode.trim().toUpperCase().slice(0, 2);
  } else if (SKU_MAP[cat.name]) {
    prefix = SKU_MAP[cat.name];
  } else {
    prefix = 'INZ-' + getCategorySkuCode(cat);
  }

  // Cari sequence tertinggi yang pernah dipakai (termasuk produk yang sudah dihapus tidak dicek,
  // tapi produk aktif dijadikan batas bawah). Pakai max + 1 agar SKU tidak pernah reuse.
  var max = 0;
  state.products.forEach(function(p) {
    if (excludeProductId && p.id === excludeProductId) return;
    if (p.sku && p.sku.startsWith(prefix + '-')) {
      var parts = p.sku.split('-');
      var num = parseInt(parts[parts.length - 1]);
      if (!isNaN(num) && num > max) max = num;
    }
  });

  // max + 1: monotonic, SKU gaps are acceptable, prevents SKU reuse after delete
  return prefix + '-' + String(max + 1).padStart(2, '0');
}

function isSkuUnique(sku, excludeProductId) {
  return !state.products.some(function(p) {
    if (excludeProductId && p.id === excludeProductId) return false;
    return p.sku === sku;
  });
}

function prodImg(p, size = 40) {
  if (p && p.images && p.images.length > 0 && p.images[0].imageUrl) {
    return `<img src="${p.images[0].imageUrl}" alt="${p.name || ''}" class="prod-thumb" style="width:${size}px;height:${size}px">`;
  }
  return `<div class="prod-thumb-placeholder" style="width:${size}px;height:${size}px"><i class="fas fa-image"></i></div>`;
}

/* =========================================================
   TOAST & MODAL
   ========================================================= */
function toast(msg, type = 'success') {
  const c = $('#toastContainer');
  const icons = { success: 'fa-circle-check', error: 'fa-circle-xmark', warning: 'fa-triangle-exclamation' };
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<i class="fas ${icons[type] || icons.success}"></i><span>${msg}</span>`;
  c.appendChild(el);
  setTimeout(() => { el.classList.add('removing'); setTimeout(() => el.remove(), 300) }, 3000);
}

function openModal(title, body, footer = '') {
  $('#modalTitle').textContent = title;
  $('#modalBody').innerHTML = body;
  $('#modalFooter').innerHTML = footer;
  $('#modalOverlay').classList.add('show');
}

function closeModal() { $('#modalOverlay').classList.remove('show') }
 $('#modalClose').onclick = closeModal;
 $('#modalOverlay').addEventListener('click', e => { if (e.target === $('#modalOverlay')) closeModal() });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal() });

/* =========================================================
   CLOUDINARY — Upload langsung via API
   ========================================================= */
async function handleImageUpload(input) {
  const file = input.files[0];
  if (!file) return;

  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg'];
  if (!allowedTypes.includes(file.type)) {
    toast('Format gambar harus JPG, PNG, atau WebP', 'warning');
    input.value = '';
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    toast('Ukuran gambar maksimal 10MB', 'warning');
    input.value = '';
    return;
  }

  const formData = new FormData();
  formData.append('file', file);
  formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
  formData.append('folder', 'inztamoto/products');

  const preview = $('#imagePreview');
  if (preview) {
    preview.innerHTML = `<div style="text-align:center;padding:20px"><i class="fas fa-spinner fa-spin" style="font-size:24px;color:var(--primary)"></i><p style="margin-top:8px;font-size:13px;color:var(--text-muted)">Mengupload & mengompres gambar...</p></div>`;
  }

  try {
    const res = await fetch(
      `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`,
      { method: 'POST', body: formData }
    );
    const data = await res.json();

    if (data.error) {
      toast('Upload gagal: ' + data.error.message, 'error');
      if (preview) preview.innerHTML = '';
      input.value = '';
      return;
    }

    state.tempImageData = {
      publicId: data.public_id,
      imageUrl: `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/image/upload/q_auto,f_auto,w_800/${data.public_id}`,
      ...(data.delete_token ? { deleteToken: data.delete_token } : {})
    };

    if (preview) {
      preview.innerHTML = `
        <img src="${state.tempImageData.imageUrl}" alt="Preview" style="max-width:100%;max-height:200px;border-radius:8px;object-fit:contain;margin-bottom:10px">
        <p style="font-size:11px;color:var(--success);margin-bottom:8px"><i class="fas fa-check-circle"></i> Gambar terkompres & dioptimasi otomatis oleh Cloudinary</p>
        <button type="button" class="btn btn-outline btn-sm" onclick="removeImage()"><i class="fas fa-trash"></i> Hapus Gambar</button>`;
    }
    toast('Gambar berhasil diupload', 'success');
  } catch (err) {
    toast('Gagal upload: ' + err.message, 'error');
    if (preview) preview.innerHTML = '';
    input.value = '';
  }
}

window.removeImage = function () {
  state.tempImageData = null;
  const preview = $('#imagePreview');
  if (preview) preview.innerHTML = '';
  const fileInput = document.getElementById('fImageFile');
  if (fileInput) fileInput.value = '';
};

async function deleteCloudinaryImage(images) {
  if (!images || !images.length) return;
  for (const img of images) {
    if (!img.deleteToken) continue;
    try {
      await fetch(
        `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/destroy`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ delete_token: img.deleteToken })
        }
      );
      console.log('Gambar dihapus dari Cloudinary:', img.publicId);
    } catch (e) {
      console.warn('Gagal hapus gambar dari Cloudinary:', img.publicId, e);
    }
  }
}

/* =========================================================
   BADGES
   ========================================================= */
function statusBadge(s) {
  const m = { active: 'badge-active', in_production: 'badge-in_production', pre_order: 'badge-pre_order', low_stock: 'badge-low_stock', out_of_stock: 'badge-out_of_stock', inactive: 'badge-inactive' };
  const l = { active: 'Aktif', in_production: 'Dalam Produksi', pre_order: 'Pre Order', low_stock: 'Stok Rendah', out_of_stock: 'Habis', inactive: 'Nonaktif' };
  return `<span class="badge ${m[s] || 'badge-inactive'}">${l[s] || s}</span>`;
}

function prodStatusBadge(s) {
  const m = { pending: 'badge-pending', in_progress: 'badge-in_progress', qc: 'badge-qc', completed: 'badge-completed' };
  const l = { pending: 'Pending', in_progress: 'Dalam Proses', qc: 'Quality Control', completed: 'Selesai' };
  return `<span class="badge ${m[s] || 'badge-pending'}">${l[s] || s}</span>`;
}

function channelBadge(ch) {
  const key = ch.toLowerCase().replace(/ /g, '_');
  const m = { website: 'badge-website', shopee: 'badge-shopee', tokopedia: 'badge-tokopedia', whatsapp: 'badge-whatsapp', offline_store: 'badge-offline_store' };
  return `<span class="badge ${m[key] || 'badge-offline_store'}">${ch}</span>`;
}

function expeditionBadge(exp) {
  if (!exp) return '';
  const key = exp.toLowerCase().replace(/[^a-z0-9]/g, '_');
  const m = {
    shopee_express: 'badge-shopee', j_t: 'badge-tokopedia', jne: 'badge-website',
    sicepat: 'badge-in_progress', anteraja: 'badge-qc', ninja: 'badge-pre_order',
    pos: 'badge-pending', lainnya: 'badge-offline_store'
  };
  return `<span class="badge ${m[key] || 'badge-offline_store'}">${exp}</span>`;
}

/* =========================================================
   AUTH
   ========================================================= */
 $('#loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  const email = $('#loginEmail').value.trim();
  const pass = $('#loginPassword').value;
  const btn = $('#loginBtn');
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Memproses...';
  btn.disabled = true;

  try {
    if (email === 'admin@inztamoto.com' && pass === 'admin123') {
      state.user = { name: 'Rizky InztaMoto', email, role: 'Owner' };
      enterApp();
    } else {
      await auth.signInWithEmailAndPassword(email, pass);
    }
  } catch (err) {
    toast(err.message || 'Login gagal', 'error');
    btn.innerHTML = '<span>Masuk ke Sistem</span><i class="fas fa-arrow-right"></i>';
    btn.disabled = false;
  }
});

 $('#logoutBtn').addEventListener('click', () => {
  state.listeners.forEach(unsub => { try { unsub(); } catch(e) {} });
  state.listeners = [];
  appInitialized = false;

  if (auth.currentUser) {
    auth.signOut().then(() => {
      state.user = null;
      $('#appShell').style.display = 'none';
      $('#loginPage').style.display = 'flex';
      toast('Berhasil keluar', 'success');
    }).catch(() => {
      state.user = null;
      $('#appShell').style.display = 'none';
      $('#loginPage').style.display = 'flex';
    });
  } else {
    state.user = null;
    $('#appShell').style.display = 'none';
    $('#loginPage').style.display = 'flex';
    toast('Berhasil keluar', 'success');
  }

  $('#loginBtn').innerHTML = '<span>Masuk ke Sistem</span><i class="fas fa-arrow-right"></i>';
  $('#loginBtn').disabled = false;
});

function enterApp() {
  if (appInitialized) return;
  appInitialized = true;

  $('#loginPage').style.display = 'none';
  $('#appShell').style.display = 'block';
  $('#userName').textContent = state.user.name;
  $('#userRole').textContent = state.user.role;
  $('#settingsName').textContent = state.user.name;
  $('#settingsEmail').textContent = state.user.email;
  $('#settingNameInput').value = state.user.name;
  $('#settingEmailInput').value = state.user.email;
  $('#userAvatar').textContent = state.user.name.charAt(0).toUpperCase();
  $('#settingsAvatar').textContent = state.user.name.charAt(0).toUpperCase();
  initFirebaseListeners();
  navigateTo('dashboard');
}

/* =========================================================
   FIREBASE REAL-TIME LISTENERS
   ========================================================= */
function initFirebaseListeners() {
  const unsubCat = db.collection('categories').orderBy('name').onSnapshot(snap => {
    state.categories = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    state.categories.forEach(c => {
      c.productCount = state.products.filter(p => p.categoryId === c.id).length;
    });
    if (state.currentPage === 'kategori') renderCategories();
    populateCategoryFilter();
  }, err => console.error('Kategori listener error:', err));
  state.listeners.push(unsubCat);

  const unsubProd = db.collection('products').orderBy('sku').onSnapshot(snap => {
    state.products = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    state.categories.forEach(c => {
      c.productCount = state.products.filter(p => p.categoryId === c.id).length;
    });
    renderCurrentPage();
  }, err => console.error('Produk listener error:', err));
  state.listeners.push(unsubProd);

  const unsubSale = db.collection('sales').orderBy('date', 'desc').onSnapshot(snap => {
    state.sales = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderCurrentPage();
  }, err => console.error('Sales listener error:', err));
  state.listeners.push(unsubSale);

  const unsubProdOrder = db.collection('production').orderBy('date', 'desc').onSnapshot(snap => {
    state.production = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderCurrentPage();
  }, err => console.error('Production listener error:', err));
  state.listeners.push(unsubProdOrder);

  const unsubSM = db.collection('stock_movements').orderBy('date', 'desc').onSnapshot(snap => {
    state.stockMovements = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderCurrentPage();
  }, err => console.error('Stock movements listener error:', err));
  state.listeners.push(unsubSM);

  const unsubPP = db.collection('production_purchases').orderBy('date', 'desc').onSnapshot(snap => {
    state.productionPurchases = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (state.currentPage === 'belanjaProduksi') renderBelanjaProduksi();
  }, err => console.error('Production purchases listener error:', err));
  state.listeners.push(unsubPP);

  seedIfEmpty();
}

function renderCurrentPage() {
  switch (state.currentPage) {
    case 'dashboard': renderDashboard(); break;
    case 'produk': renderProducts(); break;
    case 'produksi': renderProduction(); break;
    case 'inventaris': renderInventory(); break;
    case 'penjualan': renderSales(); break;
    case 'laporan': renderReports(); break;
    case 'belanjaProduksi': renderBelanjaProduksi(); break;
  }
}

/* =========================================================
   SEED DATA
   ========================================================= */
async function seedIfEmpty() {
  try {
    const catSnap = await db.collection('categories').limit(1).get();
    if (!catSnap.empty) return;

    toast('Mengisi data awal...', 'warning');

    const catBatch = db.batch();
    const catIdMap = {};
    SEED_CATEGORIES.forEach(cat => {
      const ref = db.collection('categories').doc();
      catIdMap[cat.name] = ref.id;
      catBatch.set(ref, {
        name: cat.name, slug: cat.slug, description: cat.description,
        productCount: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
      });
    });
    await catBatch.commit();

    const prodBatch = db.batch();
    SEED_PRODUCTS.forEach((prod, i) => {
      const ref = db.collection('products').doc();
      const catId = catIdMap[prod.categoryName];
      const cat = SEED_CATEGORIES.find(c => c.name === prod.categoryName);
      const prefix = SKU_MAP[cat.name] || 'INZ-XXX';
      const sku = prefix + '-' + String(i + 1).padStart(3, '0');

      prodBatch.set(ref, {
        name: prod.name, sku: sku, slug: prod.name.toLowerCase().replace(/\s+/g, '-'),
        categoryId: catId, description: prod.description,
        costPrice: prod.costPrice, sellingPrice: prod.sellingPrice,
        profit: calcProfit(prod.sellingPrice, prod.costPrice),
        margin: calcMargin(prod.sellingPrice, prod.costPrice),
        stock: prod.stock, status: prod.status, featured: prod.featured,
        images: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
      });
    });
    await prodBatch.commit();

    toast('Data awal berhasil diisi', 'success');
  } catch (err) {
    console.error('Seed error:', err);
    toast('Gagal mengisi data awal', 'error');
  }
}

/* =========================================================
   ROUTER
   ========================================================= */
const TITLES = {
  dashboard: 'Dashboard', produk: 'Produk', kategori: 'Kategori',
  produksi: 'Produksi', inventaris: 'Stock Control', penjualan: 'Penjualan',
  laporan: 'Laporan', pengguna: 'Pengguna', pengaturan: 'Pengaturan',
  belanjaProduksi: 'Belanja Produksi'
};

function navigateTo(page) {
  state.currentPage = page;
  $$('.page').forEach(p => p.classList.remove('active'));
  const el = $('#page' + page.charAt(0).toUpperCase() + page.slice(1));
  if (el) el.classList.add('active');
  $$('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.page === page));
  $('#pageTitle').textContent = TITLES[page] || page;
  renderCurrentPage();
  if (page === 'kategori') renderCategories();
  if (page === 'pengguna') renderUsers();
  $('#sidebar').classList.remove('open');
  $('#sidebarOverlay').classList.remove('show');
}

 $$('.nav-item').forEach(n => n.addEventListener('click', e => { e.preventDefault(); navigateTo(n.dataset.page) }));
 $('#hamburgerBtn').addEventListener('click', () => { $('#sidebar').classList.toggle('open'); $('#sidebarOverlay').classList.toggle('show') });
 $('#sidebarOverlay').addEventListener('click', () => { $('#sidebar').classList.remove('open'); $('#sidebarOverlay').classList.remove('show') });
 $('#globalSearch').addEventListener('input', e => {
  if (state.currentPage !== 'produk') navigateTo('produk');
  $('#prodSearch').value = e.target.value;
  state.prod.search = e.target.value;
  state.prod.page = 1;
  renderProductTable();
});

/* =========================================================
   AGREGASI DATA REAL UNTUK CHART
   ========================================================= */
function groupByPeriod(arr, period, valueField, isCost = false) {
  const grouped = {};
  arr.forEach(item => {
    if (!item.date) return;
    let key = '';
    if (period === 'daily') {
      key = item.date;
    } else if (period === 'weekly') {
      const d = new Date(item.date);
      const dayNum = d.getDay();
      const startOfWeek = new Date(d);
      startOfWeek.setDate(d.getDate() - dayNum + (dayNum === 0 ? -6 : 1));
      key = startOfWeek.toISOString().split('T')[0];
    } else if (period === 'monthly') {
      key = item.date.substring(0, 7);
    }

    let val = 0;
    if (isCost) val = (item.costPrice || 0) * (item.quantity || 0);
    else if (valueField === 'targetQty' || valueField === 'completedQty') val = item[valueField] || 0;
    else val = item[valueField] || 0;

    grouped[key] = (grouped[key] || 0) + val;
  });
  return grouped;
}

function formatChartPeriodData(groupedData, period, lookback) {
  const labels = [];
  const values = [];
  const now = new Date();

  for (let i = lookback - 1; i >= 0; i--) {
    const d = new Date(now);
    let key = '';
    let label = '';

    if (period === 'daily') {
      d.setDate(d.getDate() - i);
      key = d.toISOString().split('T')[0];
      label = d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
    } else if (period === 'weekly') {
      d.setDate(d.getDate() - (i * 7));
      const dayNum = d.getDay();
      const startOfWeek = new Date(d);
      startOfWeek.setDate(d.getDate() - dayNum + (dayNum === 0 ? -6 : 1));
      key = startOfWeek.toISOString().split('T')[0];
      label = startOfWeek.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
    } else if (period === 'monthly') {
      d.setMonth(d.getMonth() - i);
      key = d.toISOString().split('T')[0].substring(0, 7);
      label = d.toLocaleDateString('id-ID', { month: 'short', year: '2-digit' });
    }

    if (!labels.includes(label)) {
      labels.push(label);
      values.push(groupedData[key] || 0);
    }
  }
  return { labels, values };
}

/* =========================================================
   DASHBOARD
   ========================================================= */
function renderDashboard() {
  // Ambil tahun dan bulan saat ini (Contoh: "2023-10")
  const currentMonth = new Date().toISOString().substring(0, 7);
  
  // Filter data untuk BULAN INI
  const tsMonth = state.sales.filter(s => (s.date || '').substring(0, 7) === currentMonth);
  const prodMonth = state.production.filter(p => (p.date || '').substring(0, 7) === currentMonth);
  
  const totalTarget = prodMonth.reduce((s, p) => s + (p.targetQty || 0), 0);
  const totalCompleted = prodMonth.reduce((s, p) => s + (p.completedQty || 0), 0);
  const revenueMonth = tsMonth.reduce((s, x) => s + (x.revenue || 0), 0);
  const costMonth = tsMonth.reduce((s, x) => s + (x.costPrice || 0) * (x.quantity || 0), 0);
  const profitMonth = revenueMonth - costMonth;
  const marginMonth = revenueMonth > 0 ? Math.round(profitMonth / revenueMonth * 100) : 0;
  
  const activeStock = state.products.filter(p => p.status === 'active' || p.status === 'in_production').reduce((s, p) => s + (p.stock || 0), 0);
  const lowStock = state.products.filter(p => p.status === 'low_stock').length;
  const outStock = state.products.filter(p => p.status === 'out_of_stock').length;
  const best = tsMonth.length > 0 ? tsMonth.reduce((a, b) => (a.revenue || 0) > (b.revenue || 0) ? a : b) : null;

  const cards = [
    { label: 'Produksi Bulan Ini', value: totalCompleted, sub: 'Target: ' + totalTarget + ' unit', icon: 'fa-industry', cls: 'gold' },
    { label: 'Penjualan Bulan Ini', value: tsMonth.length, sub: 'Transaksi', icon: 'fa-receipt', cls: 'green' },
    { label: 'Pendapatan Bulan Ini', value: revenueMonth, sub: fmtRp(revenueMonth), icon: 'fa-money-bill-wave', cls: 'gold', isRp: true },
    { label: 'Cost Hpp Bulan Ini', value: costMonth, sub: fmtRp(costMonth), icon: 'fa-coins', cls: 'maroon', isRp: true },
    { label: 'Keuntungan Bulan Ini', value: profitMonth, sub: fmtRp(profitMonth), icon: 'fa-chart-pie', cls: 'green', isRp: true },
    { label: 'Margin Keuntungan', value: marginMonth, sub: marginMonth + '%', icon: 'fa-percent', cls: 'gold', isPct: true },
    { label: 'Total Stok Aktif', value: activeStock, sub: 'Unit tersedia', icon: 'fa-boxes-stacked', cls: 'green' },
    { label: 'Stok Rendah', value: lowStock, sub: lowStock + ' produk', icon: 'fa-triangle-exclamation', cls: 'maroon' },
    { label: 'Stok Habis', value: outStock, sub: outStock + ' produk', icon: 'fa-circle-xmark', cls: 'red' },
    { label: 'Produk Terlaris', value: best ? best.productName : '-', sub: best ? fmtRp(best.revenue) : 'Belum ada', icon: 'fa-trophy', cls: 'gold', isText: true }
  ];

  $('#dashStats').innerHTML = cards.map(c => {
    const display = c.isRp ? fmtRp(c.value) : c.isPct ? c.value + '%' : c.isText ? c.value : fmt(c.value);
    return `<div class="stat-card ${c.cls}"><div class="sc-top"><div class="sc-icon"><i class="fas ${c.icon}"></i></div><span class="sc-label">${c.label}</span></div><div class="sc-value" style="${c.isText ? 'font-size:16px;word-break:break-word' : ''}">${display}</div><div class="sc-sub">${c.sub}</div></div>`;
  }).join('');

  // Alerts & Charts tetap dipanggil seperti biasa di bawah ini
  let alerts = '';
  if (outStock > 0) alerts += `<div class="alert-bar danger"><i class="fas fa-circle-exclamation"></i><span><span class="alert-count">${outStock}</span> produk dalam status <strong>Habis</strong> — segera lakukan restocking!</span></div>`;
  if (lowStock > 0) alerts += `<div class="alert-bar warning"><i class="fas fa-triangle-exclamation"></i><span><span class="alert-count">${lowStock}</span> produk dengan <strong>Stok Rendah</strong></span></div>`;
  $('#dashAlerts').innerHTML = alerts;
  $('#criticalDot').style.display = (outStock + lowStock) > 0 ? 'block' : 'none';
  $('#notifDot').style.display = (outStock + lowStock) > 0 ? 'block' : 'none';

  renderSalesTrendChart('daily');
  renderChannelChart();
  renderRevenueCostChart();
  renderProductionChart();
  renderCategoryChart();
  renderTopSellingList();
  renderProdProgressList();
}

/* =========================================================
   CHART — KONEK DATA REAL
   ========================================================= */
const chartFont = { family: 'Plus Jakarta Sans', size: 11 };
const chartGrid = { color: 'rgba(244,196,48,.06)' };

function renderSalesTrendChart(range) {
  if (state.charts.salesTrend) state.charts.salesTrend.destroy();
  const lookback = range === 'daily' ? 7 : range === 'weekly' ? 8 : 6;
  const grouped = groupByPeriod(state.sales, range, 'revenue');
  const data = formatChartPeriodData(grouped, range, lookback);

  state.charts.salesTrend = new Chart($('#chartSalesTrend').getContext('2d'), {
    type: 'line',
    data: {
      labels: data.labels,
      datasets: [{
        label: 'Penjualan', data: data.values, borderColor: '#D4A017', backgroundColor: 'rgba(244,196,48,.1)',
        fill: true, tension: .4, pointRadius: 4, pointBackgroundColor: '#fff', pointBorderColor: '#D4A017', pointBorderWidth: 2, borderWidth: 2.5
      }]
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => fmtRp(c.raw) } } }, scales: { x: { grid: { display: false }, ticks: { font: chartFont } }, y: { grid: chartGrid, ticks: { font: chartFont, callback: v => (v / 1000000).toFixed(1) + 'jt' } } } }
  });
}

document.addEventListener('click', e => {
  if (e.target.classList.contains('chart-tab') && e.target.closest('#salesTrendTabs')) {
    e.target.closest('.chart-tabs').querySelectorAll('.chart-tab').forEach(t => t.classList.remove('active'));
    e.target.classList.add('active');
    renderSalesTrendChart(e.target.dataset.range);
  }
});

function renderChannelChart() {
  if (state.charts.channel) state.charts.channel.destroy();
  const ch = {};
  state.sales.forEach(s => { ch[s.channel] = (ch[s.channel] || 0) + (s.revenue || 0) });
  const colors = ['#7A1F1F', '#EE4D2D', '#2E7D32', '#128C7E', '#4B5563'];
  state.charts.channel = new Chart($('#chartChannel').getContext('2d'), {
    type: 'doughnut', data: { labels: Object.keys(ch), datasets: [{ data: Object.values(ch), backgroundColor: colors, borderWidth: 0, hoverOffset: 8 }] },
    options: { responsive: true, maintainAspectRatio: false, cutout: '65%', plugins: { legend: { position: 'bottom', labels: { font: { ...chartFont, weight: '500' }, usePointStyle: true, pointStyle: 'circle', padding: 14 } }, tooltip: { callbacks: { label: c => c.label + ': ' + fmtRp(c.raw) } } } }
  });
}

function renderRevenueCostChart() {
  if (state.charts.revCost) state.charts.revCost.destroy();
  const groupedRev = groupByPeriod(state.sales, 'monthly', 'revenue');
  const groupedCost = groupByPeriod(state.sales, 'monthly', 'costPrice', true);
  const dataRev = formatChartPeriodData(groupedRev, 'monthly', 6);
  const dataCost = formatChartPeriodData(groupedCost, 'monthly', 6);

  state.charts.revCost = new Chart($('#chartRevenueCost').getContext('2d'), {
    type: 'bar',
    data: {
      labels: dataRev.labels,
      datasets: [
        { label: 'Pendapatan', data: dataRev.values, backgroundColor: 'rgba(244,196,48,.75)', borderRadius: 6, barPercentage: .55, categoryPercentage: .6 },
        { label: 'Biaya', data: dataCost.values, backgroundColor: 'rgba(122,31,31,.55)', borderRadius: 6, barPercentage: .55, categoryPercentage: .6 }
      ]
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'top', labels: { font: { ...chartFont, weight: '500' }, usePointStyle: true, pointStyle: 'circle', padding: 14 } }, tooltip: { callbacks: { label: c => c.dataset.label + ': ' + fmtRp(c.raw) } } }, scales: { x: { grid: { display: false }, ticks: { font: chartFont } }, y: { grid: chartGrid, ticks: { font: chartFont, callback: v => (v / 1000000).toFixed(1) + 'jt' } } } }
  });
}

function renderProductionChart() {
  if (state.charts.production) state.charts.production.destroy();
  const grouped = groupByPeriod(state.production, 'monthly', 'completedQty');
  const data = formatChartPeriodData(grouped, 'monthly', 6);

  state.charts.production = new Chart($('#chartProduction').getContext('2d'), {
    type: 'bar', data: { labels: data.labels, datasets: [{ label: 'Unit Diproduksi', data: data.values, backgroundColor: 'rgba(22,163,74,.65)', borderRadius: 6, barPercentage: .5, categoryPercentage: .6 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false }, ticks: { font: chartFont } }, y: { grid: chartGrid, ticks: { font: chartFont } } } }
  });
}

function renderCategoryChart() {
  if (state.charts.category) state.charts.category.destroy();
  const cs = {}; state.sales.forEach(s => { const p = state.products.find(x => x.id === s.productId); if (p) { const cn = getCatName(p.categoryId); cs[cn] = (cs[cn] || 0) + (s.revenue || 0) } });
  const colors = ['#F4C430', '#D4A017', '#7A1F1F', '#16A34A', '#0EA5E9', '#D97706', '#DC2626', '#6B7280'];
  state.charts.category = new Chart($('#chartCategory').getContext('2d'), {
    type: 'doughnut', data: { labels: Object.keys(cs), datasets: [{ data: Object.values(cs), backgroundColor: colors, borderWidth: 0, hoverOffset: 6 }] },
    options: { responsive: true, maintainAspectRatio: false, cutout: '55%', plugins: { legend: { position: 'bottom', labels: { font: { size: 10, weight: '500' }, usePointStyle: true, pointStyle: 'circle', padding: 10 } }, tooltip: { callbacks: { label: c => c.label + ': ' + fmtRp(c.raw) } } } }
  });
}

function renderTopSellingList() {
  const ps = {}; state.sales.forEach(s => { ps[s.productId] = (ps[s.productId] || 0) + (s.revenue || 0) });
  const sorted = Object.entries(ps).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const total = sorted.reduce((s, x) => s + x[1], 0);
  $('#topSellingList').innerHTML = sorted.length ? sorted.map(([pid, rev], i) => {
    const p = state.products.find(x => x.id === pid);
    const cls = i === 0 ? 'g' : i === 1 ? 's' : i === 2 ? 'b' : 'n';
    return `<div class="rank-item">${prodImg(p, 32)}<div class="rank-num ${cls}">${i + 1}</div><div class="rank-info"><div class="name">${p ? p.name : '-'}</div><div class="sub">${p ? p.sku : ''} — ${pct(rev, total)}%</div><div class="progress-bar" style="width:120px"><div class="fill fill-gold" style="width:${pct(rev, total)}%"></div></div></div><div class="rank-val">${fmtRp(rev)}<small>${pct(rev, total)}%</small></div></div>`;
  }).join('') : '<div class="empty-state"><i class="fas fa-trophy"></i><h4>Belum ada data</h4></div>';
}

function renderProdProgressList() {
  const tp = state.production.filter(p => p.date === today);
  if (!tp.length) { $('#prodProgressList').innerHTML = '<div class="empty-state"><i class="fas fa-industry"></i><h4>Tidak ada produksi hari ini</h4></div>'; return; }
  $('#prodProgressList').innerHTML = tp.map(pr => {
    const pctDone = pr.targetQty > 0 ? Math.round((pr.completedQty || 0) / pr.targetQty * 100) : 0;
    const fillCls = pctDone >= 100 ? 'fill-green' : pctDone >= 50 ? 'fill-gold' : 'fill-red';
    const p = findProduct(pr.productId, pr.productName);
    return `<div class="prod-card">${prodImg(p, 36)}<div class="pc-info"><h4>${pr.productName}</h4><p>${pr.sku} — ${prodStatusBadge(pr.status)}</p><div class="progress-bar" style="width:100%;margin-top:8px"><div class="fill ${fillCls}" style="width:${pctDone}%"></div></div></div><div class="pc-stats"><div class="val">${pr.completedQty || 0}/${pr.targetQty}</div><div class="lbl">${pctDone}%</div></div></div>`;
  }).join('');
}

/* =========================================================
   PRODUK — CRUD + CLOUDINARY + AUTO SKU
   ========================================================= */
function getFilteredProducts() {
  let list = [...state.products];
  if (state.prod.search) { const q = state.prod.search.toLowerCase(); list = list.filter(p => (p.name || '').toLowerCase().includes(q) || (p.sku || '').toLowerCase().includes(q)) }
  if (state.prod.filter !== 'all') list = list.filter(p => p.status === state.prod.filter);
  if (state.prod.catFilter !== 'all') list = list.filter(p => p.categoryId === state.prod.catFilter);
  const { field, dir } = state.prod.sort;
  list.sort((a, b) => {
    let va = a[field], vb = b[field];
    if (typeof va === 'string') return dir === 'asc' ? (va || '').localeCompare(vb || '') : (vb || '').localeCompare(va || '');
    return dir === 'asc' ? (va || 0) - (vb || 0) : (vb || 0) - (va || 0);
  });
  return list;
}

function populateCategoryFilter() {
  const sel = $('#prodCatFilter');
  const current = sel.value;
  sel.innerHTML = '<option value="all">Semua Kategori</option>';
  state.categories.forEach(c => { sel.innerHTML += `<option value="${c.id}">${c.name}</option>` });
  sel.value = current;
}

function renderProducts() { populateCategoryFilter(); renderProductTable(); }

function renderProductTable() {
  const filtered = getFilteredProducts();
  const { page, perPage } = state.prod;
  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
  if (page > totalPages) state.prod.page = totalPages;
  const start = (state.prod.page - 1) * perPage;
  const items = filtered.slice(start, start + perPage);
  const tbody = $('#prodBody');

  if (!items.length) {
    tbody.innerHTML = `<tr><td colspan="10"><div class="empty-state"><i class="fas fa-box-open"></i><h4>Tidak ada produk</h4><p>Tambahkan produk pertama Anda</p></div></td></tr>`;
  } else {
    tbody.innerHTML = items.map(p => {
      // Backward compat: produk lama mungkin tidak punya profit/margin tersimpan
      const displayProfit = (p.profit !== undefined && p.profit !== null) ? p.profit : calcProfit(p.sellingPrice, p.costPrice);
      const displayMargin = (p.margin !== undefined && p.margin !== null) ? p.margin : calcMargin(p.sellingPrice, p.costPrice);
      return `<tr>
      <td>${prodImg(p)}</td>
      <td><div style="display:flex;align-items:center;gap:8px">${p.featured ? '<i class="fas fa-star" style="color:var(--primary);font-size:11px" title="Unggulan"></i>' : ''}<div><strong style="font-size:13px">${p.name}</strong><br><small style="color:var(--text-muted)">${getCatName(p.categoryId)}</small></div></div></td>
      <td><strong style="color:var(--primary-dark)">${p.sku}</strong></td>
      <td>${fmtRp(p.costPrice)}</td><td>${fmtRp(p.sellingPrice)}</td>
      <td style="color:var(--success);font-weight:600">${fmtRp(displayProfit)}</td>
      <td><span style="font-weight:600;color:${displayMargin >= 40 ? 'var(--success)' : displayMargin >= 25 ? 'var(--warning)' : 'var(--danger)'}">${displayMargin}%</span></td>
      <td><strong>${fmt(p.stock)}</strong></td>
      <td>${statusBadge(p.status)}</td>
      <td><div class="action-btns"><button class="action-btn" title="Edit" onclick="editProduct('${p.id}')"><i class="fas fa-pen"></i></button><button class="action-btn del" title="Hapus" onclick="confirmDeleteProduct('${p.id}','${(p.name || '').replace(/'/g, "\\'")}')"><i class="fas fa-trash"></i></button></div></td>
    </tr>`;
    }).join('');
  }

  const end = Math.min(start + perPage, filtered.length);
  $('#prodInfo').textContent = filtered.length > 0 ? `Menampilkan ${start + 1}–${end} dari ${filtered.length} produk` : 'Tidak ada data';

  let pag = `<button ${state.prod.page <= 1 ? 'disabled' : ''} onclick="goProdPage(${state.prod.page - 1})"><i class="fas fa-chevron-left"></i></button>`;
  for (let i = 1; i <= totalPages; i++) {
    if (totalPages > 7 && i > 2 && i < totalPages - 1 && Math.abs(i - state.prod.page) > 1) {
      if (i === 3 || i === totalPages - 2) pag += '<button disabled>...</button>';
      continue;
    }
    pag += `<button class="${i === state.prod.page ? 'active' : ''}" onclick="goProdPage(${i})">${i}</button>`;
  }
  pag += `<button ${state.prod.page >= totalPages ? 'disabled' : ''} onclick="goProdPage(${state.prod.page + 1})"><i class="fas fa-chevron-right"></i></button>`;
  $('#prodPagination').innerHTML = pag;
}

window.goProdPage = function (n) { state.prod.page = n; renderProductTable(); };

let prodSearchTimeout;
 $('#prodSearch').addEventListener('input', e => { clearTimeout(prodSearchTimeout); prodSearchTimeout = setTimeout(() => { state.prod.search = e.target.value; state.prod.page = 1; renderProductTable() }, 200) });
 $('#prodFilter').addEventListener('change', e => { state.prod.filter = e.target.value; state.prod.page = 1; renderProductTable() });
 $('#prodCatFilter').addEventListener('change', e => { state.prod.catFilter = e.target.value; state.prod.page = 1; renderProductTable() });
 $('#prodTable').addEventListener('click', e => {
  const th = e.target.closest('th'); if (!th || !th.dataset.sort) return;
  const f = th.dataset.sort;
  if (state.prod.sort.field === f) state.prod.sort.dir = state.prod.sort.dir === 'asc' ? 'desc' : 'asc';
  else { state.prod.sort.field = f; state.prod.sort.dir = 'asc'; }
  state.prod.page = 1; renderProductTable();
});

 $('#exportProdBtn').addEventListener('click', () => {
  const h = ['SKU', 'Nama', 'Kategori', 'Harga Modal', 'Harga Jual', 'Keuntungan', 'Margin', 'Stok', 'Status', 'Gambar'];
  const rows = state.products.map(p => [p.sku, p.name, getCatName(p.categoryId), p.costPrice, p.sellingPrice, p.profit, p.margin + '%', p.stock, p.status, (p.images && p.images[0]) ? p.images[0].imageUrl : '']);
  let csv = '\uFEFF' + h.join(',') + '\n' + rows.map(r => r.map(v => `"${v}"`).join(',')).join('\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' })); a.download = `produk_${today}.csv`; a.click();
  toast('Data produk di-export', 'success');
});

/* --- Product Form --- */
function productFormHTML(p = null) {
  const v = p || { name: '', categoryId: state.categories[0]?.id || '', description: '', costPrice: 0, sellingPrice: 0, stock: 0, featured: false, status: 'active' };
  const catOpts = state.categories.map(c => `<option value="${c.id}" ${v.categoryId === c.id ? 'selected' : ''}>${c.name}</option>`).join('');
  const existingImg = (p && p.images && p.images.length > 0) ? p.images[0].imageUrl : '';
  const previewHTML = state.tempImageData ? `<img src="${state.tempImageData.imageUrl}" alt="Preview"><br><button type="button" class="btn btn-outline btn-sm" style="margin-top:8px" onclick="removeImage()"><i class="fas fa-trash"></i> Hapus Gambar</button>` : existingImg ? `<img src="${existingImg}" alt="Preview"><br><button type="button" class="btn btn-outline btn-sm" style="margin-top:8px" onclick="removeImage()"><i class="fas fa-trash"></i> Hapus Gambar</button>` : '';

  return `
    <div class="form-row"><div class="form-group full"><label>Nama Produk</label><input type="text" class="form-input" id="fName" value="${v.name || ''}" required></div></div>
    <div class="form-row">
      <div class="form-group"><label>Kategori</label><select class="form-input" id="fCat" onchange="onCategoryChange()">${catOpts}</select></div>
      <div class="form-group"><label>SKU (otomatis)</label><input type="text" class="form-input" id="fSku" value="${p ? p.sku : generateSKU(v.categoryId)}" readonly></div>
    </div>
    <div class="form-group"><label>Deskripsi</label><textarea class="form-input" id="fDesc" rows="2">${v.description || ''}</textarea></div>
    <div class="form-row">
      <div class="form-group"><label>Harga Modal (Rp)</label><input type="number" class="form-input" id="fCost" value="${v.costPrice}" min="0" oninput="calcFormProfit()"></div>
      <div class="form-group"><label>Harga Jual (Rp)</label><input type="number" class="form-input" id="fSell" value="${v.sellingPrice}" min="0" oninput="calcFormProfit()"></div>
    </div>
    <div style="padding:10px 14px;background:var(--primary-light);border-radius:var(--radius-sm);font-size:13px;margin-bottom:16px;display:flex;gap:20px">
      <span>Keuntungan: <strong id="fProfitDisplay">${fmtRp(calcProfit(v.sellingPrice, v.costPrice))}</strong></span>
      <span>Margin: <strong id="fMarginDisplay">${calcMargin(v.sellingPrice, v.costPrice)}%</strong></span>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Stok Awal</label><input type="number" class="form-input" id="fStock" value="${v.stock}" min="0"></div>
      <div class="form-group"><label>Status</label><select class="form-input" id="fStatus"><option value="active" ${v.status === 'active' ? 'selected' : ''}>Aktif</option><option value="in_production" ${v.status === 'in_production' ? 'selected' : ''}>Dalam Produksi</option><option value="pre_order" ${v.status === 'pre_order' ? 'selected' : ''}>Pre Order</option><option value="low_stock" ${v.status === 'low_stock' ? 'selected' : ''}>Stok Rendah</option><option value="inactive" ${v.status === 'inactive' ? 'selected' : ''}>Nonaktif</option></select></div>
    </div>
    <div class="form-group"><label style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" id="fFeatured" ${v.featured ? 'checked' : ''}> Produk Unggulan</label></div>
    <div class="form-group">
      <label>Gambar Produk</label>
      <div class="image-upload-area" id="imagePreview" style="cursor:pointer" onclick="document.getElementById('fImageFile').click()">
        ${previewHTML || `<div style="padding:24px;text-align:center;color:var(--text-muted)"><i class="fas fa-cloud-upload-alt" style="font-size:32px;display:block;margin-bottom:10px;opacity:.4"></i><p style="font-size:13px">Klik untuk pilih gambar</p><p style="font-size:11px;opacity:.7">JPG, PNG, WebP — Maks 10MB</p><p style="font-size:11px;opacity:.7;margin-top:4px">Otomatis dikompres Cloudinary</p></div>`}
      </div>
      <input type="file" id="fImageFile" accept="image/jpeg,image/png,image/webp,image/jpg" style="display:none" onchange="handleImageUpload(this)">
    </div>`;
}

window.onCategoryChange = function () {
  const catId = $('#fCat').value;
  $('#fSku').value = generateSKU(catId);
};
window.calcFormProfit = function () {
  const cp = parsePrice($('#fCost').value), sp = parsePrice($('#fSell').value);
  $('#fProfitDisplay').textContent = fmtRp(calcProfit(sp, cp));
  $('#fMarginDisplay').textContent = calcMargin(sp, cp) + '%';
};

 $('#addProdBtn').addEventListener('click', () => {
  state.tempImageData = null;
  openModal('Tambah Produk Baru', productFormHTML(), `<button class="btn btn-outline btn-sm" onclick="closeModal()">Batal</button><button class="btn btn-primary btn-sm" onclick="saveNewProduct()"><i class="fas fa-check"></i>Simpan</button>`);
});

/* =========================================================
   PRODUK — SAVE (FIXED: no duplicate, no const reassign)
   ========================================================= */
function getFormVal(id, fallback = '') {
  const el = document.getElementById(id);
  return el ? el.value : fallback;
}

window.saveNewProduct = async function () {
  const name = getFormVal('fName').trim();
  if (!name) { toast('Nama produk wajib diisi', 'warning'); return; }
  const cp = parsePrice(getFormVal('fCost', '0'));
  const sp = parsePrice(getFormVal('fSell', '0'));
  const catId = getFormVal('fCat', '');

  if (cp < 0 || sp < 0) { toast('Harga tidak boleh negatif', 'warning'); return; }
  if (sp < cp) toast('Harga jual lebih rendah dari harga modal — margin negatif', 'warning');

  // Ambil SKU dari form; jika sudah dipakai regenerate (generateSKU sudah skip ke sequence unik)
  let sku = getFormVal('fSku', generateSKU(catId));
  if (!isSkuUnique(sku)) {
    sku = generateSKU(catId);
    if (!isSkuUnique(sku)) {
      toast('Tidak dapat membuat SKU unik untuk kategori ini.', 'error');
      return;
    }
    $('#fSku').value = sku;
  }

  const productData = sanitize({
    name: name,
    sku: sku,
    slug: name.toLowerCase().replace(/\s+/g, '-'),
    categoryId: getFormVal('fCat', ''),
    description: getFormVal('fDesc', ''),
    costPrice: cp,
    sellingPrice: sp,
    profit: calcProfit(sp, cp),
    margin: calcMargin(sp, cp),
    stock: parseInt(getFormVal('fStock', '0')) || 0,
    status: getFormVal('fStatus', 'active'),
    featured: !!document.getElementById('fFeatured')?.checked,
    images: state.tempImageData ? [state.tempImageData] : [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });

  try {
    await db.collection('products').add(productData);
    state.tempImageData = null;
    toast('Produk berhasil ditambahkan', 'success');
    closeModal();
  } catch (err) {
    console.error('Save new product error:', err);
    toast('Gagal menambahkan produk: ' + err.message, 'error');
  }
};

window.editProduct = function (id) {
  const p = state.products.find(x => x.id === id);
  if (!p) { toast('Produk tidak ditemukan', 'error'); return; }
  state.tempImageData = null;
  openModal('Edit Produk', productFormHTML(p), `<button class="btn btn-outline btn-sm" onclick="closeModal()">Batal</button><button class="btn btn-primary btn-sm" onclick="saveEditProduct('${id}')"><i class="fas fa-check"></i>Update</button>`);
};

window.saveEditProduct = async function (id) {
  const name = getFormVal('fName').trim();
  if (!name) { toast('Nama produk wajib diisi', 'warning'); return; }
  const cp = parsePrice(getFormVal('fCost', '0'));
  const sp = parsePrice(getFormVal('fSell', '0'));

  if (cp < 0 || sp < 0) { toast('Harga tidak boleh negatif', 'warning'); return; }
  if (sp < cp) toast('Harga jual lebih rendah dari harga modal — margin negatif', 'warning');

  const p = state.products.find(x => x.id === id);
  const images = state.tempImageData ? [state.tempImageData] : (p && p.images ? p.images : []);

  const productData = sanitize({
    name: name,
    sku: p ? p.sku : getFormVal('fSku', ''),  // always preserve existing SKU, never regenerate
    slug: name.toLowerCase().replace(/\s+/g, '-'),
    categoryId: getFormVal('fCat', p ? p.categoryId : ''),
    description: getFormVal('fDesc', ''),
    costPrice: cp,
    sellingPrice: sp,
    profit: calcProfit(sp, cp),
    margin: calcMargin(sp, cp),
    stock: parseInt(getFormVal('fStock', '0')) || 0,
    status: getFormVal('fStatus', p ? p.status : 'active'),
    featured: !!document.getElementById('fFeatured')?.checked,
    images: images,
    updatedAt: new Date().toISOString()
  });

  try {
    await db.collection('products').doc(id).update(productData);
    state.tempImageData = null;
    toast('Produk berhasil diupdate', 'success');
    closeModal();
  } catch (err) {
    console.error('Save edit product error:', err);
    toast('Gagal update produk: ' + err.message, 'error');
  }
};

window.confirmDeleteProduct = function (id, name) {
  openModal('Konfirmasi Hapus', `<div style="text-align:center;padding:10px 0"><i class="fas fa-trash" style="font-size:40px;color:var(--danger);opacity:.6;margin-bottom:14px;display:block"></i><p style="font-size:15px;font-weight:600">Hapus produk ini?</p><p style="font-size:13px;color:var(--text-muted);margin-top:6px">"${name}" akan dihapus permanen.</p></div>`, `<button class="btn btn-outline btn-sm" onclick="closeModal()">Batal</button><button class="btn btn-danger btn-sm" onclick="doDeleteProduct('${id}')"><i class="fas fa-trash"></i>Hapus</button>`);
};

window.doDeleteProduct = async function (id) {
  const product = state.products.find(x => x.id === id);
  const imagesToDelete = product && product.images ? [...product.images] : [];

  try {
    await db.collection('products').doc(id).delete();
    if (imagesToDelete.length > 0) {
      deleteCloudinaryImage(imagesToDelete).then(() => {
        console.log('Semua gambar produk dihapus dari Cloudinary');
      });
    }
    toast('Produk dihapus', 'success');
    closeModal();
  } catch (err) {
    toast('Gagal menghapus: ' + err.message, 'error');
  }
};

/* =========================================================
   KATEGORI
   ========================================================= */
function renderCategories() {
  state.categories.forEach(c => { c.productCount = state.products.filter(p => p.categoryId === c.id).length });

  if (!state.categories.length) {
    $('#catAccordion').innerHTML = '<div class="empty-state"><i class="fas fa-tags"></i><h4>Belum ada kategori</h4><p>Tambahkan kategori pertama Anda</p></div>';
    return;
  }

  $('#catAccordion').innerHTML = state.categories.map(c => {
    const products = state.products.filter(p => p.categoryId === c.id);
    const totalStock = products.reduce((s, p) => s + (p.stock || 0), 0);
    const totalValue = products.reduce((s, p) => s + (p.stock || 0) * (p.sellingPrice || 0), 0);

    let tableRows = '';
    if (products.length) {
      tableRows = products.map(p => `<tr>
        <td>${prodImg(p, 32)}</td>
        <td><strong style="font-size:13px">${p.name}</strong></td>
        <td style="color:var(--primary-dark);font-weight:600;font-size:12px">${p.sku}</td>
        <td>${fmtRp(p.sellingPrice)}</td>
        <td style="font-weight:600">${fmt(p.stock)}</td>
        <td>${statusBadge(p.status)}</td>
      </tr>`).join('');
    } else {
      tableRows = `<tr><td colspan="6"><div class="cat-acc-empty"><i class="fas fa-box-open"></i>Belum ada produk di kategori ini</div></td></tr>`;
    }

    return `
    <div class="cat-accordion-item" id="cat-${c.id}">
      <div class="cat-accordion-header" onclick="toggleCategory('${c.id}')">
        <div class="cat-acc-icon"><i class="fas fa-tag"></i></div>
        <div class="cat-acc-info">
          <h4>${c.name}</h4>
          <p>${c.description || 'Tanpa deskripsi'} — ${totalStock} unit stok · Nilai: ${fmtRp(totalValue)}</p>
        </div>
        <span class="cat-acc-count">${c.productCount} Produk</span>
        <div class="cat-acc-actions" onclick="event.stopPropagation()">
          <button class="action-btn" title="Edit" onclick="editCategory('${c.id}')"><i class="fas fa-pen"></i></button>
          <button class="action-btn del" title="Hapus" onclick="confirmDeleteCategory('${c.id}','${(c.name || '').replace(/'/g, "\\'")}')"><i class="fas fa-trash"></i></button>
        </div>
        <i class="fas fa-chevron-down cat-chevron"></i>
      </div>
      <div class="cat-accordion-body">
        <div class="cat-acc-inner">
          <table class="cat-acc-inner-table">
            <thead><tr>
              <th>Gambar</th><th>Produk</th><th>SKU</th><th>Harga Jual</th><th>Stok</th><th>Status</th>
            </tr></thead>
            <tbody>${tableRows}</tbody>
          </table>
        </div>
      </div>
    </div>`;
  }).join('');
}

window.toggleCategory = function (id) {
  const item = document.getElementById('cat-' + id);
  if (item) item.classList.toggle('open');
};

 $('#addCatBtn').addEventListener('click', () => {
  openModal('Tambah Kategori', `<div class="form-group"><label>Nama Kategori</label><input type="text" class="form-input" id="fCatName" placeholder="Contoh: Helmet Bag"></div><div class="form-group"><label>Kode SKU <small style="color:var(--text-muted);font-weight:400">(2 huruf, contoh: TB, SB, HB)</small></label><input type="text" class="form-input" id="fCatSku" placeholder="Contoh: HB" maxlength="2" oninput="this.value=this.value.toUpperCase().replace(/[^A-Z]/g,'')"></div><div class="form-group"><label>Deskripsi</label><input type="text" class="form-input" id="fCatDesc" placeholder="Deskripsi singkat"></div>`, `<button class="btn btn-outline btn-sm" onclick="closeModal()">Batal</button><button class="btn btn-primary btn-sm" onclick="saveNewCategory()"><i class="fas fa-check"></i>Simpan</button>`);
});
window.saveNewCategory = async function () {
  const n = $('#fCatName').value.trim();
  if (!n) { toast('Nama wajib diisi', 'warning'); return; }

  const rawSku = ($('#fCatSku') ? $('#fCatSku').value : '').trim().toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2);
  if (!rawSku) { toast('Kode SKU wajib diisi (2 huruf)', 'warning'); return; }

  // Validasi uniqueness skuCode
  const duplicate = state.categories.find(c => c.skuCode && c.skuCode.toUpperCase() === rawSku);
  if (duplicate) { toast('Kode SKU "' + rawSku + '" sudah dipakai oleh kategori "' + duplicate.name + '"', 'error'); return; }

  try {
    await db.collection('categories').add({
      name: n, slug: n.toLowerCase().replace(/\s+/g, '-'),
      description: $('#fCatDesc').value, skuCode: rawSku,
      productCount: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    });
    toast('Kategori ditambahkan', 'success');
    closeModal();
  } catch (err) { toast('Gagal: ' + err.message, 'error'); }
};
window.editCategory = function (id) {
  const c = state.categories.find(x => x.id === id); if (!c) return;
  openModal('Edit Kategori', `<div class="form-group"><label>Nama Kategori</label><input type="text" class="form-input" id="fCatName" value="${c.name}"></div><div class="form-group"><label>Kode SKU <small style="color:var(--text-muted);font-weight:400">(2 huruf, contoh: TB, SB)</small></label><input type="text" class="form-input" id="fCatSku" value="${c.skuCode || ''}" maxlength="2" oninput="this.value=this.value.toUpperCase().replace(/[^A-Z]/g,'')"></div><div class="form-group"><label>Deskripsi</label><input type="text" class="form-input" id="fCatDesc" value="${c.description || ''}"></div>`, `<button class="btn btn-outline btn-sm" onclick="closeModal()">Batal</button><button class="btn btn-primary btn-sm" onclick="saveEditCategory('${id}')"><i class="fas fa-check"></i>Update</button>`);
};
window.saveEditCategory = async function (id) {
  const n = $('#fCatName').value.trim();
  if (!n) { toast('Nama wajib diisi', 'warning'); return; }

  const rawSku = ($('#fCatSku') ? $('#fCatSku').value : '').trim().toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2);
  if (!rawSku) { toast('Kode SKU wajib diisi (2 huruf)', 'warning'); return; }

  // Validasi uniqueness — exclude kategori yang sedang diedit
  const duplicate = state.categories.find(c => c.id !== id && c.skuCode && c.skuCode.toUpperCase() === rawSku);
  if (duplicate) { toast('Kode SKU "' + rawSku + '" sudah dipakai oleh kategori "' + duplicate.name + '"', 'error'); return; }

  try {
    await db.collection('categories').doc(id).update({
      name: n, slug: n.toLowerCase().replace(/\s+/g, '-'),
      description: $('#fCatDesc').value, skuCode: rawSku,
      updatedAt: new Date().toISOString()
    });
    toast('Kategori diupdate', 'success');
    closeModal();
  } catch (err) { toast('Gagal: ' + err.message, 'error'); }
};
window.confirmDeleteCategory = function (id, name) {
  openModal('Konfirmasi Hapus', `<div style="text-align:center;padding:10px 0"><i class="fas fa-trash" style="font-size:40px;color:var(--danger);opacity:.6;margin-bottom:14px;display:block"></i><p style="font-size:15px;font-weight:600">Hapus kategori "${name}"?</p></div>`, `<button class="btn btn-outline btn-sm" onclick="closeModal()">Batal</button><button class="btn btn-danger btn-sm" onclick="doDeleteCategory('${id}')"><i class="fas fa-trash"></i>Hapus</button>`);
};
window.doDeleteCategory = async function (id) { try { await db.collection('categories').doc(id).delete(); toast('Kategori dihapus', 'success'); closeModal(); } catch (err) { toast('Gagal: ' + err.message, 'error'); } };

/* =========================================================
   PRODUKSI
   ========================================================= */
function renderProduction() {
  const tp = state.production.filter(p => p.date === today);
  const totalTarget = tp.reduce((s, p) => s + (p.targetQty || 0), 0);
  const totalCompleted = tp.reduce((s, p) => s + (p.completedQty || 0), 0);
  const pctDone = totalTarget > 0 ? Math.round(totalCompleted / totalTarget * 100) : 0;
  $('#prodStats').innerHTML = [
    { label: 'Target Produksi', value: totalTarget, sub: 'Produksi Hari Ini', icon: 'fa-bullseye', cls: 'gold' },
    { label: 'Selesai', value: totalCompleted, sub: 'Produksi Selesai', icon: 'fa-check-circle', cls: 'green' },
    { label: 'Persentase', value: pctDone + '%', sub: 'penyelesaian', icon: 'fa-percent', cls: pctDone >= 80 ? 'green' : 'gold' }
  ].map(c => `<div class="stat-card ${c.cls}"><div class="sc-top"><div class="sc-icon"><i class="fas ${c.icon}"></i></div><span class="sc-label">${c.label}</span></div><div class="sc-value">${c.value}</div><div class="sc-sub">${c.sub}</div></div>`).join('');
  renderProductionTable();
}

function renderProductionTable() {
  let list = [...state.production];
  if (state.prodOrder.search) { const q = state.prodOrder.search.toLowerCase(); list = list.filter(p => (p.productName || '').toLowerCase().includes(q) || (p.sku || '').toLowerCase().includes(q)) }
  if (state.prodOrder.filter !== 'all') list = list.filter(p => p.status === state.prodOrder.filter);
  list.sort((a, b) => {
    const aPct = a.targetQty > 0 ? (a.completedQty || 0) / a.targetQty : 0;
    const bPct = b.targetQty > 0 ? (b.completedQty || 0) / b.targetQty : 0;
    const aDone = aPct >= 1 ? 1 : 0;
    const bDone = bPct >= 1 ? 1 : 0;
    if (aDone !== bDone) return aDone - bDone;
    return (b.date || '').localeCompare(a.date || '');
  });
  const { page, perPage } = state.prodOrder; const total = Math.max(1, Math.ceil(list.length / perPage));
  if (page > total) state.prodOrder.page = total;
  const start = (state.prodOrder.page - 1) * perPage, items = list.slice(start, start + perPage);

  $('#prodOrderBody').innerHTML = items.length ? items.map(p => {
    const pctDone = p.targetQty > 0 ? Math.round((p.completedQty || 0) / p.targetQty * 100) : 0;
    const fillCls = pctDone >= 100 ? 'fill-green' : pctDone >= 50 ? 'fill-gold' : 'fill-red';
    const prod = findProduct(p.productId, p.productName);
    return `<tr><td>${prodImg(prod, 32)}</td><td><strong>${p.productName}</strong></td><td>${p.sku}</td><td>${p.targetQty}</td><td>${p.completedQty || 0}</td>
    <td style="min-width:100px"><div style="display:flex;align-items:center;gap:8px"><div class="progress-bar" style="flex:1"><div class="fill ${fillCls}" style="width:${pctDone}%"></div></div><span style="font-size:12px;font-weight:600">${pctDone}%</span></div></td>
    <td>${p.date}</td><td>${prodStatusBadge(p.status)}</td>
    <td><div class="action-btns"><button class="action-btn" title="Update" onclick="updateProdStatus('${p.id}')"><i class="fas fa-pen"></i></button></div></td></tr>`;
  }).join('') : `<tr><td colspan="9"><div class="empty-state"><i class="fas fa-industry"></i><h4>Tidak ada data produksi</h4></div></td></tr>`;

  const end = Math.min(start + perPage, list.length);
  $('#prodOrderInfo').textContent = list.length > 0 ? `Menampilkan ${start + 1}–${end} dari ${list.length}` : '';
  let pag = `<button ${state.prodOrder.page <= 1 ? 'disabled' : ''} onclick="goProdOrderPage(${state.prodOrder.page - 1})"><i class="fas fa-chevron-left"></i></button>`;
  for (let i = 1; i <= total; i++) pag += `<button class="${i === state.prodOrder.page ? 'active' : ''}" onclick="goProdOrderPage(${i})">${i}</button>`;
  pag += `<button ${state.prodOrder.page >= total ? 'disabled' : ''} onclick="goProdOrderPage(${state.prodOrder.page + 1})"><i class="fas fa-chevron-right"></i></button>`;
  $('#prodOrderPag').innerHTML = pag;
}

window.goProdOrderPage = function (n) { state.prodOrder.page = n; renderProductionTable(); };
let poSearchTimeout;
 $('#prodProdSearch').addEventListener('input', e => { clearTimeout(poSearchTimeout); poSearchTimeout = setTimeout(() => { state.prodOrder.search = e.target.value; state.prodOrder.page = 1; renderProductionTable() }, 200) });
 $('#prodStatusFilter').addEventListener('change', e => { state.prodOrder.filter = e.target.value; state.prodOrder.page = 1; renderProductionTable() });

 $('#addProdOrderBtn').addEventListener('click', () => {
  const opts = state.products.map(p => `<option value="${p.id}">${p.name} (${p.sku})</option>`).join('');
  openModal('Tambah Order Produksi', `<div class="form-group"><label>Produk</label><select class="form-input" id="fPOProd">${opts}</select></div><div class="form-row"><div class="form-group"><label>Target Quantity</label><input type="number" class="form-input" id="fPOTarget" value="10" min="1"></div><div class="form-group"><label>Tanggal</label><input type="date" class="form-input" id="fPODate" value="${today}"></div></div><div class="form-group"><label>Catatan</label><input type="text" class="form-input" id="fPONotes" placeholder="Opsional"></div>`, `<button class="btn btn-outline btn-sm" onclick="closeModal()">Batal</button><button class="btn btn-primary btn-sm" onclick="saveProdOrder()"><i class="fas fa-check"></i>Simpan</button>`);
});
window.saveProdOrder = async function () {
  const pid = $('#fPOProd').value, p = state.products.find(x => x.id === pid); if (!p) return;
  try { await db.collection('production').add({ productId: pid, productName: p.name, sku: p.sku, targetQty: parseInt($('#fPOTarget').value) || 0, completedQty: 0, date: $('#fPODate').value, status: 'pending', notes: $('#fPONotes').value }); toast('Order produksi ditambahkan', 'success'); closeModal(); } catch (err) { toast('Gagal: ' + err.message, 'error'); }
};
window.updateProdStatus = function (id) {
  const p = state.production.find(x => x.id === id); if (!p) return;
  openModal('Update Status Produksi', `<div style="margin-bottom:16px"><strong>${p.productName}</strong> — ${p.sku}</div><div class="form-row"><div class="form-group"><label>Selesai (unit)</label><input type="number" class="form-input" id="fUPCompleted" value="${p.completedQty || 0}" min="0" max="${p.targetQty}"></div><div class="form-group"><label>Status</label><select class="form-input" id="fUPStatus"><option value="pending" ${p.status === 'pending' ? 'selected' : ''}>Pending</option><option value="in_progress" ${p.status === 'in_progress' ? 'selected' : ''}>Dalam Proses</option><option value="qc" ${p.status === 'qc' ? 'selected' : ''}>Quality Control</option><option value="completed" ${p.status === 'completed' ? 'selected' : ''}>Selesai</option></select></div></div><div class="form-group"><label>Catatan</label><input type="text" class="form-input" id="fUPNotes" value="${p.notes || ''}"></div>`, `<button class="btn btn-outline btn-sm" onclick="closeModal()">Batal</button><button class="btn btn-primary btn-sm" onclick="doUpdateProdStatus('${id}')"><i class="fas fa-check"></i>Update</button>`);
};
window.doUpdateProdStatus = async function (id) {
  const completed = parseInt($('#fUPCompleted').value) || 0;
  const newStatusVal = $('#fUPStatus').value;
  const p = state.production.find(x => x.id === id);
  try {
    await db.collection('production').doc(id).update({ completedQty: completed, status: newStatusVal, notes: $('#fUPNotes').value });
    if (newStatusVal === 'completed' && p) {
      const oldCompleted = p.completedQty || 0;
      const diff = completed - oldCompleted;
      if (diff > 0) {
        const prod = state.products.find(x => x.id === p.productId);
        if (prod) {
          const newStock = (prod.stock || 0) + diff;
          const prodNewStatus = newStock <= 0 ? 'out_of_stock' : newStock <= 5 ? 'low_stock' : 'active';
          await db.collection('products').doc(p.productId).update({ stock: newStock, status: prodNewStatus, updatedAt: new Date().toISOString() });
        }
      }
    }
    toast('Status produksi diupdate', 'success'); closeModal();
  } catch (err) { toast('Gagal: ' + err.message, 'error'); }
};

/* =========================================================
   INVENTARIS / STOCK CONTROL
   ========================================================= */
function renderInventory() {
  const q = ($('#invSearch') ? $('#invSearch').value : '').toLowerCase();
  const filterVal = $('#invFilter') ? $('#invFilter').value : 'all';
  let list = [...state.products];
  if (q) list = list.filter(p => (p.name || '').toLowerCase().includes(q) || (p.sku || '').toLowerCase().includes(q));
  if (filterVal === 'safe') list = list.filter(p => p.stock > 5);
  else if (filterVal === 'low') list = list.filter(p => p.stock > 0 && p.stock <= 5);
  else if (filterVal === 'out') list = list.filter(p => p.stock <= 0);

  const todayIn = {}, todayOut = {};
  state.stockMovements.filter(m => m.date === today && !m.deleted).forEach(m => {
    if (m.type === 'in') todayIn[m.productId] = (todayIn[m.productId] || 0) + m.qty;
    else todayOut[m.productId] = (todayOut[m.productId] || 0) + m.qty;
  });

  $('#invBody').innerHTML = list.length ? list.map(p => {
    const sIn = todayIn[p.id] || 0, sOut = todayOut[p.id] || 0;
    const opening = p.stock - sIn + sOut;
    const st = p.stock > 5 ? 'Aman' : p.stock > 0 ? 'Stok Rendah' : 'Habis';
    const stCls = p.stock > 5 ? 'badge-active' : p.stock > 0 ? 'badge-low_stock' : 'badge-out_of_stock';
    return `<tr><td>${prodImg(p, 32)}</td><td><strong style="color:var(--primary-dark)">${p.sku}</strong></td><td>${p.name}</td><td>${opening}</td><td style="color:var(--success);font-weight:600">+${sIn}</td><td style="color:var(--danger);font-weight:600">-${sOut}</td><td><strong>${p.stock}</strong></td><td><span class="badge ${stCls}">${st}</span></td></tr>`;
  }).join('') : `<tr><td colspan="8"><div class="empty-state"><i class="fas fa-boxes-stacked"></i><h4>Tidak ada data</h4></div></td></tr>`;
  $('#invInfo').textContent = `Menampilkan ${list.length} produk`;

  // Riwayat — tombol edit & hapus
  const sorted = [...state.stockMovements].filter(m => !m.deleted).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  $('#invHistoryBody').innerHTML = sorted.length ? sorted.map(m => {
    const typeBadge = `<span class="badge ${m.type === 'in' ? 'badge-active' : 'badge-out_of_stock'}">${m.type === 'in' ? 'Masuk' : 'Keluar'}</span>`;
    let actions = `<div class="action-btns">
      <button class="action-btn" title="Edit" onclick="editStockMovement('${m.id}')"><i class="fas fa-pen"></i></button>
      <button class="action-btn del" title="Hapus" onclick="confirmDeleteMovement('${m.id}')"><i class="fas fa-trash"></i></button>
    </div>`;
    return `<tr><td>${m.date}</td><td><strong style="color:var(--primary-dark)">${m.sku}</strong></td><td>${m.productName}</td><td>${typeBadge}</td><td style="font-weight:600;color:${m.type === 'in' ? 'var(--success)' : 'var(--danger)'}">${m.type === 'in' ? '+' : '-'}${m.qty}</td><td style="color:var(--text-muted);max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${m.note || '-'}">${m.note || '-'}</td><td>${actions}</td></tr>`;
  }).join('') : `<tr><td colspan="7"><div class="empty-state"><i class="fas fa-clock-rotate-left"></i><h4>Belum ada riwayat</h4></div></td></tr>`;
}

let invSearchTimeout;
 $('#invSearch').addEventListener('input', e => { clearTimeout(invSearchTimeout); invSearchTimeout = setTimeout(renderInventory, 200) });
 $('#invFilter').addEventListener('change', renderInventory);

function stockModal(title, type) {
  const opts = state.products.map(p => `<option value="${p.id}">${p.name} (${p.sku}) — Stok: ${p.stock}</option>`).join('');
  openModal(title, `<div class="form-group"><label>Produk</label><select class="form-input" id="fSMProd">${opts}</select></div><div class="form-row"><div class="form-group"><label>Jumlah</label><input type="number" class="form-input" id="fSMQty" value="1" min="1"></div><div class="form-group"><label>Tanggal</label><input type="date" class="form-input" id="fSMDate" value="${today}"></div></div><div class="form-group"><label>Catatan</label><input type="text" class="form-input" id="fSMNote" placeholder="Alasan pergerakan stok"></div>`, `<button class="btn btn-outline btn-sm" onclick="closeModal()">Batal</button><button class="btn btn-primary btn-sm" onclick="doStockMove('${type}')"><i class="fas fa-check"></i>Simpan</button>`);
}
 $('#stockInBtn').addEventListener('click', () => stockModal('Stok Masuk', 'in'));
 $('#stockOutBtn').addEventListener('click', () => stockModal('Stok Keluar', 'out'));
 $('#stockAdjBtn').addEventListener('click', () => stockModal('Penyesuaian Stok', 'adjust'));

window.doStockMove = async function (type) {
  const pid = $('#fSMProd').value, qty = parseInt($('#fSMQty').value) || 0;
  const p = state.products.find(x => x.id === pid);
  if (!p || qty <= 0) { toast('Pilih produk dan jumlah valid', 'warning'); return; }
  if (type === 'out' && p.stock < qty) { toast('Stok tidak mencukupi', 'error'); return; }

  try {
    let newStock, moveType;
    if (type === 'in') { newStock = p.stock + qty; moveType = 'in'; }
    else if (type === 'out') { newStock = p.stock - qty; moveType = 'out'; }
    else { newStock = qty; moveType = qty > p.stock ? 'in' : 'out'; }

    const newStatus = newStock <= 0 ? 'out_of_stock' : newStock <= 5 ? 'low_stock' : 'active';
    await db.collection('products').doc(pid).update({ stock: Math.max(0, newStock), status: newStatus, updatedAt: new Date().toISOString() });
    await db.collection('stock_movements').add({
      date: $('#fSMDate').value, productId: pid, productName: p.name, sku: p.sku,
      type: moveType, qty: type === 'adjust' ? Math.abs(newStock - p.stock) : qty,
      note: $('#fSMNote').value || '-', createdAt: new Date().toISOString()
    });
    toast('Pergerakan stok dicatat', 'success'); closeModal();
  } catch (err) { toast('Gagal: ' + err.message, 'error'); }
};

/* ===== HAPUS pergerakan stok ===== */
window.confirmDeleteMovement = function (id) {
  const m = state.stockMovements.find(x => x.id === id);
  if (!m) return;
  openModal('Konfirmasi Hapus', `
    <div style="text-align:center;padding:10px 0">
      <i class="fas fa-trash" style="font-size:40px;color:var(--danger);opacity:.6;margin-bottom:14px;display:block"></i>
      <p style="font-size:15px;font-weight:600">Hapus pergerakan stok ini?</p>
      <div style="margin-top:14px;padding:14px;background:var(--primary-light);border-radius:var(--radius-sm);text-align:left;font-size:13px;line-height:1.8">
        <strong>${m.productName}</strong> · ${m.sku}<br>
        Tipe: <span class="badge ${m.type === 'in' ? 'badge-active' : 'badge-out_of_stock'}">${m.type === 'in' ? 'Masuk' : 'Keluar'}</span>
        Jumlah: <strong>${m.type === 'in' ? '+' : '-'}${m.qty}</strong><br>
        Catatan: ${m.note || '-'}
      </div>
      <p style="font-size:12px;color:var(--text-muted);margin-top:12px">
        Stok <strong>${m.productName}</strong> akan ${m.type === 'in' ? 'berkurang' : 'bertambah'} <strong>${m.qty}</strong> unit.
      </p>
    </div>`,
    `<button class="btn btn-outline btn-sm" onclick="closeModal()">Batal</button>
     <button class="btn btn-danger btn-sm" onclick="doDeleteMovement('${id}')"><i class="fas fa-trash"></i>Hapus</button>`
  );
};

window.doDeleteMovement = async function (id) {
  const m = state.stockMovements.find(x => x.id === id);
  if (!m || m.deleted) { toast('Sudah dihapus', 'warning'); return; }
  const product = state.products.find(p => p.id === m.productId);
  if (!product) { toast('Produk tidak ditemukan', 'error'); return; }

  try {
    let newStock;
    if (m.type === 'in') newStock = product.stock - m.qty;
    else newStock = product.stock + m.qty;
    const newStatus = newStock <= 0 ? 'out_of_stock' : newStock <= 5 ? 'low_stock' : 'active';

    await db.collection('products').doc(m.productId).update({
      stock: Math.max(0, newStock), status: newStatus, updatedAt: new Date().toISOString()
    });
    await db.collection('stock_movements').doc(id).delete();

    toast('Pergerakan stok dihapus & stok dikembalikan', 'success');
    closeModal();
  } catch (err) {
    toast('Gagal menghapus: ' + err.message, 'error');
  }
};

/* ===== EDIT pergerakan stok ===== */
window.editStockMovement = function (id) {
  const m = state.stockMovements.find(x => x.id === id);
  if (!m || m.deleted) { toast('Tidak bisa di-edit', 'warning'); return; }

  const product = state.products.find(p => p.id === m.productId);
  const stockAfterEdit = m.type === 'in'
    ? (product ? product.stock - m.qty : 0) + m.qty
    : (product ? product.stock + m.qty : 0) - m.qty;

  openModal('Edit Pergerakan Stok', `
    <div style="margin-bottom:16px;padding:14px;background:var(--primary-light);border-radius:var(--radius-sm);font-size:13px;line-height:1.8">
      <strong>${m.productName}</strong> · ${m.sku}<br>
      <span class="badge ${m.type === 'in' ? 'badge-active' : 'badge-out_of_stock'}">${m.type === 'in' ? 'Masuk' : 'Keluar'}</span>
      Jumlah saat ini: <strong>${m.qty}</strong> unit<br>
      Stok produk sekarang: <strong>${product ? product.stock : '?'}</strong> unit
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Jumlah Baru</label>
        <input type="number" class="form-input" id="fEditSMQty" value="${m.qty}" min="1" oninput="previewEditStock('${id}')">
      </div>
      <div class="form-group">
        <label>Tanggal</label>
        <input type="date" class="form-input" id="fEditSMDate" value="${m.date}">
      </div>
    </div>
    <div class="form-group">
      <label>Catatan</label>
      <input type="text" class="form-input" id="fEditSMNote" value="${m.note || ''}">
    </div>
    <div id="editStockPreview" style="margin-top:10px;padding:10px 14px;background:rgba(0,0,0,.03);border-radius:var(--radius-sm);font-size:13px">
      Stok setelah edit: <strong id="editStockVal">${stockAfterEdit}</strong> unit
    </div>`,
    `<button class="btn btn-outline btn-sm" onclick="closeModal()">Batal</button>
     <button class="btn btn-primary btn-sm" onclick="doEditStockMovement('${id}')"><i class="fas fa-check"></i>Simpan</button>`
  );
};

window.previewEditStock = function (id) {
  const m = state.stockMovements.find(x => x.id === id);
  if (!m) return;
  const product = state.products.find(p => p.id === m.productId);
  const newQty = parseInt($('#fEditSMQty').value) || 0;
  const diff = newQty - m.qty;
  let newStock;
  if (m.type === 'in') newStock = (product ? product.stock : 0) + diff;
  else newStock = (product ? product.stock : 0) - diff;
  const el = $('#editStockVal');
  if (el) {
    el.textContent = Math.max(0, newStock);
    el.style.color = newStock < 0 ? 'var(--danger)' : newStock <= 5 ? 'var(--warning)' : 'var(--success)';
  }
};

window.doEditStockMovement = async function (id) {
  const m = state.stockMovements.find(x => x.id === id);
  if (!m) return;
  const newQty = parseInt($('#fEditSMQty').value) || 0;
  if (newQty <= 0) { toast('Jumlah harus lebih dari 0', 'warning'); return; }
  const product = state.products.find(p => p.id === m.productId);
  if (!product) { toast('Produk tidak ditemukan', 'error'); return; }

  const diff = newQty - m.qty;
  let newStock;
  if (m.type === 'in') newStock = product.stock + diff;
  else newStock = product.stock - diff;
  if (newStock < 0) { toast('Stok tidak boleh negatif (akan jadi ' + newStock + ')', 'error'); return; }

  try {
    const newStatus = newStock <= 0 ? 'out_of_stock' : newStock <= 5 ? 'low_stock' : 'active';
    await db.collection('products').doc(m.productId).update({
      stock: newStock, status: newStatus, updatedAt: new Date().toISOString()
    });
    await db.collection('stock_movements').doc(id).update({
      qty: newQty, date: $('#fEditSMDate').value, note: $('#fEditSMNote').value || '-'
    });
    toast('Pergerakan stok diperbarui', 'success');
    closeModal();
  } catch (err) { toast('Gagal: ' + err.message, 'error'); }
};

/* =========================================================
   PENJUALAN
   ========================================================= */
function renderSales() {
  let list = [...state.sales].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  if (state.sale.search) {
    const q = state.sale.search.toLowerCase();
    list = list.filter(s =>
      (s.txNumber   || '').toLowerCase().includes(q) ||
      (s.productName|| '').toLowerCase().includes(q) ||
      (s.customer   || '').toLowerCase().includes(q) ||
      (s.channel    || '').toLowerCase().includes(q) ||
      (s.city       || '').toLowerCase().includes(q) ||
      (s.district   || '').toLowerCase().includes(q) ||
      (s.expedition || '').toLowerCase().includes(q)
    );
  }
  if (state.sale.channel !== 'all') list = list.filter(s => s.channel === state.sale.channel);
  const { page, perPage } = state.sale;
  const total = Math.max(1, Math.ceil(list.length / perPage));
  if (page > total) state.sale.page = total;
  const start = (state.sale.page - 1) * perPage, items = list.slice(start, start + perPage);

  $('#saleBody').innerHTML = items.length ? items.map(s => {
    const p = state.products.find(x => x.id === s.productId);
    // Use realRevenue/realProfit for new sales, fallback to revenue/profit for old
    const displayRevenue = s.realRevenue !== undefined ? s.realRevenue : (s.revenue || 0);
    const displayProfit  = s.realProfit  !== undefined ? s.realProfit  : (s.profit  || 0);
    const addressStr = [s.district, s.city].filter(Boolean).join(', ') || '-';
    return `<tr>
      <td>${prodImg(p, 32)}</td>
      <td><strong style="color:var(--primary-dark)">${s.txNumber}</strong></td>
      <td>${s.date}</td>
      <td>${s.productName}<br><small style="color:var(--text-muted)">${s.sku}</small></td>
      <td>${s.quantity}</td>
      <td>${channelBadge(s.channel || '')}</td>
      <td>${s.expedition ? expeditionBadge(s.expedition) : '<span style="color:var(--text-muted);font-size:12px">—</span>'}</td>
      <td style="font-size:12px;color:var(--text-muted)">${addressStr}</td>
      <td style="font-weight:600">${fmtRp(displayRevenue)}</td>
      <td style="color:var(--success);font-weight:600">${fmtRp(displayProfit)}</td>
      <td><div class="action-btns"><button class="action-btn del" title="Hapus" onclick="deleteSale('${s.id}')"><i class="fas fa-trash"></i></button></div></td>
    </tr>`;
  }).join('') : `<tr><td colspan="11"><div class="empty-state"><i class="fas fa-receipt"></i><h4>Belum ada data penjualan</h4></div></td></tr>`;

  const end = Math.min(start + perPage, list.length);
  $('#saleInfo').textContent = list.length > 0 ? `Menampilkan ${start + 1}–${end} dari ${list.length} transaksi` : '';
  let pag = `<button ${state.sale.page <= 1 ? 'disabled' : ''} onclick="goSalePage(${state.sale.page - 1})"><i class="fas fa-chevron-left"></i></button>`;
  for (let i = 1; i <= Math.min(total, 10); i++) pag += `<button class="${i === state.sale.page ? 'active' : ''}" onclick="goSalePage(${i})">${i}</button>`;
  pag += `<button ${state.sale.page >= total ? 'disabled' : ''} onclick="goSalePage(${state.sale.page + 1})"><i class="fas fa-chevron-right"></i></button>`;
  $('#salePag').innerHTML = pag;
}

window.goSalePage = function (n) { state.sale.page = n; renderSales(); };
let saleSearchTimeout;
 $('#saleSearch').addEventListener('input', e => { clearTimeout(saleSearchTimeout); saleSearchTimeout = setTimeout(() => { state.sale.search = e.target.value; state.sale.page = 1; renderSales() }, 200) });
 $('#saleChannelFilter').addEventListener('change', e => { state.sale.channel = e.target.value; state.sale.page = 1; renderSales() });

 $('#addSaleBtn').addEventListener('click', () => {
  const opts = state.products.filter(p => p.stock > 0).map(p => `<option value="${p.id}">${p.name} (${p.sku}) — ${fmtRp(p.sellingPrice)}</option>`).join('');
  const chOpts = CHANNELS.map(c => `<option value="${c}">${c}</option>`).join('');
  const expOpts = EXPEDITIONS.map(e => `<option value="${e}">${e}</option>`).join('');
  openModal('Catat Penjualan', `
    <div class="form-group"><label>Produk</label><select class="form-input" id="fSaleProd" onchange="updateSaleForm()">${opts}</select></div>
    <div class="form-row">
      <div class="form-group"><label>Jumlah</label><input type="number" class="form-input" id="fSaleQty" value="1" min="1" oninput="updateSaleForm()"></div>
      <div class="form-group"><label>Channel</label><select class="form-input" id="fSaleChannel">${chOpts}</select></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Harga Default <small style="color:var(--text-muted);font-weight:400">(per unit)</small></label><input type="text" class="form-input" id="fSaleDefaultPrice" readonly style="background:var(--primary-light)"></div>
      <div class="form-group"><label>Harga Real Marketplace <small style="color:var(--text-muted);font-weight:400">(per unit)</small></label><input type="number" class="form-input" id="fSaleRealPrice" min="0" oninput="updateSaleForm()" placeholder="Kosongkan = pakai harga default"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Kecamatan</label><input type="text" class="form-input" id="fSaleDistrict" placeholder="Kecamatan tujuan"></div>
      <div class="form-group"><label>Kota</label><input type="text" class="form-input" id="fSaleCity" placeholder="Kota tujuan"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Ekspedisi</label><select class="form-input" id="fSaleExpedition"><option value="">— Pilih Ekspedisi —</option>${expOpts}</select></div>
      <div class="form-group"><label>Pelanggan</label><input type="text" class="form-input" id="fSaleCustomer" placeholder="Nama pelanggan"></div>
    </div>
    <div class="form-group"><label>Tanggal</label><input type="date" class="form-input" id="fSaleDate" value="${today}"></div>
    <div style="padding:12px 14px;background:var(--primary-light);border-radius:var(--radius-sm);font-size:13px;margin-bottom:14px;display:grid;grid-template-columns:1fr 1fr;gap:6px 20px">
      <span>Pendapatan Standar: <strong id="fSaleStdRev">Rp 0</strong></span>
      <span>Pendapatan Real: <strong id="fSaleRev">Rp 0</strong></span>
      <span>Modal (HPP): <strong id="fSaleModal">Rp 0</strong></span>
      <span>Keuntungan Real: <strong id="fSaleProfit" style="color:var(--success)">Rp 0</strong></span>
      <span style="grid-column:1/-1">Selisih Marketplace: <strong id="fSaleDiff">Rp 0</strong></span>
    </div>
    <div class="form-group"><label>Catatan</label><input type="text" class="form-input" id="fSaleNotes" placeholder="Opsional"></div>
  `, `<button class="btn btn-outline btn-sm" onclick="closeModal()">Batal</button><button class="btn btn-primary btn-sm" onclick="saveSale()"><i class="fas fa-check"></i>Simpan</button>`);
  setTimeout(updateSaleForm, 50);
});

window.updateSaleForm = function () {
  const pid = $('#fSaleProd').value, p = state.products.find(x => x.id === pid); if (!p) return;
  const qty = parseInt($('#fSaleQty').value) || 1;

  // Isi harga default
  const defPriceEl = $('#fSaleDefaultPrice');
  if (defPriceEl) defPriceEl.value = fmtRp(p.sellingPrice);

  // Harga real: ambil dari input, jika kosong pakai sellingPrice
  const realPriceInput = $('#fSaleRealPrice');
  const realUnitPrice = (realPriceInput && realPriceInput.value !== '')
    ? (parsePrice(realPriceInput.value) || p.sellingPrice)
    : p.sellingPrice;
  if (realPriceInput && realPriceInput.value === '') realPriceInput.placeholder = fmtRp(p.sellingPrice);

  const standardRevenue = p.sellingPrice * qty;
  const realRevenue     = realUnitPrice * qty;
  const modal           = (p.costPrice || 0) * qty;
  const realProfit      = realRevenue - modal;
  const diff            = realRevenue - standardRevenue;

  const set = (id, val) => { const el = $(id); if (el) el.textContent = fmtRp(val); };
  set('#fSaleStdRev', standardRevenue);
  set('#fSaleRev', realRevenue);
  set('#fSaleModal', modal);
  set('#fSaleProfit', realProfit);
  const diffEl = $('#fSaleDiff');
  if (diffEl) {
    diffEl.textContent = fmtRp(diff);
    diffEl.style.color = diff < 0 ? 'var(--danger)' : diff > 0 ? 'var(--success)' : '';
  }
};

window.saveSale = async function () {
  const pid = $('#fSaleProd').value, p = state.products.find(x => x.id === pid);
  if (!p) { toast('Pilih produk', 'warning'); return; }
  const qty = parseInt($('#fSaleQty').value) || 1;
  if (p.stock < qty) { toast('Stok tidak mencukupi (tersedia: ' + p.stock + ')', 'error'); return; }

  const realPriceInput = $('#fSaleRealPrice');
  const realUnitPrice = (realPriceInput && realPriceInput.value !== '')
    ? (parsePrice(realPriceInput.value) || p.sellingPrice)
    : p.sellingPrice;

  const standardRevenue      = p.sellingPrice * qty;
  const realRevenue          = realUnitPrice * qty;
  const modal                = (p.costPrice || 0) * qty;
  const realProfit           = realRevenue - modal;
  const marketplaceDifference = realRevenue - standardRevenue;

  const channel    = $('#fSaleChannel').value;
  const expedition = ($('#fSaleExpedition') ? $('#fSaleExpedition').value : '') || '';
  const district   = ($('#fSaleDistrict') ? $('#fSaleDistrict').value : '').trim();
  const city       = ($('#fSaleCity') ? $('#fSaleCity').value : '').trim();
  const saleDate   = $('#fSaleDate').value;

  try {
    const txNum = state.sales.length > 0 ? parseInt((state.sales[0].txNumber || 'TXN-00100').split('-')[1]) + 1 : 1001;

    const newStock = p.stock - qty;
    const newStatus = newStock <= 0 ? 'out_of_stock' : newStock <= 5 ? 'low_stock' : 'active';
    await db.collection('products').doc(pid).update({ stock: newStock, status: newStatus, updatedAt: new Date().toISOString() });

    const saleDoc = {
      txNumber: 'TXN-' + String(txNum).padStart(5, '0'),
      date: saleDate, productId: pid, productName: p.name, sku: p.sku,
      quantity: qty,
      costPrice: p.costPrice, sellingPrice: p.sellingPrice,
      realUnitPrice: realUnitPrice,
      standardRevenue: standardRevenue,
      realRevenue: realRevenue,
      revenue: realRevenue,               // compat: use realRevenue for new sales
      modal: modal,
      realProfit: realProfit,
      profit: realProfit,                 // compat: use realProfit for new sales
      marketplaceDifference: marketplaceDifference,
      channel: channel,
      expedition: expedition,
      district: district,
      city: city,
      customer: $('#fSaleCustomer').value || '-',
      notes: $('#fSaleNotes').value,
      createdAt: new Date().toISOString()
    };
    await db.collection('sales').add(sanitize(saleDoc));

    const moveNote = expedition
      ? 'Penjualan ' + channel + ' - ' + expedition
      : 'Penjualan ' + channel;
    await db.collection('stock_movements').add({
      date: saleDate, productId: pid, productName: p.name, sku: p.sku,
      type: 'out', qty: qty, note: moveNote, createdAt: new Date().toISOString()
    });

    toast('Penjualan berhasil dicatat', 'success');
    closeModal();
  } catch (err) { toast('Gagal: ' + err.message, 'error'); }
};

window.deleteSale = async function (id) {
  try { await db.collection('sales').doc(id).delete(); toast('Transaksi dihapus', 'success'); } catch (err) { toast('Gagal: ' + err.message, 'error'); }
};

/* =========================================================
   BELANJA PRODUKSI — Phase 4A
   ========================================================= */

function getWeekKey(dateStr) {
  const d = new Date(dateStr || today);
  const year = d.getFullYear();
  // ISO week number
  const startOfYear = new Date(year, 0, 1);
  const dayOfYear = Math.floor((d - startOfYear) / 86400000) + 1;
  const weekNum = Math.ceil((dayOfYear + startOfYear.getDay()) / 7);
  return year + '-W' + String(weekNum).padStart(2, '0');
}

function getAvailableWeeks() {
  const weeks = new Set();
  weeks.add(getWeekKey(today)); // always include current week
  state.productionPurchases.forEach(p => { if (p.weekKey) weeks.add(p.weekKey); });
  return [...weeks].sort().reverse();
}

function renderBelanjaProduksi() {
  const container = $('#pageBelanjaProduksi');
  if (!container) return;

  const { search, week, status, page, perPage } = state.pp;
  const selectedWeek = week || getWeekKey(today);

  let list = [...state.productionPurchases];
  if (search) {
    const q = search.toLowerCase();
    list = list.filter(p =>
      (p.itemName   || '').toLowerCase().includes(q) ||
      (p.category   || '').toLowerCase().includes(q) ||
      (p.note       || '').toLowerCase().includes(q)
    );
  }
  if (week) list = list.filter(p => p.weekKey === week);
  if (status !== 'all') list = list.filter(p => p.status === status);

  const weeklyTotal = state.productionPurchases
    .filter(p => p.weekKey === selectedWeek)
    .reduce((s, p) => s + (p.totalCost || 0), 0);

  const total    = Math.max(1, Math.ceil(list.length / perPage));
  if (page > total) state.pp.page = 1;
  const start    = (state.pp.page - 1) * perPage;
  const items    = list.slice(start, start + perPage);

  const weekOpts = getAvailableWeeks()
    .map(w => `<option value="${w}" ${w === week ? 'selected' : ''}>${w}</option>`).join('');

  // ---- Toolbar ----
  const toolbar = `
    <div class="table-toolbar">
      <div class="table-search"><i class="fas fa-search"></i><input type="text" id="ppSearch" class="form-input" placeholder="Cari barang..." value="${search}" oninput="onPPSearch(this.value)"></div>
      <div class="table-filter">
        <select class="form-input" onchange="onPPWeek(this.value)" style="min-width:130px">
          <option value="">Semua Minggu</option>${weekOpts}
        </select>
      </div>
      <div class="table-filter">
        <select class="form-input" onchange="onPPStatus(this.value)">
          <option value="all" ${status === 'all' ? 'selected' : ''}>Semua Status</option>
          <option value="open" ${status === 'open' ? 'selected' : ''}>Open</option>
          <option value="closed" ${status === 'closed' ? 'selected' : ''}>Closed</option>
        </select>
      </div>
      <div style="margin-left:auto;display:flex;gap:8px;align-items:center">
        <span style="font-size:13px;color:var(--text-muted)">Total ${selectedWeek}: <strong style="color:var(--text)">${fmtRp(weeklyTotal)}</strong></span>
        <button class="btn btn-outline btn-sm" onclick="closeWeek('${selectedWeek}')"><i class="fas fa-lock"></i>Tutup Minggu</button>
        <button class="btn btn-primary btn-sm" onclick="openAddPurchaseModal()"><i class="fas fa-plus"></i>Tambah Belanja</button>
      </div>
    </div>`;

  // ---- Table rows ----
  const rows = items.length
    ? items.map(p => {
        const isClosed = p.status === 'closed';
        const statusBadgeStr = isClosed
          ? `<span class="badge badge-inactive">Closed</span>`
          : `<span class="badge badge-active">Open</span>`;
        const actions = isClosed
          ? `<span style="font-size:12px;color:var(--text-muted)">—</span>`
          : `<div class="action-btns">
               <button class="action-btn" title="Edit" onclick="editPurchase('${p.id}')"><i class="fas fa-pen"></i></button>
               <button class="action-btn del" title="Hapus" onclick="confirmDeletePurchase('${p.id}')"><i class="fas fa-trash"></i></button>
             </div>`;
        return `<tr>
          <td>${p.date}</td>
          <td><small style="color:var(--text-muted)">${p.weekKey || ''}</small></td>
          <td><strong>${p.itemName}</strong></td>
          <td>${p.category || '-'}</td>
          <td>${fmt(p.quantity)} ${p.unit || ''}</td>
          <td>${fmtRp(p.unitPrice)}</td>
          <td style="font-weight:600">${fmtRp(p.totalCost)}</td>
          <td>${statusBadgeStr}</td>
          <td style="color:var(--text-muted);font-size:12px;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${p.note || ''}">${p.note || '-'}</td>
          <td>${actions}</td>
        </tr>`;
      }).join('')
    : `<tr><td colspan="10"><div class="empty-state"><i class="fas fa-shopping-basket"></i><h4>Belum ada data belanja</h4><p>Tambahkan belanja produksi pertama</p></div></td></tr>`;

  // ---- Pagination ----
  let pag = `<button ${state.pp.page <= 1 ? 'disabled' : ''} onclick="goPPPage(${state.pp.page - 1})"><i class="fas fa-chevron-left"></i></button>`;
  for (let i = 1; i <= Math.min(total, 10); i++) {
    pag += `<button class="${i === state.pp.page ? 'active' : ''}" onclick="goPPPage(${i})">${i}</button>`;
  }
  pag += `<button ${state.pp.page >= total ? 'disabled' : ''} onclick="goPPPage(${state.pp.page + 1})"><i class="fas fa-chevron-right"></i></button>`;

  container.innerHTML = `
    <div class="card">
      ${toolbar}
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr>
            <th>Tanggal</th><th>Minggu</th><th>Nama Barang</th><th>Kategori</th>
            <th>Qty</th><th>Harga Satuan</th><th>Total</th><th>Status</th><th>Catatan</th><th>Aksi</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="table-footer">
        <span>${list.length > 0 ? `Menampilkan ${start + 1}–${Math.min(start + perPage, list.length)} dari ${list.length}` : ''}</span>
        <div class="pagination">${pag}</div>
      </div>
    </div>`;
}

// ---- Search/filter handlers ----
window.onPPSearch = function(val) {
  state.pp.search = val; state.pp.page = 1; renderBelanjaProduksi();
};
window.onPPWeek = function(val) {
  state.pp.week = val; state.pp.page = 1; renderBelanjaProduksi();
};
window.onPPStatus = function(val) {
  state.pp.status = val; state.pp.page = 1; renderBelanjaProduksi();
};
window.goPPPage = function(n) { state.pp.page = n; renderBelanjaProduksi(); };

// ---- Purchase modal helpers ----
function purchaseFormHTML(p) {
  const v = p || { date: today, weekKey: getWeekKey(today), itemName: '', category: '', quantity: 1, unit: 'pcs', unitPrice: 0, totalCost: 0, note: '' };
  return `
    <div class="form-row">
      <div class="form-group"><label>Tanggal</label><input type="date" class="form-input" id="fPPDate" value="${v.date}" oninput="updatePPWeekKey()"></div>
      <div class="form-group"><label>Kode Minggu</label><input type="text" class="form-input" id="fPPWeekKey" value="${v.weekKey}" readonly style="background:var(--primary-light)"></div>
    </div>
    <div class="form-row">
      <div class="form-group full"><label>Nama Barang</label><input type="text" class="form-input" id="fPPItemName" value="${v.itemName || ''}" placeholder="Contoh: Kain Canvas" required></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Kategori Belanja</label><input type="text" class="form-input" id="fPPCategory" value="${v.category || ''}" placeholder="Contoh: Bahan Baku"></div>
      <div class="form-group"><label>Satuan</label><input type="text" class="form-input" id="fPPUnit" value="${v.unit || 'pcs'}" placeholder="pcs / meter / kg"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Jumlah</label><input type="number" class="form-input" id="fPPQty" value="${v.quantity}" min="0.01" step="0.01" oninput="calcPPTotal()"></div>
      <div class="form-group"><label>Harga Satuan (Rp)</label><input type="number" class="form-input" id="fPPUnitPrice" value="${v.unitPrice}" min="0" oninput="calcPPTotal()"></div>
    </div>
    <div style="padding:10px 14px;background:var(--primary-light);border-radius:var(--radius-sm);font-size:13px;margin-bottom:16px">
      Total: <strong id="fPPTotalDisplay">${fmtRp(v.totalCost)}</strong>
    </div>
    <div class="form-group"><label>Catatan</label><input type="text" class="form-input" id="fPPNote" value="${v.note || ''}" placeholder="Opsional"></div>`;
}

window.updatePPWeekKey = function() {
  const dateEl = $('#fPPDate'), wkEl = $('#fPPWeekKey');
  if (dateEl && wkEl) wkEl.value = getWeekKey(dateEl.value);
};
window.calcPPTotal = function() {
  const qty = parseFloat($('#fPPQty').value) || 0;
  const up  = parsePrice($('#fPPUnitPrice').value);
  const total = Math.round(qty * up);
  const el = $('#fPPTotalDisplay');
  if (el) el.textContent = fmtRp(total);
};

// ---- Open Add Modal ----
window.openAddPurchaseModal = function() {
  openModal('Tambah Belanja Produksi', purchaseFormHTML(), `
    <button class="btn btn-outline btn-sm" onclick="closeModal()">Batal</button>
    <button class="btn btn-primary btn-sm" onclick="savePurchase()"><i class="fas fa-check"></i>Simpan</button>`);
};

// ---- Save new purchase ----
window.savePurchase = async function() {
  const itemName = ($('#fPPItemName') ? $('#fPPItemName').value : '').trim();
  if (!itemName) { toast('Nama barang wajib diisi', 'warning'); return; }
  const qty  = parseFloat($('#fPPQty').value) || 0;
  const up   = parsePrice($('#fPPUnitPrice').value);
  const date = $('#fPPDate').value || today;
  const doc  = sanitize({
    date: date,
    weekKey:   $('#fPPWeekKey').value || getWeekKey(date),
    itemName:  itemName,
    category:  ($('#fPPCategory') ? $('#fPPCategory').value.trim() : ''),
    quantity:  qty,
    unit:      ($('#fPPUnit') ? $('#fPPUnit').value.trim() : 'pcs'),
    unitPrice: up,
    totalCost: Math.round(qty * up),
    note:      ($('#fPPNote') ? $('#fPPNote').value.trim() : ''),
    status:    'open',
    closedAt:  null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });
  try {
    await db.collection('production_purchases').add(doc);
    toast('Belanja dicatat', 'success');
    closeModal();
  } catch (err) { toast('Gagal: ' + err.message, 'error'); }
};

// ---- Edit purchase ----
window.editPurchase = function(id) {
  const p = state.productionPurchases.find(x => x.id === id);
  if (!p) { toast('Data tidak ditemukan', 'error'); return; }
  if (p.status === 'closed') { toast('Belanja yang sudah ditutup tidak bisa diedit', 'warning'); return; }
  openModal('Edit Belanja Produksi', purchaseFormHTML(p), `
    <button class="btn btn-outline btn-sm" onclick="closeModal()">Batal</button>
    <button class="btn btn-primary btn-sm" onclick="saveEditPurchase('${id}')"><i class="fas fa-check"></i>Update</button>`);
};

window.saveEditPurchase = async function(id) {
  const p = state.productionPurchases.find(x => x.id === id);
  if (!p || p.status === 'closed') { toast('Tidak bisa mengedit pembelian yang sudah ditutup', 'warning'); return; }
  const itemName = ($('#fPPItemName') ? $('#fPPItemName').value : '').trim();
  if (!itemName) { toast('Nama barang wajib diisi', 'warning'); return; }
  const qty  = parseFloat($('#fPPQty').value) || 0;
  const up   = parsePrice($('#fPPUnitPrice').value);
  const date = $('#fPPDate').value || today;
  const updates = sanitize({
    date: date,
    weekKey:   $('#fPPWeekKey').value || getWeekKey(date),
    itemName:  itemName,
    category:  ($('#fPPCategory') ? $('#fPPCategory').value.trim() : ''),
    quantity:  qty,
    unit:      ($('#fPPUnit') ? $('#fPPUnit').value.trim() : 'pcs'),
    unitPrice: up,
    totalCost: Math.round(qty * up),
    note:      ($('#fPPNote') ? $('#fPPNote').value.trim() : ''),
    updatedAt: new Date().toISOString()
  });
  try {
    await db.collection('production_purchases').doc(id).update(updates);
    toast('Belanja diupdate', 'success');
    closeModal();
  } catch (err) { toast('Gagal: ' + err.message, 'error'); }
};

// ---- Delete purchase ----
window.confirmDeletePurchase = function(id) {
  const p = state.productionPurchases.find(x => x.id === id);
  if (!p) return;
  if (p.status === 'closed') { toast('Belanja yang sudah ditutup tidak bisa dihapus', 'warning'); return; }
  openModal('Konfirmasi Hapus',
    `<div style="text-align:center;padding:10px 0">
       <i class="fas fa-trash" style="font-size:40px;color:var(--danger);opacity:.6;margin-bottom:14px;display:block"></i>
       <p style="font-size:15px;font-weight:600">Hapus "${p.itemName}"?</p>
       <p style="font-size:13px;color:var(--text-muted);margin-top:6px">Total: ${fmtRp(p.totalCost)}</p>
     </div>`,
    `<button class="btn btn-outline btn-sm" onclick="closeModal()">Batal</button>
     <button class="btn btn-danger btn-sm" onclick="doDeletePurchase('${id}')"><i class="fas fa-trash"></i>Hapus</button>`);
};

window.doDeletePurchase = async function(id) {
  try {
    await db.collection('production_purchases').doc(id).delete();
    toast('Belanja dihapus', 'success');
    closeModal();
  } catch (err) { toast('Gagal: ' + err.message, 'error'); }
};

// ---- Close week ----
window.closeWeek = function(weekKey) {
  if (!weekKey) { toast('Pilih minggu yang ingin ditutup', 'warning'); return; }
  const openItems = state.productionPurchases.filter(p => p.weekKey === weekKey && p.status === 'open');
  if (!openItems.length) { toast('Tidak ada pembelian open di minggu ' + weekKey, 'warning'); return; }
  const weekTotal = state.productionPurchases
    .filter(p => p.weekKey === weekKey).reduce((s, p) => s + (p.totalCost || 0), 0);
  openModal('Tutup Minggu ' + weekKey,
    `<div style="text-align:center;padding:10px 0">
       <i class="fas fa-lock" style="font-size:40px;color:var(--warning);opacity:.7;margin-bottom:14px;display:block"></i>
       <p style="font-size:15px;font-weight:600">Tutup minggu ${weekKey}?</p>
       <p style="font-size:13px;color:var(--text-muted);margin-top:8px">${openItems.length} pembelian akan ditandai <strong>closed</strong></p>
       <p style="font-size:14px;font-weight:700;margin-top:10px">Total minggu: ${fmtRp(weekTotal)}</p>
     </div>`,
    `<button class="btn btn-outline btn-sm" onclick="closeModal()">Batal</button>
     <button class="btn btn-accent btn-sm" onclick="doCloseWeek('${weekKey}')"><i class="fas fa-lock"></i>Tutup Minggu</button>`);
};

window.doCloseWeek = async function(weekKey) {
  const openItems = state.productionPurchases.filter(p => p.weekKey === weekKey && p.status === 'open');
  if (!openItems.length) { toast('Tidak ada item open', 'warning'); closeModal(); return; }
  try {
    const batch = db.batch();
    const now = new Date().toISOString();
    openItems.forEach(p => {
      batch.update(db.collection('production_purchases').doc(p.id), {
        status: 'closed', closedAt: now, updatedAt: now
      });
    });
    await batch.commit();
    toast('Minggu ' + weekKey + ' berhasil ditutup (' + openItems.length + ' item)', 'success');
    closeModal();
  } catch (err) { toast('Gagal: ' + err.message, 'error'); }
};

/* =========================================================
   LAPORAN
   ========================================================= */
function renderReports() {
  const type = $('#reportType').value;
  const totalRev = state.sales.reduce((s, x) => s + (x.revenue || 0), 0);
  const totalCost = state.sales.reduce((s, x) => s + (x.costPrice || 0) * (x.quantity || 0), 0);
  const totalProfit = totalRev - totalCost;
  const marginPct = totalRev > 0 ? Math.round(totalProfit / totalRev * 100) : 0;

  const getTopChannel = () => { const ch = {}; state.sales.forEach(s => { ch[s.channel] = (ch[s.channel] || 0) + 1 }); const e = Object.entries(ch).sort((a, b) => b[1] - a[1]); return e.length ? e[0][0] : '-' };
  const getBestSeller = () => { const ps = {}; state.sales.forEach(s => { ps[s.productId] = (ps[s.productId] || 0) + (s.revenue || 0) }); const e = Object.entries(ps).sort((a, b) => b[1] - a[1]); return e.length ? (state.products.find(p => p.id === e[0][0]) || {}).name || '-' : '-' };
  const getTopCategory = () => { const cs = {}; state.sales.forEach(s => { const p = state.products.find(x => x.id === s.productId); if (p) { const cn = getCatName(p.categoryId); cs[cn] = (cs[cn] || 0) + (s.revenue || 0) } }); const e = Object.entries(cs).sort((a, b) => b[1] - a[1]); return e.length ? e[0][0] : '-' };

  const statsMap = {
    sales: [
      { label: 'Total Transaksi', value: state.sales.length, cls: 'gold' },
      { label: 'Total Pendapatan', value: fmtRp(totalRev), cls: 'green' },
      { label: 'Rata-rata/Transaksi', value: fmtRp(state.sales.length > 0 ? Math.round(totalRev / state.sales.length) : 0), cls: 'maroon' },
      { label: 'Channel Terbanyak', value: getTopChannel(), cls: 'gold' }
    ],
    profit: [
      { label: 'Total Pendapatan', value: fmtRp(totalRev), cls: 'gold' },
      { label: 'Total Biaya', value: fmtRp(totalCost), cls: 'maroon' },
      { label: 'Laba Kotor', value: fmtRp(totalProfit), cls: 'green' },
      { label: 'Margin Laba', value: marginPct + '%', cls: marginPct >= 30 ? 'green' : marginPct >= 15 ? 'gold' : 'red' }
    ],
    production: [
      { label: 'Total Order', value: state.production.length, cls: 'gold' },
      { label: 'Total Target', value: state.production.reduce((s, p) => s + (p.targetQty || 0), 0), cls: 'maroon' },
      { label: 'Total Selesai', value: state.production.reduce((s, p) => s + (p.completedQty || 0), 0), cls: 'green' },
      { label: 'Completion', value: (state.production.reduce((s, p) => s + (p.targetQty || 0), 0) > 0 ? Math.round(state.production.reduce((s, p) => s + (p.completedQty || 0), 0) / state.production.reduce((s, p) => s + (p.targetQty || 0), 0) * 100) : 0) + '%', cls: 'gold' }
    ],
    inventory: [
      { label: 'Total Produk', value: state.products.length, cls: 'gold' },
      { label: 'Total Stok', value: state.products.reduce((s, p) => s + (p.stock || 0), 0), cls: 'green' },
      { label: 'Stok Rendah', value: state.products.filter(p => p.status === 'low_stock').length, cls: 'maroon' },
      { label: 'Stok Habis', value: state.products.filter(p => p.status === 'out_of_stock').length, cls: 'red' }
    ],
    bestseller: [
      { label: 'Total Terjual', value: state.sales.reduce((s, x) => s + (x.quantity || 0), 0) + ' unit', cls: 'gold' },
      { label: 'Produk Terlaris', value: getBestSeller(), cls: 'green' },
      { label: 'Kategori Terlaris', value: getTopCategory(), cls: 'maroon' },
      { label: 'Total Pendapatan', value: fmtRp(totalRev), cls: 'gold' }
    ]
  };

  $('#reportStats').innerHTML = (statsMap[type] || statsMap.sales).map(s =>
    `<div class="stat-card ${s.cls}"><div class="sc-label">${s.label}</div><div class="sc-value" style="font-size:17px;margin-top:8px;word-break:break-word">${s.value}</div></div>`
  ).join('');

  renderReportChart(type);
  renderReportDetail(type);
}

function renderReportChart(type) {
  if (state.charts.report) state.charts.report.destroy();
  const ctx = $('#chartReport').getContext('2d');
  let config;

  if (type === 'sales' || type === 'bestseller') {
    const ps = {}; state.sales.forEach(s => { ps[s.productName] = (ps[s.productName] || 0) + (s.revenue || 0) });
    const sorted = Object.entries(ps).sort((a, b) => b[1] - a[1]).slice(0, 8);
    config = { type: 'bar', data: { labels: sorted.map(x => x[0].length > 18 ? x[0].substring(0, 18) + '...' : x[0]), datasets: [{ label: 'Pendapatan', data: sorted.map(x => x[1]), backgroundColor: 'rgba(244,196,48,.75)', borderRadius: 5, barPercentage: .6 }] }, options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => fmtRp(c.raw) } } }, scales: { x: { grid: chartGrid, ticks: { font: chartFont, callback: v => (v / 1000000).toFixed(1) + 'jt' } }, y: { grid: { display: false }, ticks: { font: { size: 10 } } } } } };
  } else if (type === 'profit') {
    const groupedRev = groupByPeriod(state.sales, 'monthly', 'revenue');
    const groupedCost = groupByPeriod(state.sales, 'monthly', 'costPrice', true);
    const dataRev = formatChartPeriodData(groupedRev, 'monthly', 6);
    const dataCost = formatChartPeriodData(groupedCost, 'monthly', 6);
    const profitValues = dataRev.values.map((rev, i) => rev - (dataCost.values[i] || 0));

    config = {
      type: 'bar',
      data: {
        labels: dataRev.labels,
        datasets: [
          { label: 'Pendapatan', data: dataRev.values, backgroundColor: 'rgba(244,196,48,.75)', borderRadius: 5, barPercentage: .55 },
          { label: 'Biaya', data: dataCost.values, backgroundColor: 'rgba(122,31,31,.55)', borderRadius: 5, barPercentage: .55 },
          { label: 'Laba', data: profitValues, backgroundColor: 'rgba(22,163,74,.55)', borderRadius: 5, barPercentage: .55 }
        ]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'top', labels: { font: { size: 11 }, usePointStyle: true, pointStyle: 'circle' } } }, scales: { x: { grid: { display: false }, ticks: { font: chartFont } }, y: { grid: chartGrid, ticks: { font: chartFont, callback: v => (v / 1000000).toFixed(0) + 'jt' } } } }
    };
  } else if (type === 'production') {
    const ps = {}; state.production.forEach(p => { ps[p.productName] = (ps[p.productName] || 0) + (p.completedQty || 0) });
    const sorted = Object.entries(ps).sort((a, b) => b[1] - a[1]).slice(0, 8);
    config = { type: 'bar', data: { labels: sorted.map(x => x[0].length > 18 ? x[0].substring(0, 18) + '...' : x[0]), datasets: [{ label: 'Unit Selesai', data: sorted.map(x => x[1]), backgroundColor: 'rgba(22,163,74,.65)', borderRadius: 5, barPercentage: .6 }] }, options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: chartGrid }, y: { grid: { display: false }, ticks: { font: { size: 10 } } } } } };
  } else {
    const data = state.categories.map(c => ({ name: c.name, count: state.products.filter(p => p.categoryId === c.id).reduce((s, p) => s + (p.stock || 0), 0) }));
    const colors = ['#F4C430', '#D4A017', '#7A1F1F', '#16A34A', '#0EA5E9', '#D97706', '#DC2626', '#6B7280'];
    config = { type: 'doughnut', data: { labels: data.map(d => d.name), datasets: [{ data: data.map(d => d.count), backgroundColor: colors, borderWidth: 0, hoverOffset: 6 }] }, options: { responsive: true, maintainAspectRatio: false, cutout: '55%', plugins: { legend: { position: 'bottom', labels: { font: { size: 11 }, usePointStyle: true, pointStyle: 'circle', padding: 12 } } } } };
  }
  state.charts.report = new Chart(ctx, config);
}

function renderReportDetail(type) {
  if (type === 'sales' || type === 'bestseller') {
    const ps = {}; state.sales.forEach(s => { if (!ps[s.productId]) ps[s.productId] = { name: s.productName, productId: s.productId, qty: 0, rev: 0 }; ps[s.productId].qty += (s.quantity || 0); ps[s.productId].rev += (s.revenue || 0) });
    const sorted = Object.values(ps).sort((a, b) => b.rev - a.rev).slice(0, 10);
    const totalRev = sorted.reduce((s, x) => s + x.rev, 0);
    $('#reportDetail').innerHTML = sorted.map((p, i) => {
      const prod = state.products.find(x => x.id === p.productId);
      return `<div class="rank-item">${prodImg(prod, 32)}<div class="rank-num ${i === 0 ? 'g' : i === 1 ? 's' : i === 2 ? 'b' : 'n'}">${i + 1}</div><div class="rank-info"><div class="name">${p.name}</div><div class="sub">${p.qty} unit</div><div class="progress-bar" style="width:110px"><div class="fill fill-gold" style="width:${pct(p.rev, totalRev)}%"></div></div></div><div class="rank-val">${fmtRp(p.rev)}<small>${pct(p.rev, totalRev)}%</small></div></div>`;
    }).join('') || '<div class="empty-state"><i class="fas fa-chart-bar"></i><h4>Belum ada data</h4></div>';
  } else if (type === 'profit') {
    const ps = {}; state.sales.forEach(s => { if (!ps[s.productId]) ps[s.productId] = { name: s.productName, productId: s.productId, rev: 0, cost: 0, profit: 0 }; ps[s.productId].rev += (s.revenue || 0); ps[s.productId].cost += (s.costPrice || 0) * (s.quantity || 0); ps[s.productId].profit += (s.profit || 0) });
    const sorted = Object.values(ps).sort((a, b) => b.profit - a.profit).slice(0, 10);
    $('#reportDetail').innerHTML = sorted.map(p => {
      const prod = state.products.find(x => x.id === p.productId);
      return `<div class="rank-item">${prodImg(prod, 32)}<div class="rank-num n"><i class="fas fa-chart-pie" style="font-size:11px"></i></div><div class="rank-info"><div class="name">${p.name}</div><div class="sub">Rev: ${fmtRp(p.rev)} | Cost: ${fmtRp(p.cost)}</div></div><div class="rank-val" style="color:var(--success)">${fmtRp(p.profit)}<small>Laba</small></div></div>`;
    }).join('') || '<div class="empty-state"><i class="fas fa-chart-pie"></i><h4>Belum ada data</h4></div>';
  } else if (type === 'production') {
    const sorted = [...state.production].sort((a, b) => ((b.completedQty || 0) / (b.targetQty || 1)) - ((a.completedQty || 0) / (a.targetQty || 1)));
    $('#reportDetail').innerHTML = sorted.map(p => {
      const pctDone = p.targetQty > 0 ? Math.round((p.completedQty || 0) / p.targetQty * 100) : 0;
      const prod = state.products.find(x => x.id === p.productId);
      return `<div class="rank-item">${prodImg(prod, 32)}<div class="rank-num n"><i class="fas fa-industry" style="font-size:11px"></i></div><div class="rank-info"><div class="name">${p.productName}</div><div class="sub">${p.sku} — ${prodStatusBadge(p.status)}</div><div class="progress-bar" style="width:110px"><div class="fill ${pctDone >= 100 ? 'fill-green' : 'fill-gold'}" style="width:${pctDone}%"></div></div></div><div class="rank-val">${p.completedQty || 0}/${p.targetQty}<small>${pctDone}%</small></div></div>`;
    }).join('') || '<div class="empty-state"><i class="fas fa-industry"></i><h4>Belum ada data</h4></div>';
  } else {
    const sorted = [...state.products].sort((a, b) => (b.stock || 0) - (a.stock || 0));
    $('#reportDetail').innerHTML = sorted.map(p => `<div class="rank-item">${prodImg(p, 32)}<div class="rank-num ${p.stock > 20 ? 'g' : p.stock > 5 ? 's' : p.stock > 0 ? 'b' : 'n'}">${p.stock}</div><div class="rank-info"><div class="name">${p.name}</div><div class="sub">${p.sku} — ${getCatName(p.categoryId)}</div></div><div class="rank-val">${statusBadge(p.status)}</div></div>`).join('') || '<div class="empty-state"><i class="fas fa-boxes-stacked"></i><h4>Belum ada data</h4></div>';
  }
}

 $('#reportType').addEventListener('change', renderReports);
 $('#reportPeriod').addEventListener('change', renderReports);

 $('#exportCsvBtn').addEventListener('click', () => {
  const type = $('#reportType').value;
  let csv = '\uFEFF';
  if (type === 'sales') {
    csv += 'No Transaksi,Tanggal,Produk,SKU,Qty,Channel,Pendapatan,Keuntungan\n';
    state.sales.forEach(s => { csv += `"${s.txNumber}","${s.date}","${s.productName}","${s.sku}",${s.quantity},"${s.channel}",${s.revenue},${s.profit}\n` });
  } else if (type === 'profit') {
    csv += 'Produk,Pendapatan,Biaya,Laba,Margin\n';
    const ps = {}; state.sales.forEach(s => { if (!ps[s.productId]) ps[s.productId] = { name: s.productName, rev: 0, cost: 0, profit: 0 }; ps[s.productId].rev += (s.revenue || 0); ps[s.productId].cost += (s.costPrice || 0) * (s.quantity || 0); ps[s.productId].profit += (s.profit || 0) });
    Object.values(ps).forEach(p => { csv += `"${p.name}",${p.rev},${p.cost},${p.profit},${p.rev > 0 ? Math.round(p.profit / p.rev * 100) : 0}%\n` });
  } else if (type === 'production') {
    csv += 'Produk,SKU,Target,Selesai,Status,Tanggal\n';
    state.production.forEach(p => { csv += `"${p.productName}","${p.sku}",${p.targetQty},${p.completedQty || 0},"${p.status}","${p.date}"\n` });
  } else if (type === 'inventory') {
    csv += 'SKU,Produk,Stok,Status,Gambar\n';
    state.products.forEach(p => { csv += `"${p.sku}","${p.name}",${p.stock},"${p.status}","${(p.images && p.images[0]) ? p.images[0].imageUrl : ''}"\n` });
  } else {
    csv += 'Produk,SKU,Total Terjual,Pendapatan\n';
    const ps = {}; state.sales.forEach(s => { if (!ps[s.productId]) ps[s.productId] = { name: s.productName, sku: s.sku, qty: 0, rev: 0 }; ps[s.productId].qty += (s.quantity || 0); ps[s.productId].rev += (s.revenue || 0) });
    Object.values(ps).sort((a, b) => b.rev - a.rev).forEach(p => { csv += `"${p.name}","${p.sku}",${p.qty},${p.rev}\n` });
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
  a.download = `laporan_${type}_${today}.csv`;
  a.click();
  toast('Laporan di-export ke CSV', 'success');
});

/* =========================================================
   PENGGUNA
   ========================================================= */
function renderUsers() {
  const roleBadge = r => {
    const m = { Owner: 'badge-website', Admin: 'badge-in_production', Warehouse: 'badge-in_progress', 'Production Team': 'badge-qc' };
    return `<span class="badge ${m[r] || 'badge-offline_store'}">${r}</span>`;
  };
  $('#userBody').innerHTML = state.users.map(u => `<tr><td><div style="display:flex;align-items:center;gap:10px"><div class="avatar" style="width:32px;height:32px;border-radius:8px;font-size:13px">${u.name.charAt(0)}</div><strong>${u.name}</strong></div></td><td style="color:var(--text-muted)">${u.email}</td><td>${roleBadge(u.role)}</td><td><span class="badge ${u.status === 'Aktif' ? 'badge-active' : 'badge-inactive'}">${u.status}</span></td></tr>`).join('');
}

/* =========================================================
   PENGATURAN
   ========================================================= */
document.addEventListener('click', e => {
  if (e.target.classList.contains('toggle')) {
    e.target.classList.toggle('active');
    toast(`Pengaturan "${e.target.dataset.setting}" ${e.target.classList.contains('active') ? 'diaktifkan' : 'dinonaktifkan'}`, 'success');
  }
});

 $('#saveProfileBtn').addEventListener('click', () => {
  const name = $('#settingNameInput').value.trim();
  if (!name) { toast('Nama tidak boleh kosong', 'warning'); return; }
  state.user.name = name;
  $('#userName').textContent = name;
  $('#settingsName').textContent = name;
  $('#userAvatar').textContent = name.charAt(0).toUpperCase();
  $('#settingsAvatar').textContent = name.charAt(0).toUpperCase();
  toast('Profil disimpan', 'success');
});

/* =========================================================
   NOTIFIKASI
   ========================================================= */
 $('#notifBtn').addEventListener('click', () => {
  const outP = state.products.filter(p => p.status === 'out_of_stock');
  const lowP = state.products.filter(p => p.status === 'low_stock');
  const doneProd = state.production.filter(p => p.date === today && p.status === 'completed');
  let html = '<div style="max-height:400px;overflow-y:auto">';

  if (!outP.length && !lowP.length && !doneProd.length) {
    html += '<div class="empty-state" style="padding:30px 10px"><i class="fas fa-bell-slash"></i><h4>Tidak ada notifikasi</h4><p>Semua dalam kondisi aman</p></div>';
  } else {
    if (outP.length) {
      html += `<div style="margin-bottom:14px"><p style="font-size:11px;font-weight:700;color:var(--danger);margin-bottom:8px;text-transform:uppercase;letter-spacing:.5px"><i class="fas fa-circle-exclamation"></i> Stok Habis (${outP.length})</p>`;
      outP.forEach(p => { html += `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid rgba(244,196,48,.05);font-size:13px">${prodImg(p, 28)}<span class="badge badge-out_of_stock">0 unit</span><span style="flex:1">${p.name}</span><span style="color:var(--text-muted);font-size:12px">${p.sku}</span></div>` });
      html += '</div>';
    }
    if (lowP.length) {
      html += `<div style="margin-bottom:14px"><p style="font-size:11px;font-weight:700;color:var(--warning);margin-bottom:8px;text-transform:uppercase;letter-spacing:.5px"><i class="fas fa-triangle-exclamation"></i> Stok Rendah (${lowP.length})</p>`;
      lowP.forEach(p => { html += `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid rgba(244,196,48,.05);font-size:13px">${prodImg(p, 28)}<span class="badge badge-low_stock">${p.stock} unit</span><span style="flex:1">${p.name}</span><span style="color:var(--text-muted);font-size:12px">${p.sku}</span></div>` });
      html += '</div>';
    }
    if (doneProd.length) {
      html += `<div><p style="font-size:11px;font-weight:700;color:var(--success);margin-bottom:8px;text-transform:uppercase;letter-spacing:.5px"><i class="fas fa-circle-check"></i> Produksi Selesai (${doneProd.length})</p>`;
      doneProd.forEach(p => { html += `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid rgba(244,196,48,.05);font-size:13px"><span class="badge badge-completed">${p.completedQty || 0}/${p.targetQty}</span><span style="flex:1">${p.productName}</span><span style="color:var(--text-muted);font-size:12px">${p.sku}</span></div>` });
      html += '</div>';
    }
  }
  html += '</div>';
  openModal('Notifikasi', html, '<button class="btn btn-primary btn-sm" onclick="closeModal()">Tutup</button>');
});

/* =========================================================
   INISIALISASI APLIKASI
   ========================================================= */
(function initApp() {
  if (auth.currentUser) {
    db.collection('users').doc(auth.currentUser.uid).get().then(doc => {
      if (doc.exists) {
        state.user = { ...doc.data(), email: auth.currentUser.email };
      } else {
        state.user = {
          name: auth.currentUser.displayName || auth.currentUser.email.split('@')[0],
          email: auth.currentUser.email,
          role: 'User'
        };
      }
      enterApp();
    }).catch(() => {
      state.user = {
        name: auth.currentUser.displayName || auth.currentUser.email.split('@')[0],
        email: auth.currentUser.email,
        role: 'User'
      };
      enterApp();
    });
    return;
  }
})();

auth.onAuthStateChanged(user => {
  if (!user) {
    if (appInitialized) {
      state.listeners.forEach(unsub => { try { unsub(); } catch(e) {} });
      state.listeners = [];
      appInitialized = false;
    }
    return;
  }

  if (appInitialized) return;

  db.collection('users').doc(user.uid).get().then(doc => {
    if (doc.exists) {
      state.user = { ...doc.data(), email: user.email };
    } else {
      state.user = {
        name: user.displayName || user.email.split('@')[0],
        email: user.email,
        role: 'User'
      };
    }
    enterApp();
  }).catch(() => {
    state.user = {
      name: user.displayName || user.email.split('@')[0],
      email: user.email,
      role: 'User'
    };
    enterApp();
  });
});