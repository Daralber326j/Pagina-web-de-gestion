/* ═══════════════════════════════════════════
   LUMIÈRE — Configuración de Firebase
   ───────────────────────────────────────────
   PASOS PARA ACTIVAR LA SINCRONIZACIÓN EN LA NUBE:

   1. Ve a https://console.firebase.google.com
   2. Crea un proyecto nuevo (ej: "mi-lumiere-tienda")
   3. Dentro del proyecto: haz clic en el ícono Web </> para
      agregar una aplicación web. Dale cualquier nombre.
   4. Firebase te mostrará un bloque "firebaseConfig" —
      copia los valores y pégalos abajo.
   5. Activa Firestore Database:
      Build → Firestore Database → Create database
      → "Start in test mode" → elige tu región → Done
   6. (Opcional — recomendado después del desarrollo)
      En Firestore → Rules, cambia las reglas a:
      ─────────────────────────────────────────
      rules_version = '2';
      service cloud.firestore {
        match /databases/{database}/documents {
          match /stores/{storeId} {
            allow read, write: if true;
          }
        }
      }
      ─────────────────────────────────────────
   7. Guarda y recarga la app. Verás "☁" en la topbar
      cuando la sincronización esté activa.
═══════════════════════════════════════════ */

const firebaseConfig = {
  apiKey: "AIzaSyCOeJAKE_1BpamsOw9kCXn8WPhAgt0I4XA",
  authDomain: "tienda-web-gestion.firebaseapp.com",
  projectId: "tienda-web-gestion",
  storageBucket: "tienda-web-gestion.firebasestorage.app",
  messagingSenderId: "517867998585",
  appId: "1:517867998585:web:d7ea6ff0866079998a33a8",
  measurementId: "G-KV90ZC7LC4"
};

// ─── NO MODIFICAR ABAJO DE ESTA LÍNEA ───────
const _fbReady =
  firebaseConfig.apiKey      !== "PEGA_TU_API_KEY_AQUI" &&
  firebaseConfig.projectId   !== "tu-proyecto-id";

if (_fbReady && typeof firebase !== 'undefined' && !firebase.apps.length) {
  try {
    firebase.initializeApp(firebaseConfig);
    console.log('[LUMIÈRE] Firebase inicializado ✓ — Sincronización en la nube activa');
  } catch (e) {
    console.warn('[LUMIÈRE] Error al inicializar Firebase:', e.message);
  }
}
