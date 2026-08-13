let deferredInstallPrompt = null;
let reloadingForControllerChange = false;

const EXTERNAL_RUNTIME_ASSETS = Object.freeze([
  'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js',
  'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js',
  'https://cdn.jsdelivr.net/npm/jspdf@4.0.0/dist/jspdf.umd.min.js',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.111.0/dist/umd/supabase.js',
  'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.min.js'
]);

export async function prepareOfflineDependencies({ timeoutMs = 20000 } = {}) {
  if (!('serviceWorker' in navigator)) throw new Error('Service Worker indisponível neste navegador.');
  const registration = await navigator.serviceWorker.ready;
  const worker = registration.active;
  if (!worker) throw new Error('O Service Worker ainda não está ativo. Feche e abra o aplicativo e tente novamente.');

  const result = await new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timer = window.setTimeout(() => reject(new Error('Tempo excedido ao preparar as bibliotecas para uso offline.')), timeoutMs);
    channel.port1.onmessage = event => {
      window.clearTimeout(timer);
      resolve(event.data || {});
    };
    worker.postMessage({ type: 'CACHE_EXTERNAL' }, [channel.port2]);
  });

  if (Array.isArray(result.failed) && result.failed.length) {
    throw new Error(`Não foi possível armazenar ${result.failed.length} biblioteca(s) para uso offline.`);
  }

  const checks = await Promise.all(EXTERNAL_RUNTIME_ASSETS.map(url => caches.match(url)));
  if (checks.some(item => !item)) {
    throw new Error('Nem todas as bibliotecas essenciais foram confirmadas no cache offline.');
  }

  return { cached: EXTERNAL_RUNTIME_ASSETS.length };
}

export async function getStorageReadiness() {
  let persisted = null;
  let quota = null;
  let usage = null;

  if (navigator.storage?.persisted) {
    persisted = await navigator.storage.persisted().catch(() => null);
  }
  if (navigator.storage?.estimate) {
    const estimate = await navigator.storage.estimate().catch(() => null);
    quota = Number.isFinite(estimate?.quota) ? estimate.quota : null;
    usage = Number.isFinite(estimate?.usage) ? estimate.usage : null;
  }

  return {
    persisted,
    quota,
    usage,
    available: quota != null && usage != null ? Math.max(0, quota - usage) : null
  };
}

window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  deferredInstallPrompt = event;
  window.dispatchEvent(new CustomEvent('sky17:install-available'));
});

window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  window.dispatchEvent(new CustomEvent('sky17:installed'));
});

function isIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}

export function getInstallState() {
  if (isStandalone()) {
    return { installed: true, canPrompt: false, ios: isIOS() };
  }
  return { installed: false, canPrompt: Boolean(deferredInstallPrompt), ios: isIOS() };
}

export async function requestInstall() {
  if (isStandalone()) return { status: 'installed' };

  if (deferredInstallPrompt) {
    const prompt = deferredInstallPrompt;
    deferredInstallPrompt = null;
    await prompt.prompt();
    const choice = await prompt.userChoice;
    return { status: choice.outcome === 'accepted' ? 'accepted' : 'dismissed' };
  }

  if (isIOS()) return { status: 'ios-manual' };
  return { status: 'unavailable' };
}

function promoteWaitingWorker(registration) {
  registration?.waiting?.postMessage({ type: 'SKIP_WAITING' });
}

function watchRegistrationUpdates(registration, hadController) {
  promoteWaitingWorker(registration);

  registration.addEventListener('updatefound', () => {
    const worker = registration.installing;
    if (!worker) return;
    worker.addEventListener('statechange', () => {
      if (worker.state === 'installed' && navigator.serviceWorker.controller) {
        worker.postMessage({ type: 'SKIP_WAITING' });
      }
    });
  });

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloadingForControllerChange) return;
    reloadingForControllerChange = true;
    window.location.reload();
  });
}

export async function registerPWA(onError) {
  if (!('serviceWorker' in navigator)) return null;

  try {
    if (navigator.storage?.persisted && navigator.storage?.persist) {
      try {
        const persisted = await navigator.storage.persisted();
        if (!persisted) await navigator.storage.persist();
      } catch {
        // Persistência reforçada é opcional; falhas aqui não devem impedir o PWA.
      }
    }

    const hadController = Boolean(navigator.serviceWorker.controller);
    const registration = await navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' });
    watchRegistrationUpdates(registration, hadController);
    await registration.update().catch(() => {});

    const readyRegistration = await navigator.serviceWorker.ready;
    promoteWaitingWorker(readyRegistration);
    readyRegistration.active?.postMessage({ type: 'CACHE_EXTERNAL' });

    return registration;
  } catch (error) {
    onError?.(error);
    return null;
  }
}