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
let _presenceInterval = null;

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
  // lum_pal sobrevive a CloudSync.pull() — tiene prioridad sobre el config sincronizado.
  // Si no existe aún (primera carga tras la actualización), lo inicializa desde config.
  if (!localStorage.getItem('lum_pal') && cfg.palette) {
    localStorage.setItem('lum_pal', cfg.palette);
  }
  const palette = localStorage.getItem('lum_pal') || cfg.palette || 'black';
  document.documentElement.setAttribute('data-palette', palette);
  document.documentElement.setAttribute('data-font', cfg.fontFamily || 'moderno');
  document.documentElement.setAttribute('data-fontsize', cfg.fontSize || 'medium');
  if (cfg.accent) applyAccentVars(cfg.accent, cfg.accentDark);
  document.documentElement.setAttribute('data-fontweight', cfg.fontWeight || 'normal');
  applyCustomAppearance();
  applyVideoBg(palette);
  applyAdminTheme();
  applyAdminLayout();
  applyAdminBg();
  applyLayout();
  renderRightSidebar();
}

function getConfig() { return DB.getObj('config', { palette: 'black', fontFamily: 'moderno', fontSize: 'medium', storeName: 'LUMIÈRE', currency: '$', lowStock: 5 }); }

function saveSettings() {
  const cfg = getConfig();
  cfg.storeName = document.getElementById('settingStoreName').value || cfg.storeName;
  cfg.currency  = document.getElementById('settingCurrency').value;
  cfg.lowStock  = parseInt(document.getElementById('settingLowStock').value) || 5;
  DB.set('config', cfg);
  // Guardar moneda por separado para que CloudSync.pull() no la borre
  localStorage.setItem('lum_cur', cfg.currency);
  document.getElementById('sidebarBrand').textContent = cfg.storeName;
  if (typeof CloudSync !== 'undefined' && CloudSync.enabled) CloudSync.schedulePush();
  showToast('Configuración guardada ✓');
}

function setPalette(name) {
  document.documentElement.setAttribute('data-palette', name);
  const cfg = getConfig();
  cfg.palette = name;
  delete cfg.accent;
  delete cfg.accentDark;
  DB.set('config', cfg);
  // Guardar por separado igual que la moneda — sobrevive a CloudSync.pull()
  localStorage.setItem('lum_pal', name);
  document.querySelectorAll('.palette-card').forEach(c => {
    c.classList.toggle('active', c.dataset.pal === name);
  });
  // Sincronizar cambio a Firestore para que future pulls traigan el valor correcto
  if (typeof CloudSync !== 'undefined' && CloudSync.enabled) CloudSync.schedulePush();
  applyVideoBg(name);
}

// ─── VIDEO DE FONDO (paleta "Lluvia") — almacenado localmente en IndexedDB ───
// El usuario sube el video desde su dispositivo. Se guarda en el navegador
// usando IndexedDB (sin Firebase, sin consumo de base de datos).

let _bgBlobURL = null; // URL temporal del blob actual

