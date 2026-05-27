/* ═══════════════════════════════════════════
   LUMIÈRE — app.js
   Base de datos: localStorage (sin servidor)
   Compatible con GitHub Pages
═══════════════════════════════════════════ */

// ─── STORAGE HELPERS ───────────────────────
const DB = {
  get:    (k)      => { try { return JSON.parse(localStorage.getItem('lum_' + k)) || []; } catch { return []; } },
  getObj: (k, def = {}) => { try { return JSON.parse(localStorage.getItem('lum_' + k)) || def; } catch { return def; } },
  set:    (k, v)   => {
    localStorage.setItem('lum_' + k, JSON.stringify(v));
    if (typeof CloudSync !== 'undefined') CloudSync.schedulePush();
  },
  remove: (k)      => localStorage.removeItem('lum_' + k),
};

// ─── ADMIN ─────────────────────────────────
const ADMIN_CREDS = { username: 'Daralber326', password: 'Reyvikingo326' };
let isAdminSession = false;
let _changePassTargetId = null;

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

// Format a monetary amount — always rounds to whole number, no cents
function fmtN(n) {
  return Math.round(parseFloat(n) || 0).toLocaleString();
}

// ─── AUTH ───────────────────────────────────
async function checkAutoLogin() {
  const saved = localStorage.getItem('lum_session');
  if (saved) {
    try {
      const s = JSON.parse(saved);
      // Admin session restore
      if (s.isAdmin && s.username === ADMIN_CREDS.username && s.password === ADMIN_CREDS.password) {
        isAdminSession = true;
        loginSuccess({ username: s.username, storeName: 'Administrador', isAdmin: true });
        return;
      }
      // Pull latest data from cloud before resuming session
      if (typeof CloudSync !== 'undefined' && CloudSync.enabled) {
        const sub = document.querySelector('.login-logo p');
        if (sub) sub.textContent = 'Sincronizando datos…';
        await CloudSync.pull(s.username);
        if (sub) sub.textContent = 'Sistema de Gestión';
      }
      const users = DB.get('users');
      const u = users.find(u => u.username === s.username && u.password === s.password);
      if (u) { loginSuccess(u); return; }
    } catch {}
  }
  showLoginScreen();
}

async function handleAdminLogin() {
  const u = document.getElementById('adminLoginUser').value.trim();
  const p = document.getElementById('adminLoginPass').value;
  const err = document.getElementById('adminLoginError');
  if (!u || !p) { err.textContent = 'Completa todos los campos.'; return; }
  if (u !== ADMIN_CREDS.username || p !== ADMIN_CREDS.password) {
    err.textContent = 'Credenciales incorrectas.'; return;
  }
  isAdminSession = true;
  localStorage.setItem('lum_session', JSON.stringify({ username: u, password: p, isAdmin: true }));
  loginSuccess({ username: u, storeName: 'Administrador', isAdmin: true });
}

function showLoginScreen() {
  const loginTheme = localStorage.getItem('lum_loginTheme') || 'black';
  document.documentElement.setAttribute('data-palette', loginTheme);
  document.body.removeAttribute('data-admin-mode');
  document.getElementById('loginScreen').classList.remove('hidden');
  document.getElementById('appMain').classList.add('hidden');
}

function loginSuccess(user) {
  currentUser = user;
  cleanupTrash();
  if (user.isAdmin) {
    document.body.setAttribute('data-admin-mode', 'true');
  } else {
    document.body.removeAttribute('data-admin-mode');
    if (typeof CloudSync !== 'undefined') {
      CloudSync.setUser(user.username);
      CloudSync.showInitialStatus();
      CloudSync.push();
    }
  }
  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('appMain').classList.remove('hidden');
  document.getElementById('topbarUser').textContent = user.username;
  const cfg = getConfig();
  document.getElementById('sidebarBrand').textContent = user.isAdmin ? '⚙ Admin' : (user.storeName || cfg.storeName || 'LUMIÈRE');
  document.querySelectorAll('.nav-admin-item').forEach(el => el.classList.toggle('hidden', !user.isAdmin));
  navigateTo(user.isAdmin ? 'admin' : 'dashboard');
  if (!user.isAdmin) { loadSettingsPage(); refreshNavLabels(); }
  applySettings();
}

