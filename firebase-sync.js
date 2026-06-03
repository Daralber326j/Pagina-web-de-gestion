/* ═══════════════════════════════════════════
   LUMIÈRE — Módulo de Sincronización en la Nube

   Arquitectura de documentos Firestore:
   · stores/{userId}           — datos principales (sin imágenes de productos)
   · stores/{userId}_img0      — primer bloque de imágenes (≤ 700 KB)
   · stores/{userId}_img1      — segundo bloque si se necesita, y así sucesivamente
   · El campo _imgDocCount en el doc principal indica cuántos bloques existen.

   Esto permite almacenar cientos de imágenes de productos sin chocar con
   el límite de 1 MB por documento de Firestore.
═══════════════════════════════════════════ */

const CloudSync = {
  get enabled() {
    return typeof firebase !== 'undefined' &&
           firebase.apps && firebase.apps.length > 0;
  },

  _userId:         null,
  _pushTimer:      null,
  _listener:       null,
  _lastPushAt:     0,
  _onRemoteUpdate: null,
  COLLECTION: 'stores',
  KEYS: ['products', 'clients', 'sales', 'config', 'users', 'activityLog', 'navLabels', 'trash'],

  // Máximo de caracteres por documento de imágenes (≈ 700 KB con margen)
  _IMG_CHUNK: 700 * 1024,

  _docId(username) {
    return (username || '').toLowerCase().replace(/[^a-z0-9_-]/g, '_').slice(0, 128);
  },

  // ── Helpers de imágenes ──────────────────────────────────────────────

  // Extrae las imágenes de los productos, devuelve productos limpios + mapa de imágenes
  _stripImages(products) {
    const imgMap = {};
    const clean = (products || []).map(p => {
      if (p.image) {
        imgMap[p.id] = p.image;
        const { image, ...rest } = p;
        return { ...rest, _hasImg: true };
      }
      return p;
    });
    return { clean, imgMap };
  },

  // Restaura las imágenes en los productos usando imgMap y/o fallbackMap (localStorage)
  _restoreImages(products, imgMap, fallbackMap = {}) {
    return (products || []).map(p => {
      if (p._hasImg) {
        const { _hasImg, ...rest } = p;
        return { ...rest, image: imgMap[p.id] || fallbackMap[p.id] || null };
      }
      return p;
    });
  },

  // Divide el mapa de imágenes en trozos de ≤ _IMG_CHUNK caracteres
  _chunkImgMap(imgMap) {
    const chunks = [{}];
    let size = 0;
    for (const [id, b64] of Object.entries(imgMap)) {
      const len = b64.length;
      if (size + len > this._IMG_CHUNK && size > 0) {
        chunks.push({});
        size = 0;
      }
      chunks[chunks.length - 1][id] = b64;
      size += len;
    }
    return chunks;
  },

  // Escribe los documentos de imágenes en Firestore
  async _writeImgDocs(db, docId, chunks, ts) {
    await Promise.all(chunks.map((chunk, i) =>
      db.collection(this.COLLECTION)
        .doc(`${docId}_img${i}`)
        .set({ images: chunk, syncedAt: ts })
    ));
    return chunks.length;
  },

  // Lee y fusiona todos los documentos de imágenes
  async _readImgDocs(db, docId, count) {
    if (!count || count < 1) count = 1;
    const snaps = await Promise.all(
      Array.from({ length: count }, (_, i) =>
        db.collection(this.COLLECTION).doc(`${docId}_img${i}`).get()
      )
    );
    const imgMap = {};
    snaps.forEach(s => { if (s.exists) Object.assign(imgMap, s.data().images || {}); });
    return imgMap;
  },

  // ── USUARIO ──────────────────────────────────────────────────────────
  setUser(username) { this._userId = username; },

  clearUser() {
    this._userId = null;
    clearTimeout(this._pushTimer);
    this._pushTimer = null;
    this.stopListener();
  },

  // ── PUSH (local → nube) ──────────────────────────────────────────────
  schedulePush() {
    if (!this.enabled || !this._userId) return;
    clearTimeout(this._pushTimer);
    this._pushTimer = setTimeout(() => this.push(), 600);
  },

  async push() {
    if (!this.enabled || !this._userId) return;
    try {
      this._setStatus('syncing');
      this._lastPushAt = Date.now();
      const db    = firebase.firestore();
      const docId = this._docId(this._userId);
      const ts    = new Date().toISOString();

      const mainData = { syncedAt: ts };
      let imgMap = {};

      this.KEYS.forEach(k => {
        const raw = localStorage.getItem('lum_' + k);
        if (!raw) return;
        try {
          let parsed = JSON.parse(raw);
          if (k === 'products' && Array.isArray(parsed)) {
            const { clean, imgMap: map } = this._stripImages(parsed);
            parsed = clean;
            imgMap = map;
          } else if (k === 'activityLog' && Array.isArray(parsed)) {
            // Solo últimos 100 registros en Firestore; 500 se mantienen en local
            parsed = parsed.slice(-100);
          }
          mainData[k] = parsed;
        } catch { /* skip */ }
      });

      // Escribir imágenes primero (en paralelo, bloques independientes)
      const chunks       = this._chunkImgMap(imgMap);
      const imgDocCount  = await this._writeImgDocs(db, docId, chunks, ts);
      mainData._imgDocCount = imgDocCount;

      // Escribir documento principal
      await db.collection(this.COLLECTION).doc(docId).set(mainData);
      this._setStatus('ok');
    } catch (e) {
      console.warn('[CloudSync] Error al sincronizar:', e.message);
      this._setStatus('error');
    }
  },

  // ── PULL (nube → local) ──────────────────────────────────────────────
  async pull(username) {
    if (!this.enabled || !username) return false;
    try {
      this._setStatus('syncing');
      const db    = firebase.firestore();
      const docId = this._docId(username);

      const mainSnap = await db.collection(this.COLLECTION).doc(docId).get();
      if (!mainSnap.exists) { this._setStatus(''); return false; }

      const data        = mainSnap.data();
      const imgDocCount = data._imgDocCount || 1;
      const imgMap      = await this._readImgDocs(db, docId, imgDocCount);

      // Restaurar imágenes en los productos antes de guardar en localStorage
      if (Array.isArray(data.products)) {
        data.products = this._restoreImages(data.products, imgMap);
      }

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

  // ── LISTENER EN TIEMPO REAL ──────────────────────────────────────────
  startListener(onUpdate) {
    if (!this.enabled || !this._userId) return;
    this.stopListener();
    this._onRemoteUpdate = onUpdate;
    this._lastPushAt = Date.now(); // ignorar snapshot inicial
    const db    = firebase.firestore();
    const docId = this._docId(this._userId);

    this._listener = db.collection(this.COLLECTION).doc(docId)
      .onSnapshot({ includeMetadataChanges: false }, doc => {
        if (!doc.exists || doc.metadata.hasPendingWrites) return;
        if (Date.now() - this._lastPushAt < 5000) return;

        const data = doc.data();

        // Para productos con _hasImg, usar las imágenes que ya están en localStorage
        // (las imágenes se sincronizan en el próximo pull completo, no en el listener)
        if (Array.isArray(data.products)) {
          const localProds   = JSON.parse(localStorage.getItem('lum_products') || '[]');
          const localImgMap  = {};
          localProds.forEach(p => { if (p.image) localImgMap[p.id] = p.image; });
          data.products = this._restoreImages(data.products, {}, localImgMap);
        }

        let changed = false;
        this.KEYS.forEach(k => {
          if (data[k] !== undefined) {
            const newVal = JSON.stringify(data[k]);
            if (localStorage.getItem('lum_' + k) !== newVal) {
              localStorage.setItem('lum_' + k, newVal);
              changed = true;
            }
          }
        });

        if (data.config && changed) {
          if (data.config.palette) localStorage.setItem('lum_pal', data.config.palette);
          if (data.config.layout)  localStorage.setItem('lum_layout', data.config.layout);
        }

        if (changed && typeof this._onRemoteUpdate === 'function') {
          this._onRemoteUpdate();
        }
      }, err => {
        console.warn('[CloudSync] Listener error:', err.message);
      });
  },

  stopListener() {
    if (this._listener) { this._listener(); this._listener = null; }
  },

  // ── INDICADOR VISUAL ─────────────────────────────────────────────────
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
    } else if (state === 'error') {
      el.textContent = '⚠';
      el.title = 'Error al sincronizar — datos guardados localmente';
      el.style.color = '#e0a870';
    } else {
      el.textContent = this.enabled ? '☁' : '';
      el.title = this.enabled ? 'Nube conectada' : '';
      el.style.color = 'var(--text3)';
    }
  },

  // Crea documentos iniciales para una cuenta nueva
  async pushFresh(username, userRecord, storeName) {
    if (!this.enabled || !username) return;
    try {
      const db    = firebase.firestore();
      const docId = this._docId(username);
      const ts    = new Date().toISOString();
      await Promise.all([
        db.collection(this.COLLECTION).doc(docId).set({
          syncedAt: ts, _imgDocCount: 1,
          users: [userRecord],
          config: { storeName: storeName || 'LUMIÈRE' },
          products: [], clients: [], sales: [],
          activityLog: [], navLabels: [],
        }),
        db.collection(this.COLLECTION).doc(`${docId}_img0`).set({
          images: {}, syncedAt: ts,
        }),
      ]);
    } catch(e) {
      console.warn('[CloudSync] Error al crear tienda en la nube:', e.message);
    }
  },

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
