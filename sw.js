const VERSION = '0.9.47';
const CORE_CACHE = `docinspector-core-${VERSION}`;
const RUNTIME_CACHE = `docinspector-runtime-${VERSION}`;
const XLSX_URL = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';
const EXCELJS_URL = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
const JSPDF_URL = 'https://cdn.jsdelivr.net/npm/jspdf@4.0.0/dist/jspdf.umd.min.js';
const SUPABASE_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.111.0/dist/umd/supabase.js';
const TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.min.js';

function isOcrRuntimeAsset(url) {
  return url.hostname === 'cdn.jsdelivr.net' && (
    url.pathname.includes('/npm/tesseract.js@') ||
    url.pathname.includes('/npm/tesseract.js-core@') ||
    url.pathname.includes('/npm/@tesseract.js-data/')
  );
}

function isConfidentialCiphertextRequest(url) {
  const pathname = String(url.pathname || '').toLowerCase();
  return pathname.endsWith('.dipdf') ||
    (url.hostname.endsWith('.supabase.co') && pathname.includes('/docinspector-confidential-pdfs/'));
}

const APP_SHELL = [
  './', './index.html', './styles.css', './visual-system.css', './visual-verify.css', './visual-documents.css', './visual-overlays.css', './visual-responsive.css', './visual-refinement.css', './auth.css', './engineering-tracker.css', './visual-hardening.css',
  './manifest.webmanifest', './assets/icon.svg', './assets/icon-180.png', './assets/icon-192.png', './assets/icon-512.png',
  './assets/icon-maskable-192.png', './assets/icon-maskable-512.png', './js/app.js', './js/db.js', './js/domain.js', './js/document-lifecycle.js', './js/document-management-ui.js',
  './js/auth-config.js', './js/inspection-creation-guard.js', './js/auth.js', './js/auth-context.js', './js/auth-entry.js', './js/access-request.js', './js/access-request-admin-ui.js', './js/permissions.js', './js/permission-ui.js', './js/user-admin-ui.js', './js/sync-auth.js', './js/sync-delete-queue.js',
  './js/confidential-crypto.js', './js/confidential-storage.js', './js/confidential-offline.js', './js/confidential-viewer.js', './js/recovery-core.js', './js/recovery-ui.js', './js/pdf-upload-retirement.js',
  './vendor/pdfjs/pdf.min.mjs', './vendor/pdfjs/pdf.worker.min.mjs',
  './js/inspection-update.js', './js/inspection-update-ui.js', './js/field-recovery-ui.js', './js/evidence-health-ui.js', './js/engineering-tracker-core.js', './js/engineering-tracker-ui.js',
  './js/marking-policy-ui.js', './js/copy-evidence-edit-ui.js', './js/ui-refinement.js', './js/export-pdf-options-ui.js', './js/pwa.js', './js/report.js', './js/sync.js', './js/sync.js?legacy=1', './js/ui.js', './js/xlsx.js', './js/vision.js', './js/word.js'
];

async function cacheExternalAssets() {
  const cache = await caches.open(RUNTIME_CACHE);
  const urls = [XLSX_URL, EXCELJS_URL, JSPDF_URL, SUPABASE_URL, TESSERACT_URL];
  const settled = await Promise.allSettled(urls.map(async url => {
    const response = await fetch(url, { mode: 'cors', cache: 'no-cache' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    await cache.put(url, response.clone());
    return url;
  }));
  return {
    cached: settled.flatMap((item, index) => item.status === 'fulfilled' ? [urls[index]] : []),
    failed: settled.flatMap((item, index) => item.status === 'rejected' ? [urls[index]] : [])
  };
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CORE_CACHE);
    await cache.addAll(APP_SHELL);
    await cacheExternalAssets();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const validCaches = new Set([CORE_CACHE, RUNTIME_CACHE]);
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => !validCaches.has(key)).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data?.type === 'CACHE_EXTERNAL') event.waitUntil(cacheExternalAssets().then(result => event.ports?.[0]?.postMessage(result)));
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // Confidential PDF bytes are stored only in the dedicated IndexedDB vault.
  // Never allow .dipdf ciphertext to enter generic CacheStorage.
  if (isConfidentialCiphertextRequest(url)) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok) {
          const cache = await caches.open(RUNTIME_CACHE);
          await cache.put('./index.html', response.clone());
        }
        return response;
      } catch {
        return (await caches.match('./index.html')) || Response.error();
      }
    })());
    return;
  }

  if (request.url === XLSX_URL || request.url === EXCELJS_URL || request.url === JSPDF_URL || request.url === SUPABASE_URL || request.url === TESSERACT_URL || isOcrRuntimeAsset(url)) {
    event.respondWith((async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      try {
        const response = await fetch(request);
        if (response.ok || response.type === 'opaque') {
          const cache = await caches.open(RUNTIME_CACHE);
          await cache.put(request, response.clone());
        }
        return response;
      } catch {
        return cached || Response.error();
      }
    })());
    return;
  }

  if (url.origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cached = await caches.match(request);
    const networkPromise = fetch(request)
      .then(async response => {
        if (response.ok) {
          const cache = await caches.open(RUNTIME_CACHE);
          await cache.put(request, response.clone());
        }
        return response;
      })
      .catch(() => null);
    return cached || await networkPromise || Response.error();
  })());
});