async function handleLogin() {
  const u = document.getElementById('loginUser').value.trim();
  const p = document.getElementById('loginPass').value;
  const err = document.getElementById('loginError');
  if (!u || !p) { err.textContent = 'Completa todos los campos.'; return; }

  const btn = document.querySelector('#loginForm .btn-primary');
  if (btn) { btn.disabled = true; btn.textContent = 'Verificando…'; }

  // Pull from cloud first so accounts created on other devices are recognized
  if (typeof CloudSync !== 'undefined') await CloudSync.pull(u);

  const users = DB.get('users');
  const user = users.find(x => x.username === u && x.password === p);

  if (btn) { btn.disabled = false; btn.textContent = 'Entrar'; }

  if (!user) { err.textContent = 'Usuario o contraseña incorrectos.'; return; }

  localStorage.setItem('lum_session', JSON.stringify({ username: u, password: p }));
  err.textContent = '';
  loginSuccess(user);
}

async function handleRegister() {
  const u = document.getElementById('regUser').value.trim();
  const p = document.getElementById('regPass').value;
  const c = document.getElementById('regPassConfirm').value;
  const s = document.getElementById('regStore').value.trim();
  const err = document.getElementById('registerError');

  if (!u || !p || !c || !s) { err.textContent = 'Completa todos los campos.'; return; }
  if (p.length < 4) { err.textContent = 'La contraseña debe tener al menos 4 caracteres.'; return; }
  if (p !== c) { err.textContent = 'Las contraseñas no coinciden.'; return; }

  const btn = document.querySelector('#registerForm .btn-primary');
  if (btn) { btn.disabled = true; btn.textContent = 'Creando cuenta…'; }

  // Check cloud to avoid duplicate usernames across devices
  if (typeof CloudSync !== 'undefined' && CloudSync.enabled) {
    await CloudSync.pull(u);
    const cloudUsers = DB.get('users');
    if (cloudUsers.find(x => x.username === u)) {
      if (btn) { btn.disabled = false; btn.textContent = 'Registrarse'; }
      err.textContent = 'Ese usuario ya existe.';
      return;
    }
  } else {
    const localUsers = DB.get('users');
    if (localUsers.find(x => x.username === u)) {
      if (btn) { btn.disabled = false; btn.textContent = 'Registrarse'; }
      err.textContent = 'Ese usuario ya existe.';
      return;
    }
  }

  const newUser = { id: uid(), username: u, password: p, storeName: s };
  const users = DB.get('users');
  users.push(newUser);
  DB.set('users', users);

  const cfg = getConfig();
  cfg.storeName = s;
  DB.set('config', cfg);

  // Push a fresh empty store doc so this account is available from other devices
  // without inheriting any existing data on this device
  if (typeof CloudSync !== 'undefined' && CloudSync.enabled) {
    await CloudSync.pushFresh(u, newUser, s);
  }

  if (btn) { btn.disabled = false; btn.textContent = 'Registrarse'; }
  err.textContent = '';
  showToast('Cuenta creada. Inicia sesión ✓');
  toggleAuthMode('login');
}

function logout() {
  if (typeof CloudSync !== 'undefined') CloudSync.clearUser();
  localStorage.removeItem('lum_session');
  currentUser = null;
  isAdminSession = false;
  destroyCharts();
  showLoginScreen();
  toggleAuthMode('login');
}

function setLoginTheme(palette) {
  localStorage.setItem('lum_loginTheme', palette);
  showToast('Tema de login actualizado ✓');
  renderAdminPage();
}

function toggleAuthMode(mode) {
  document.getElementById('loginForm').classList.toggle('hidden', mode !== 'login');
  document.getElementById('registerForm').classList.toggle('hidden', mode !== 'register');
  document.getElementById('adminLoginForm').classList.toggle('hidden', mode !== 'admin');
  ['loginError','registerError','adminLoginError'].forEach(id => {
    const el = document.getElementById(id); if (el) el.textContent = '';
  });
}

// ─── ADMIN PANEL ────────────────────────────
function cleanupTrash() {
  const week = 7 * 24 * 60 * 60 * 1000;
  const trash = DB.get('trash');
  const clean = trash.filter(t => Date.now() - t.deletedAt < week);
  if (clean.length !== trash.length) DB.set('trash', clean);
}

