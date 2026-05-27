/* ═══════════════════════════════════════════
   LUMIÈRE — app.js
   Base de datos: localStorage (sin servidor)
   Compatible con GitHub Pages
═══════════════════════════════════════════ */

// ─── STORAGE HELPERS ───────────────────────
const DB = {
  get: (k) => { try { return JSON.parse(localStorage.getItem('lum_' + k)) || []; } catch { return []; } },
  getObj: (k, def = {}) => { try { return JSON.parse(localStorage.getItem('lum_' + k)) || def; } catch { return def; } },
  set: (k, v) => localStorage.setItem('lum_' + k, JSON.stringify(v)),
  remove: (k) => localStorage.removeItem('lum_' + k),
};

// ─── STATE ─────────────────────────────────
let currentUser = null;
let editingProductId = null;
let editingClientId = null;
let productImageB64 = null;
let saleCart = [];

let _logFilter = '';

let salesChartInst = null;
let topProductsChartInst = null;
let monthlyChartInst = null;
let categoryChartInst = null;

const NAV_PAGES = [
  { id: 'dashboard', icon: '◈', label: 'Dashboard' },
  { id: 'products',  icon: '◉', label: 'Productos' },
  { id: 'clients',   icon: '◎', label: 'Clientes' },
  { id: 'sales',     icon: '◌', label: 'Ventas' },
  { id: 'reports',   icon: '◍', label: 'Reportes' },
  { id: 'settings',  icon: '⊙', label: 'Configuración' },
  { id: 'registro',  icon: '◷', label: 'Registro' },
];

// ─── ACTIVITY LOG ───────────────────────────
function logAction(type, action, description) {
  const log = DB.get('activityLog');
  log.push({ id: uid(), type, action, description, date: todayStr(), timestamp: now() });
  if (log.length > 500) log.splice(0, log.length - 500);
  DB.set('activityLog', log);
}

function renderActivityLog() {
  const log = DB.get('activityLog').slice().reverse();
  const filtered = _logFilter ? log.filter(e => e.type === _logFilter) : log;
  const listEl = document.getElementById('activityLogList');
  if (!listEl) return;
  if (!filtered.length) {
    listEl.innerHTML = `<div class="empty-state"><span class="empty-icon">◷</span><p>Sin actividad registrada aún.</p></div>`;
    return;
  }
  listEl.innerHTML = filtered.slice(0, 150).map(e => `
    <div class="log-entry">
      <span class="log-type-badge log-type-${e.type}">${e.type}</span>
      <div class="log-entry-body">
        <p class="log-action">${e.action}</p>
        <p class="log-desc">${e.description || ''}</p>
      </div>
      <span class="log-date">${e.date}</span>
    </div>`).join('');
}

function filterActivityLog(type) {
  _logFilter = type;
  document.querySelectorAll('.log-tab').forEach(t => t.classList.toggle('active', (t.dataset.type || '') === type));
  renderActivityLog();
}

// ─── SALE ITEMS HELPER (backward compat) ────
function getSaleItems(sale) {
  if (sale.items && sale.items.length) return sale.items;
  return [{
    productId: sale.productId,
    productName: sale.productName || '—',
    qty: sale.qty || 1,
    unitPrice: sale.unitPrice || 0,
    total: sale.total || 0,
    profit: sale.profit || 0,
  }];
}

// ─── INIT ───────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  applySettings();
  checkAutoLogin();
  buildNavEditor();
});

// ─── SETTINGS ──────────────────────────────
function applySettings() {
  const cfg = DB.getObj('config', {});
  const palette = cfg.palette || 'black';
  document.documentElement.setAttribute('data-palette', palette);
  document.documentElement.setAttribute('data-font', cfg.fontFamily || 'moderno');
  document.documentElement.setAttribute('data-fontsize', cfg.fontSize || 'medium');
  if (cfg.accent) applyAccentVars(cfg.accent, cfg.accentDark);
}

function getConfig() { return DB.getObj('config', { palette: 'black', fontFamily: 'moderno', fontSize: 'medium', storeName: 'LUMIÈRE', currency: '$', lowStock: 5 }); }

function saveSettings() {
  const cfg = getConfig();
  cfg.storeName = document.getElementById('settingStoreName').value || cfg.storeName;
  cfg.currency = document.getElementById('settingCurrency').value;
  cfg.lowStock = parseInt(document.getElementById('settingLowStock').value) || 5;
  DB.set('config', cfg);
  document.getElementById('sidebarBrand').textContent = cfg.storeName;
  showToast('Configuración guardada ✓');
}

function setPalette(name) {
  document.documentElement.setAttribute('data-palette', name);
  const cfg = getConfig();
  cfg.palette = name;
  // clear custom accent when switching palette
  delete cfg.accent;
  delete cfg.accentDark;
  DB.set('config', cfg);
  document.querySelectorAll('.palette-card').forEach(c => {
    c.classList.toggle('active', c.dataset.pal === name);
  });
}

function setFontFamily(font) {
  document.documentElement.setAttribute('data-font', font);
  const cfg = getConfig();
  cfg.fontFamily = font;
  DB.set('config', cfg);
}

function setFontSize(size) {
  document.documentElement.setAttribute('data-fontsize', size);
  const cfg = getConfig();
  cfg.fontSize = size;
  DB.set('config', cfg);
  document.querySelectorAll('.fontsize-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.size === size);
  });
}

// Legacy compat — kept in case called from old saved config
function toggleTheme() { setPalette(getConfig().palette === 'black' ? 'white' : 'black'); }
function setAccent(color, dark) {
  applyAccentVars(color, dark);
  const cfg = getConfig();
  cfg.accent = color; cfg.accentDark = dark;
  DB.set('config', cfg);
}

function applyAccentVars(color, dark) {
  document.documentElement.style.setProperty('--accent', color);
  document.documentElement.style.setProperty('--accent-dark', dark || color);
}

function getCurrency() { return getConfig().currency || '$'; }
function getLowStockThreshold() { return getConfig().lowStock || 5; }

// ─── AUTH ───────────────────────────────────
function checkAutoLogin() {
  const saved = localStorage.getItem('lum_session');
  if (saved) {
    try {
      const s = JSON.parse(saved);
      const users = DB.get('users');
      const u = users.find(u => u.username === s.username && u.password === s.password);
      if (u) { loginSuccess(u); return; }
    } catch {}
  }
  showLoginScreen();
}

function showLoginScreen() {
  document.getElementById('loginScreen').classList.remove('hidden');
  document.getElementById('appMain').classList.add('hidden');
}

function loginSuccess(user) {
  currentUser = user;
  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('appMain').classList.remove('hidden');
  document.getElementById('topbarUser').textContent = user.username;
  const cfg = getConfig();
  document.getElementById('sidebarBrand').textContent = user.storeName || cfg.storeName || 'LUMIÈRE';
  navigateTo('dashboard');
  loadSettingsPage();
  refreshNavLabels();
}

function handleLogin() {
  const u = document.getElementById('loginUser').value.trim();
  const p = document.getElementById('loginPass').value;
  const err = document.getElementById('loginError');
  if (!u || !p) { err.textContent = 'Completa todos los campos.'; return; }

  const users = DB.get('users');
  const user = users.find(x => x.username === u && x.password === p);
  if (!user) { err.textContent = 'Usuario o contraseña incorrectos.'; return; }

  if (document.getElementById('rememberMe').checked) {
    localStorage.setItem('lum_session', JSON.stringify({ username: u, password: p }));
  }
  err.textContent = '';
  loginSuccess(user);
}

function handleRegister() {
  const u = document.getElementById('regUser').value.trim();
  const p = document.getElementById('regPass').value;
  const s = document.getElementById('regStore').value.trim();
  const err = document.getElementById('registerError');

  if (!u || !p || !s) { err.textContent = 'Completa todos los campos.'; return; }
  if (p.length < 4) { err.textContent = 'La contraseña debe tener al menos 4 caracteres.'; return; }

  const users = DB.get('users');
  if (users.find(x => x.username === u)) { err.textContent = 'Ese usuario ya existe.'; return; }

  const newUser = { id: uid(), username: u, password: p, storeName: s };
  users.push(newUser);
  DB.set('users', users);

  const cfg = getConfig();
  cfg.storeName = s;
  DB.set('config', cfg);

  err.textContent = '';
  showToast('Cuenta creada. Inicia sesión ✓');
  toggleAuthMode('login');
}

