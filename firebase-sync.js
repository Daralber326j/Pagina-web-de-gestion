/* ═══════════════════════════════════════════
   LUMIÈRE — Módulo de Sincronización Incremental

   Documentos Firestore:
   · stores/{userId}       — datos principales (sin imágenes)
   · stores/{userId}_img0  — imágenes bloque 0  (≤ 700 KB)
   · stores/{userId}_img1  — imágenes bloque 1, si se necesita, etc.

   Solo se sube lo que cambió:
   · Si editas un cliente  → solo sube "clients"
   · Si cambias precio     → solo sube "products" (sin imágenes)
   · Si cambias una foto   → solo sube esa imagen en su bloque
   · Primera vez / cuenta nueva → push completo
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

  // ── Estado de cambios pendientes ──────────────────────────────────────
  _dirtyKeys:   new Set(),   // qué claves cambiaron (products, clients, …)
  _dirtyImgIds: new Set(),   // IDs de productos cuya imagen cambió
  //   "__del__<id>" significa que la imagen de ese producto fue eliminada

  // Índice local: productId → número de doc de imágenes (0, 1, 2…)
  // Se persiste en localStorage como 'lum_imgIdx'
  _imgIdx: {},

  COLLECTION: 'stores',
  KEYS: ['products','clients','sales','config','users','activityLog','navLabels','trash'],
  _IMG_CHUNK: 700 * 1024,   // máx caracteres por doc de imágenes (push completo)
  _IMG_DOC_LIMIT: 900 * 1024, // umbral seguro por doc al añadir imágenes incrementalmente

  // ── Helpers ──────────────────────────────────────────────────────────
  _docId(u) {
    return (u || '').toLowerCase().replace(/[^a-z0-9_-]/g, '_').slice(0, 128);
  },

  _loadImgIdx() {
    try { this._imgIdx = JSON.parse(localStorage.getItem('lum_imgIdx') || '{}'); }
    catch { this._imgIdx = {}; }
  },

  _saveImgIdx() {
    localStorage.setItem('lum_imgIdx', JSON.stringify(this._imgIdx));
  },

  // Cuántos docs de imágenes (_img0, _img1, …) existen
  _loadImgDocCount() {
    const stored = parseInt(localStorage.getItem('lum_imgDocCount') || '0', 10);
    if (stored > 0) return stored;
    const maxIdx = Object.values(this._imgIdx).reduce((m, n) => Math.max(m, n), -1);
    return maxIdx + 1 || 1;
  },

  _saveImgDocCount(n) {
    localStorage.setItem('lum_imgDocCount', String(n));
  },

  // Extrae imágenes de los productos → { clean, imgMap }
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

  // Restaura imágenes en productos desde imgMap y/o fallback (localStorage)
  _restoreImages(products, imgMap, fallback = {}) {
    return (products || []).map(p => {
      if (p._hasImg) {
        const { _hasImg, ...rest } = p;
        return { ...rest, image: imgMap[p.id] || fallback[p.id] || null };
      }
      return p;
    });
  },

  // Divide un mapa de imágenes en trozos de ≤ _IMG_CHUNK chars
  _chunkImgMap(imgMap) {
    const chunks = [{}];
    let size = 0;
    for (const [id, b64] of Object.entries(imgMap)) {
      if (size + b64.length > this._IMG_CHUNK && size > 0) {
        chunks.push({});
        size = 0;
      }
      chunks[chunks.length - 1][id] = b64;
      size += b64.length;
    }
    return chunks;
  },

  // Lee todos los docs de imágenes y devuelve { imgMap, idx }
  // Usa allSettled para que un doc lento o denegado no rompa los demás.
  async _readImgDocs(db, docId, count) {
    if (!count || count < 1) count = 1;
    const results = await Promise.allSettled(
      Array.from({ length: count }, (_, i) =>
        db.collection(this.COLLECTION).doc(`${docId}_img${i}`).get()
      )
    );
    const imgMap = {}, idx = {};
    results.forEach((r, i) => {
      if (r.status === 'fulfilled' && r.value.exists) {
        Object.entries(r.value.data().images || {}).forEach(([id, b64]) => {
          imgMap[id] = b64;
          idx[id] = i;
        });
      }
    });
    return { imgMap, idx };
  },

  // ── Marcar qué cambió (llamado desde DB.set antes de escribir) ────────
  markDirty(key, oldVal, newVal) {
    this._dirtyKeys.add(key);
    if (key === 'products') this._diffImages(oldVal, newVal);
  },

  // Detecta qué imágenes cambiaron comparando old vs new products
  _diffImages(oldProds, newProds) {
    const oldMap = {};
    (oldProds || []).forEach(p => { oldMap[p.id] = p.image || null; });

    (newProds || []).forEach(p => {
      const oldImg = oldMap[p.id] !== undefined ? oldMap[p.id] : '__new__';
      if ((p.image || null) !== oldImg || oldImg === '__new__') {
        this._dirtyImgIds.add(p.id);
      }
      delete oldMap[p.id];
    });

    // Productos que ya no existen → borrar su imagen del doc
    Object.keys(oldMap).forEach(id => this._dirtyImgIds.add('__del__' + id));
  },

  // ── USUARIO ──────────────────────────────────────────────────────────
  setUser(u) { this._userId = u; },

  clearUser() {
    this._userId = null;
    clearTimeout(this._pushTimer);
    this._pushTimer = null;
    this.stopListener();
    this._dirtyKeys.clear();
    this._dirtyImgIds.clear();
  },

  // ── PUSH incremental ─────────────────────────────────────────────────
  schedulePush() {
    if (!this.enabled || !this._userId) return;
    clearTimeout(this._pushTimer);
    this._pushTimer = setTimeout(() => this.push(), 600);
  },

  async push() {
    if (!this.enabled || !this._userId) return;
    if (this._dirtyKeys.size === 0 && this._dirtyImgIds.size === 0) return;

    // Capturar y limpiar el estado sucio (si falla, se re-ensuciará en el catch)
    const dirtyKeys   = new Set(this._dirtyKeys);
    const dirtyImages = new Set(this._dirtyImgIds);
    this._dirtyKeys.clear();
    this._dirtyImgIds.clear();

    try {
      this._setStatus('syncing');
      this._lastPushAt = Date.now();
      const db    = firebase.firestore();
      const docId = this._docId(this._userId);
      const ts    = new Date().toISOString();

      // Actualización parcial del doc principal (solo claves sucias)
      const updates = { syncedAt: ts };
      dirtyKeys.forEach(k => {
        const raw = localStorage.getItem('lum_' + k);
        if (!raw) return;
        try {
          let parsed = JSON.parse(raw);
          if (k === 'products' && Array.isArray(parsed)) {
            parsed = this._stripImages(parsed).clean;
          } else if (k === 'activityLog' && Array.isArray(parsed)) {
            parsed = parsed.slice(-100);
          }
          updates[k] = parsed;
        } catch { /* skip */ }
      });

      // Subir SOLO las imágenes que cambiaron
      if (dirtyImages.size > 0) {
        const newDocCount = await this._incrementalImgPush(db, docId, dirtyImages, ts);
        if (newDocCount) updates._imgDocCount = newDocCount;
      }

      // Actualizar doc principal (update en vez de set → solo toca los campos indicados)
      await db.collection(this.COLLECTION).doc(docId).update(updates);
      this._setStatus('ok');

    } catch (e) {
      if (e && e.code === 'not-found') {
        // El documento no existe aún → push completo
        return this._fullPush();
      }
      console.warn('[CloudSync] Error al sincronizar:', e && e.message);
      this._setStatus('error');
      // Devolver al estado sucio para que el próximo schedulePush lo reintente
      dirtyKeys.forEach(k   => this._dirtyKeys.add(k));
      dirtyImages.forEach(id => this._dirtyImgIds.add(id));
    }
  },

  // Sube solo las imágenes marcadas como sucias usando dot-notation update.
  // Es "size-aware": si el doc donde iría una imagen ya está lleno (≥ _IMG_DOC_LIMIT),
  // la imagen se reubica en otro doc (o se crea uno nuevo). Devuelve el nuevo
  // _imgDocCount si cambió, o null si sigue igual.
  async _incrementalImgPush(db, docId, dirtyImgIds, ts) {
    this._loadImgIdx();
    const products = (() => {
      try { return JSON.parse(localStorage.getItem('lum_products') || '[]'); } catch { return []; }
    })();
    const imgMap = {};
    products.forEach(p => { if (p.image) imgMap[p.id] = p.image; });

    let docCount = this._loadImgDocCount();
    const initialDocCount = docCount;

    // Tamaño aproximado actual de cada doc según _imgIdx + imágenes locales
    const docSizes = {};
    Object.entries(this._imgIdx).forEach(([id, n]) => {
      if (imgMap[id]) docSizes[n] = (docSizes[n] || 0) + imgMap[id].length;
    });

    // Busca el primer doc con espacio para `size` bytes más, o crea uno nuevo
    const findRoom = (size) => {
      for (let n = 0; n < docCount; n++) {
        if ((docSizes[n] || 0) + size <= this._IMG_DOC_LIMIT) return n;
      }
      const n = docCount++;
      docSizes[n] = 0;
      return n;
    };

    // Agrupar cambios por número de doc de imágenes
    const perDoc = {}; // { docN: { 'images.id': value | FieldValue.delete() } }
    const FVdel  = firebase.firestore.FieldValue.delete();

    dirtyImgIds.forEach(rawId => {
      const isDel = rawId.startsWith('__del__');
      const id    = isDel ? rawId.slice(7) : rawId;

      if (isDel) {
        const docN = this._imgIdx[id];
        if (docN === undefined) return;
        if (!perDoc[docN]) perDoc[docN] = { syncedAt: ts };
        perDoc[docN][`images.${id}`] = FVdel;
        delete this._imgIdx[id];
        return;
      }

      const b64 = imgMap[id];
      if (!b64) return;
      const size = b64.length;
      let docN    = this._imgIdx[id];

      if (docN === undefined) {
        // Imagen nueva → asignar al primer doc con espacio
        docN = findRoom(size);
        docSizes[docN] = (docSizes[docN] || 0) + size;
        this._imgIdx[id] = docN;
      } else if ((docSizes[docN] || 0) > this._IMG_DOC_LIMIT) {
        // El doc donde estaba esta imagen ya está lleno → moverla a otro doc
        docSizes[docN] = (docSizes[docN] || 0) - size;
        const oldDocN = docN;
        docN = findRoom(size);
        docSizes[docN] = (docSizes[docN] || 0) + size;
        this._imgIdx[id] = docN;
        if (!perDoc[oldDocN]) perDoc[oldDocN] = { syncedAt: ts };
        perDoc[oldDocN][`images.${id}`] = FVdel;
      }

      if (!perDoc[docN]) perDoc[docN] = { syncedAt: ts };
      perDoc[docN][`images.${id}`] = b64;
    });

    // Aplicar actualizaciones a cada doc de imágenes
    await Promise.all(Object.entries(perDoc).map(async ([docN, upd]) => {
      const ref = db.collection(this.COLLECTION).doc(`${docId}_img${docN}`);
      try {
        await ref.update(upd);
      } catch (err) {
        // El doc de imágenes aún no existe → crearlo y reintentar
        if (err && err.code === 'not-found') {
          await ref.set({ images: {}, syncedAt: ts });
          await ref.update(upd);
        } else {
          throw err;
        }
      }
    }));

    this._saveImgIdx();
    if (docCount !== initialDocCount) {
      this._saveImgDocCount(docCount);
      return docCount;
    }
    return null;
  },

  // Push completo (primera vez o cuando update() falla por doc inexistente)
  async _fullPush() {
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
            const r = this._stripImages(parsed);
            parsed  = r.clean;
            imgMap  = r.imgMap;
          } else if (k === 'activityLog' && Array.isArray(parsed)) {
            parsed = parsed.slice(-100);
          }
          mainData[k] = parsed;
        } catch { /* skip */ }
      });

      // Escribir docs de imágenes en paralelo
      const chunks      = this._chunkImgMap(imgMap);
      const newIdx      = {};
      await Promise.all(chunks.map((chunk, i) => {
        Object.keys(chunk).forEach(id => { newIdx[id] = i; });
        return db.collection(this.COLLECTION).doc(`${docId}_img${i}`).set({ images: chunk, syncedAt: ts });
      }));
      mainData._imgDocCount = chunks.length;

      await db.collection(this.COLLECTION).doc(docId).set(mainData);

      // Guardar índice local
      this._imgIdx = newIdx;
      this._saveImgIdx();
      this._saveImgDocCount(chunks.length);
      this._setStatus('ok');
    } catch (e) {
      console.warn('[CloudSync] Error en push completo:', e && e.message);
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

      // Leer img docs de forma tolerante: si alguno falla (lentitud, red) se ignora.
      // allSettled dentro de _readImgDocs ya maneja fallos individuales; aquí capturamos
      // cualquier otro error inesperado para que pull() siempre termine.
      let imgMap = {}, idx = {};
      try {
        ({ imgMap, idx } = await this._readImgDocs(db, docId, imgDocCount));
      } catch (e) {
        console.warn('[CloudSync] Error leyendo imgs (se usará caché local):', e && e.message);
      }

      if (Array.isArray(data.products)) {
        const localProds = (() => { try { return JSON.parse(localStorage.getItem('lum_products') || '[]'); } catch { return []; } })();
        const localImgs  = {};
        localProds.forEach(p => { if (p.image) localImgs[p.id] = p.image; });
        // Restaurar sin depender de _hasImg — el marcador puede haberse perdido si
        // productos se subieron a Firestore desde un estado incorrecto (image: null).
        data.products = data.products.map(p => {
          const { _hasImg, ...rest } = p;
          const img = imgMap[p.id] || localImgs[p.id] || null;
          return img ? { ...rest, image: img } : rest;
        });
      }

      this.KEYS.forEach(k => {
        if (data[k] !== undefined) {
          localStorage.setItem('lum_' + k, JSON.stringify(data[k]));
        }
      });

      // Guardar índice solo si se pudo leer al menos un doc de imágenes
      if (Object.keys(idx).length > 0) {
        this._imgIdx = idx;
        this._saveImgIdx();
        this._saveImgDocCount(imgDocCount);
      }

      this._setStatus('ok');
      return true;
    } catch (e) {
      console.warn('[CloudSync] Error al obtener datos:', e && e.message);
      this._setStatus('error');
      return false;
    }
  },

  // ── LISTENER EN TIEMPO REAL ──────────────────────────────────────────
  startListener(onUpdate) {
    if (!this.enabled || !this._userId) return;
    this.stopListener();
    this._onRemoteUpdate = onUpdate;
    this._lastPushAt = Date.now();
    const db    = firebase.firestore();
    const docId = this._docId(this._userId);

    this._listener = db.collection(this.COLLECTION).doc(docId)
      .onSnapshot({ includeMetadataChanges: false }, doc => {
        if (!doc.exists || doc.metadata.hasPendingWrites) return;
        if (Date.now() - this._lastPushAt < 5000) return;

        const data = doc.data();

        if (Array.isArray(data.products)) {
          const localProds = (() => { try { return JSON.parse(localStorage.getItem('lum_products') || '[]'); } catch { return []; } })();
          const localImgs  = {};
          localProds.forEach(p => { if (p.image) localImgs[p.id] = p.image; });
          data.products = data.products.map(p => {
            const { _hasImg, ...rest } = p;
            const img = localImgs[p.id] || null;
            return img ? { ...rest, image: img } : rest;
          });
        }

        let changed = false;
        this.KEYS.forEach(k => {
          if (data[k] !== undefined) {
            const v = JSON.stringify(data[k]);
            if (localStorage.getItem('lum_' + k) !== v) {
              localStorage.setItem('lum_' + k, v);
              changed = true;
            }
          }
        });

        if (data.config && changed) {
          if (data.config.palette) localStorage.setItem('lum_pal', data.config.palette);
          if (data.config.layout)  localStorage.setItem('lum_layout', data.config.layout);
        }

        if (changed && typeof this._onRemoteUpdate === 'function') this._onRemoteUpdate();
      }, err => {
        console.warn('[CloudSync] Listener error:', err && err.message);
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
      el.title = 'Sincronizando…';
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
      el.title       = this.enabled ? 'Nube conectada' : '';
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
        db.collection(this.COLLECTION).doc(`${docId}_img0`).set({ images: {}, syncedAt: ts }),
      ]);
      this._imgIdx = {};
      this._saveImgIdx();
      this._saveImgDocCount(1);
    } catch(e) {
      console.warn('[CloudSync] Error al crear tienda:', e && e.message);
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