function renderAdminPage() {
  cleanupTrash();
  const users = DB.get('users');
  const trash = DB.get('trash');
  const week = 7 * 24 * 60 * 60 * 1000;

  const usersHtml = users.length === 0
    ? '<p class="empty-state">No hay cuentas registradas.</p>'
    : users.map(u => `
      <div class="admin-user-row">
        <div class="admin-user-info">
          <span class="admin-user-name">${u.username}</span>
          <span class="admin-user-store">${u.storeName || '—'}</span>
        </div>
        <div class="admin-user-actions">
          <button class="btn-secondary btn-sm" onclick="openChangePassword('${u.id}','${u.username}')">Contraseña</button>
          <button class="btn-danger btn-sm" onclick="adminDeleteUser('${u.id}')">Eliminar</button>
        </div>
      </div>`).join('');

  const trashHtml = trash.length === 0
    ? '<p class="empty-state">La papelera está vacía.</p>'
    : trash.map(t => {
        const daysLeft = Math.max(1, Math.ceil((week - (Date.now() - t.deletedAt)) / (24 * 60 * 60 * 1000)));
        return `
        <div class="admin-user-row admin-trash-row">
          <div class="admin-user-info">
            <span class="admin-user-name" style="opacity:0.55">${t.user.username}</span>
            <span class="admin-user-store" style="color:#e0a870">Se borra en ${daysLeft} día${daysLeft !== 1 ? 's' : ''}</span>
          </div>
          <div class="admin-user-actions">
            <button class="btn-secondary btn-sm" onclick="adminRestoreUser('${t.user.id}')">Restaurar</button>
          </div>
        </div>`;
      }).join('');

  const currentLoginTheme = localStorage.getItem('lum_loginTheme') || 'black';
  const loginThemes = [
    { id: 'black',    label: 'Negra',      colors: ['#080808','#141414','#d4a97a','#f2f2f2'] },
    { id: 'cream',    label: 'Crema',      colors: ['#dfc898','#f0e0c0','#c47a3a','#2a1005'] },
    { id: 'bluegray', label: 'Azul Gris',  colors: ['#9ab0c8','#bcd0e4','#4a7eb8','#0d1e30'] },
    { id: 'white',    label: 'Gris Neutro',colors: ['#b8b8b8','#d4d4d4','#5a6a7a','#181818'] },
    { id: 'agua',     label: 'Agua',       colors: ['#030810','#0c2040','#38bdf8','#ffffff'] },
    { id: 'cristal',  label: 'Cristal',    colors: ['#cce4f8','#eaf4ff','#0284c7','#0d1f3c'] },
    { id: 'perla',    label: 'Perla',      colors: ['#eef1f6','#ffffff','#9ca3af','#111827'] },
  ];
  const themePickerHtml = loginThemes.map(t => `
    <button class="palette-card ${t.id === currentLoginTheme ? 'active' : ''}" onclick="setLoginTheme('${t.id}')">
      <div class="palette-preview">${t.colors.map(c => `<span style="background:${c}"></span>`).join('')}</div>
      <div class="palette-label">${t.label}</div>
    </button>`).join('');

  document.getElementById('adminContent').innerHTML = `
    <div class="admin-section">
      <h3 class="admin-section-title">Cuentas activas</h3>
      <div class="admin-user-list">${usersHtml}</div>
    </div>
    <div class="admin-section">
      <h3 class="admin-section-title">Papelera <span class="admin-section-sub">se borran a los 7 días</span></h3>
      <div class="admin-user-list">${trashHtml}</div>
    </div>
    <div class="admin-section">
      <h3 class="admin-section-title">Tema de pantalla de login</h3>
      <p class="admin-section-sub" style="margin:0 0 1rem;display:block">Se aplica a todos al acceder.</p>
      <div class="palette-picker">${themePickerHtml}</div>
    </div>`;
}

function adminDeleteUser(userId) {
  const users = DB.get('users');
  const user = users.find(u => u.id === userId);
  if (!user) return;
  confirm2('¿Mover a papelera?', `La cuenta "${user.username}" quedará 7 días antes de borrarse definitivamente.`, () => {
    DB.set('users', users.filter(u => u.id !== userId));
    const trash = DB.get('trash');
    trash.push({ user, deletedAt: Date.now() });
    DB.set('trash', trash);
    renderAdminPage();
    showToast('Cuenta movida a papelera');
  });
}

function adminRestoreUser(userId) {
  const trash = DB.get('trash');
  const item = trash.find(t => t.user.id === userId);
  if (!item) return;
  const users = DB.get('users');
  users.push(item.user);
  DB.set('users', users);
  DB.set('trash', trash.filter(t => t.user.id !== userId));
  renderAdminPage();
  showToast('Cuenta restaurada ✓');
}

function openChangePassword(userId, username) {
  _changePassTargetId = userId;
  document.getElementById('changePassUserLabel').textContent = `Usuario: ${username}`;
  document.getElementById('newPassInput').value = '';
  document.getElementById('newPassConfirm2').value = '';
  document.getElementById('changePassError').textContent = '';
  openModal('changePassModal');
}