function logout() {
  localStorage.removeItem('lum_session');
  currentUser = null;
  destroyCharts();
  showLoginScreen();
}

function toggleAuthMode(mode) {
  document.getElementById('loginForm').classList.toggle('hidden', mode !== 'login');
  document.getElementById('registerForm').classList.toggle('hidden', mode !== 'register');
}

// ─── NAVIGATION ─────────────────────────────
function navigateTo(pageId) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  const page = document.getElementById('page-' + pageId);
  if (page) page.classList.add('active');
  const navBtn = document.querySelector(`[data-page="${pageId}"]`);
  if (navBtn) navBtn.classList.add('active');

  // Page titles
  const labels = getUserNavLabels();
  const found = labels.find(l => l.id === pageId);
  document.getElementById('topbarTitle').textContent = found ? found.label : pageId;

  // Close sidebar on mobile
  if (window.innerWidth <= 700) closeSidebar();

  // Page-specific init
  if (pageId === 'dashboard') renderDashboard();
  if (pageId === 'products') renderProducts();
  if (pageId === 'clients') renderClients();
  if (pageId === 'sales') initSalesPage();
  if (pageId === 'reports') renderReports();
  if (pageId === 'settings') loadSettingsPage();
  if (pageId === 'registro') renderActivityLog();
}

function toggleSidebar() {
  const sb = document.getElementById('sidebar');
  if (sb.classList.contains('open')) {
    closeSidebar();
  } else {
    sb.classList.add('open');
    // overlay
    const ov = document.createElement('div');
    ov.className = 'sidebar-overlay';
    ov.id = 'sidebarOverlay';
    ov.onclick = closeSidebar;
    document.body.appendChild(ov);
  }
}

function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  const ov = document.getElementById('sidebarOverlay');
  if (ov) ov.remove();
}

// ─── NAV LABELS (editable) ──────────────────
function getUserNavLabels() {
  const saved = DB.get('navLabels');
  if (saved && saved.length) return saved;
  return NAV_PAGES.map(p => ({ id: p.id, label: p.label, icon: p.icon }));
}

function buildNavEditor() {
  const container = document.getElementById('navEditor');
  if (!container) return;
  const labels = getUserNavLabels();
  container.innerHTML = '';
  labels.forEach(item => {
    const row = document.createElement('div');
    row.className = 'nav-edit-row';
    row.innerHTML = `
      <span class="nav-icon-preview">${item.icon}</span>
      <input type="text" value="${item.label}" data-id="${item.id}" placeholder="${item.label}" />
    `;
    container.appendChild(row);
  });
}

function saveNavLabels() {
  const inputs = document.querySelectorAll('#navEditor input');
  const labels = getUserNavLabels();
  inputs.forEach(inp => {
    const item = labels.find(l => l.id === inp.dataset.id);
    if (item) item.label = inp.value.trim() || item.label;
  });
  DB.set('navLabels', labels);
  refreshNavLabels();
  showToast('Etiquetas actualizadas ✓');
}

function refreshNavLabels() {
  const labels = getUserNavLabels();
  labels.forEach(item => {
    const btn = document.querySelector(`[data-page="${item.id}"] .nav-label`);
    if (btn) btn.textContent = item.label;
  });
}

// ─── SETTINGS PAGE ──────────────────────────
function loadSettingsPage() {
  const cfg = getConfig();
  const el = id => document.getElementById(id);

  if (el('settingStoreName')) el('settingStoreName').value = cfg.storeName || '';
  if (el('settingCurrency')) el('settingCurrency').value = cfg.currency || '$';
  if (el('settingLowStock')) el('settingLowStock').value = cfg.lowStock || 5;

  // Palette cards
  const pal = cfg.palette || 'black';
  document.querySelectorAll('.palette-card').forEach(c => {
    c.classList.toggle('active', c.dataset.pal === pal);
  });

  // Font family
  if (el('fontFamilySelect')) el('fontFamilySelect').value = cfg.fontFamily || 'moderno';

  // Font size buttons
  const fs = cfg.fontSize || 'medium';
  document.querySelectorAll('.fontsize-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.size === fs);
  });

  buildNavEditor();
}

// ─── PRODUCTS ───────────────────────────────
function getProducts() { return DB.get('products'); }
function setProducts(arr) { DB.set('products', arr); }

function openProductModal(prodId = null) {
  editingProductId = prodId;
  productImageB64 = null;
  const title = document.getElementById('productModalTitle');
  const fields = ['prodName','prodCategory','prodCost','prodPrice','prodStock','prodDesc'];

  fields.forEach(f => {
    const el = document.getElementById(f);
    if (el) el.value = '';
  });

  document.getElementById('prodImagePreview').classList.add('hidden');
  document.getElementById('prodImagePreview').src = '';
  document.getElementById('prodImagePlaceholder').classList.remove('hidden');

  if (prodId) {
    title.textContent = 'Editar Producto';
    const products = getProducts();
    const p = products.find(x => x.id === prodId);
    if (p) {
      document.getElementById('prodName').value = p.name || '';
      document.getElementById('prodCategory').value = p.category || 'perfume';
      document.getElementById('prodCost').value = p.cost || '';
      document.getElementById('prodPrice').value = p.price || '';
      document.getElementById('prodStock').value = p.stock || 0;
      document.getElementById('prodDesc').value = p.description || '';
      if (p.image) {
        productImageB64 = p.image;
        document.getElementById('prodImagePreview').src = p.image;
        document.getElementById('prodImagePreview').classList.remove('hidden');
        document.getElementById('prodImagePlaceholder').classList.add('hidden');
      }
    }
  } else {
    title.textContent = 'Nuevo Producto';
  }

  openModal('productModal');
}

function handleProductImage(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    productImageB64 = ev.target.result;
    const img = document.getElementById('prodImagePreview');
    img.src = productImageB64;
    img.classList.remove('hidden');
    document.getElementById('prodImagePlaceholder').classList.add('hidden');
  };
  reader.readAsDataURL(file);
}

function saveProduct() {
  const name = document.getElementById('prodName').value.trim();
  const price = parseFloat(document.getElementById('prodPrice').value);
  const stock = parseInt(document.getElementById('prodStock').value);

  if (!name) { showToast('El nombre es obligatorio', true); return; }
  if (isNaN(price) || price < 0) { showToast('Precio inválido', true); return; }
  if (isNaN(stock)) { showToast('Stock inválido', true); return; }

  const products = getProducts();
  const oldProd = editingProductId ? products.find(p => p.id === editingProductId) : null;

  const prod = {
    id: editingProductId || uid(),
    name,
    category: document.getElementById('prodCategory').value,
    cost: parseFloat(document.getElementById('prodCost').value) || 0,
    price,
    stock,
    description: document.getElementById('prodDesc').value.trim(),
    image: productImageB64 || null,
    createdAt: editingProductId ? (oldProd?.createdAt || now()) : now(),
    updatedAt: now(),
  };

  if (editingProductId) {
    const idx = products.findIndex(p => p.id === editingProductId);
    if (idx > -1) products[idx] = prod;

    // Cascade rename to existing sales
    if (oldProd && oldProd.name !== prod.name) {
      const salesData = DB.get('sales');
      salesData.forEach(s => {
        if (s.productId === editingProductId) s.productName = prod.name;
        if (s.items) s.items.forEach(item => {
          if (item.productId === editingProductId) item.productName = prod.name;
        });
      });
      DB.set('sales', salesData);
    }
  } else {
    products.push(prod);
  }

  setProducts(products);
  closeModal('productModal');
  renderProducts();
  logAction('productos', editingProductId ? 'Editado' : 'Agregado', prod.name);
  showToast(editingProductId ? 'Producto actualizado ✓' : 'Producto guardado ✓');
  editingProductId = null;
}