function _openVidDB() {
  return new Promise((res, rej) => {
    const req = indexedDB.open('lum_vidstore', 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore('vids');
    req.onsuccess = e => res(e.target.result);
    req.onerror = e => rej(e.target.error);
  });
}
async function _saveVidBlob(blob) {
  const db = await _openVidDB();
  return new Promise((res, rej) => {
    const tx = db.transaction('vids', 'readwrite');
    tx.objectStore('vids').put(blob, 'bg');
    tx.oncomplete = res; tx.onerror = rej;
  });
}
async function _getVidBlob() {
  try {
    const db = await _openVidDB();
    return new Promise(res => {
      const req = db.transaction('vids', 'readonly').objectStore('vids').get('bg');
      req.onsuccess = e => res(e.target.result || null);
      req.onerror = () => res(null);
    });
  } catch { return null; }
}
async function _delVidBlob() {
  const db = await _openVidDB();
  return new Promise(res => {
    const tx = db.transaction('vids', 'readwrite');
    tx.objectStore('vids').delete('bg');
    tx.oncomplete = res; tx.onerror = res;
  });
}

async function applyVideoBg(palette) {
  const inAdminMode = document.body.hasAttribute('data-admin-mode');

  if (inAdminMode) {
    // Admin: cada plantilla tiene su propio video en lum_adminvid2
    await applyAdminThemeVideo();
    return;
  }

  // Usuario normal: video solo cuando paleta activa = lavanda (lum_vidstore)
  const wrap  = document.getElementById('bgVideoWrap');
  const video = document.getElementById('bgVideo');
  const src   = document.getElementById('bgVideoSrc');
  if (!wrap || !video || !src) return;

  const pal = palette || localStorage.getItem('lum_pal') || getConfig().palette || 'black';
  if (pal !== 'lavanda') {
    wrap.classList.add('hidden');
    video.pause();
    return;
  }

  const blob = await _getVidBlob();
  if (!blob) { wrap.classList.add('hidden'); return; }

  if (_bgBlobURL) URL.revokeObjectURL(_bgBlobURL);
  _bgBlobURL = URL.createObjectURL(blob);
  wrap.classList.remove('hidden');
  src.setAttribute('src', _bgBlobURL);
  video.load();
  video.play().catch(() => {});
}

async function handleVideoUpload(file) {
  if (!file || !file.type.startsWith('video/')) {
    showToast('Selecciona un archivo de video válido', true); return;
  }
  showToast('Guardando video en el navegador…');
  await _saveVidBlob(file);
  await applyVideoBg();
  await renderVideoPicker();
  showToast('Video de fondo listo ✓');
}

async function removeVideoBg() {
  if (_bgBlobURL) { URL.revokeObjectURL(_bgBlobURL); _bgBlobURL = null; }
  await _delVidBlob();
  const wrap  = document.getElementById('bgVideoWrap');
  const video = document.getElementById('bgVideo');
  if (wrap) wrap.classList.add('hidden');
  if (video) video.pause();
  await renderVideoPicker();
  showToast('Video de fondo eliminado');
}

async function renderVideoPicker(containerId = 'videoPicker') {
  const picker = document.getElementById(containerId);
  if (!picker) return;
  const blob = await _getVidBlob();

  if (blob) {
    const previewURL = _bgBlobURL || URL.createObjectURL(blob);
    picker.innerHTML = `
      <div style="display:flex;align-items:center;gap:0.85rem;flex-wrap:wrap">
        <video src="${previewURL}" muted preload="metadata" playsinline
               style="height:72px;width:124px;border-radius:8px;object-fit:cover;border:2px solid var(--accent)"></video>
        <div>
          <p style="font-size:0.82rem;color:var(--text);margin-bottom:0.45rem;font-weight:500">Video cargado ✓</p>
          <button class="btn-secondary btn-sm" onclick="document.getElementById('videoBgInput').click()">Cambiar</button>
          <button class="btn-danger btn-sm" style="margin-left:0.4rem" onclick="removeVideoBg()">Quitar</button>
        </div>
      </div>`;
  } else {
    picker.innerHTML = `
      <button class="btn-secondary" onclick="document.getElementById('videoBgInput').click()">
        📁 Subir video desde mi dispositivo
      </button>
      <p style="font-size:0.76rem;color:var(--text3);margin-top:0.5rem">
        MP4, WebM, MOV — se guarda en este navegador, sin consumir Firebase.
      </p>`;
  }
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

function getCurrency() {
  // lum_cur se guarda aparte para sobrevivir CloudSync.pull()
  return localStorage.getItem('lum_cur') || getConfig().currency || '$';
}
function getLowStockThreshold() { return getConfig().lowStock || 5; }

// Format a monetary amount — always rounds to whole number, no cents
function fmtN(n) {
  return Math.round(parseFloat(n) || 0).toLocaleString();
}

// ─── AUTH ───────────────────────────────────
// ─── GLOBAL REGISTRY (accounts list + login theme, shared across all devices) ──
async function _pullRegistry() {
  if (typeof CloudSync === 'undefined' || !CloudSync.enabled) return null;
  try {
    const db = firebase.firestore();
    const snap = await db.collection('stores').doc('_registry').get();
    return snap.exists ? snap.data() : null;
  } catch(e) { return null; }
}
async function _pushRegistry(updates) {
  if (typeof CloudSync === 'undefined' || !CloudSync.enabled) return;
  try {
    const db = firebase.firestore();
    await db.collection('stores').doc('_registry').set(updates, { merge: true });
  } catch(e) { console.warn('[Registry]', e.message); }
}

// Usa update() con dot-notation para escribir lastSeen.username como campo anidado
// set() con merge:true NO interpreta la clave 'a.b' como campo anidado, solo update() lo hace
async function _updateLastSeen(username) {
  if (typeof CloudSync === 'undefined' || !CloudSync.enabled) return;
  try {
    const db = firebase.firestore();
    await db.collection('stores').doc('_registry').update({
      [`lastSeen.${username}`]: Date.now()
    });
  } catch(e) {
    // El documento puede no existir todavía — fallback con set+merge en objeto anidado
    await _pushRegistry({ lastSeen: { [username]: Date.now() } });
  }
}

function _startPresenceHeartbeat(username) {
  _stopPresenceHeartbeat();
  // Actualiza lastSeen cada 2 minutos para mantener el punto verde activo
  _presenceInterval = setInterval(() => _updateLastSeen(username), 120000);
}

function _stopPresenceHeartbeat() {
  if (_presenceInterval) { clearInterval(_presenceInterval); _presenceInterval = null; }
}

let _adminAccounts = null; // cache for admin panel account list

async function checkAutoLogin() {
  // Always pull registry first to get latest login theme (before any login screen shows)
  const reg = await _pullRegistry();
  if (reg?.loginTheme) {
    const cfg = DB.getObj('config', {});
    cfg.loginTheme = reg.loginTheme;
    localStorage.setItem('lum_config', JSON.stringify(cfg));
    localStorage.setItem('lum_loginTheme', reg.loginTheme);
  }

  const saved = localStorage.getItem('lum_session');
  if (saved) {
    try {
      const s = JSON.parse(saved);
      // Admin session restore
      if (s.isAdmin && s.username === ADMIN_CREDS.username && s.password === ADMIN_CREDS.password) {
        isAdminSession = true;
        if (typeof CloudSync !== 'undefined' && CloudSync.enabled) {
          const sub = document.querySelector('.login-logo p');
          if (sub) sub.textContent = 'Sincronizando datos…';
          await CloudSync.pull(ADMIN_CREDS.username);
          if (sub) sub.textContent = 'Sistema de Gestión';
        }
        loginSuccess({ username: s.username, storeName: 'Administrador', isAdmin: true });
        return;
      }
      // Staff session restore — pull from their own document
      if (typeof CloudSync !== 'undefined' && CloudSync.enabled) {
        const sub = document.querySelector('.login-logo p');
        if (sub) sub.textContent = 'Sincronizando datos…';
        await CloudSync.pull(s.username);
        if (sub) sub.textContent = 'Sistema de Gestión';
      }
      // Limpiar preferencias locales para que Firestore tenga prioridad
      localStorage.removeItem('lum_pal');
      localStorage.removeItem('lum_layout');
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
  localStorage.removeItem('lum_pal'); // limpiar para que Firestore tome prioridad
  if (typeof CloudSync !== 'undefined' && CloudSync.enabled) {
    await CloudSync.pull(ADMIN_CREDS.username);
  }
  loginSuccess({ username: u, storeName: 'Administrador', isAdmin: true });
}

function showLoginScreen() {
  const cfg = DB.getObj('config', {});
  const loginTheme = cfg.loginTheme || localStorage.getItem('lum_loginTheme') || 'black';
  document.documentElement.setAttribute('data-palette', loginTheme);
  document.body.removeAttribute('data-admin-mode');
  document.getElementById('loginScreen').classList.remove('hidden');
  document.getElementById('appMain').classList.add('hidden');
}

async function loginSuccess(user) {
  currentUser = user;
  cleanupTrash();
  if (user.isAdmin) {
    document.body.setAttribute('data-admin-mode', 'true');
  } else {
    document.body.removeAttribute('data-admin-mode');
  }
  if (typeof CloudSync !== 'undefined') {
    CloudSync.setUser(user.isAdmin ? ADMIN_CREDS.username : user.username);
    CloudSync.showInitialStatus();
    if (!user.isAdmin) CloudSync.push();
  }
  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('appMain').classList.remove('hidden');
  document.getElementById('topbarUser').textContent = user.username;
  const cfg = getConfig();
  document.getElementById('sidebarBrand').textContent = user.isAdmin ? '⚙ Admin' : (user.storeName || cfg.storeName || 'LUMIÈRE');
  document.querySelectorAll('.nav-admin-item').forEach(el => el.classList.toggle('hidden', !user.isAdmin));
  navigateTo(user.isAdmin ? 'admin' : 'dashboard');
  if (!user.isAdmin) {
    const _cfg = DB.getObj('config', {});
    // Solo escribir lum_pal si NO hay ya un valor del usuario en esta sesión.
    // Si ya está puesto (el usuario cambió paleta y recargó antes de que el push
    // terminara), respetamos esa selección en vez de pisar con el valor de Firestore.
    if (!localStorage.getItem('lum_pal')) {
      localStorage.setItem('lum_pal', _cfg.palette || 'black');
    }
    if (!localStorage.getItem('lum_layout')) {
      localStorage.setItem('lum_layout', _cfg.layout || 'default');
    }
    loadSettingsPage();
    refreshNavLabels();
    _updateLastSeen(user.username);
    _startPresenceHeartbeat(user.username);
    // Listener en tiempo real: actualiza UI cuando otro dispositivo hace cambios
    if (typeof CloudSync !== 'undefined') {
      CloudSync.startListener(() => {
        applySettings();
        const activePage = document.querySelector('.page.active');
        if (activePage) navigateTo(activePage.id.replace('page-', ''));
        showToast('↻ Datos actualizados desde otro dispositivo');
      });
    }
    // Pequeño retraso para que la app termine de cargar antes de mostrar el anuncio
    setTimeout(() => _checkAndShowAnnouncement(), 1200);
  } else {
    // Admin: solo inicializar lum_pal si no hay valor previo en esta sesión
    if (!localStorage.getItem('lum_pal')) {
      const adminTheme = localStorage.getItem('lum_adminTheme') || 'default';
      const adminPal   = (DB.getObj('config', {})).palette || 'black';
      localStorage.setItem('lum_pal', adminTheme === 'lluvia' ? 'lavanda' : adminPal);
    }
  }
  applySettings();
}

async function handleLogin() {
  const u = document.getElementById('loginUser').value.trim();
  const p = document.getElementById('loginPass').value;
  const err = document.getElementById('loginError');
  if (!u || !p) { err.textContent = 'Completa todos los campos.'; return; }

  const btn = document.querySelector('#loginForm .btn-primary');
  if (btn) { btn.disabled = true; btn.textContent = 'Verificando…'; }

  // Pull desde Firestore antes de verificar — trae datos actualizados de otros dispositivos
  if (typeof CloudSync !== 'undefined') await CloudSync.pull(u);

  const users = DB.get('users');
  const user = users.find(x => x.username === u && x.password === p);

  if (btn) { btn.disabled = false; btn.textContent = 'Entrar'; }

  if (!user) { err.textContent = 'Usuario o contraseña incorrectos.'; return; }

  // Login explícito: limpiar lum_pal para que se aplique la paleta guardada en Firestore
  // Esto garantiza que los cambios de otro dispositivo se sincronicen
  localStorage.removeItem('lum_pal');
  localStorage.removeItem('lum_layout');

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

  // Check registry for duplicate usernames across all accounts
  const reg = await _pullRegistry();
  const regAccounts = reg?.accounts || [];
  if (regAccounts.find(a => a.username === u)) {
    if (btn) { btn.disabled = false; btn.textContent = 'Registrarse'; }
    err.textContent = 'Ese usuario ya existe.';
    return;
  }

  const newUser = { id: uid(), username: u, password: p, storeName: s };

  // Create own Firestore document with empty store data
  if (typeof CloudSync !== 'undefined' && CloudSync.enabled) {
    await CloudSync.pushFresh(u, newUser, s);
  } else {
    // Offline fallback: save locally
    const users = DB.get('users');
    users.push(newUser);
    DB.set('users', users);
  }

  // Add account to global registry so admin can see it
  await _pushRegistry({
    accounts: [...regAccounts, { id: newUser.id, username: u, storeName: s }]
  });

  if (btn) { btn.disabled = false; btn.textContent = 'Registrarse'; }
  err.textContent = '';
  showToast('Cuenta creada. Inicia sesión ✓');
  toggleAuthMode('login');
}

function logout() {
  _stopPresenceHeartbeat();
  if (typeof CloudSync !== 'undefined') CloudSync.clearUser();
  localStorage.removeItem('lum_session');
  localStorage.removeItem('lum_pal');
  localStorage.removeItem('lum_layout');
  localStorage.removeItem('lum_seenAnn'); // legado, por si existe
  currentUser = null;
  isAdminSession = false;
  _adminAccounts = null;
  destroyCharts();
  showLoginScreen();
  toggleAuthMode('login');
}

async function setLoginTheme(palette) {
  localStorage.setItem('lum_loginTheme', palette);
  const cfg = getConfig();
  cfg.loginTheme = palette;
  localStorage.setItem('lum_config', JSON.stringify(cfg));
  // Write to global registry so ALL devices see the new login theme
  await _pushRegistry({ loginTheme: palette });
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

async function renderAdminPage() {
  cleanupTrash();

  // Si aún no tenemos la lista del registro, la traemos primero
  if (_adminAccounts === null) {
    document.getElementById('adminContent').innerHTML =
      '<p style="padding:1rem;color:var(--text3)">Cargando cuentas… ↻</p>';
    await adminSyncUsers(); // ya llama a renderAdminPage() al terminar
    return;
  }

  const users  = _adminAccounts;
  const trash  = DB.get('trash');
  const week   = 7 * 24 * 60 * 60 * 1000;
  // lastSeen viene del registro global
  const reg    = await _pullRegistry();
  const lastSeenMap = reg?.lastSeen || {};

  function fmtLastSeen(username) {
    const ts = lastSeenMap[username];
    if (!ts) return { label: 'No conectado', when: 'Sin registros de acceso', dot: 'dot-offline' };

    const diff   = Date.now() - ts;
    const mins   = Math.floor(diff / 60000);
    const hrs    = Math.floor(diff / 3600000);
    const days   = Math.floor(diff / 86400000);
    const weeks  = Math.floor(diff / 604800000);
    const months = Math.floor(diff / 2592000000);

    if (diff < 180000)      return { label: 'En línea',            when: 'Ahora mismo',                          dot: 'dot-online'  };
    if (diff < 900000)      return { label: 'Desconectado',        when: `Hace ${mins} minuto${mins!==1?'s':''}`, dot: 'dot-recent'  };
    if (diff < 86400000)    return { label: 'Desconectado',        when: `Hace ${hrs} hora${hrs!==1?'s':''}`,    dot: 'dot-idle'    };
    if (diff < 172800000)   return { label: 'Desconectado',        when: 'Ayer',                                 dot: 'dot-idle'    };
    if (diff < 604800000)   return { label: 'Inactivo',            when: `Hace ${days} día${days!==1?'s':''}`,   dot: 'dot-offline' };
    if (diff < 2592000000)  return { label: 'Inactivo',            when: `Hace ${weeks} semana${weeks!==1?'s':''}`, dot: 'dot-offline' };
    if (diff < 31536000000) return { label: 'Sin actividad',       when: `Hace ${months} mes${months!==1?'es':''}`, dot: 'dot-offline'};
    return                         { label: 'Sin actividad',       when: 'Hace más de un año',                   dot: 'dot-offline' };
  }

  const usersHtml = users.length === 0
    ? '<p class="empty-state">No hay cuentas. Pulsa ↻ Actualizar o crea una.</p>'
    : users.map(u => {
        const seen = fmtLastSeen(u.username);
        return `
      <div class="admin-user-row">
        <div class="admin-user-info">
          <div style="display:flex;align-items:center;gap:0.5rem">
            <span class="status-dot ${seen.dot}"></span>
            <span class="admin-user-name">${u.username}</span>
          </div>
          <span class="admin-user-store">${u.storeName || '—'}</span>
          <span class="admin-last-seen">${seen.label}</span>
          <span class="admin-last-seen-when">🕐 ${seen.when}</span>
        </div>
        <div class="admin-user-actions">
          <button class="btn-secondary btn-sm" onclick="adminViewPassword('${u.username}')">👁</button>
          <button class="btn-secondary btn-sm" onclick="openChangePassword('${u.id}','${u.username}')">Contraseña</button>
          <button class="btn-danger btn-sm" onclick="adminDeleteUser('${u.id}','${u.username}')">Eliminar</button>
        </div>
      </div>`;
      }).join('');

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

  const currentLoginTheme = DB.getObj('config', {}).loginTheme || localStorage.getItem('lum_loginTheme') || 'black';
  const loginThemes = [
    { id: 'black',    label: 'Negra',      colors: ['#080808','#141414','#d4a97a','#f2f2f2'] },
    { id: 'cream',    label: 'Crema',      colors: ['#dfc898','#f0e0c0','#c47a3a','#2a1005'] },
    { id: 'bluegray', label: 'Azul Gris',  colors: ['#9ab0c8','#bcd0e4','#4a7eb8','#0d1e30'] },
    { id: 'white',    label: 'Gris Neutro',colors: ['#b8b8b8','#d4d4d4','#5a6a7a','#181818'] },
    { id: 'agua',     label: 'Agua',       colors: ['#030810','#0c2040','#38bdf8','#ffffff'] },
    { id: 'cristal',  label: 'Cristal',    colors: ['#cce4f8','#eaf4ff','#0284c7','#0d1f3c'] },
    { id: 'perla',    label: 'Perla',      colors: ['#c8d2e0','rgba(255,255,255,0.35)','#475569','#0f172a'] },
    { id: 'lavanda',  label: 'Lluvia',     colors: ['#2b2f38','rgba(255,255,255,0.32)','rgba(210,235,255,0.6)','#f0f0f0'] },
  ];
  const themePickerHtml = loginThemes.map(t => `
    <button class="palette-card ${t.id === currentLoginTheme ? 'active' : ''}" onclick="setLoginTheme('${t.id}')">
      <div class="palette-preview">${t.colors.map(c => `<span style="background:${c}"></span>`).join('')}</div>
      <div class="palette-label">${t.label}</div>
    </button>`).join('');

  const currentAnn = reg?.announcement || null;
  const annHtml = currentAnn
    ? `<div class="admin-current-ann">
        ${currentAnn.imageB64 ? `<img src="${currentAnn.imageB64}" style="max-width:180px;max-height:120px;border-radius:8px;margin-bottom:0.5rem;display:block">` : ''}
        <p style="font-size:0.85rem;margin-bottom:0.35rem"><strong>Anuncio activo:</strong> ${currentAnn.text || '—'}</p>
        <p style="font-size:0.72rem;color:var(--text3)">${currentAnn.date ? new Date(currentAnn.date).toLocaleString() : ''}</p>
      </div>`
    : '<p style="font-size:0.8rem;color:var(--text3)">No hay anuncio activo.</p>';

  document.getElementById('adminContent').innerHTML = `
    <div class="admin-section">
      <h3 class="admin-section-title">Anuncio para usuarios</h3>
      <p class="admin-section-sub" style="display:block;margin-bottom:0.75rem">Se muestra a cada usuario la próxima vez que inicie sesión.</p>
      ${annHtml}
      <div style="margin-top:0.85rem">
        <textarea id="annText" rows="3" placeholder="Escribe tu mensaje para todos los usuarios…"
          style="width:100%;resize:vertical;margin-bottom:0.5rem;border-radius:var(--radius-sm);padding:0.6rem;background:var(--surface);border:1px solid var(--border);color:var(--text);font-family:var(--font-body);font-size:0.85rem">${currentAnn?.text || ''}</textarea>
        <div id="annImgPreview" style="margin-bottom:0.5rem"></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;margin-bottom:0.55rem">
          <div>
            <label style="font-size:0.75rem;color:var(--text3);display:block;margin-bottom:2px">Mostrar X veces por usuario</label>
            <input type="number" id="annRepeat" min="1" max="99" value="${currentAnn?.repeatCount||1}" style="width:100%" />
          </div>
          <div>
            <label style="font-size:0.75rem;color:var(--text3);display:block;margin-bottom:2px">Intervalo entre apariciones</label>
            <select id="annInterval" style="width:100%">
              <option value="0"   ${(!currentAnn?.intervalHours)?'selected':''}>Sin intervalo</option>
              <option value="1"   ${currentAnn?.intervalHours==1  ?'selected':''}>1 hora</option>
              <option value="6"   ${currentAnn?.intervalHours==6  ?'selected':''}>6 horas</option>
              <option value="24"  ${currentAnn?.intervalHours==24 ?'selected':''}>1 día</option>
              <option value="72"  ${currentAnn?.intervalHours==72 ?'selected':''}>3 días</option>
              <option value="168" ${currentAnn?.intervalHours==168?'selected':''}>1 semana</option>
            </select>
          </div>
        </div>
        <div style="display:flex;gap:0.5rem;flex-wrap:wrap;align-items:center">
          <button class="btn-secondary btn-sm" onclick="document.getElementById('annImgInput').click()">📷 Foto</button>
          <input type="file" id="annImgInput" accept="image/*" class="hidden" onchange="previewAnnImage(event)" />
          <button class="btn-primary btn-sm" onclick="publishAnnouncement()">Publicar</button>
          ${currentAnn ? `<button class="btn-danger btn-sm" onclick="clearAnnouncement()">Quitar anuncio</button>` : ''}
        </div>
      </div>
    </div>
    <div class="admin-section">
      <h3 class="admin-section-title">Crear cuenta de usuario</h3>
      <div class="admin-create-form">
        <div class="input-group" style="margin-bottom:0.5rem">
          <label>Usuario</label>
          <input type="text" id="newUserUsername" placeholder="Nombre de usuario" autocomplete="off" />
        </div>
        <div class="input-group" style="margin-bottom:0.5rem">
          <label>Contraseña</label>
          <input type="password" id="newUserPassword" placeholder="Contraseña" autocomplete="off" />
        </div>
        <div class="input-group" style="margin-bottom:0.75rem">
          <label>Nombre de la tienda</label>
          <input type="text" id="newUserStore" placeholder="Ej: LUMIÈRE" autocomplete="off" />
        </div>
        <p id="adminCreateError" style="color:#e07070;font-size:0.82rem;min-height:1.1em;margin-bottom:0.5rem"></p>
        <button class="btn-primary" onclick="adminCreateUser()">Crear cuenta</button>
      </div>
    </div>
    <div class="admin-section">
      <h3 class="admin-section-title">Importar cuenta existente</h3>
      <p class="admin-section-sub" style="margin:0 0 0.75rem;display:block;font-size:0.78rem;color:var(--text3)">Si alguien se registró antes de la última actualización, su cuenta quedó en un documento separado.</p>
      <div style="display:flex;gap:0.5rem;align-items:flex-end;flex-wrap:wrap">
        <div class="input-group" style="flex:1;min-width:160px;margin-bottom:0">
          <label>Usuario a importar</label>
          <input type="text" id="importUsername" placeholder="Ej: maria123" autocomplete="off" />
        </div>
        <button class="btn-secondary" onclick="adminImportUser()">Importar</button>
      </div>
      <p id="adminImportMsg" style="font-size:0.82rem;min-height:1.1em;margin-top:0.4rem"></p>
    </div>
    <div class="admin-section">
      <h3 class="admin-section-title">Cuentas activas
        <button class="btn-secondary btn-sm" style="margin-left:0.75rem;font-size:0.72rem" onclick="adminSyncUsers()">↻ Actualizar</button>
      </h3>
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
    </div>
    <div class="admin-section">
      <h3 class="admin-section-title">Tema del panel de administrador</h3>
      ${[
        { id:'default', label:'Azul',    c1:'#020210', c2:'#00aaff' },
        { id:'matrix',  label:'Matrix',  c1:'#000',    c2:'#00ff41' },
        { id:'batman',  label:'Batman',  c1:'#050505', c2:'#c9a227' },
        { id:'lluvia',  label:'Lluvia',  c1:'#2b2f38', c2:'rgba(210,235,255,0.8)' },
      ].map(t => `
        <button class="admin-theme-btn ${(localStorage.getItem('lum_adminTheme')||'default')===t.id?'active':''}"
                onclick="setAdminTheme('${t.id}')">
          <span style="display:flex;gap:3px">
            <span style="background:${t.c1};width:18px;height:18px;border-radius:3px"></span>
            <span style="background:${t.c2};width:10px;height:18px;border-radius:3px"></span>
          </span>
          ${t.label}
        </button>`).join('')}
      ${_VIDEO_THEMES.includes(localStorage.getItem('lum_adminTheme')||'default')
        ? `<div style="margin-top:0.85rem"><h4 style="font-size:0.8rem;color:var(--text3);margin-bottom:0.4rem">🎬 Video de fondo (esta plantilla)</h4><div id="adminVidPickerWrap"></div></div>`
        : ''}
      <h4 style="font-size:0.82rem;margin:1rem 0 0.4rem;color:var(--text3)">🖼 Imagen de fondo (esta plantilla)</h4>
      <div id="adminBgPickerWrap"></div>
    </div>
    <div class="admin-section">
      <h3 class="admin-section-title">Distribución del panel</h3>
      <p class="admin-section-sub" style="display:block;margin-bottom:0.75rem">Elige cómo quieres que se vean las secciones.</p>
      ${[
        { id:'default',  label:'Clásico',   desc:'Sidebar estándar, contenido a la derecha' },
        { id:'compact',  label:'Compacto',  desc:'Sidebar más angosto, elementos más pequeños' },
        { id:'wide',     label:'Amplio',    desc:'Sidebar ancho, contenido centrado' },
      ].map(l => `
        <button class="admin-layout-btn ${(localStorage.getItem('lum_adminLayout')||'default')===l.id?'active':''}"
                onclick="setAdminLayout('${l.id}')">
          <strong>${l.label}</strong>
          <span>${l.desc}</span>
        </button>`).join('')}
    </div>`;
  // Poblar pickers asíncronos tras render
  renderAdminBgPicker();
  if (_VIDEO_THEMES.includes(localStorage.getItem('lum_adminTheme')||'default')) {
    renderAdminVidPicker();
  }
}

function adminDeleteUser(userId, username) {
  const displayName = username || userId;
  confirm2('¿Eliminar cuenta?', `"${displayName}" se moverá a la papelera por 7 días.`, async () => {
    // Buscar en usuarios locales y en registry
    const localUsers = DB.get('users');
    const localUser  = localUsers.find(u => u.id === userId);
    const regUser    = (_adminAccounts || []).find(a => a.id === userId);
    const userObj    = localUser || regUser || { id: userId, username: displayName };

    if (localUser) {
      DB.set('users', localUsers.filter(u => u.id !== userId));
    }
    const trash = DB.get('trash');
    trash.push({ user: userObj, deletedAt: Date.now() });
    DB.set('trash', trash);

    if (_adminAccounts) {
      _adminAccounts = _adminAccounts.filter(a => a.id !== userId);
      await _pushRegistry({ accounts: _adminAccounts });
    }
    renderAdminPage();
    showToast('Cuenta movida a papelera');
  });
}

// ── ANUNCIOS ADMIN ─────────────────────────────────────────────────
let _annPendingImageB64 = null;

function previewAnnImage(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    _annPendingImageB64 = e.target.result;
    const prev = document.getElementById('annImgPreview');
    if (prev) prev.innerHTML = `<img src="${_annPendingImageB64}" style="max-width:160px;max-height:100px;border-radius:6px;margin-bottom:0.4rem;display:block">`;
  };
  // Redimensionar imagen antes de guardar (máx 600px)
  const img = new Image();
  img.onload = () => {
    const scale = Math.min(600 / img.width, 400 / img.height, 1);
    const canvas = document.createElement('canvas');
    canvas.width  = Math.round(img.width  * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    _annPendingImageB64 = canvas.toDataURL('image/jpeg', 0.75);
    const prev = document.getElementById('annImgPreview');
    if (prev) prev.innerHTML = `<img src="${_annPendingImageB64}" style="max-width:160px;max-height:100px;border-radius:6px;margin-bottom:0.4rem;display:block">`;
    URL.revokeObjectURL(img.src);
  };
  img.src = URL.createObjectURL(file);
}

async function publishAnnouncement() {
  const text = document.getElementById('annText')?.value?.trim() || '';
  if (!text && !_annPendingImageB64) {
    showToast('Escribe un mensaje o adjunta una foto', true); return;
  }
  const repeatCount   = parseInt(document.getElementById('annRepeat')?.value) || 1;
  const intervalHours = parseFloat(document.getElementById('annInterval')?.value) || 0;
  const ann = {
    id: uid(), text,
    imageB64: _annPendingImageB64 || null,
    date: Date.now(),
    repeatCount,
    intervalHours,
  };
  await _pushRegistry({ announcement: ann });
  _annPendingImageB64 = null;
  showToast('Anuncio publicado ✓');
  renderAdminPage();
}

async function clearAnnouncement() {
  await _pushRegistry({ announcement: null });
  showToast('Anuncio eliminado');
  renderAdminPage();
}

async function _checkAndShowAnnouncement() {
  const reg = await _pullRegistry();
  const ann = reg?.announcement;
  if (!ann?.id) return;

  // Tracking por anuncio: cuántas veces se ha mostrado y cuándo fue la última
  const key     = `lum_ann_${ann.id}`;
  const tracked = JSON.parse(localStorage.getItem(key) || '{"seen":0,"lastShown":0}');
  const maxShows    = Math.max(1, parseInt(ann.repeatCount) || 1);
  const intervalMs  = ((parseFloat(ann.intervalHours) || 0) * 3600000);
  const now         = Date.now();

  // ¿Ya se mostró suficientes veces?
  if (tracked.seen >= maxShows) return;
  // ¿Hay intervalo y aún no ha pasado el tiempo desde la última vez?
  if (tracked.seen > 0 && intervalMs > 0 && (now - tracked.lastShown) < intervalMs) return;

  // Registrar esta aparición
  tracked.seen++;
  tracked.lastShown = now;
  localStorage.setItem(key, JSON.stringify(tracked));
  localStorage.removeItem('lum_seenAnn'); // limpiar clave legada

  const box = document.getElementById('announcementModal');
  if (!box) return;
  document.getElementById('annModalText').textContent = ann.text || '';
  const imgEl = document.getElementById('annModalImg');
  if (imgEl) {
    if (ann.imageB64) { imgEl.src = ann.imageB64; imgEl.classList.remove('hidden'); }
    else imgEl.classList.add('hidden');
  }
  document.getElementById('annModalDate').textContent =
    ann.date ? new Date(ann.date).toLocaleString() : '';
  openModal('announcementModal');
}

// ── TEMA ADMIN (azul / matrix) ─────────────────────────────────────
function setAdminTheme(theme) {
  const prevTheme = localStorage.getItem('lum_adminTheme') || 'default';
  localStorage.setItem('lum_adminTheme', theme);
  document.body.setAttribute('data-admin-theme', theme);

  if (theme === 'lluvia') {
    // Guardar la paleta actual antes de forzar lavanda, para restaurarla después
    const curPal = localStorage.getItem('lum_pal') || getConfig().palette || 'black';
    if (curPal !== 'lavanda') localStorage.setItem('lum_adminPrePal', curPal);
    setPalette('lavanda');
  } else if (prevTheme === 'lluvia') {
    // Saliendo de Lluvia: restaurar la paleta que había antes
    const restorePal = localStorage.getItem('lum_adminPrePal') || 'black';
    localStorage.removeItem('lum_adminPrePal');
    setPalette(restorePal);
  }

  // Limpiar imagen de la plantilla anterior antes de cargar la nueva
  document.body.style.removeProperty('background-image');
  document.body.style.removeProperty('background-size');
  document.body.style.removeProperty('background-position');
  document.body.style.removeProperty('background-attachment');
  document.body.classList.remove('has-admin-bg');

  applyAdminBg();   // carga imagen de la NUEVA plantilla
  applyVideoBg();   // carga video de la NUEVA plantilla
  renderAdminPage();
}

function applyAdminTheme() {
  // Solo aplica el atributo visual — la paleta la maneja applySettings desde config
  const theme = localStorage.getItem('lum_adminTheme') || 'default';
  document.body.setAttribute('data-admin-theme', theme);
}

function setAdminLayout(layout) {
  localStorage.setItem('lum_adminLayout', layout);
  document.body.setAttribute('data-admin-layout', layout);
  renderAdminPage();
}

function applyAdminLayout() {
  const layout = localStorage.getItem('lum_adminLayout') || 'default';
  document.body.setAttribute('data-admin-layout', layout);
}

// ── DISTRIBUCIÓN BICOLUMNA ──────────────────────────────────────────
function setLayout(name) {
  localStorage.setItem('lum_layout', name);
  document.body.setAttribute('data-layout', name);
  const cfg = getConfig();
  cfg.layout = name;
  DB.set('config', cfg);
  renderRightSidebar();
  document.querySelectorAll('.layout-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.layout === name);
  });
}

function applyLayout() {
  const layout = localStorage.getItem('lum_layout') || getConfig().layout || 'default';
  document.body.setAttribute('data-layout', layout);
}

function renderRightSidebar() {
  try {
    const rs = document.getElementById('rightSidebar');
    if (!rs) return;

    const layout  = localStorage.getItem('lum_layout') || 'default';
    const isAdmin = document.body.hasAttribute('data-admin-mode');

    if (layout !== 'dual' || isAdmin) {
      rs.innerHTML = '';
      rs.style.display = 'none';
      return;
    }

    rs.style.display = '';
    const currentPage = document.querySelector('.page.active')?.id?.replace('page-', '') || 'dashboard';
    const labels = getUserNavLabels();
    if (!labels || !labels.length) return;

    rs.innerHTML = labels.map(item => `
      <button class="rs-btn ${item.id === currentPage ? 'active' : ''}"
              onclick="navigateTo('${item.id}')"
              title="${item.label}">
        <span class="rs-icon">${item.icon}</span>
        <span class="rs-label">${item.label.slice(0, 7)}</span>
      </button>`).join('');
  } catch(e) {
    console.warn('[RightSidebar]', e.message);
  }
}

function setFontWeight(w) {
  document.documentElement.setAttribute('data-fontweight', w);
  const cfg = getConfig();
  cfg.fontWeight = w;
  DB.set('config', cfg);
  document.querySelectorAll('.fontweight-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.fw === w);
  });
}

// ── FONDOS DEL ADMIN POR PLANTILLA (IndexedDB) ──────────────────────
// Cada plantilla tiene su propia imagen y (si aplica) su propio video.
// DB de imágenes: 'lum_adminbg2'  · clave = nombre del tema
// DB de videos:   'lum_adminvid2' · clave = nombre del tema

function _openAdminDB(dbName) {
  return new Promise((res, rej) => {
    const req = indexedDB.open(dbName, 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore('data');
    req.onsuccess = e => res(e.target.result);
    req.onerror = e => rej(e.target.error);
  });
}
async function _adminDBGet(dbName, key) {
  try {
    const db = await _openAdminDB(dbName);
    return new Promise(res => {
      const req = db.transaction('data','readonly').objectStore('data').get(key);
      req.onsuccess = e => res(e.target.result || null);
      req.onerror = () => res(null);
    });
  } catch { return null; }
}
async function _adminDBPut(dbName, key, blob) {
  const db = await _openAdminDB(dbName);
  return new Promise((res, rej) => {
    const tx = db.transaction('data','readwrite');
    tx.objectStore('data').put(blob, key);
    tx.oncomplete = res; tx.onerror = rej;
  });
}
async function _adminDBDel(dbName, key) {
  const db = await _openAdminDB(dbName);
  return new Promise(res => {
    const tx = db.transaction('data','readwrite');
    tx.objectStore('data').delete(key);
    tx.oncomplete = res; tx.onerror = res;
  });
}

const _adminBgURLs  = {}; // theme → image object URL
const _adminVidURLs = {}; // theme → video object URL

function _currentAdminTheme() {
  return localStorage.getItem('lum_adminTheme') || 'default';
}

async function applyAdminBg() {
  const theme = _currentAdminTheme();
  const blob  = await _adminDBGet('lum_adminbg2', theme);

  if (!blob) {
    document.documentElement.style.removeProperty('--admin-bg-img');
    document.body.style.removeProperty('background-image');
    document.body.style.removeProperty('background-size');
    document.body.style.removeProperty('background-position');
    document.body.style.removeProperty('background-attachment');
    document.body.classList.remove('has-admin-bg');
    return;
  }
  if (!_adminBgURLs[theme]) _adminBgURLs[theme] = URL.createObjectURL(blob);
  const imgUrl = `url("${_adminBgURLs[theme]}")`;
  document.documentElement.style.setProperty('--admin-bg-img', imgUrl);
  // setProperty con 'important' para ganar sobre background:!important de los temas
  document.body.style.setProperty('background-image', imgUrl, 'important');
  document.body.style.setProperty('background-size', 'cover', 'important');
  document.body.style.setProperty('background-position', 'center', 'important');
  document.body.style.setProperty('background-attachment', 'fixed', 'important');
  document.body.classList.add('has-admin-bg');
}

async function uploadAdminBg(file) {
  if (!file || !file.type.startsWith('image/')) { showToast('Selecciona una imagen válida', true); return; }
  const theme = _currentAdminTheme();
  showToast('Guardando imagen…');
  await _adminDBPut('lum_adminbg2', theme, file);
  if (_adminBgURLs[theme]) { URL.revokeObjectURL(_adminBgURLs[theme]); delete _adminBgURLs[theme]; }
  await applyAdminBg();
  await renderAdminBgPicker();
  showToast('Imagen de fondo guardada ✓');
}

async function removeAdminBg() {
  const theme = _currentAdminTheme();
  await _adminDBDel('lum_adminbg2', theme);
  if (_adminBgURLs[theme]) { URL.revokeObjectURL(_adminBgURLs[theme]); delete _adminBgURLs[theme]; }
  document.documentElement.style.removeProperty('--admin-bg-img');
  document.body.style.removeProperty('background-image');
  document.body.style.removeProperty('background-size');
  document.body.style.removeProperty('background-position');
  document.body.style.removeProperty('background-attachment');
  document.body.classList.remove('has-admin-bg');
  await renderAdminBgPicker();
  showToast('Imagen eliminada');
}

async function renderAdminBgPicker() {
  const wrap = document.getElementById('adminBgPickerWrap');
  if (!wrap) return;
  const theme = _currentAdminTheme();
  const blob  = await _adminDBGet('lum_adminbg2', theme);
  if (blob) {
    if (!_adminBgURLs[theme]) _adminBgURLs[theme] = URL.createObjectURL(blob);
    wrap.innerHTML = `
      <div style="display:flex;align-items:center;gap:0.75rem;flex-wrap:wrap">
        <img src="${_adminBgURLs[theme]}" style="height:64px;width:110px;object-fit:cover;border-radius:8px;border:2px solid var(--accent)">
        <div>
          <p style="font-size:0.8rem;margin-bottom:0.3rem">Imagen de la plantilla "${theme}" ✓</p>
          <button class="btn-secondary btn-sm" onclick="document.getElementById('adminBgInput').click()">Cambiar</button>
          <button class="btn-danger btn-sm" style="margin-left:0.4rem" onclick="removeAdminBg()">Quitar</button>
        </div>
      </div>`;
  } else {
    wrap.innerHTML = `
      <button class="btn-secondary btn-sm" onclick="document.getElementById('adminBgInput').click()">
        🖼 Subir imagen de fondo
      </button>
      <p style="font-size:0.74rem;color:var(--text3);margin-top:0.35rem">Solo se aplica a la plantilla <strong>${theme}</strong>. Sin Firebase.</p>`;
  }
}

// ── VIDEOS DE ADMIN POR PLANTILLA (lluvia y matrix) ─────────────────
const _VIDEO_THEMES = ['lluvia', 'matrix'];

async function applyAdminThemeVideo() {
  const theme = _currentAdminTheme();
  const wrap  = document.getElementById('bgVideoWrap');
  const video = document.getElementById('bgVideo');
  const src   = document.getElementById('bgVideoSrc');
  if (!wrap || !video || !src) return;

  if (!_VIDEO_THEMES.includes(theme)) { wrap.classList.add('hidden'); video.pause(); return; }

  const blob = await _adminDBGet('lum_adminvid2', theme);
  if (!blob) { wrap.classList.add('hidden'); video.pause(); return; }

  if (!_adminVidURLs[theme]) _adminVidURLs[theme] = URL.createObjectURL(blob);
  wrap.classList.remove('hidden');
  if (src.getAttribute('src') !== _adminVidURLs[theme]) {
    src.setAttribute('src', _adminVidURLs[theme]);
    video.load();
  }
  video.play().catch(() => {});
}

async function uploadAdminThemeVid(file) {
  if (!file || !file.type.startsWith('video/')) { showToast('Selecciona un archivo de video válido', true); return; }
  const theme = _currentAdminTheme();
  showToast('Guardando video…');
  await _adminDBPut('lum_adminvid2', theme, file);
  if (_adminVidURLs[theme]) { URL.revokeObjectURL(_adminVidURLs[theme]); delete _adminVidURLs[theme]; }
  await applyAdminThemeVideo();
  await renderAdminVidPicker();
  showToast('Video de fondo guardado ✓');
}

async function removeAdminThemeVid() {
  const theme = _currentAdminTheme();
  await _adminDBDel('lum_adminvid2', theme);
  if (_adminVidURLs[theme]) { URL.revokeObjectURL(_adminVidURLs[theme]); delete _adminVidURLs[theme]; }
  const wrap = document.getElementById('bgVideoWrap');
  const video = document.getElementById('bgVideo');
  if (wrap) wrap.classList.add('hidden');
  if (video) video.pause();
  await renderAdminVidPicker();
  showToast('Video eliminado');
}

async function renderAdminVidPicker() {
  const wrap = document.getElementById('adminVidPickerWrap');
  if (!wrap) return;
  const theme = _currentAdminTheme();
  const blob  = await _adminDBGet('lum_adminvid2', theme);
  if (blob) {
    if (!_adminVidURLs[theme]) _adminVidURLs[theme] = URL.createObjectURL(blob);
    wrap.innerHTML = `
      <div style="display:flex;align-items:center;gap:0.75rem;flex-wrap:wrap">
        <video src="${_adminVidURLs[theme]}" muted preload="metadata" style="height:64px;width:110px;object-fit:cover;border-radius:8px;border:2px solid var(--accent)"></video>
        <div>
          <p style="font-size:0.8rem;margin-bottom:0.3rem">Video de la plantilla "${theme}" ✓</p>
          <button class="btn-secondary btn-sm" onclick="document.getElementById('adminVidInput').click()">Cambiar</button>
          <button class="btn-danger btn-sm" style="margin-left:0.4rem" onclick="removeAdminThemeVid()">Quitar</button>
        </div>
      </div>`;
  } else {
    wrap.innerHTML = `
      <button class="btn-secondary btn-sm" onclick="document.getElementById('adminVidInput').click()">
        🎬 Subir video de fondo
      </button>
      <p style="font-size:0.74rem;color:var(--text3);margin-top:0.35rem">Solo se aplica a la plantilla <strong>${theme}</strong>. Sin Firebase.</p>`;
  }
}

// ── APARIENCIA AVANZADA ─────────────────────────────────────────────
// Paletas con efecto vidrio (fondo visible a través de los paneles)
const _GLASS_PALETTES = ['agua', 'cristal', 'perla', 'lavanda'];

function applyCustomAppearance() {
  const cfg = getConfig();
  const c = cfg.custom || {};
  const root = document.documentElement;
  const palette = localStorage.getItem('lum_pal') || cfg.palette || 'black';
  const isGlass = _GLASS_PALETTES.includes(palette);

  if (c.accent) { root.style.setProperty('--accent', c.accent); root.style.setProperty('--accent-dark', c.accentDark || c.accent); }
  if (c.text)   root.style.setProperty('--text', c.text);
  if (c.bg)     root.style.setProperty('--bg', c.bg);

  const s = document.getElementById('_custom_glass_style') ||
    (() => { const el = document.createElement('style'); el.id = '_custom_glass_style'; document.head.appendChild(el); return el; })();

  // "Transparencia" (0-95) tiene prioridad sobre "Solidez" si está activa
  // transparencia 0 = sólido (alpha=1), transparencia 95 = casi invisible (alpha≈0.05)
  let finalAlpha;
  if (c.uiTransparency !== undefined && +c.uiTransparency > 0) {
    finalAlpha = 1 - (+c.uiTransparency / 100);
  } else if (c.glassAlpha !== undefined) {
    finalAlpha = +c.glassAlpha;
  }

  const hasCustom = finalAlpha !== undefined || c.panelColor;

  if (hasCustom) {
    // Aplicar a TODAS las paletas cuando hay transparencia activa,
    // solo a paletas de vidrio cuando es solo solidez.
    const applyToAll = c.uiTransparency !== undefined && +c.uiTransparency > 0;
    const shouldApply = applyToAll || isGlass;

    if (shouldApply) {
      const a   = finalAlpha !== undefined ? finalAlpha : 0.5;
      const a2  = Math.min(a + 0.18, 1);
      const hex = c.panelColor || (isGlass ? '#ffffff' : null);

      // Para paletas sólidas sin color personalizado: extraer color de superficie
      // usando el propio CSS (simplificado: usar el valor que tenga sentido)
      let rgb;
      if (hex) {
        const r = parseInt(hex.slice(1,3), 16);
        const g = parseInt(hex.slice(3,5), 16);
        const b = parseInt(hex.slice(5,7), 16);
        rgb = `${r},${g},${b}`;
      } else {
        // Para paletas sólidas, usar el color de superficie como base aproximada
        rgb = '20,20,20';
      }

      s.textContent = `
        html[data-palette] .sidebar,
        html[data-palette] .topbar,
        html[data-palette] .table-card,
        html[data-palette] .settings-card,
        html[data-palette] .stat-card,
        html[data-palette] .chart-card,
        html[data-palette] .login-card,
        html[data-palette] .client-row,
        html[data-palette] .product-card { background: rgba(${rgb},${a}) !important; }
        html[data-palette] .modal        { background: rgba(${rgb},${a2}) !important; }
      `;
    } else {
      s.textContent = '';
    }
  } else {
    s.textContent = '';
  }
}

function setCustomAccent(color) {
  const cfg = getConfig();
  cfg.custom = cfg.custom || {};
  cfg.custom.accent = color;
  cfg.custom.accentDark = color;
  DB.set('config', cfg);
  applyCustomAppearance();
}

function setCustomText(color) {
  const cfg = getConfig();
  cfg.custom = cfg.custom || {};
  cfg.custom.text = color;
  DB.set('config', cfg);
  applyCustomAppearance();
}

function setCustomBg(color) {
  const cfg = getConfig();
  cfg.custom = cfg.custom || {};
  cfg.custom.bg = color;
  DB.set('config', cfg);
  applyCustomAppearance();
}

function setPanelTransparency(pct) {
  const val = parseInt(pct);
  const cfg = getConfig();
  cfg.custom = cfg.custom || {};
  cfg.custom.uiTransparency = val;
  DB.set('config', cfg);
  applyCustomAppearance();
  const lbl = document.getElementById('transparencyVal');
  if (lbl) lbl.textContent = val + '%';
  const sl = document.getElementById('transparencySlider');
  if (sl) sl.value = val;
}

function setCustomPanelColor(hex) {
  const cfg = getConfig();
  cfg.custom = cfg.custom || {};
  cfg.custom.panelColor = hex;
  DB.set('config', cfg);
  const el = document.getElementById('customPanelColorPicker');
  if (el) el.value = hex;
  applyCustomAppearance();
}

function setGlassAlpha(val) {
  const cfg = getConfig();
  cfg.custom = cfg.custom || {};
  cfg.custom.glassAlpha = parseFloat(val);
  DB.set('config', cfg);
  applyCustomAppearance();
  const lbl = document.getElementById('glassAlphaVal');
  if (lbl) lbl.textContent = Math.round(parseFloat(val)*100) + '%';
}

function resetAppearance() {
  const cfg = getConfig();
  delete cfg.custom;
  delete cfg.accent;
  delete cfg.accentDark;
  DB.set('config', cfg);
  // Limpiar vars inline
  const root = document.documentElement;
  ['--accent','--accent-dark','--text','--bg'].forEach(v => root.style.removeProperty(v));
  const s = document.getElementById('_custom_glass_style');
  if (s) s.textContent = '';
  loadSettingsPage();
  showToast('Apariencia restablecida ✓');
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

async function adminCreateUser() {
  const u = (document.getElementById('newUserUsername')?.value || '').trim();
  const p = (document.getElementById('newUserPassword')?.value || '').trim();
  const s = (document.getElementById('newUserStore')?.value || '').trim();
  const err = document.getElementById('adminCreateError');
  if (!u || !p) { err.textContent = 'Usuario y contraseña son obligatorios.'; return; }
  const existing = (_adminAccounts || DB.get('users'));
  if (existing.find(x => x.username === u)) { err.textContent = 'Ese usuario ya existe.'; return; }
  const newUser = { id: uid(), username: u, password: p, storeName: s || (getConfig().storeName || 'LUMIÈRE') };
  // Create their own Firestore document
  if (typeof CloudSync !== 'undefined' && CloudSync.enabled) {
    await CloudSync.pushFresh(u, newUser, s);
  }
  // Add to global registry
  const regEntry = { id: newUser.id, username: u, storeName: newUser.storeName };
  _adminAccounts = [...(existing), regEntry];
  await _pushRegistry({ accounts: _adminAccounts });
  err.textContent = '';
  document.getElementById('newUserUsername').value = '';
  document.getElementById('newUserPassword')?.value != null && (document.getElementById('newUserPassword').value = '');
  document.getElementById('newUserStore').value = '';
  renderAdminPage();
  showToast(`Cuenta "${u}" creada ✓`);
}

async function adminSyncUsers() {
  if (typeof CloudSync === 'undefined' || !CloudSync.enabled) {
    _adminAccounts = DB.get('users');
    renderAdminPage();
    return;
  }
  try {
    const reg = await _pullRegistry();
    const fromRegistry = Array.isArray(reg?.accounts) ? reg.accounts : [];
    const fromLocal    = DB.get('users') || [];

    // Fusionar: registro global + usuarios locales del admin (sin duplicar)
    const merged = [...fromRegistry];
    fromLocal.forEach(u => {
      if (!merged.find(a => a.username === u.username)) {
        merged.push({ id: u.id, username: u.username, storeName: u.storeName || '' });
      }
    });
    _adminAccounts = merged;
  } catch(e) {
    console.warn('[adminSyncUsers]', e.message);
    _adminAccounts = DB.get('users') || [];
  }
  renderAdminPage();
}

async function adminImportUser() {
  const targetUsername = (document.getElementById('importUsername')?.value || '').trim();
  const msgEl = document.getElementById('adminImportMsg');
  if (!targetUsername) { if (msgEl) msgEl.textContent = 'Escribe el nombre de usuario.'; return; }
  if (typeof CloudSync === 'undefined' || !CloudSync.enabled) {
    if (msgEl) msgEl.textContent = 'Sincronización en la nube no disponible.'; return;
  }
  if (msgEl) { msgEl.style.color = 'var(--text3)'; msgEl.textContent = 'Buscando en la nube…'; }
  try {
    const db = firebase.firestore();
    const docId = targetUsername.toLowerCase().replace(/[^a-z0-9_-]/g, '_').slice(0, 128);
    const snap = await db.collection('stores').doc(docId).get();
    if (!snap.exists) {
      if (msgEl) { msgEl.style.color = '#e07070'; msgEl.textContent = `No se encontró ningún documento para "${targetUsername}".`; }
      return;
    }
    const data = snap.data();
    const remoteUsers = data.users || [];
    const targetUser = remoteUsers.find(x => x.username === targetUsername) || remoteUsers[0];
    if (!targetUser) {
      if (msgEl) { msgEl.style.color = '#e07070'; msgEl.textContent = 'Documento encontrado pero no tiene usuarios.'; }
      return;
    }
    // Forzar sync del registro antes de verificar duplicados
    const freshReg = await _pullRegistry();
    _adminAccounts = freshReg?.accounts || DB.get('users');

    const regEntry = { id: targetUser.id, username: targetUser.username, storeName: targetUser.storeName || '' };
    if (_adminAccounts.find(a => a.username.toLowerCase() === regEntry.username.toLowerCase())) {
      if (msgEl) { msgEl.style.color = '#e0a870'; msgEl.textContent = `"${regEntry.username}" ya está en cuentas activas. Pulsa ↻ Actualizar para verla.`; }
      renderAdminPage();
      return;
    }
    _adminAccounts = [..._adminAccounts, regEntry];
    await _pushRegistry({ accounts: _adminAccounts });
    document.getElementById('importUsername').value = '';
    if (msgEl) { msgEl.style.color = 'var(--accent2)'; msgEl.textContent = `"${targetUser.username}" importado correctamente ✓`; }
    renderAdminPage();
  } catch(e) {
    if (msgEl) { msgEl.style.color = '#e07070'; msgEl.textContent = `Error: ${e.message}`; }
  }
}

async function adminViewPassword(username) {
  // Buscar primero en usuarios locales
  const localUser = DB.get('users').find(u => u.username === username);
  if (localUser?.password) {
    confirm2(`Contraseña de "${username}"`,
      `La contraseña guardada es:\n\n${localUser.password}`,
      () => {});
    return;
  }
  // Buscar en Firestore si CloudSync está activo
  if (typeof CloudSync === 'undefined' || !CloudSync.enabled) {
    showToast('No hay contraseña local para este usuario', true); return;
  }
  try {
    const db = firebase.firestore();
    const docId = username.toLowerCase().replace(/[^a-z0-9_-]/g, '_').slice(0, 128);
    const snap = await db.collection('stores').doc(docId).get();
    if (!snap.exists) { showToast('Documento no encontrado en la nube', true); return; }
    const users = snap.data().users || [];
    const u = users.find(x => x.username === username) || users[0];
    if (!u?.password) { showToast('Contraseña no encontrada', true); return; }
    confirm2(`Contraseña de "${username}"`,
      `La contraseña guardada es:\n\n${u.password}`,
      () => {});
  } catch(e) {
    showToast('Error: ' + e.message, true);
  }
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

  // Actualizar panel derecho (resalta la sección activa)
  renderRightSidebar();

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
  const c   = cfg.custom || {};
  const el  = id => document.getElementById(id);

  if (el('settingStoreName')) el('settingStoreName').value = cfg.storeName || '';
  // Moneda: leer del key independiente primero
  if (el('settingCurrency')) el('settingCurrency').value = localStorage.getItem('lum_cur') || cfg.currency || '$';
  if (el('settingLowStock')) el('settingLowStock').value = cfg.lowStock || 5;

  // Palette cards
  const pal = cfg.palette || 'black';
  document.querySelectorAll('.palette-card').forEach(c2 => {
    c2.classList.toggle('active', c2.dataset.pal === pal);
  });

  // Font family
  if (el('fontFamilySelect')) el('fontFamilySelect').value = cfg.fontFamily || 'moderno';

  // Font size buttons
  const fs = cfg.fontSize || 'medium';
  document.querySelectorAll('.fontsize-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.size === fs);
  });

  // Font weight buttons
  const fw = cfg.fontWeight || 'normal';
  document.querySelectorAll('.fontweight-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.fw === fw);
  });

  // Layout buttons
  const lay = localStorage.getItem('lum_layout') || cfg.layout || 'default';
  document.querySelectorAll('.layout-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.layout === lay);
  });

  // Apariencia avanzada — rellenar controles
  if (el('customAccentPicker'))     el('customAccentPicker').value     = c.accent     || '#d4a97a';
  if (el('customTextPicker'))       el('customTextPicker').value       = c.text       || '#f2f2f2';
  if (el('customBgPicker'))         el('customBgPicker').value         = c.bg         || '#080808';
  if (el('customPanelColorPicker')) el('customPanelColorPicker').value = c.panelColor || '#ffffff';
  if (el('transparencySlider')) {
    const t = c.uiTransparency !== undefined ? c.uiTransparency : 0;
    el('transparencySlider').value = t;
    if (el('transparencyVal')) el('transparencyVal').textContent = t + '%';
  }
  if (el('glassAlphaSlider')) {
    const a = c.glassAlpha !== undefined ? c.glassAlpha : 0.5;
    el('glassAlphaSlider').value = a;
    if (el('glassAlphaVal')) el('glassAlphaVal').textContent = Math.round(a * 100) + '%';
  }

  buildNavEditor();
  renderVideoPicker();
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

  const search = normalizeStr(document.getElementById('productSearch')?.value || '');
  const cat = document.getElementById('productCatFilter')?.value || '';
  const currency = getCurrency();
  const lowThr = getLowStockThreshold();

  let products = getProducts();
  if (search) products = products.filter(p =>
    normalizeStr(p.name).includes(search) ||
    normalizeStr(p.description || '').includes(search) ||
    normalizeStr(p.category || '').includes(search));
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

let _clientDebtFilter = 'all';

function setClientFilter(f) {
  _clientDebtFilter = f;
  ['all','debt','ok'].forEach(k => {
    const btn = document.getElementById(k === 'all' ? 'dfAll' : k === 'debt' ? 'dfDebt' : 'dfOk');
    if (btn) btn.classList.toggle('active', k === f);
  });
  renderClients();
}

function renderClients() {
  const grid = document.getElementById('clientsGrid');
  if (!grid) return;

  const search = normalizeStr(document.getElementById('clientSearch')?.value || '');
  const currency = getCurrency();
  const sales = DB.get('sales');
  const OVERDUE_DAYS = 42;
  const now = Date.now();

  let clients = getClients();
  if (search) clients = clients.filter(c =>
    normalizeStr(c.name).includes(search) ||
    normalizeStr(c.phone || '').includes(search) ||
    normalizeStr(c.email || '').includes(search));

  // Enrich each client with debt and overdue status
  clients = clients.map(c => {
    const clientSales = sales.filter(s => s.clientId === c.id);
    const debt = clientSales.reduce((a, s) => a + getSaleRemaining(s), 0);
    const lastPayTs = clientSales
      .flatMap(s => s.payments || [])
      .map(p => new Date(p.date).getTime())
      .filter(t => !isNaN(t))
      .reduce((max, t) => t > max ? t : max, 0);
    const daysSince = lastPayTs ? Math.floor((now - lastPayTs) / 86400000) : Infinity;
    const isOverdue = debt > 0.01 && daysSince > OVERDUE_DAYS;
    return { ...c, _debt: debt, _isOverdue: isOverdue };
  });

  if (_clientDebtFilter === 'debt') clients = clients.filter(c => c._debt > 0.01);
  else if (_clientDebtFilter === 'ok') clients = clients.filter(c => c._debt <= 0.01);

  if (!clients.length) {
    grid.innerHTML = `<div class="empty-state"><span class="empty-icon">◎</span><p>Sin clientes registrados.</p></div>`;
    return;
  }

  grid.innerHTML = clients.map(c => {
    const initials = c.name.split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase();
    const overdueClass = c._isOverdue ? ' overdue' : '';
    return `
      <div class="client-row${overdueClass}" onclick="openClientDetail('${c.id}')">
        <div class="client-avatar">${initials}</div>
        <div class="client-info">
          <p class="client-name">${c.name}${c._isOverdue ? ' <span class="overdue-badge">+42 días</span>' : ''}</p>
          <p class="client-detail">${c.phone || c.email || 'Sin contacto'}</p>
        </div>
        <div>
          ${c._debt > 0
            ? `<p class="client-debt">${currency}${fmtN(c._debt)}<br><small style="font-size:0.72rem;font-family:DM Sans">debe</small></p>`
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
      // Per-item remaining: use stored amountPaid if available, else proportional fallback
      const itemAmtPaid = typeof item.amountPaid === 'number'
        ? item.amountPaid
        : (s.total > 0 ? (item.total / s.total) * getSaleAmountPaid(s) : 0);
      const itemRemaining = Math.max(0, item.total - itemAmtPaid);
      return `<div class="cd-sale-item">
        ${imgEl}
        <div class="cd-sale-info">
          <span class="cd-sale-name">${item.productName}</span>
          <span class="cd-sale-detail">${item.qty} ud. · ${currency}${fmtN(item.unitPrice)} c/u</span>
        </div>
        <div style="text-align:right">
          <span class="cd-sale-sub">${currency}${fmtN(itemRemaining)}</span>
          <span style="font-size:0.68rem;color:var(--text3);display:block">pendiente</span>
        </div>
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
      <div style="display:flex;gap:0.5rem;margin-top:0.75rem">
        <button class="btn-primary" style="flex:1;font-size:0.85rem"
                onclick="openPaymentModal('${s.id}','${clientId}')">Registrar Pago →</button>
        <button class="btn-secondary" style="font-size:0.82rem;padding:0.45rem 0.8rem"
                onclick="openManualDebtModal('${clientId}','${s.id}')" title="Editar esta deuda">✎</button>
      </div>
    </div>`;
  }

  const pendingHtml = pendingSales.length
    ? pendingSales.slice().reverse().map(buildFiadoCard).join('')
    : `<p style="color:var(--accent2);font-size:0.85rem;padding:0.5rem 0">Sin deudas pendientes ✓</p>`;

  const deudasHtml = `
    <div style="display:flex;justify-content:flex-end;margin-bottom:0.75rem">
      <button class="btn-primary btn-sm" onclick="openManualDebtModal('${clientId}')">+ Agregar deuda</button>
    </div>
    ${pendingSales.length ? `
      <div class="cd-debt-total-banner">
        <span>Deuda total del cliente</span>
        <strong>${currency}${fmtN(totalDebt)}</strong>
      </div>
      <p style="font-size:0.78rem;color:var(--text3);margin-bottom:0.75rem">Toca "Registrar Pago" para abonar o saldar.</p>
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

// ── DEUDA MANUAL — multi-producto ───────────────────────────────────
let _mdClientId = null;
let _mdSaleId   = null;  // null = nueva deuda, string = editar existente
let _mdItems    = [];    // [{ productId, productName, qty, unitPrice, custom }]

function openManualDebtModal(clientId, saleId) {
  _mdClientId = clientId;
  _mdSaleId   = saleId || null;
  _mdItems    = [];

  const todayVal = todayStr();

  if (saleId) {
    // EDITAR: cargar ítems de la venta existente
    const sale = DB.get('sales').find(s => s.id === saleId);
    if (!sale) return;
    document.getElementById('manualDebtTitle').textContent = 'Editar deuda';
    getSaleItems(sale).forEach(item => {
      _mdItems.push({
        productId:   item.productId || null,
        productName: item.productName || '',
        qty:         item.qty || 1,
        unitPrice:   item.unitPrice || (item.total / (item.qty || 1)),
        custom:      !item.productId,
      });
    });
    document.getElementById('mdPaid').value  = Math.round(getSaleAmountPaid(sale));
    document.getElementById('mdDate').value  = sale.date || todayVal;
    document.getElementById('mdNote').value  = sale.note || '';
  } else {
    document.getElementById('manualDebtTitle').textContent = 'Agregar deuda';
    document.getElementById('mdPaid').value  = 0;
    document.getElementById('mdDate').value  = todayVal;
    document.getElementById('mdNote').value  = '';
  }

  document.getElementById('mdSearch').value    = '';
  document.getElementById('mdProductResults').innerHTML = '';
  document.getElementById('mdError').textContent = '';

  renderMdItemsList();
  updateMdTotal();
  searchMdProducts(); // mostrar todos los productos al abrir

  closeModal('clientDetailModal');
  openModal('manualDebtModal');
}

function searchMdProducts() {
  const q = normalizeStr(document.getElementById('mdSearch')?.value || '');
  const el = document.getElementById('mdProductResults');
  if (!el) return;

  const currency = getCurrency();
  let prods = getProducts();
  if (q) prods = prods.filter(p =>
    normalizeStr(p.name).includes(q) ||
    normalizeStr(p.category || '').includes(q));

  if (!prods.length && q) {
    el.innerHTML = `<p style="font-size:0.82rem;color:var(--text3);padding:0.4rem 0">
      Sin resultados para "${document.getElementById('mdSearch').value}" — usa "+ Producto no listado".</p>`;
    return;
  }

  const shown = q ? prods : prods.slice(0, 16);
  el.innerHTML = shown.map(p => {
    const inList = _mdItems.find(i => i.productId === p.id);
    return `<div class="md-prod-card ${inList ? 'in-list' : ''}" onclick="addMdProduct('${p.id}','${p.name.replace(/'/g,"\\'").replace(/"/g,'&quot;')}',${p.price||0})">
      <span class="md-prod-name">${p.name}</span>
      <span class="md-prod-price">${currency}${fmtN(p.price||0)}</span>
      ${inList ? '<span class="md-in-list-badge">✓ añadido</span>' : ''}
    </div>`;
  }).join('');
}

function addMdProduct(productId, productName, price) {
  const existing = _mdItems.findIndex(i => i.productId === productId);
  if (existing !== -1) {
    // Incrementar cantidad si ya está
    _mdItems[existing].qty++;
  } else {
    _mdItems.push({ productId, productName, qty: 1, unitPrice: price || 0, custom: false });
  }
  renderMdItemsList();
  updateMdTotal();
  searchMdProducts(); // actualizar badge "✓ añadido"
}

function addMdCustomItem() {
  _mdItems.push({ productId: null, productName: '', qty: 1, unitPrice: 0, custom: true });
  renderMdItemsList();
  updateMdTotal();
  // Focus al input de nombre del nuevo item
  const inputs = document.querySelectorAll('.md-custom-name');
  if (inputs.length) inputs[inputs.length - 1].focus();
}

function removeMdItem(idx) {
  _mdItems.splice(idx, 1);
  renderMdItemsList();
  updateMdTotal();
  searchMdProducts();
}

function updateMdItemField(idx, field, value) {
  _mdItems[idx][field] = field === 'qty' || field === 'unitPrice' ? (parseFloat(value) || 0) : value;
  updateMdTotal();
  // Re-render solo la celda de subtotal
  const cells = document.querySelectorAll('.md-item-sub');
  if (cells[idx]) {
    const item = _mdItems[idx];
    cells[idx].textContent = getCurrency() + fmtN(Math.round((item.qty || 1) * (item.unitPrice || 0)));
  }
}

function renderMdItemsList() {
  const el = document.getElementById('mdItemsList');
  if (!el) return;
  const currency = getCurrency();

  if (!_mdItems.length) {
    el.innerHTML = `<p class="md-empty-items">Busca y añade productos arriba, o usa "+ Producto no listado".</p>`;
    return;
  }

  el.innerHTML = _mdItems.map((item, idx) => `
    <div class="md-item-row">
      ${item.custom
        ? `<input class="md-custom-name" type="text" placeholder="Nombre del producto" value="${item.productName}"
                  style="flex:1" oninput="updateMdItemField(${idx},'productName',this.value)" />`
        : `<span class="md-item-name" style="flex:1">${item.productName}</span>`}
      <label style="font-size:0.72rem;color:var(--text3);display:flex;flex-direction:column;align-items:center;gap:2px">
        Cant.
        <input type="number" min="1" value="${item.qty}" style="width:52px;text-align:center"
               oninput="updateMdItemField(${idx},'qty',this.value)" />
      </label>
      <label style="font-size:0.72rem;color:var(--text3);display:flex;flex-direction:column;align-items:center;gap:2px">
        Precio
        <input type="number" min="0" value="${item.unitPrice}" style="width:80px"
               oninput="updateMdItemField(${idx},'unitPrice',this.value)" />
      </label>
      <span class="md-item-sub" style="min-width:72px;text-align:right;font-family:'Cormorant Garamond',serif;font-size:1rem">
        ${currency}${fmtN(Math.round((item.qty||1)*(item.unitPrice||0)))}
      </span>
      <button class="md-remove-btn" onclick="removeMdItem(${idx})" title="Quitar">✕</button>
    </div>`).join('');
}

function updateMdTotal() {
  const total = _mdItems.reduce((a, i) => a + Math.round((i.qty||1)*(i.unitPrice||0)), 0);
  const el = document.getElementById('mdTotalDisplay');
  if (el) el.textContent = getCurrency() + fmtN(total);
}

function saveManualDebt() {
  const errEl = document.getElementById('mdError');
  errEl.textContent = '';

  if (!_mdItems.length) { errEl.textContent = 'Agrega al menos un producto.'; return; }
  if (_mdItems.some(i => !i.productName.trim())) { errEl.textContent = 'Todos los productos deben tener nombre.'; return; }
  if (_mdItems.some(i => (i.unitPrice||0) <= 0 && (i.qty||1) > 0)) {
    errEl.textContent = 'Todos los productos deben tener precio mayor a 0.'; return;
  }

  const total = _mdItems.reduce((a, i) => a + Math.round((i.qty||1)*(i.unitPrice||0)), 0);
  if (total <= 0) { errEl.textContent = 'El total debe ser mayor a 0.'; return; }

  const paid  = parseFloat(document.getElementById('mdPaid').value)  || 0;
  const date  = document.getElementById('mdDate').value || todayStr();
  const note  = document.getElementById('mdNote').value.trim();

  if (paid > total) { errEl.textContent = 'El pago previo no puede superar el total.'; return; }

  const client = getClients().find(c => c.id === _mdClientId);
  if (!client)  { errEl.textContent = 'Cliente no encontrado.'; return; }

  const items = _mdItems.map(i => ({
    productId:   i.productId || null,
    productName: i.productName.trim(),
    qty:         i.qty || 1,
    unitPrice:   i.unitPrice || 0,
    total:       Math.round((i.qty||1) * (i.unitPrice||0)),
    amountPaid:  0,
  }));
  // Distribuir pago inicial proporcionalmente
  if (paid > 0) {
    items.forEach(item => {
      item.amountPaid = Math.min(item.total, Math.round((item.total / total) * paid));
    });
  }

  const payments = paid > 0
    ? [{ id: uid(), amount: paid, date, note: note || 'Abono inicial', by: currentUser?.username || '', itemAmounts: {} }]
    : [];

  const saleLabel = items.length === 1 ? items[0].productName : `${items.length} productos`;
  const sales = DB.get('sales');

  if (_mdSaleId) {
    // ── EDITAR ──────────────────────────────────────────────────────
    const idx = sales.findIndex(s => s.id === _mdSaleId);
    if (idx === -1) { errEl.textContent = 'Venta no encontrada.'; return; }
    const sale = sales[idx];
    sale.total       = total;
    sale.items       = items;
    sale.productName = saleLabel;
    sale.productId   = items[0]?.productId || null;
    sale.qty         = items.reduce((a, i) => a + i.qty, 0);
    sale.date        = date;
    sale.note        = note;
    sale.isManualDebt = true;
    // Añadir diferencia de pago si el abono previo aumentó
    const realPaid = getSaleAmountPaid(sale);
    if (paid > realPaid) {
      if (!sale.payments) sale.payments = [];
      sale.payments.push({ id: uid(), amount: paid - realPaid, date, note: note || 'Abono inicial', by: currentUser?.username || '', itemAmounts: {} });
    }
    sale.amountPaid = getSaleAmountPaid(sale);
    sale.paid = sale.amountPaid >= sale.total - 0.001;
    if (sale.paid) sale.amountPaid = sale.total;
    sales[idx] = sale;
    DB.set('sales', sales);
    showToast('Deuda actualizada ✓');
  } else {
    // ── NUEVA ───────────────────────────────────────────────────────
    const newSale = {
      id: uid(),
      clientId:    _mdClientId,
      clientName:  client.name,
      productId:   items[0]?.productId || null,
      productName: saleLabel,
      qty:         items.reduce((a, i) => a + i.qty, 0),
      unitPrice:   items[0]?.unitPrice || 0,
      total,
      amountPaid:  paid,
      paid:        paid >= total,
      date,
      note,
      payments,
      isManualDebt: true,
      items,
    };
    if (newSale.paid) newSale.amountPaid = total;
    sales.push(newSale);
    DB.set('sales', sales);
    logAction('clientes', 'Deuda registrada', `${client.name} — ${saleLabel} — ${getCurrency()}${fmtN(total)}`);
    showToast('Deuda registrada ✓');
  }

  closeModal('manualDebtModal');
  openClientDetail(_mdClientId);
}

function switchClientTab(tab) {
  document.querySelectorAll('.cd-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  document.querySelectorAll('.cd-panel').forEach(p => p.classList.add('hidden'));
  const panel = document.getElementById('cd-panel-' + tab);
  if (panel) panel.classList.remove('hidden');
}

// ─── PAYMENT SYSTEM ─────────────────────────
function getSaleAmountPaid(sale) {
  if (sale.payments && sale.payments.length > 0) {
    return sale.payments.reduce((a, p) => a + (p.amount || 0), 0);
  }
  if (sale.paid === true) return sale.total;
  return 0;
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

  const itemsHtml = items.map((item, idx) => {
    const prod = products.find(p => p.id === item.productId);
    const imgEl = (prod && prod.image)
      ? `<img src="${prod.image}" class="pm-item-img" alt="" />`
      : `<div class="pm-item-emoji">${categoryEmoji(prod ? prod.category : 'otro')}</div>`;
    // Per-item remaining: use stored amountPaid if available, else proportional fallback
    const itemAmtPaid = typeof item.amountPaid === 'number'
      ? item.amountPaid
      : (sale.total > 0 ? (item.total / sale.total) * getSaleAmountPaid(sale) : 0);
    const itemRemaining = Math.max(0, item.total - itemAmtPaid);
    const checkEl = showCheckboxes
      ? `<label class="pm-item-check" onclick="event.stopPropagation()"><input type="checkbox" checked value="${Math.round(itemRemaining)}" onchange="updatePayFromChecked()" /></label>`
      : '';
    const paidOff = itemRemaining < 0.5;
    return `<div class="pm-item-row${showCheckboxes ? ' pm-selectable' : ''}" data-item-idx="${idx}" ${showCheckboxes ? 'onclick="togglePmItem(this)"' : ''}>
      ${checkEl}${imgEl}
      <div class="pm-item-info">
        <span class="pm-item-name">${item.productName}</span>
        <span class="pm-item-detail">${item.qty} ud. · ${currency}${fmtN(item.unitPrice)} c/u</span>
      </div>
      <div style="text-align:right;flex-shrink:0">
        <span class="pm-item-total">${currency}${fmtN(item.total)}</span>
        ${remaining > 0.001
          ? `<span class="pm-item-pending">${paidOff ? '✓' : currency + fmtN(itemRemaining) + ' pendiente'}</span>`
          : `<span class="pm-item-pending paid">✓ pagado</span>`}
      </div>
    </div>`;
  }).join('');

  const payHist = (sale.payments || []);
  const saleItemsPreview = getSaleItems(sale).map(i =>
    `<span class="pm-hist-detail-item">${i.productName} ×${i.qty}</span>`).join('');
  const histHtml = payHist.length
    ? payHist.map(p => `
      <div class="pm-hist-item" onclick="togglePmHistDetail(this)">
        <div class="pm-hist-left">
          <span class="pm-hist-date">${p.date}${p.by ? ` · <b>${p.by}</b>` : ''}</span>
          ${p.note ? `<span class="pm-hist-note">${p.note}</span>` : ''}
        </div>
        <div class="pm-hist-right">
          <span class="pm-hist-amount">${currency}${fmtN(p.amount)}</span>
          <button class="pm-hist-undo" onclick="event.stopPropagation();deletePayment('${sale.id}','${p.id}')" title="Deshacer este pago">↩</button>
        </div>
      </div>
      <div class="pm-hist-detail hidden">
        <p class="pm-hist-detail-label">Productos en esta venta:</p>
        <div class="pm-hist-detail-items">${saleItemsPreview}</div>
        <p class="pm-hist-detail-total">Total venta: <strong>${currency}${fmtN(sale.total)}</strong>
          · Abono: <strong>${currency}${fmtN(p.amount)}</strong></p>
      </div>`).join('')
    : `<p class="pm-hist-empty">Sin pagos registrados aún.</p>`;

  const newPaySection = remaining > 0.001 ? `
    <div class="pm-new-section">
      <h4>Registrar pago</h4>
      ${showCheckboxes ? `
      <label class="pm-mode-toggle">
        <input type="checkbox" id="pmAutoCalc" onchange="togglePmAutoCalc(this.checked)" />
        <span>Calcular monto desde ítems marcados</span>
      </label>
      <div id="pmSummary" class="pm-summary" style="display:none"></div>
      ` : ''}
      <div class="pm-new-row">
        <div class="input-group" style="flex:1;margin-bottom:0">
          <label>Monto a pagar</label>
          <input type="number" id="payAmount" min="1" max="${Math.ceil(remaining)}" step="1" value="" placeholder="Escribe el monto..." />
        </div>
        <div class="input-group" style="flex:1;margin-bottom:0">
          <label>Nota (opcional)</label>
          <input type="text" id="payNote" placeholder="Abono, efectivo..." />
        </div>
      </div>
      <button class="pm-pay-all-btn" onclick="setPayAmount(${Math.ceil(remaining)})">
        Saldar todo — ${currency}${fmtN(remaining)}
      </button>
    </div>` : `<div class="pm-done-banner">Deuda saldada completamente ✓</div>`;

  document.getElementById('paymentModalBody').innerHTML = `
    <div class="pm-items-list">${itemsHtml}</div>
    ${showCheckboxes ? `<p style="font-size:0.75rem;color:var(--text3);margin:-0.5rem 0 0.5rem">Marca o desmarca ítems, luego activa el cálculo automático o escribe el monto</p>` : ''}

    <div class="pm-progress-section">
      <div class="pm-progress-track"><div class="pm-progress-fill" style="width:${pct}%"></div></div>
      <div class="pm-progress-labels">
        <span>Abonado: <strong>${currency}${fmtN(paid)}</strong></span>
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
  openModal('paymentModal');
}

function setPayAmount(amount) {
  const inp = document.getElementById('payAmount');
  if (inp) { inp.value = Math.round(amount); inp.focus(); }
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

  const autoOn = document.getElementById('pmAutoCalc')?.checked;
  const inp = document.getElementById('payAmount');
  if (autoOn && inp) inp.value = sum > 0 ? Math.round(sum) : '';

  const summary = document.getElementById('pmSummary');
  if (!summary) return;
  if (!autoOn) { summary.style.display = 'none'; return; }
  summary.style.display = '';
  const currency = getCurrency();
  if (sum <= 0) {
    summary.innerHTML = `<p class="pm-summary-none">Desmarcaste todos los ítems</p>`;
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

function toggleShDetail(row) {
  const detail = row.nextElementSibling;
  if (detail && detail.classList.contains('sh-detail')) {
    detail.classList.toggle('hidden');
  }
}

function togglePmHistDetail(row) {
  const detail = row.nextElementSibling;
  if (detail && detail.classList.contains('pm-hist-detail')) {
    detail.classList.toggle('hidden');
  }
}

function togglePmAutoCalc(enabled) {
  const inp = document.getElementById('payAmount');
  const summary = document.getElementById('pmSummary');
  if (!enabled) {
    if (inp) inp.value = '';
    if (summary) { summary.style.display = 'none'; summary.innerHTML = ''; }
  } else {
    updatePayFromChecked();
  }
}

function submitPayment() {
  const amount = parseFloat(document.getElementById('payAmount')?.value);
  const note = (document.getElementById('payNote')?.value || '').trim();

  if (isNaN(amount) || amount <= 0) { showToast('Ingresa un monto válido', true); return; }

  const sale = DB.get('sales').find(s => s.id === _paymentSaleId);
  if (!sale) return;

  const remaining = getSaleRemaining(sale);
  const remainingRounded = Math.ceil(remaining);
  if (amount > remainingRounded) {
    showToast(`Máximo a pagar: ${getCurrency()}${fmtN(remaining)}`, true);
    return;
  }

  // Capture which items are checked to apply payment per-item
  const allBoxes = [...document.querySelectorAll('.pm-item-check input[type="checkbox"]')];
  const itemAllocations = {};
  if (allBoxes.length > 0) {
    const checkedBoxes = allBoxes.filter(cb => cb.checked);
    const totalCheckedVal = checkedBoxes.reduce((a, cb) => a + (parseFloat(cb.value) || 0), 0);
    checkedBoxes.forEach(cb => {
      const row = cb.closest('[data-item-idx]');
      const idx = row ? parseInt(row.dataset.itemIdx) : 0;
      const share = totalCheckedVal > 0 ? (parseFloat(cb.value) || 0) / totalCheckedVal : 0;
      itemAllocations[idx] = amount * share;
    });
  }

  const currency = getCurrency();
  const isFull = amount >= remainingRounded;
  const confirmMsg = isFull
    ? `¿Registrar pago completo de ${currency}${fmtN(amount)} y marcar la deuda como saldada?`
    : `¿Registrar abono de ${currency}${fmtN(amount)}? Quedará ${currency}${fmtN(remaining - amount)} pendiente.`;

  confirm2('Confirmar pago', confirmMsg, () => _doSubmitPayment(amount, note, itemAllocations));
}

function _doSubmitPayment(amount, note, itemAllocations) {
  const sales = DB.get('sales');
  const sale = sales.find(s => s.id === _paymentSaleId);
  if (!sale) return;

  if (!sale.payments) sale.payments = [];

  // Apply payment to each item's amountPaid
  if (sale.items) {
    const hasAlloc = itemAllocations && Object.keys(itemAllocations).length > 0;
    sale.items.forEach((item, idx) => {
      let itemPay = 0;
      if (hasAlloc) {
        itemPay = itemAllocations[idx] || 0;
      } else {
        // single-item or no checkboxes: all goes to this item proportionally
        itemPay = sale.total > 0 ? (item.total / sale.total) * amount : 0;
      }
      item.amountPaid = Math.min(item.total, (item.amountPaid || 0) + itemPay);
    });
  }

  sale.payments.push({ id: uid(), amount, date: todayStr(), note, by: currentUser?.username || '', itemAmounts: itemAllocations || {} });
  sale.amountPaid = sale.payments.reduce((a, p) => a + p.amount, 0);
  sale.paid = sale.amountPaid >= sale.total - 0.001;
  if (sale.paid) sale.amountPaid = sale.total;

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

function deletePayment(saleId, paymentId) {
  const sales = DB.get('sales');
  const sale = sales.find(s => s.id === saleId);
  if (!sale || !sale.payments) return;
  const pay = sale.payments.find(p => p.id === paymentId);
  if (!pay) return;
  confirm2(
    'Deshacer pago',
    `¿Eliminar el pago de ${getCurrency()}${fmtN(pay.amount)} del ${pay.date}? La deuda volverá a estar pendiente.`,
    () => {
      sale.payments = sale.payments.filter(p => p.id !== paymentId);

      // Recalculate per-item amountPaid from remaining payments
      if (sale.items) {
        sale.items.forEach((item, idx) => {
          item.amountPaid = sale.payments.reduce((a, p) => {
            if (p.itemAmounts && p.itemAmounts[idx] !== undefined) return a + p.itemAmounts[idx];
            return a + (sale.total > 0 ? (item.total / sale.total) * p.amount : 0);
          }, 0);
          item.amountPaid = Math.min(item.amountPaid, item.total);
        });
      }

      sale.amountPaid = sale.payments.reduce((a, p) => a + p.amount, 0);
      sale.paid = sale.amountPaid >= sale.total - 0.001;
      if (sale.paid) sale.amountPaid = sale.total;
      DB.set('sales', sales);
      logAction('pagos', 'Pago eliminado', `${getCurrency()}${fmtN(pay.amount)}${pay.note ? ' — ' + pay.note : ''}`);
      showToast('Pago eliminado — deuda restaurada');
      renderClients();
      renderSalesHistory();
      openPaymentModal(saleId, _paymentClientId);
      if (_paymentClientId) {
        const detailEl = document.getElementById('clientDetailModal');
        if (detailEl && !detailEl.classList.contains('hidden')) {
          openClientDetail(_paymentClientId);
          switchClientTab('deudas');
          openModal('paymentModal');
        }
      }
    }
  );
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
  const q = normalizeStr(document.getElementById('saleProductSearch')?.value || '');
  const resultsEl = document.getElementById('saleProductResults');
  if (!resultsEl) return;

  const currency = getCurrency();
  let products = getProducts().filter(p => p.stock > 0);
  if (q) products = products.filter(p =>
    normalizeStr(p.name).includes(q) ||
    normalizeStr(p.category || '').includes(q) ||
    normalizeStr(p.description || '').includes(q));

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
    by: currentUser?.username || '',
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
      ? `<span class="fiado-badge" onclick="event.stopPropagation();openPaymentModal('${s.id}',null)" style="cursor:pointer">Fiado →</span>`
      : `<span class="paid-badge">Pagado</span>`;
    const itemsDetail = items.map(i =>
      `<div class="sh-detail-row"><span>${i.productName} ×${i.qty}</span><span>${currency}${fmtN(i.unitPrice)} c/u → <b>${currency}${fmtN(i.total)}</b></span></div>`
    ).join('');
    const paymentsDetail = (s.payments || []).length
      ? (s.payments || []).map(p =>
          `<div class="sh-detail-row pay"><span>${p.date}${p.by ? ' · ' + p.by : ''}${p.note ? ' — ' + p.note : ''}</span><span class="sh-pay-amt">+${currency}${fmtN(p.amount)}</span></div>`
        ).join('')
      : '';
    const profitDetail = typeof s.profit === 'number'
      ? `<div class="sh-detail-row profit"><span>Ganancia</span><span>${currency}${fmtN(s.profit)}</span></div>` : '';
    return `
    <div class="sale-history-item" onclick="toggleShDetail(this)" style="cursor:pointer">
      <div>
        <span class="s-name">${productLabel}</span><br>
        <span class="s-client">${client ? client.name : 'Sin cliente'} ${statusBadge}</span>
      </div>
      <div style="text-align:right">
        <span class="s-amount">${currency}${fmtN(s.total)}</span><br>
        <span class="s-date">${s.date}</span>
      </div>
    </div>
    <div class="sh-detail hidden">
      ${itemsDetail}
      ${profitDetail}
      ${paymentsDetail ? `<p class="sh-detail-sub">Pagos registrados:</p>${paymentsDetail}` : ''}
      ${isPending ? `<button class="btn-primary sh-pay-btn" onclick="openPaymentModal('${s.id}',null)">Registrar Pago →</button>` : ''}
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
let _reportPeriod = 'all';

function setReportPeriod(period) {
  _reportPeriod = period;
  document.querySelectorAll('.rp-btn').forEach(b => b.classList.toggle('active', b.dataset.period === period));
  renderReports();
}

function _filterSalesByPeriod(sales, period) {
  if (period === 'all') return sales;
  const now = new Date();
  let cutoff;
  if (period === 'week') {
    cutoff = new Date(now); cutoff.setDate(now.getDate() - 7);
  } else if (period === 'month') {
    cutoff = new Date(now); cutoff.setMonth(now.getMonth() - 1);
  } else if (period === '3m') {
    cutoff = new Date(now); cutoff.setMonth(now.getMonth() - 3);
  } else if (period === '8m') {
    cutoff = new Date(now); cutoff.setMonth(now.getMonth() - 8);
  } else if (period === 'year') {
    cutoff = new Date(now); cutoff.setFullYear(now.getFullYear() - 1);
  }
  const cutStr = cutoff.toISOString().slice(0, 10);
  return sales.filter(s => s.date >= cutStr);
}

function renderReports() {
  const allSales = DB.get('sales');
  const sales = _filterSalesByPeriod(allSales, _reportPeriod);
  const clients = getClients();
  const currency = getCurrency();

  // Profit = sum of (sellingPrice - costPrice) * qty per item
  const totalRevenue = sales.reduce((a, s) => a + s.total, 0);
  const totalProfit  = sales.reduce((a, s) => {
    if (typeof s.profit === 'number') return a + s.profit;
    // Fallback: sum item-level profits if stored, otherwise 0
    return a + getSaleItems(s).reduce((b, i) => b + (typeof i.profit === 'number' ? i.profit : 0), 0);
  }, 0);
  const totalUnits = sales.reduce((a, s) => {
    return a + getSaleItems(s).reduce((b, i) => b + i.qty, 0);
  }, 0);

  const periodLabels = { all:'Siempre', week:'Esta semana', month:'Este mes', '3m':'3 meses', '8m':'8 meses', year:'Este año' };

  const summary = document.getElementById('reportsSummary');
  if (summary) {
    summary.innerHTML = `
      <div class="rp-period-bar">
        ${Object.entries(periodLabels).map(([k,v]) =>
          `<button class="rp-btn${_reportPeriod===k?' active':''}" data-period="${k}" onclick="setReportPeriod('${k}')">${v}</button>`
        ).join('')}
      </div>` +
      [
        { label: 'Ingresos', val: currency + fmtN(totalRevenue), accent: true },
        { label: 'Ganancia neta', val: currency + fmtN(totalProfit), accent: true, green: true },
        { label: 'Unidades', val: totalUnits },
        { label: 'Ventas', val: sales.length },
      ].map(s => `
        <div class="stat-card ${s.accent ? 'accent' : ''} ${s.green ? 'profit-card' : ''}">
          <div class="stat-info">
            <p class="stat-label">${s.label}</p>
            <h3 class="stat-value">${s.val}</h3>
          </div>
        </div>`).join('');
  }

  renderMonthlyChart(sales);
  renderCategoryChart(sales);
  renderDebtTable(clients, allSales, currency);
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

// Normaliza texto quitando acentos/tildes para búsquedas tolerantes
// normalizeStr('café') === 'cafe', normalizeStr('niño') === 'nino'
function normalizeStr(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

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