function submitChangePassword() {
  const newPass = document.getElementById('newPassInput').value;
  const conf = document.getElementById('newPassConfirm2').value;
  const err = document.getElementById('changePassError');
  if (!newPass) { err.textContent = 'Ingresa una contraseña.'; return; }
  if (newPass.length < 4) { err.textContent = 'Mínimo 4 caracteres.'; return; }
  if (newPass !== conf) { err.textContent = 'Las contraseñas no coinciden.'; return; }
  const users = DB.get('users');
  const idx = users.findIndex(u => u.id === _changePassTargetId);
  if (idx === -1) { err.textContent = 'Usuario no encontrado.'; return; }
  users[idx].password = newPass;
  DB.set('users', users);
  closeModal('changePassModal');
  showToast('Contraseña actualizada ✓');
  _changePassTargetId = null;
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
  if (pageId === 'admin') renderAdminPage();
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

function _compressImage(dataUrl, maxPx, quality, cb) {
  const img = new Image();
  img.onload = () => {
    const ratio = Math.min(1, maxPx / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * ratio);
    canvas.height = Math.round(img.height * ratio);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    cb(canvas.toDataURL('image/jpeg', quality));
  };
  img.src = dataUrl;
}

function handleProductImage(e) {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > 15 * 1024 * 1024) {
    showToast('La imagen supera los 15 MB permitidos', true);
    e.target.value = '';
    return;
  }
  const reader = new FileReader();
  reader.onload = ev => {
    _compressImage(ev.target.result, 400, 0.75, compressed => {
      productImageB64 = compressed;
      const img = document.getElementById('prodImagePreview');
      img.src = productImageB64;
      img.classList.remove('hidden');
      document.getElementById('prodImagePlaceholder').classList.add('hidden');
    });
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
            <span class="product-price">${currency}${fmtN(p.price)}</span>
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
    <div class="detail-row"><span class="detail-label">Precio venta</span><span class="detail-val">${currency}${fmtN(p.price)}</span></div>
    <div class="detail-row"><span class="detail-label">Precio costo</span><span class="detail-val">${p.cost ? currency + fmtN(p.cost) : '—'}</span></div>
    <div class="detail-row"><span class="detail-label">Stock actual</span><span class="detail-val">${p.stock} unidades</span></div>
    <div class="detail-row"><span class="detail-label">Total vendido</span><span class="detail-val">${totalSold} unidades</span></div>
    <div class="detail-row"><span class="detail-label">Ingreso total</span><span class="detail-val">${currency}${fmtN(totalRevenue)}</span></div>
    <div class="detail-row"><span class="detail-label">Ganancia estimada</span><span class="detail-val" style="color:var(--accent)">${currency}${fmtN(profit)}</span></div>
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
            ? `<p class="client-debt">${currency}${fmtN(debt)}<br><small style="font-size:0.72rem;font-family:DM Sans">debe</small></p>`
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
    <div class="detail-row"><span class="detail-label">Total comprado</span><span class="detail-val">${currency}${fmtN(totalSpent)}</span></div>
    <div class="detail-row"><span class="detail-label">Deuda total</span>
      <span class="detail-val" style="color:${totalDebt > 0 ? '#e07070' : 'var(--accent2)'}">
        ${totalDebt > 0 ? currency + fmtN(totalDebt) : 'Sin deudas ✓'}
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
        ? `<img src="${prod.image}" class="cd-item-img" alt="" />`
        : `<div class="cd-item-emoji">${categoryEmoji(prod ? prod.category : 'otro')}</div>`;
      return `<div class="cd-sale-item">
        ${imgEl}
        <div class="cd-sale-info">
          <span class="cd-sale-name">${item.productName}</span>
          <span class="cd-sale-detail">${item.qty} ud. · ${currency}${fmtN(item.unitPrice)} c/u</span>
        </div>
        <span class="cd-sale-sub" style="font-size:0.78rem;color:var(--text3)">${currency}${fmtN(item.total)}</span>
      </div>`;
    }).join('');
    return `<div class="cd-fiado-card">
      <div class="cd-fiado-header">
        <div>
          <span class="cd-fiado-date">${s.date}</span>
          <span style="font-size:0.72rem;color:var(--text3);display:block;margin-top:1px">Total venta: ${currency}${fmtN(s.total)}</span>
        </div>
        <div style="text-align:right">
          <span style="font-size:0.72rem;color:var(--text3);display:block">Saldo pendiente</span>
          <span class="cd-fiado-remaining">${currency}${fmtN(remaining)}</span>
        </div>
      </div>
      ${itemsHtml}
      <div class="cd-progress-wrap">
        <div class="cd-progress-track"><div class="cd-progress-fill" style="width:${pct}%"></div></div>
        <div class="cd-progress-labels">
          <span>Abonado: <b>${currency}${fmtN(paid)}</b></span>
          <span>${pct}%</span>
          <span class="cd-remaining">Pendiente: <b>${currency}${fmtN(remaining)}</b></span>
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
    ${pendingSales.length ? `
      <div class="cd-debt-total-banner">
        <span>Deuda total del cliente</span>
        <strong>${currency}${fmtN(totalDebt)}</strong>
      </div>
      <p style="font-size:0.78rem;color:var(--text3);margin-bottom:0.75rem">Toca una venta para registrar un pago o abono parcial</p>
    ` : ''}
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
      sub: isPending ? `Pendiente: ${currency}${fmtN(getSaleRemaining(s))}` : 'Pagado ✓',
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
          <span class="tl-amount ${e.type}">${e.type === 'pago' ? '+' : ''}${currency}${fmtN(e.amount)}</span>
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
      ? `<img src="${prod.image}" class="pm-item-img" alt="" />`
      : `<div class="pm-item-emoji">${categoryEmoji(prod ? prod.category : 'otro')}</div>`;
    const checkEl = showCheckboxes
      ? `<label class="pm-item-check" onclick="event.stopPropagation()"><input type="checkbox" checked value="${item.total.toFixed(2)}" onchange="updatePayFromChecked()" /></label>`
      : '';
    return `<div class="pm-item-row${showCheckboxes ? ' pm-selectable' : ''}" ${showCheckboxes ? 'onclick="togglePmItem(this)"' : ''}>
      ${checkEl}${imgEl}
      <div class="pm-item-info">
        <span class="pm-item-name">${item.productName}</span>
        <span class="pm-item-detail">${item.qty} ud. · ${currency}${fmtN(item.unitPrice)} c/u</span>
      </div>
      <span class="pm-item-total">${currency}${fmtN(item.total)}</span>
    </div>`;
  }).join('');

  const payHist = (sale.payments || []);
  const histHtml = payHist.length
    ? payHist.map(p => `<div class="pm-hist-item">
        <span class="pm-hist-date">${p.date}</span>
        ${p.note ? `<span class="pm-hist-note">${p.note}</span>` : ''}
        <span class="pm-hist-amount">${currency}${fmtN(p.amount)}</span>
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
        Saldar todo — ${currency}${fmtN(remaining)}
      </button>
    </div>` : `<div class="pm-done-banner">Deuda saldada completamente ✓</div>`;

  document.getElementById('paymentModalBody').innerHTML = `
    <div class="pm-items-list">${itemsHtml}</div>
    ${showCheckboxes ? `<p style="font-size:0.75rem;color:var(--text3);margin:-0.5rem 0 0.5rem">Toca un ítem para seleccionarlo o deseleccionarlo</p>
    <div id="pmSummary" class="pm-summary"></div>` : ''}

    <div class="pm-progress-section">
      <div class="pm-progress-track"><div class="pm-progress-fill" style="width:${pct}%"></div></div>
      <div class="pm-progress-labels">
        <span>Pagado: <strong>${currency}${fmtN(paid)}</strong></span>
        <span class="pm-pct">${pct}%</span>
        <span>Total: <strong>${currency}${fmtN(sale.total)}</strong></span>
      </div>
      ${remaining > 0.001
        ? `<p class="pm-remaining">Pendiente: <strong>${currency}${fmtN(remaining)}</strong></p>`
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
      <strong>${currency}${fmtN(sum)}</strong>
    </div>
    <div class="pm-summary-row pm-summary-remaining">
      <span>Quedará pendiente:</span>
      <strong>${currency}${fmtN(afterPay)}</strong>
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
    showToast(`Máximo a pagar: ${getCurrency()}${fmtN(remaining)}`, true);
    return;
  }

  const currency = getCurrency();
  const isFull = amount >= remaining - 0.001;
  const confirmMsg = isFull
    ? `¿Registrar pago completo de ${currency}${fmtN(amount)} y marcar la deuda como saldada?`
    : `¿Registrar abono de ${currency}${fmtN(amount)}? Quedará ${currency}${fmtN(remaining - amount)} pendiente.`;

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
  logAction('pagos', 'Pago registrado', `${getCurrency()}${fmtN(amount)}${note ? ' — ' + note : ''}`);
  showToast(`Pago de ${getCurrency()}${fmtN(amount)} registrado ✓`);

  renderClients();
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
        <span class="spr-price">${currency}${fmtN(p.price)}</span>
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
  totalEl.textContent = currency + fmtN(total);

  itemsEl.innerHTML = saleCart.map(item => `
    <div class="cart-item">
      <div class="cart-item-info">
        <span class="cart-item-name">${item.productName}</span>
        <span class="cart-item-sub">${currency}${fmtN(item.unitPrice)} c/u</span>
      </div>
      <div class="cart-item-controls">
        <input type="number" class="cart-qty-input" min="1" max="${item.maxStock}" value="${item.qty}"
               onchange="updateCartQty('${item.productId}', this.value)" />
        <span class="cart-item-total">${currency}${fmtN(item.unitPrice * item.qty)}</span>
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
  logAction('ventas', 'Registrada', `${saleLabel} — ${currency}${fmtN(total)}${fiado ? ' (fiado)' : ''}`);

  showToast(`Venta registrada — ${currency}${fmtN(total)}${fiado ? ' (fiado)' : ''} ✓`);

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
        <span class="s-amount">${currency}${fmtN(s.total)}</span><br>
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
  document.getElementById('statRevenue').textContent = currency + fmtN(sales.reduce((a, s) => a + s.total, 0));

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
          <span class="sale-amount">${currency}${fmtN(s.total)}</span>
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
      { label: 'Ingresos Totales', val: currency + fmtN(totalRevenue), accent: true },
      { label: 'Ganancia Estimada', val: currency + fmtN(totalProfit), accent: true },
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
        <span class="debt-amount">${currency}${fmtN(c.debt)}</span>
      </div>`).join('')
    : '<p style="color:var(--text3);font-size:0.85rem;padding:0.5rem 0">Sin deudas pendientes ✓</p>';
}