function deleteProduct(prodId) {
  const prodName = (getProducts().find(p => p.id === prodId) || {}).name || prodId;
  confirm2('¿Eliminar producto?', 'Esta acción no se puede deshacer.', () => {
    setProducts(getProducts().filter(p => p.id !== prodId));
    closeModal('productDetailModal');
    renderProducts();
    logAction('productos', 'Eliminado', prodName);
    showToast('Producto eliminado');
  });
}

function renderProducts() {
  const grid = document.getElementById('productsGrid');
  if (!grid) return;

  const search = (document.getElementById('productSearch')?.value || '').toLowerCase();
  const cat = document.getElementById('productCatFilter')?.value || '';
  const currency = getCurrency();
  const lowThr = getLowStockThreshold();

  let products = getProducts();
  if (search) products = products.filter(p => p.name.toLowerCase().includes(search) || (p.description || '').toLowerCase().includes(search));
  if (cat) products = products.filter(p => p.category === cat);

  if (!products.length) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><span class="empty-icon">✦</span><p>Sin productos. Agrega el primero.</p></div>`;
    return;
  }

  grid.innerHTML = products.map(p => {
    const stockClass = p.stock === 0 ? 'stock-out' : (p.stock <= lowThr ? 'stock-low' : 'stock-ok');
    const stockLabel = p.stock === 0 ? 'Agotado' : (p.stock <= lowThr ? `⚠ ${p.stock}` : p.stock);
    const imgEl = p.image
      ? `<img src="${p.image}" alt="${p.name}" class="product-img" />`
      : `<div class="product-img-placeholder">${categoryEmoji(p.category)}</div>`;
    return `
      <div class="product-card" onclick="openProductDetail('${p.id}')">
        ${imgEl}
        <div class="product-info">
          <p class="product-cat">${p.category}</p>
          <h3 class="product-name">${p.name}</h3>
          <div class="product-meta">
            <span class="product-price">${currency}${p.price.toFixed(2)}</span>
            <span class="product-stock ${stockClass}">${stockLabel}</span>
          </div>
        </div>
      </div>`;
  }).join('');
}

function openProductDetail(prodId) {
  const products = getProducts();
  const p = products.find(x => x.id === prodId);
  if (!p) return;

  const currency = getCurrency();
  const sales = DB.get('sales').filter(s => s.productId === prodId);
  const totalSold = sales.reduce((a, s) => a + s.qty, 0);
  const totalRevenue = sales.reduce((a, s) => a + s.total, 0);
  const profit = totalRevenue - (p.cost * totalSold);

  document.getElementById('productDetailTitle').textContent = p.name;
  document.getElementById('productDetailBody').innerHTML = `
    ${p.image ? `<img src="${p.image}" alt="${p.name}" class="product-detail-img" />` : ''}
    <div class="detail-row"><span class="detail-label">Categoría</span><span class="detail-val">${p.category}</span></div>
    <div class="detail-row"><span class="detail-label">Precio venta</span><span class="detail-val">${currency}${p.price.toFixed(2)}</span></div>
    <div class="detail-row"><span class="detail-label">Precio costo</span><span class="detail-val">${p.cost ? currency + p.cost.toFixed(2) : '—'}</span></div>
    <div class="detail-row"><span class="detail-label">Stock actual</span><span class="detail-val">${p.stock} unidades</span></div>
    <div class="detail-row"><span class="detail-label">Total vendido</span><span class="detail-val">${totalSold} unidades</span></div>
    <div class="detail-row"><span class="detail-label">Ingreso total</span><span class="detail-val">${currency}${totalRevenue.toFixed(2)}</span></div>
    <div class="detail-row"><span class="detail-label">Ganancia estimada</span><span class="detail-val" style="color:var(--accent)">${currency}${profit.toFixed(2)}</span></div>
    ${p.description ? `<p style="margin-top:1rem;font-size:0.85rem;color:var(--text3)">${p.description}</p>` : ''}
    <div style="margin-top:1.5rem;display:flex;gap:0.75rem;flex-wrap:wrap">
      <button class="btn-secondary" onclick="addStockModal('${p.id}')">+ Agregar Stock</button>
      <button class="btn-danger" onclick="deleteProduct('${p.id}')">Eliminar</button>
    </div>
  `;

  document.getElementById('editProductBtn').onclick = () => {
    closeModal('productDetailModal');
    openProductModal(prodId);
  };

  openModal('productDetailModal');
}

function addStockModal(prodId) {
  const qty = parseInt(prompt('¿Cuántas unidades agregar al stock?'));
  if (isNaN(qty) || qty <= 0) return;
  const products = getProducts();
  const p = products.find(x => x.id === prodId);
  if (!p) return;
  p.stock += qty;
  setProducts(products);
  closeModal('productDetailModal');
  renderProducts();
  showToast(`+${qty} unidades agregadas al stock ✓`);
}

// ─── CLIENTS ────────────────────────────────
function getClients() { return DB.get('clients'); }
function setClients(arr) { DB.set('clients', arr); }

function openClientModal(clientId = null) {
  editingClientId = clientId;
  ['clientName','clientPhone','clientEmail','clientNotes'].forEach(f => {
    const el = document.getElementById(f);
    if (el) el.value = '';
  });
  document.getElementById('clientModalTitle').textContent = clientId ? 'Editar Cliente' : 'Nuevo Cliente';

  if (clientId) {
    const c = getClients().find(x => x.id === clientId);
    if (c) {
      document.getElementById('clientName').value = c.name || '';
      document.getElementById('clientPhone').value = c.phone || '';
      document.getElementById('clientEmail').value = c.email || '';
      document.getElementById('clientNotes').value = c.notes || '';
    }
  }
  openModal('clientModal');
}

function saveClient() {
  const name = document.getElementById('clientName').value.trim();
  if (!name) { showToast('El nombre es obligatorio', true); return; }

  const clients = getClients();
  const client = {
    id: editingClientId || uid(),
    name,
    phone: document.getElementById('clientPhone').value.trim(),
    email: document.getElementById('clientEmail').value.trim(),
    notes: document.getElementById('clientNotes').value.trim(),
    createdAt: editingClientId ? (clients.find(c => c.id === editingClientId)?.createdAt || now()) : now(),
  };

  if (editingClientId) {
    const idx = clients.findIndex(c => c.id === editingClientId);
    if (idx > -1) clients[idx] = client;
  } else {
    clients.push(client);
  }

  setClients(clients);
  closeModal('clientModal');
  renderClients();
  logAction('clientes', editingClientId ? 'Editado' : 'Agregado', client.name);
  showToast(editingClientId ? 'Cliente actualizado ✓' : 'Cliente guardado ✓');
  editingClientId = null;
}

function deleteClient(clientId) {
  const clientName = (getClients().find(c => c.id === clientId) || {}).name || clientId;
  confirm2('¿Eliminar cliente?', 'Sus ventas se conservarán pero sin nombre de cliente.', () => {
    setClients(getClients().filter(c => c.id !== clientId));
    closeModal('clientDetailModal');
    renderClients();
    logAction('clientes', 'Eliminado', clientName);
    showToast('Cliente eliminado');
  });
}

function renderClients() {
  const grid = document.getElementById('clientsGrid');
  if (!grid) return;

  const search = (document.getElementById('clientSearch')?.value || '').toLowerCase();
  const currency = getCurrency();

  let clients = getClients();
  if (search) clients = clients.filter(c => c.name.toLowerCase().includes(search) || (c.phone || '').includes(search));

  if (!clients.length) {
    grid.innerHTML = `<div class="empty-state"><span class="empty-icon">◎</span><p>Sin clientes registrados.</p></div>`;
    return;
  }

  const sales = DB.get('sales');

  grid.innerHTML = clients.map(c => {
    const clientSales = sales.filter(s => s.clientId === c.id);
    const debt = clientSales.reduce((a, s) => a + getSaleRemaining(s), 0);
    const initials = c.name.split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase();
    return `
      <div class="client-row" onclick="openClientDetail('${c.id}')">
        <div class="client-avatar">${initials}</div>
        <div class="client-info">
          <p class="client-name">${c.name}</p>
          <p class="client-detail">${c.phone || c.email || 'Sin contacto'}</p>
        </div>
        <div>
          ${debt > 0
            ? `<p class="client-debt">${currency}${debt.toFixed(2)}<br><small style="font-size:0.72rem;font-family:DM Sans">debe</small></p>`
            : `<p class="client-debt zero">Al día ✓</p>`}
        </div>
      </div>`;
  }).join('');
}

function openClientDetail(clientId) {
  const c = getClients().find(x => x.id === clientId);
  if (!c) return;

  const allSales = DB.get('sales').filter(s => s.clientId === clientId);
  const products = getProducts();
  const currency = getCurrency();
  const totalSpent = allSales.reduce((a, s) => a + s.total, 0);
  const pendingSales = allSales.filter(s => getSaleRemaining(s) > 0.001);
  const paidSales = allSales.filter(s => getSaleRemaining(s) <= 0.001);
  const totalDebt = pendingSales.reduce((a, s) => a + getSaleRemaining(s), 0);

  // ── PERFIL ────────────────────────────────
  const perfilHtml = `
    <div class="detail-row"><span class="detail-label">Teléfono</span><span class="detail-val">${c.phone || '—'}</span></div>
    <div class="detail-row"><span class="detail-label">Correo</span><span class="detail-val">${c.email || '—'}</span></div>
    <div class="detail-row"><span class="detail-label">Total comprado</span><span class="detail-val">${currency}${totalSpent.toFixed(2)}</span></div>
    <div class="detail-row"><span class="detail-label">Deuda total</span>
      <span class="detail-val" style="color:${totalDebt > 0 ? '#e07070' : 'var(--accent2)'}">
        ${totalDebt > 0 ? currency + totalDebt.toFixed(2) : 'Sin deudas ✓'}
      </span>
    </div>
    <div class="detail-row"><span class="detail-label">Compras</span><span class="detail-val">${allSales.length} en total</span></div>
    ${c.notes ? `<div class="detail-row"><span class="detail-label">Notas</span><span class="detail-val" style="font-style:italic;font-size:0.83rem">${c.notes}</span></div>` : ''}
    <div style="margin-top:1.5rem;display:flex;gap:0.75rem;flex-wrap:wrap">
      <button class="btn-secondary" onclick="closeModal('clientDetailModal');openClientModal('${c.id}')">Editar</button>
      <button class="btn-danger" onclick="deleteClient('${c.id}')">Eliminar</button>
    </div>`;

  // ── DEUDAS ────────────────────────────────
  function buildFiadoCard(s) {
    const items = getSaleItems(s);
    const paid = getSaleAmountPaid(s);
    const remaining = getSaleRemaining(s);
    const pct = Math.min(100, Math.round((paid / s.total) * 100));
    const itemsHtml = items.map(item => {
      const prod = products.find(p => p.id === item.productId);
      const imgEl = (prod && prod.image)
        ? `<img src="${prod.image}" class="cd-item-img" alt="${item.productName}" />`
        : `<div class="cd-item-emoji">${categoryEmoji(prod ? prod.category : 'otro')}</div>`;
      return `<div class="cd-sale-item">
        ${imgEl}
        <div class="cd-sale-info">
          <span class="cd-sale-name">${item.productName}</span>
          <span class="cd-sale-detail">${item.qty} ud. · ${currency}${item.unitPrice.toFixed(2)} c/u</span>
        </div>
        <span class="cd-sale-sub">${currency}${item.total.toFixed(2)}</span>
      </div>`;
    }).join('');
    return `<div class="cd-fiado-card">
      <div class="cd-fiado-header">
        <div>
          <span class="cd-fiado-date">${s.date}</span>
          <span style="font-size:0.72rem;color:var(--text3);display:block;margin-top:1px">Total: ${currency}${s.total.toFixed(2)}</span>
        </div>
        <div style="text-align:right">
          <span style="font-size:0.72rem;color:var(--text3);display:block">Debe:</span>
          <span class="cd-fiado-remaining">${currency}${remaining.toFixed(2)}</span>
        </div>
      </div>
      ${itemsHtml}
      <div class="cd-progress-wrap">
        <div class="cd-progress-track"><div class="cd-progress-fill" style="width:${pct}%"></div></div>
        <div class="cd-progress-labels">
          <span>Pagado: <b>${currency}${paid.toFixed(2)}</b></span>
          <span>${pct}%</span>
          <span class="cd-remaining">Debe: <b>${currency}${remaining.toFixed(2)}</b></span>
        </div>
      </div>
      <button class="btn-primary" style="width:100%;margin-top:0.75rem;font-size:0.85rem"
              onclick="openPaymentModal('${s.id}','${clientId}')">Registrar Pago →</button>
    </div>`;
  }

  const pendingHtml = pendingSales.length
    ? pendingSales.slice().reverse().map(buildFiadoCard).join('')
    : `<p style="color:var(--accent2);font-size:0.85rem;padding:0.5rem 0">Sin deudas pendientes ✓</p>`;

  const deudasHtml = `
    ${pendingSales.length ? `<p style="font-size:0.78rem;color:var(--text3);margin-bottom:0.75rem">Toca una venta para registrar un pago o abono parcial</p>` : ''}
    <div class="cd-fiado-list">${pendingHtml}</div>`;

  // ── HISTORIAL ─────────────────────────────
  const events = [];
  allSales.forEach(s => {
    const items = getSaleItems(s);
    const label = items.length === 1
      ? `${items[0].productName} × ${items[0].qty}`
      : `${items.length} productos`;
    const isPending = getSaleRemaining(s) > 0.001;
    events.push({
      date: s.date, timestamp: s.timestamp || s.date,
      type: 'venta', title: `Venta: ${label}`,
      sub: isPending ? `Pendiente: ${currency}${getSaleRemaining(s).toFixed(2)}` : 'Pagado ✓',
      amount: s.total,
    });
    (s.payments || []).forEach(p => {
      events.push({
        date: p.date, timestamp: p.date,
        type: 'pago', title: 'Abono registrado',
        sub: `${label}${p.note ? ' · ' + p.note : ''}`,
        amount: p.amount,
      });
    });
  });
  events.sort((a, b) => (b.timestamp || b.date).localeCompare(a.timestamp || a.date));

  const historialHtml = events.length
    ? `<div class="tl-list">${events.map(e => `
      <div class="tl-entry">
        <div class="tl-dot ${e.type}">${e.type === 'venta' ? '◌' : '✓'}</div>
        <div class="tl-body">
          <p class="tl-title">${e.title}</p>
          <p class="tl-sub">${e.sub}</p>
        </div>
        <div class="tl-right">
          <span class="tl-amount ${e.type}">${e.type === 'pago' ? '+' : ''}${currency}${e.amount.toFixed(2)}</span>
          <span class="tl-date">${e.date}</span>
        </div>
      </div>`).join('')}</div>`
    : `<p style="color:var(--text3);font-size:0.85rem;padding:1rem 0">Sin actividad registrada.</p>`;

  document.getElementById('clientDetailName').textContent = c.name;
  document.getElementById('clientDetailBody').innerHTML = `
    <div class="cd-tabs">
      <button class="cd-tab active" data-tab="perfil" onclick="switchClientTab('perfil')">Perfil</button>
      <button class="cd-tab" data-tab="deudas" onclick="switchClientTab('deudas')">${pendingSales.length ? `Deudas (${pendingSales.length})` : 'Deudas'}</button>
      <button class="cd-tab" data-tab="historial" onclick="switchClientTab('historial')">Historial</button>
    </div>
    <div id="cd-panel-perfil" class="cd-panel">${perfilHtml}</div>
    <div id="cd-panel-deudas" class="cd-panel hidden">${deudasHtml}</div>
    <div id="cd-panel-historial" class="cd-panel hidden">${historialHtml}</div>`;

  openModal('clientDetailModal');
}

function switchClientTab(tab) {
  document.querySelectorAll('.cd-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  document.querySelectorAll('.cd-panel').forEach(p => p.classList.add('hidden'));
  const panel = document.getElementById('cd-panel-' + tab);
  if (panel) panel.classList.remove('hidden');
}

// ─── PAYMENT SYSTEM ─────────────────────────
function getSaleAmountPaid(sale) {
  if (sale.paid === true && !sale.payments) return sale.total;
  return sale.amountPaid || 0;
}

function getSaleRemaining(sale) {
  return Math.max(0, sale.total - getSaleAmountPaid(sale));
}

let _paymentSaleId = null;
let _paymentClientId = null;

function openPaymentModal(saleId, clientId) {
  _paymentSaleId = saleId;
  _paymentClientId = clientId || null;

  const sales = DB.get('sales');
  const sale = sales.find(s => s.id === saleId);
  if (!sale) return;

  const products = getProducts();
  const currency = getCurrency();
  const items = getSaleItems(sale);
  const paid = getSaleAmountPaid(sale);
  const remaining = getSaleRemaining(sale);
  const pct = Math.min(100, Math.round((paid / sale.total) * 100));

  const showCheckboxes = items.length > 1 && remaining > 0.001;

  const itemsHtml = items.map(item => {
    const prod = products.find(p => p.id === item.productId);
    const imgEl = (prod && prod.image)
      ? `<img src="${prod.image}" class="pm-item-img" alt="${item.productName}" />`
      : `<div class="pm-item-emoji">${categoryEmoji(prod ? prod.category : 'otro')}</div>`;
    const checkEl = showCheckboxes
      ? `<label class="pm-item-check" onclick="event.stopPropagation()"><input type="checkbox" checked value="${item.total.toFixed(2)}" onchange="updatePayFromChecked()" /></label>`
      : '';
    return `<div class="pm-item-row${showCheckboxes ? ' pm-selectable' : ''}" ${showCheckboxes ? 'onclick="togglePmItem(this)"' : ''}>
      ${checkEl}${imgEl}
      <div class="pm-item-info">
        <span class="pm-item-name">${item.productName}</span>
        <span class="pm-item-detail">${item.qty} ud. · ${currency}${item.unitPrice.toFixed(2)} c/u</span>
      </div>
      <span class="pm-item-total">${currency}${item.total.toFixed(2)}</span>
    </div>`;
  }).join('');

  const payHist = (sale.payments || []);
  const histHtml = payHist.length
    ? payHist.map(p => `<div class="pm-hist-item">
        <span class="pm-hist-date">${p.date}</span>
        ${p.note ? `<span class="pm-hist-note">${p.note}</span>` : ''}
        <span class="pm-hist-amount">${currency}${p.amount.toFixed(2)}</span>
      </div>`).join('')
    : `<p class="pm-hist-empty">Sin pagos registrados aún.</p>`;

  const newPaySection = remaining > 0.001 ? `
    <div class="pm-new-section">
      <h4>Registrar pago</h4>
      <div class="pm-new-row">
        <div class="input-group" style="flex:1;margin-bottom:0">
          <label>Monto a pagar</label>
          <input type="number" id="payAmount" min="0.01" max="${remaining.toFixed(2)}" step="0.01" value="${remaining.toFixed(2)}" />
        </div>
        <div class="input-group" style="flex:1;margin-bottom:0">
          <label>Nota (opcional)</label>
          <input type="text" id="payNote" placeholder="Abono, efectivo..." />
        </div>
      </div>
      <button class="pm-pay-all-btn" onclick="setPayAmount(${remaining.toFixed(2)})">
        Saldar todo — ${currency}${remaining.toFixed(2)}
      </button>
    </div>` : `<div class="pm-done-banner">Deuda saldada completamente ✓</div>`;

  document.getElementById('paymentModalBody').innerHTML = `
    <div class="pm-items-list">${itemsHtml}</div>
    ${showCheckboxes ? `<p style="font-size:0.75rem;color:var(--text3);margin:-0.5rem 0 0.5rem">Toca un ítem para seleccionarlo o deseleccionarlo</p>
    <div id="pmSummary" class="pm-summary"></div>` : ''}

    <div class="pm-progress-section">
      <div class="pm-progress-track"><div class="pm-progress-fill" style="width:${pct}%"></div></div>
      <div class="pm-progress-labels">
        <span>Pagado: <strong>${currency}${paid.toFixed(2)}</strong></span>
        <span class="pm-pct">${pct}%</span>
        <span>Total: <strong>${currency}${sale.total.toFixed(2)}</strong></span>
      </div>
      ${remaining > 0.001
        ? `<p class="pm-remaining">Pendiente: <strong>${currency}${remaining.toFixed(2)}</strong></p>`
        : ''}
    </div>

    <div class="pm-hist-section">
      <h4>Historial de pagos</h4>
      <div class="pm-hist-list">${histHtml}</div>
    </div>

    ${newPaySection}
  `;

  const btn = document.getElementById('paymentModalBtn');
  if (btn) btn.style.display = remaining > 0.001 ? '' : 'none';

  if (showCheckboxes) updatePayFromChecked();
  openModal('paymentModal');
}

function setPayAmount(amount) {
  const inp = document.getElementById('payAmount');
  if (inp) { inp.value = amount.toFixed(2); inp.focus(); }
}

function togglePmItem(row) {
  const cb = row.querySelector('input[type="checkbox"]');
  if (!cb) return;
  cb.checked = !cb.checked;
  row.classList.toggle('unchecked', !cb.checked);
  updatePayFromChecked();
}

function updatePayFromChecked() {
  const boxes = document.querySelectorAll('.pm-item-check input[type="checkbox"]:checked');
  let sum = 0;
  boxes.forEach(cb => { sum += parseFloat(cb.value) || 0; });
  const sale = DB.get('sales').find(s => s.id === _paymentSaleId);
  if (sale) sum = Math.min(sum, getSaleRemaining(sale));
  const inp = document.getElementById('payAmount');
  if (inp) inp.value = sum.toFixed(2);

  const summary = document.getElementById('pmSummary');
  if (!summary) return;
  const currency = getCurrency();
  if (sum <= 0) {
    summary.innerHTML = `<p class="pm-summary-none">Selecciona al menos un ítem para calcular el pago</p>`;
    return;
  }
  const totalRemaining = sale ? getSaleRemaining(sale) : sum;
  const afterPay = Math.max(0, totalRemaining - sum);
  summary.innerHTML = `
    <div class="pm-summary-row">
      <span>A pagar ahora:</span>
      <strong>${currency}${sum.toFixed(2)}</strong>
    </div>
    <div class="pm-summary-row pm-summary-remaining">
      <span>Quedará pendiente:</span>
      <strong>${currency}${afterPay.toFixed(2)}</strong>
    </div>`;
}

function submitPayment() {
  const amount = parseFloat(document.getElementById('payAmount')?.value);
  const note = (document.getElementById('payNote')?.value || '').trim();

  if (isNaN(amount) || amount <= 0) { showToast('Ingresa un monto válido', true); return; }

  const sale = DB.get('sales').find(s => s.id === _paymentSaleId);
  if (!sale) return;

  const remaining = getSaleRemaining(sale);
  if (amount > remaining + 0.001) {
    showToast(`Máximo a pagar: ${getCurrency()}${remaining.toFixed(2)}`, true);
    return;
  }

  const currency = getCurrency();
  const isFull = amount >= remaining - 0.001;
  const confirmMsg = isFull
    ? `¿Registrar pago completo de ${currency}${amount.toFixed(2)} y marcar la deuda como saldada?`
    : `¿Registrar abono de ${currency}${amount.toFixed(2)}? Quedará ${currency}${(remaining - amount).toFixed(2)} pendiente.`;

  confirm2('Confirmar pago', confirmMsg, () => _doSubmitPayment(amount, note));
}

function _doSubmitPayment(amount, note) {
  const sales = DB.get('sales');
  const sale = sales.find(s => s.id === _paymentSaleId);
  if (!sale) return;

  if (!sale.payments) sale.payments = [];
  if (typeof sale.amountPaid !== 'number') sale.amountPaid = getSaleAmountPaid(sale);

  sale.payments.push({ id: uid(), amount, date: todayStr(), note });
  sale.amountPaid = (sale.amountPaid || 0) + amount;

  if (sale.amountPaid >= sale.total - 0.001) {
    sale.paid = true;
    sale.amountPaid = sale.total;
  }

  DB.set('sales', sales);
  logAction('pagos', 'Pago registrado', `${getCurrency()}${amount.toFixed(2)}${note ? ' — ' + note : ''}`);
  showToast(`Pago de ${getCurrency()}${amount.toFixed(2)} registrado ✓`);

  openPaymentModal(_paymentSaleId, _paymentClientId);
  renderSalesHistory();
  if (_paymentClientId) {
    const detailEl = document.getElementById('clientDetailModal');
    if (detailEl && !detailEl.classList.contains('hidden')) {
      openClientDetail(_paymentClientId);
      switchClientTab('deudas');
      openModal('paymentModal');
    }
  }
}

// ─── SALES ──────────────────────────────────
function initSalesPage() {
  saleCart = [];
  clearSaleClient();
  populateSaleSelects();
  searchSaleProducts();
  renderSaleCart();
  renderSalesHistory();
}

function searchSaleClients() {
  const q = (document.getElementById('saleClientSearch')?.value || '').toLowerCase().trim();
  const resultsEl = document.getElementById('saleClientResults');
  if (!resultsEl) return;

  const clients = getClients();
  if (!clients.length) {
    resultsEl.innerHTML = `<p class="spr-empty">Sin clientes registrados.</p>`;
    return;
  }

  const filtered = q
    ? clients.filter(c => c.name.toLowerCase().includes(q) || (c.phone || '').includes(q))
    : clients;

  if (!filtered.length) {
    resultsEl.innerHTML = `<p class="spr-empty">Sin clientes para "${q}".</p>`;
    return;
  }

  resultsEl.innerHTML = filtered.slice(0, 8).map(c => {
    const initials = c.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
    return `<div class="scr-item" onclick="selectSaleClient('${c.id}')">
      <div class="scr-avatar">${initials}</div>
      <div class="scr-info">
        <span class="scr-name">${c.name}</span>
        ${c.phone ? `<span class="scr-detail">${c.phone}</span>` : ''}
      </div>
    </div>`;
  }).join('') + (filtered.length > 8 ? `<p class="spr-hint">${filtered.length} clientes — escribe para filtrar</p>` : '');
}

function selectSaleClient(id) {
  const c = getClients().find(x => x.id === id);
  if (!c) return;
  const initials = c.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  document.getElementById('saleClientId').value = id;
  document.getElementById('saleClientSearch').value = '';
  document.getElementById('saleClientResults').innerHTML = '';
  document.getElementById('saleClientAvatar').textContent = initials;
  document.getElementById('saleClientName').textContent = c.name;
  document.getElementById('saleClientSelected').classList.remove('hidden');
}

function clearSaleClient() {
  const idEl = document.getElementById('saleClientId');
  const searchEl = document.getElementById('saleClientSearch');
  const resultsEl = document.getElementById('saleClientResults');
  const selectedEl = document.getElementById('saleClientSelected');
  if (idEl) idEl.value = '';
  if (searchEl) searchEl.value = '';
  if (resultsEl) resultsEl.innerHTML = '';
  if (selectedEl) selectedEl.classList.add('hidden');
}

function populateSaleSelects() {
  const clientSel = document.getElementById('saleClient');
  const filterSel = document.getElementById('saleFilterClient');

  if (clientSel) {
    const clients = getClients();
    clientSel.innerHTML = '<option value="">— Sin cliente —</option>' +
      clients.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  }

  if (filterSel) {
    const clients = getClients();
    filterSel.innerHTML = '<option value="">Todos los clientes</option>' +
      clients.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  }
}

function searchSaleProducts() {
  const q = (document.getElementById('saleProductSearch')?.value || '').toLowerCase().trim();
  const resultsEl = document.getElementById('saleProductResults');
  if (!resultsEl) return;

  const currency = getCurrency();
  let products = getProducts().filter(p => p.stock > 0);
  if (q) products = products.filter(p => p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q));

  if (!products.length) {
    resultsEl.innerHTML = `<p class="spr-empty">Sin productos${q ? ' para "' + q + '"' : ' disponibles'}.</p>`;
    return;
  }

  const shown = q ? products : products.slice(0, 20);
  resultsEl.innerHTML = shown.map(p => {
    const inCart = saleCart.find(i => i.productId === p.id);
    return `<div class="spr-item" onclick="addToCart('${p.id}')">
      <div class="spr-info">
        <span class="spr-name">${p.name}</span>
        <span class="spr-cat">${p.category}</span>
      </div>
      <div class="spr-right">
        <span class="spr-price">${currency}${p.price.toFixed(2)}</span>
        <span class="spr-stock ${p.stock <= getLowStockThreshold() ? 'spr-low' : ''}">Stock: ${p.stock}${inCart ? ' · en carrito' : ''}</span>
      </div>
    </div>`;
  }).join('') + (products.length > 20 && !q ? `<p class="spr-hint">Escribe para filtrar (${products.length} productos)</p>` : '');
}

function addToCart(productId) {
  const products = getProducts();
  const p = products.find(x => x.id === productId);
  if (!p) return;

  const existing = saleCart.find(i => i.productId === productId);
  if (existing) {
    if (existing.qty >= p.stock) { showToast(`Stock máximo: ${p.stock}`, true); return; }
    existing.qty++;
  } else {
    saleCart.push({ productId: p.id, productName: p.name, qty: 1, unitPrice: p.price, cost: p.cost || 0, maxStock: p.stock });
  }

  renderSaleCart();
  searchSaleProducts();
  showToast(`${p.name} agregado al carrito ✓`);
}

function removeFromCart(productId) {
  saleCart = saleCart.filter(i => i.productId !== productId);
  renderSaleCart();
  searchSaleProducts();
}

function updateCartQty(productId, val) {
  const item = saleCart.find(i => i.productId === productId);
  if (!item) return;
  const q = parseInt(val);
  if (isNaN(q) || q < 1) { removeFromCart(productId); return; }
  if (q > item.maxStock) { showToast(`Stock máximo: ${item.maxStock}`, true); return; }
  item.qty = q;
  renderSaleCart();
}

function renderSaleCart() {
  const cartEl = document.getElementById('saleCart');
  const itemsEl = document.getElementById('saleCartItems');
  const totalEl = document.getElementById('saleCartTotal');
  const countEl = document.getElementById('saleCartCount');
  if (!cartEl) return;

  if (!saleCart.length) { cartEl.classList.add('hidden'); return; }

  cartEl.classList.remove('hidden');
  const currency = getCurrency();
  const total = saleCart.reduce((a, i) => a + i.unitPrice * i.qty, 0);
  const totalUnits = saleCart.reduce((a, i) => a + i.qty, 0);
  countEl.textContent = totalUnits;
  totalEl.textContent = currency + total.toFixed(2);

  itemsEl.innerHTML = saleCart.map(item => `
    <div class="cart-item">
      <div class="cart-item-info">
        <span class="cart-item-name">${item.productName}</span>
        <span class="cart-item-sub">${currency}${item.unitPrice.toFixed(2)} c/u</span>
      </div>
      <div class="cart-item-controls">
        <input type="number" class="cart-qty-input" min="1" max="${item.maxStock}" value="${item.qty}"
               onchange="updateCartQty('${item.productId}', this.value)" />
        <span class="cart-item-total">${currency}${(item.unitPrice * item.qty).toFixed(2)}</span>
        <button class="btn-icon cart-remove" onclick="removeFromCart('${item.productId}')">✕</button>
      </div>
    </div>`).join('');
}

function registerSale() {
  if (!saleCart.length) { showToast('Agrega al menos un producto al carrito', true); return; }

  const clientId = document.getElementById('saleClientId')?.value || '';
  const fiado = document.getElementById('saleFiado')?.checked || false;
  const currency = getCurrency();

  const products = getProducts();
  for (const item of saleCart) {
    const p = products.find(x => x.id === item.productId);
    if (!p) { showToast('Producto no encontrado', true); return; }
    if (p.stock < item.qty) { showToast(`Stock insuficiente para "${p.name}" (disponible: ${p.stock})`, true); return; }
  }

  saleCart.forEach(item => {
    const idx = products.findIndex(x => x.id === item.productId);
    if (idx >= 0) products[idx].stock -= item.qty;
  });
  setProducts(products);

  const total = saleCart.reduce((a, i) => a + i.unitPrice * i.qty, 0);
  const profit = saleCart.reduce((a, i) => a + (i.unitPrice - i.cost) * i.qty, 0);

  const sale = {
    id: uid(),
    items: saleCart.map(i => ({
      productId: i.productId,
      productName: i.productName,
      qty: i.qty,
      unitPrice: i.unitPrice,
      total: i.unitPrice * i.qty,
      profit: (i.unitPrice - i.cost) * i.qty,
    })),
    clientId: clientId || null,
    total,
    profit,
    date: todayStr(),
    timestamp: now(),
    paid: !fiado,
  };

  const saleLabel = saleCart.length === 1 ? saleCart[0].productName : `${saleCart.length} productos`;
  const sales = DB.get('sales');
  sales.push(sale);
  DB.set('sales', sales);
  logAction('ventas', 'Registrada', `${saleLabel} — ${currency}${total.toFixed(2)}${fiado ? ' (fiado)' : ''}`);

  showToast(`Venta registrada — ${currency}${total.toFixed(2)}${fiado ? ' (fiado)' : ''} ✓`);

  saleCart = [];
  clearSaleClient();
  document.getElementById('saleProductSearch').value = '';
  if (document.getElementById('saleFiado')) document.getElementById('saleFiado').checked = false;
  populateSaleSelects();
  renderSaleCart();
  searchSaleProducts();
  renderSalesHistory();
}

function renderSalesHistory() {
  const list = document.getElementById('salesHistoryList');
  if (!list) return;

  const dateFilter = document.getElementById('saleFilterDate')?.value || '';
  const clientFilter = document.getElementById('saleFilterClient')?.value || '';
  const currency = getCurrency();

  let sales = DB.get('sales').slice().reverse();
  if (dateFilter) sales = sales.filter(s => s.date === dateFilter);
  if (clientFilter) sales = sales.filter(s => s.clientId === clientFilter);

  if (!sales.length) {
    list.innerHTML = `<div class="empty-state"><span class="empty-icon">◌</span><p>Sin ventas en este período.</p></div>`;
    return;
  }

  const clients = getClients();
  list.innerHTML = sales.map(s => {
    const client = clients.find(c => c.id === s.clientId);
    const items = getSaleItems(s);
    const totalUnits = items.reduce((a, i) => a + i.qty, 0);
    const productLabel = items.length === 1
      ? `${items[0].productName} · ${items[0].qty} ud.`
      : `${items[0].productName} +${items.length - 1} más · ${totalUnits} ud.`;
    const isPending = getSaleRemaining(s) > 0.001;
    const statusBadge = isPending
      ? `<span class="fiado-badge" onclick="openPaymentModal('${s.id}',null)" title="Ver deuda y registrar pago" style="cursor:pointer">Fiado →</span>`
      : `<span class="paid-badge">Pagado</span>`;
    return `<div class="sale-history-item">
      <div>
        <span class="s-name">${productLabel}</span><br>
        <span class="s-client">${client ? client.name : 'Sin cliente'} ${statusBadge}</span>
      </div>
      <div style="text-align:right">
        <span class="s-amount">${currency}${s.total.toFixed(2)}</span><br>
        <span class="s-date">${s.date}</span>
      </div>
    </div>`;
  }).join('');
}

// ─── DASHBOARD ──────────────────────────────
function renderDashboard() {
  const sales = DB.get('sales');
  const products = getProducts();
  const clients = getClients();
  const today = todayStr();
  const currency = getCurrency();
  const lowThr = getLowStockThreshold();

  document.getElementById('statProducts').textContent = products.length;
  document.getElementById('statClients').textContent = clients.length;
  document.getElementById('statSalesToday').textContent = sales.filter(s => s.date === today).length;
  document.getElementById('statRevenue').textContent = currency + sales.reduce((a, s) => a + s.total, 0).toFixed(2);

  const dateEl = document.getElementById('dashDate');
  if (dateEl) dateEl.textContent = new Date().toLocaleDateString('es-DO', { weekday:'long', year:'numeric', month:'long', day:'numeric' });

  renderSalesChart(sales);
  renderTopProductsChart(sales, products);
  renderLowStock(products, lowThr, currency);
  renderRecentSales(sales, clients, currency);
}

function renderLowStock(products, threshold, currency) {
  const el = document.getElementById('lowStockList');
  if (!el) return;
  const low = products.filter(p => p.stock <= threshold).sort((a,b) => a.stock - b.stock);
  el.innerHTML = low.length
    ? low.map(p => `<div class="low-stock-item">
        <span>${p.name}</span>
        <span class="stock-badge">${p.stock} ud.</span>
      </div>`).join('')
    : '<p style="color:var(--text3);font-size:0.85rem;padding:0.5rem 0">Todo el stock está bien ✓</p>';
}

function renderRecentSales(sales, clients, currency) {
  const el = document.getElementById('recentSalesList');
  if (!el) return;
  const recent = sales.slice().reverse().slice(0, 8);
  el.innerHTML = recent.length
    ? recent.map(s => {
        const c = clients.find(x => x.id === s.clientId);
        const items = getSaleItems(s);
        const label = items.length === 1 ? items[0].productName : `${items[0].productName} +${items.length - 1} más`;
        const fiadoTag = s.paid === false ? ' <span class="fiado-badge" style="font-size:0.65rem">Fiado</span>' : '';
        return `<div class="sale-item-mini">
          <div>
            <span style="font-weight:500">${label}</span>${fiadoTag}<br>
            <span style="font-size:0.75rem;color:var(--text3)">${c ? c.name : 'Sin cliente'} · ${s.date}</span>
          </div>
          <span class="sale-amount">${currency}${s.total.toFixed(2)}</span>
        </div>`;
      }).join('')
    : '<p style="color:var(--text3);font-size:0.85rem;padding:0.5rem 0">Sin ventas aún.</p>';
}

function renderSalesChart(sales) {
  const ctx = document.getElementById('salesChart');
  if (!ctx) return;
  if (salesChartInst) salesChartInst.destroy();

  const days = last7Days();
  const data = days.map(d => sales.filter(s => s.date === d).reduce((a, s) => a + s.total, 0));
  const labels = days.map(d => d.slice(5));

  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#d4a97a';

  salesChartInst = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Ventas',
        data,
        backgroundColor: accent + '60',
        borderColor: accent,
        borderWidth: 2,
        borderRadius: 6,
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { color: 'rgba(128,128,128,0.1)' }, ticks: { color: '#9c8b7c' } },
        y: { grid: { color: 'rgba(128,128,128,0.1)' }, ticks: { color: '#9c8b7c' } },
      }
    }
  });
}

function renderTopProductsChart(sales, products) {
  const ctx = document.getElementById('topProductsChart');
  if (!ctx) return;
  if (topProductsChartInst) topProductsChartInst.destroy();

  const map = {};
  sales.forEach(s => { getSaleItems(s).forEach(i => { map[i.productId] = (map[i.productId] || 0) + i.qty; }); });
  const sorted = Object.entries(map).sort((a,b) => b[1]-a[1]).slice(0, 5);

  if (!sorted.length) return;

  const labels = sorted.map(([id]) => {
    const p = products.find(x => x.id === id);
    return p ? (p.name.length > 14 ? p.name.slice(0,12) + '…' : p.name) : 'Eliminado';
  });
  const data = sorted.map(([,qty]) => qty);
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#d4a97a';
  const accent2 = getComputedStyle(document.documentElement).getPropertyValue('--accent2').trim() || '#a8c5b8';

  topProductsChartInst = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: [accent+'cc', accent2+'cc', '#c9a6c5cc', '#c9b89acc', '#a6bcc9cc'],
        borderWidth: 0,
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: 'bottom', labels: { color: '#9c8b7c', font: { size: 11 } } }
      }
    }
  });
}

// ─── REPORTS ────────────────────────────────
function renderReports() {
  const sales = DB.get('sales');
  const clients = getClients();
  const currency = getCurrency();

  const totalRevenue = sales.reduce((a,s) => a + s.total, 0);
  const totalProfit = sales.reduce((a,s) => a + (s.profit || 0), 0);
  const totalUnits = sales.reduce((a,s) => a + s.qty, 0);

  const summary = document.getElementById('reportsSummary');
  if (summary) {
    summary.innerHTML = [
      { label: 'Ingresos Totales', val: currency + totalRevenue.toFixed(2), accent: true },
      { label: 'Ganancia Estimada', val: currency + totalProfit.toFixed(2), accent: true },
      { label: 'Unidades Vendidas', val: totalUnits },
      { label: 'Total Ventas', val: sales.length },
    ].map(s => `
      <div class="stat-card ${s.accent ? 'accent' : ''}">
        <div class="stat-info">
          <p class="stat-label">${s.label}</p>
          <h3 class="stat-value">${s.val}</h3>
        </div>
      </div>`).join('');
  }

  renderMonthlyChart(sales);
  renderCategoryChart(sales);
  renderDebtTable(clients, sales, currency);
}

function renderMonthlyChart(sales) {
  const ctx = document.getElementById('monthlyChart');
  if (!ctx) return;
  if (monthlyChartInst) monthlyChartInst.destroy();

  const months = {};
  sales.forEach(s => {
    const m = s.date ? s.date.slice(0, 7) : '';
    if (m) months[m] = (months[m] || 0) + s.total;
  });
  const sorted = Object.keys(months).sort();
  const labels = sorted.map(m => {
    const [y, mo] = m.split('-');
    const d = new Date(y, mo - 1, 1);
    return d.toLocaleDateString('es-DO', { month: 'short', year: '2-digit' });
  });
  const data = sorted.map(m => months[m]);
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#d4a97a';

  monthlyChartInst = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Ingresos',
        data,
        borderColor: accent,
        backgroundColor: accent + '20',
        fill: true,
        tension: 0.4,
        pointBackgroundColor: accent,
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { color: 'rgba(128,128,128,0.1)' }, ticks: { color: '#9c8b7c' } },
        y: { grid: { color: 'rgba(128,128,128,0.1)' }, ticks: { color: '#9c8b7c' } },
      }
    }
  });
}

function renderCategoryChart(sales) {
  const ctx = document.getElementById('categoryChart');
  if (!ctx) return;
  if (categoryChartInst) categoryChartInst.destroy();

  const products = getProducts();
  const catMap = {};
  sales.forEach(s => {
    getSaleItems(s).forEach(item => {
      const p = products.find(x => x.id === item.productId);
      const cat = p ? p.category : 'otro';
      catMap[cat] = (catMap[cat] || 0) + item.total;
    });
  });
  if (!Object.keys(catMap).length) return;

  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#d4a97a';
  const accent2 = getComputedStyle(document.documentElement).getPropertyValue('--accent2').trim() || '#a8c5b8';

  categoryChartInst = new Chart(ctx, {
    type: 'pie',
    data: {
      labels: Object.keys(catMap),
      datasets: [{
        data: Object.values(catMap),
        backgroundColor: [accent+'cc', accent2+'cc', '#c9a6c5cc', '#c9b89acc', '#a6bcc9cc'],
        borderWidth: 0,
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { position: 'bottom', labels: { color: '#9c8b7c', font: { size: 11 } } } }
    }
  });
}

function renderDebtTable(clients, sales, currency) {
  const el = document.getElementById('debtTable');
  if (!el) return;
  const debtors = clients.map(c => {
    const debt = sales.filter(s => s.clientId === c.id).reduce((a,s) => a + getSaleRemaining(s), 0);
    return { ...c, debt };
  }).filter(c => c.debt > 0).sort((a,b) => b.debt - a.debt);

  el.innerHTML = debtors.length
    ? debtors.map(c => `<div class="debt-row">
        <span>${c.name}</span>
        <span class="debt-amount">${currency}${c.debt.toFixed(2)}</span>
      </div>`).join('')
    : '<p style="color:var(--text3);font-size:0.85rem;padding:0.5rem 0">Sin deudas pendientes ✓</p>';
}

function destroyCharts() {
  [salesChartInst, topProductsChartInst, monthlyChartInst, categoryChartInst].forEach(c => { if (c) c.destroy(); });
  salesChartInst = topProductsChartInst = monthlyChartInst = categoryChartInst = null;
}

// ─── DATA EXPORT / IMPORT ───────────────────
function exportData() {
  const data = {
    products: getProducts(),
    clients: getClients(),
    sales: DB.get('sales'),
    config: DB.getObj('config'),
    exportedAt: now(),
    version: '1.0',
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `lumiere-backup-${todayStr()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Datos exportados ✓');
}

function importData(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const data = JSON.parse(ev.target.result);
      confirm2('¿Importar datos?', 'Se reemplazarán los datos actuales. ¿Continuar?', () => {
        if (data.products) DB.set('products', data.products);
        if (data.clients) DB.set('clients', data.clients);
        if (data.sales) DB.set('sales', data.sales);
        if (data.config) DB.set('config', data.config);
        applySettings();
        showToast('Datos importados ✓');
        navigateTo('dashboard');
      });
    } catch {
      showToast('Error al leer el archivo', true);
    }
  };
  reader.readAsText(file);
  e.target.value = '';
}

