/* ═══════════════════════════════════════════
   LUMIÈRE — Módulo de Sincronización en la Nube
   Depende de: firebase-config.js + Firebase SDK
═══════════════════════════════════════════ */

const CloudSync = {
  // true solo si Firebase fue inicializado correctamente
  get enabled() {
    return typeof firebase !== 'undefined' &&
           firebase.apps && firebase.apps.length > 0;
  },

  _userId:     null,
  _pushTimer:  null,
  COLLECTION:  'stores',
  KEYS: ['products', 'clients', 'sales', 'config', 'users', 'activityLog', 'navLabels', 'trash'],

  // Convierte el nombre de usuario a un ID de documento válido para Firestore
  _docId(username) {
    return (username || '').toLowerCase().replace(/[^a-z0-9_-]/g, '_').slice(0, 128);
  },

  // ─── USUARIO ────────────────────────────────
  setUser(username) {
    this._userId = username;
  },

  clearUser() {
    this._userId = null;
    clearTimeout(this._pushTimer);
    this._pushTimer = null;
  },

  // ─── PUSH (local → nube) ────────────────────
  // Llámalo con debounce para no saturar Firestore
  schedulePush() {
    if (!this.enabled || !this._userId) return;
    clearTimeout(this._pushTimer);
    this._pushTimer = setTimeout(() => this.push(), 1800);
  },

  async push() {
    if (!this.enabled || !this._userId) return;
    try {
      this._setStatus('syncing');
      const data = { syncedAt: new Date().toISOString() };
      this.KEYS.forEach(k => {
        const raw = localStorage.getItem('lum_' + k);
        if (raw) {
          try { data[k] = JSON.parse(raw); } catch { /* skip invalid */ }
        }
      });
      const db = firebase.firestore();
      await db.collection(this.COLLECTION).doc(this._docId(this._userId)).set(data);
      this._setStatus('ok');
    } catch (e) {
      console.warn('[CloudSync] Error al sincronizar:', e.message);
      this._setStatus('error');
    }
  },

  // ─── PULL (nube → local) ────────────────────
  // Devuelve true si encontró datos en la nube
  async pull(username) {
    if (!this.enabled || !username) return false;
    try {
      this._setStatus('syncing');
      const db = firebase.firestore();
      const doc = await db
        .collection(this.COLLECTION)
        .doc(this._docId(username))
        .get();

      if (!doc.exists) {
        this._setStatus('');
        return false;
      }

      const data = doc.data();
      this.KEYS.forEach(k => {
        if (data[k] !== undefined) {
          localStorage.setItem('lum_' + k, JSON.stringify(data[k]));
        }
      });
      this._setStatus('ok');
      return true;
    } catch (e) {
      console.warn('[CloudSync] No se pudieron obtener datos:', e.message);
      this._setStatus('error');
      return false;
    }
  },

  // ─── INDICADOR VISUAL ───────────────────────
  _setStatus(state) {
    const el = document.getElementById('cloudSyncStatus');
    if (!el) return;
    if (state === 'syncing') {
      el.textContent = '↻';
      el.title = 'Sincronizando...';
      el.style.color = 'var(--text3)';
    } else if (state === 'ok') {
      el.textContent = '☁';
      el.title = 'Datos sincronizados';
      el.style.color = 'var(--accent2)';
      setTimeout(() => { el.textContent = '☁'; }, 3000);
    } else if (state === 'error') {
      el.textContent = '⚠';
      el.title = 'Sin conexión — datos guardados localmente';
      el.style.color = '#e0a870';
    } else {
      el.textContent = this.enabled ? '☁' : '';
      el.title = this.enabled ? 'Nube conectada' : '';
      el.style.color = 'var(--text3)';
    }
  },

  // Crea un documento limpio y vacío para una cuenta nueva
  async pushFresh(username, userRecord, storeName) {
    if (!this.enabled || !username) return;
    try {
      const db = firebase.firestore();
      await db.collection(this.COLLECTION).doc(this._docId(username)).set({
        syncedAt: new Date().toISOString(),
        users: [userRecord],
        config: { storeName: storeName || 'LUMIÈRE' },
        products: [],
        clients: [],
        sales: [],
        activityLog: [],
        navLabels: [],
      });
    } catch(e) {
      console.warn('[CloudSync] Error al crear tienda en la nube:', e.message);
    }
  },

  // Muestra el estado inicial cuando el usuario inicia sesión
  showInitialStatus() {
    const el = document.getElementById('cloudSyncStatus');
    if (!el) return;
    if (this.enabled) {
      el.textContent = '☁';
      el.title = 'Sincronización en la nube activa';
      el.style.color = 'var(--accent2)';
    } else {
      el.textContent = '';
      el.title = '';
    }
  },
};