function destroyCharts() {
  [salesChartInst, topProductsChartInst, monthlyChartInst, categoryChartInst].forEach(c => { if (c) c.destroy(); });
  salesChartInst = topProductsChartInst = monthlyChartInst = categoryChartInst = null;
}

// ─── DATA EXPORT / IMPORT ───────────────────
function exportPDF() {
  if (!window.jspdf) { showToast('Librería PDF no cargada, intenta recargar la página', true); return; }
  const { jsPDF } = window.jspdf;

  const products = getProducts();
  const clients  = getClients();
  const sales    = DB.get('sales');
  const cfg      = getConfig();
  const cur      = cfg.currency || '$';
  const store    = cfg.storeName || 'LUMIÈRE';
  const now      = new Date();
  const today    = now.toLocaleDateString('es-ES', { day:'2-digit', month:'2-digit', year:'numeric' });
  const dateSlug = now.toISOString().slice(0,10);

  const totalRevenue = sales.reduce((a, s) => a + (s.total || 0), 0);
  const totalPaid    = sales.reduce((a, s) => a + (s.total || 0) - getSaleRemaining(s), 0);
  const totalDebt    = clients.reduce((a, c) =>
    a + sales.filter(s => s.clientId === c.id).reduce((b, s) => b + getSaleRemaining(s), 0), 0);

  const doc = new jsPDF('p', 'mm', 'a4');
  const W = doc.internal.pageSize.getWidth();
  const DARK = [24, 33, 58];
  const ACCENT = [42, 58, 106];
  const LIGHT = [240, 244, 255];
  const MUTED = [136, 150, 176];

  let y = 0;

  // ── Header bar ──────────────────────────────────────────────────
  doc.setFillColor(...DARK);
  doc.rect(0, 0, W, 28, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(255, 255, 255);
  doc.text(store.toUpperCase(), 14, 12);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(...MUTED);
  doc.text('REPORTE GENERAL DEL SISTEMA', 14, 18);
  doc.setFontSize(8);
  doc.setTextColor(200, 210, 240);
  doc.text(`Generado el ${today}`, W - 14, 12, { align: 'right' });
  doc.text('LUMIÈRE Sistema de Gestión', W - 14, 18, { align: 'right' });
  y = 36;

  // ── Summary cards (4 boxes) ──────────────────────────────────────
  const cards = [
    { icon: 'Productos', val: products.length, sub: 'registrados' },
    { icon: 'Clientes',  val: clients.length,  sub: 'registrados' },
    { icon: 'Ventas',    val: sales.length,     sub: 'realizadas'  },
    { icon: 'Deuda',     val: cur + totalDebt.toFixed(2), sub: 'pendiente', dark: true },
  ];
  const cw = (W - 28 - 9) / 4;
  cards.forEach((card, i) => {
    const cx = 14 + i * (cw + 3);
    if (card.dark) {
      doc.setFillColor(...DARK);
    } else {
      doc.setFillColor(...LIGHT);
    }
    doc.roundedRect(cx, y, cw, 22, 3, 3, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.setTextColor(card.dark ? 255 : DARK[0], card.dark ? 208 : DARK[1], card.dark ? 128 : DARK[2]);
    doc.text(String(card.val), cx + cw / 2, y + 11, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(...MUTED);
    doc.text(card.icon.toUpperCase(), cx + cw / 2, y + 16, { align: 'center' });
    doc.setTextColor(card.dark ? 180 : 160, card.dark ? 200 : 170, card.dark ? 240 : 200);
    doc.text(card.sub, cx + cw / 2, y + 20, { align: 'center' });
  });
  y += 30;

  // ── Section heading helper ───────────────────────────────────────
  function sectionHead(title) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...DARK);
    doc.text(title.toUpperCase(), 14, y);
    doc.setDrawColor(192, 202, 224);
    doc.setLineWidth(0.3);
    const tw = doc.getTextWidth(title.toUpperCase()) + 4;
    doc.line(14 + tw, y - 0.5, W - 14, y - 0.5);
    y += 5;
  }

  // ── Products table ───────────────────────────────────────────────
  sectionHead('Productos');
  doc.autoTable({
    startY: y,
    head: [['Nombre', 'Categoría', 'Precio', 'Costo', 'Stock']],
    body: products.length
      ? products.map(p => [
          p.name,
          p.category || '—',
          cur + p.price.toLocaleString(),
          p.cost ? cur + p.cost : '—',
          String(p.stock),
        ])
      : [['Sin productos registrados', '', '', '', '']],
    headStyles: { fillColor: DARK, textColor: [255,255,255], fontSize: 7, fontStyle: 'bold' },
    bodyStyles: { fontSize: 8, textColor: [42, 52, 80] },
    alternateRowStyles: { fillColor: [245, 247, 255] },
    columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'center' } },
    margin: { left: 14, right: 14 },
    tableLineColor: [234, 238, 248],
    tableLineWidth: 0.1,
  });
  y = doc.lastAutoTable.finalY + 10;

  // ── Clients table ────────────────────────────────────────────────
  sectionHead('Clientes');
  doc.autoTable({
    startY: y,
    head: [['Cliente', 'Compras', 'Deuda']],
    body: clients.length
      ? clients.map(c => {
          const cs = sales.filter(s => s.clientId === c.id);
          const debt = cs.reduce((a, s) => a + getSaleRemaining(s), 0);
          return [c.name, String(cs.length), debt > 0.01 ? cur + debt.toFixed(2) : 'Sin deuda'];
        })
      : [['Sin clientes registrados', '', '']],
    headStyles: { fillColor: DARK, textColor: [255,255,255], fontSize: 7, fontStyle: 'bold' },
    bodyStyles: { fontSize: 8, textColor: [42, 52, 80] },
    alternateRowStyles: { fillColor: [245, 247, 255] },
    columnStyles: { 1: { halign: 'center' }, 2: { halign: 'right' } },
    margin: { left: 14, right: 14 },
    tableLineColor: [234, 238, 248],
    tableLineWidth: 0.1,
  });
  y = doc.lastAutoTable.finalY + 10;

  // ── Sales table ──────────────────────────────────────────────────
  sectionHead('Historial de Ventas');
  doc.autoTable({
    startY: y,
    head: [['Fecha', 'Cliente', 'Productos', 'Total', 'Estado']],
    body: sales.length
      ? sales.slice().reverse().map(s => {
          const c = clients.find(x => x.id === s.clientId);
          const items = getSaleItems(s);
          const paid = getSaleRemaining(s) < 0.01;
          return [
            s.date,
            c ? c.name : (s.clientName || 'Sin cliente'),
            items.map(i => i.productName + (i.qty > 1 ? ' x' + i.qty : '')).join(', '),
            cur + (s.total || 0).toLocaleString(),
            paid ? 'Pagado' : 'Pendiente',
          ];
        })
      : [['Sin ventas registradas', '', '', '', '']],
    headStyles: { fillColor: DARK, textColor: [255,255,255], fontSize: 7, fontStyle: 'bold' },
    bodyStyles: { fontSize: 7.5, textColor: [42, 52, 80] },
    alternateRowStyles: { fillColor: [245, 247, 255] },
    columnStyles: { 3: { halign: 'right' }, 4: { halign: 'center' } },
    didDrawCell(data) {
      if (data.section === 'body' && data.column.index === 4) {
        const val = data.cell.raw;
        const { x, y: cy, width, height } = data.cell;
        if (val === 'Pagado') {
          doc.setFillColor(209, 250, 229);
          doc.setTextColor(6, 95, 70);
        } else {
          doc.setFillColor(254, 243, 199);
          doc.setTextColor(146, 64, 14);
        }
        doc.roundedRect(x + 1, cy + 1.5, width - 2, height - 3, 2, 2, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(6.5);
        doc.text(val, x + width / 2, cy + height / 2 + 1, { align: 'center' });
      }
    },
    margin: { left: 14, right: 14 },
    tableLineColor: [234, 238, 248],
    tableLineWidth: 0.1,
  });
  y = doc.lastAutoTable.finalY + 10;

  // ── Observations ─────────────────────────────────────────────────
  const debtClients = clients.filter(c =>
    sales.filter(s => s.clientId === c.id).some(s => getSaleRemaining(s) > 0.01));
  const lowStock = products.filter(p => p.stock <= getLowStockThreshold());
  const obsList = [];
  debtClients.forEach(c => {
    const d = sales.filter(s => s.clientId === c.id).reduce((a, s) => a + getSaleRemaining(s), 0);
    obsList.push(`${c.name} — deuda pendiente: ${cur}${d.toFixed(2)}`);
  });
  lowStock.forEach(p => {
    obsList.push(`Stock bajo: ${p.name} — quedan ${p.stock} unidad${p.stock !== 1 ? 'es' : ''}`);
  });
  if (!obsList.length) obsList.push('Sin observaciones. Todo está en orden.');

  if (y > 260) { doc.addPage(); y = 16; }
  sectionHead('Observaciones');
  doc.setFillColor(245, 247, 255);
  doc.setDrawColor(...DARK);
  const obsH = obsList.length * 6 + 8;
  doc.roundedRect(14, y, W - 28, obsH, 2, 2, 'F');
  doc.setLineWidth(0.8);
  doc.setDrawColor(...DARK);
  doc.line(14, y, 14, y + obsH);
  doc.setLineWidth(0.1);
  obsList.forEach((line, i) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(42, 52, 80);
    doc.text('› ' + line, 20, y + 6 + i * 6);
  });
  y += obsH + 10;

  // ── Footer on every page ─────────────────────────────────────────
  const pageCount = doc.internal.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    const fy = doc.internal.pageSize.getHeight() - 8;
    doc.setDrawColor(224, 229, 240);
    doc.setLineWidth(0.3);
    doc.line(14, fy - 2, W - 14, fy - 2);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...MUTED);
    doc.text(`${store} — Reporte generado el ${today}`, 14, fy + 2);
    doc.text(`Página ${p} de ${pageCount}`, W - 14, fy + 2, { align: 'right' });
  }

  const safeName = store.replace(/[^a-zA-Z0-9]/g, '-');
  doc.save(`Reporte-${safeName}-${dateSlug}.pdf`);
  showToast('PDF descargado correctamente');
}