function confirmClearData() {
  confirm2('⚠ Borrar todos los datos', 'Esto eliminará productos, clientes, ventas y configuración permanentemente. ¿Seguro?', () => {
    ['products','clients','sales','config','navLabels'].forEach(k => DB.remove(k));
    destroyCharts();
    showToast('Datos borrados');
    navigateTo('dashboard');
  });
}

// ─── MODAL HELPERS ──────────────────────────
function openModal(id) {
  document.getElementById(id)?.classList.remove('hidden');
}

function closeModal(id) {
  document.getElementById(id)?.classList.add('hidden');
}

function closeModalOutside(e, id) {
  if (e.target.id === id) closeModal(id);
}

// ─── CONFIRM DIALOG ─────────────────────────
function confirm2(title, message, onOk) {
  document.getElementById('confirmTitle').textContent = title;
  document.getElementById('confirmMessage').textContent = message;
  document.getElementById('confirmOkBtn').onclick = () => { closeModal('confirmDialog'); onOk(); };
  openModal('confirmDialog');
}

// ─── TOAST ──────────────────────────────────
let toastTimer = null;
function showToast(msg, isError = false) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.style.borderLeftColor = isError ? '#e07070' : 'var(--accent)';
  toast.classList.remove('hidden');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add('hidden'), 3000);
}

// ─── UTILITIES ──────────────────────────────
function uid() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }
function now() { return new Date().toISOString(); }
function todayStr() { return new Date().toISOString().slice(0, 10); }

function last7Days() {
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

function categoryEmoji(cat) {
  const map = { perfume: '🌸', skincare: '✨', maquillaje: '💄', cabello: '💇', otro: '🛍' };
  return map[cat] || '✦';
}