function exportDetailedReport() {
  const products = getProducts();
  const clients  = getClients();
  const sales    = DB.get('sales');
  const cfg      = getConfig();
  const cur      = cfg.currency || '$';

  const productsReport = products.map(p => ({
    nombre: p.name,
    categoria: p.category || '—',
    precio: cur + p.price,
    costo: cur + (p.cost || 0),
    stock: p.stock,
    descripcion: p.description || '',
  }));

  const clientsReport = clients.map(c => {
    const clientSales = sales.filter(s => s.clientId === c.id);
    const deudas = clientSales
      .filter(s => getSaleRemaining(s) > 0.001)
      .map(s => {
        const items = getSaleItems(s);
        return {
          fecha: s.date,
          productos: items.map(i => `${i.productName} x${i.qty}`).join(', '),
          total: cur + s.total,
          pagado: cur + getSaleAmountPaid(s),
          pendiente: cur + getSaleRemaining(s).toFixed(2),
          pagos: (s.payments || []).map(pay => `${pay.date}: ${cur}${pay.amount}`).join(' | ') || '—',
        };
      });
    return {
      nombre: c.name,
      telefono: c.phone || '—',
      email: c.email || '—',
      deudas_pendientes: deudas,
      total_adeudado: cur + clientSales.reduce((a, s) => a + getSaleRemaining(s), 0).toFixed(2),
      total_compras: clientSales.length,
    };
  });

  const salesReport = sales.map(s => {
    const items = getSaleItems(s);
    const client = clients.find(c => c.id === s.clientId);
    return {
      fecha: s.date,
      cliente: client ? client.name : (s.clientName || 'Sin cliente'),
      productos: items.map(i => `${i.productName} x${i.qty} @ ${cur}${i.unitPrice}`).join('; '),
      total: cur + s.total,
      pagado: cur + getSaleAmountPaid(s),
      pendiente: cur + getSaleRemaining(s).toFixed(2),
      estado: getSaleRemaining(s) < 0.01 ? 'Pagado' : 'Pendiente',
    };
  });

  const report = {
    generado: new Date().toLocaleString(),
    tienda: cfg.storeName || 'LUMIÈRE',
    moneda: cur,
    resumen: {
      total_productos: products.length,
      total_clientes: clients.length,
      total_ventas: sales.length,
      deuda_total: cur + clients.reduce((a, c) => {
        return a + sales.filter(s => s.clientId === c.id).reduce((b, s) => b + getSaleRemaining(s), 0);
      }, 0).toFixed(2),
    },
    productos: productsReport,
    clientes: clientsReport,
    ventas: salesReport,
  };

  const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `lumiere-reporte-${todayStr()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Reporte exportado ✓');
}

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
