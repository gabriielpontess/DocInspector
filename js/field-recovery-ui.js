const STORAGE_KEY = 'docinspector-verification-drafts-v1';
const MAX_DRAFTS = 20;
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

let observer = null;
let saveTimer = null;
let pendingClearKey = null;
const restoredKeys = new Set();

function loadDrafts() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const cutoff = Date.now() - MAX_AGE_MS;
    return Object.fromEntries(Object.entries(parsed).filter(([, draft]) => Date.parse(draft?.savedAt || '') >= cutoff));
  } catch {
    return {};
  }
}

function persistDrafts(drafts) {
  const entries = Object.entries(drafts)
    .sort(([, a], [, b]) => Date.parse(b?.savedAt || '') - Date.parse(a?.savedAt || ''))
    .slice(0, MAX_DRAFTS);
  if (!entries.length) localStorage.removeItem(STORAGE_KEY);
  else localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
}

function currentFingerprint(root = document) {
  const detail = root.querySelector('.doc-detail');
  const code = detail?.querySelector('.doc-heading h2')?.textContent?.trim() || '';
  const origin = detail?.querySelector('.doc-kicker')?.textContent?.trim() || '';
  const inspectionId = localStorage.getItem('sky17-current') || '';
  if (!detail || !inspectionId || !code || !origin || !detail.querySelector('#found-revision')) return '';
  return `${inspectionId}::${origin}::${code}`;
}

function readDraft(root = document) {
  const key = currentFingerprint(root);
  if (!key) return null;
  const revision = root.querySelector('#found-revision')?.value || '';
  const comment = root.querySelector('#comment')?.value || '';
  const quantity = root.querySelector('#copy-quantity')?.value || '1';
  const markings = [...root.querySelectorAll('input[name="marking"]:checked')].map(input => input.value);
  const meaningful = Boolean(revision.trim() || comment.trim() || markings.length || Number(quantity) !== 1);
  return { key, meaningful, revision, comment, quantity, markings, savedAt: new Date().toISOString() };
}

function saveCurrentDraft() {
  const draft = readDraft();
  if (!draft) return;
  const drafts = loadDrafts();
  if (draft.meaningful) drafts[draft.key] = draft;
  else delete drafts[draft.key];
  persistDrafts(drafts);
}

function scheduleSave() {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(saveCurrentDraft, 180);
}

function clearDraft(key) {
  if (!key) return;
  const drafts = loadDrafts();
  if (!drafts[key]) return;
  delete drafts[key];
  persistDrafts(drafts);
  restoredKeys.delete(key);
}

function showRecoveryBanner(detail, draft) {
  if (detail.querySelector('[data-field-recovery-banner]')) return;
  const actions = detail.querySelector('.new-copy-panel .actions');
  if (!actions) return;
  const banner = document.createElement('div');
  banner.className = 'alert soft-alert';
  banner.dataset.fieldRecoveryBanner = '1';
  banner.innerHTML = `<strong>Rascunho recuperado.</strong> Dados não enviados desta verificação foram restaurados após a interrupção. <button class="btn" data-discard-recovered-draft type="button">Descartar rascunho</button>`;
  actions.before(banner);
  banner.querySelector('[data-discard-recovered-draft]')?.addEventListener('click', () => {
    clearDraft(draft.key);
    const revision = detail.querySelector('#found-revision');
    const comment = detail.querySelector('#comment');
    const quantity = detail.querySelector('#copy-quantity');
    if (revision) revision.value = '';
    if (comment) comment.value = '';
    if (quantity) quantity.value = '1';
    detail.querySelectorAll('input[name="marking"]').forEach(input => { input.checked = false; });
    banner.remove();
    revision?.focus();
  });
}

function restoreDraftIfNeeded(root = document) {
  const key = currentFingerprint(root);
  if (!key || restoredKeys.has(key)) return;
  const draft = loadDrafts()[key];
  if (!draft) return;

  const detail = root.querySelector('.doc-detail');
  const revision = detail?.querySelector('#found-revision');
  const comment = detail?.querySelector('#comment');
  const quantity = detail?.querySelector('#copy-quantity');
  if (!detail || !revision || !comment || !quantity) return;

  const liveHasContent = Boolean(
    revision.value.trim() ||
    comment.value.trim() ||
    detail.querySelectorAll('input[name="marking"]:checked').length ||
    Number(quantity.value || 1) !== 1
  );
  if (liveHasContent) return;

  revision.value = draft.revision || '';
  comment.value = draft.comment || '';
  quantity.value = String(Math.min(9999, Math.max(1, Number.parseInt(draft.quantity, 10) || 1)));
  const selected = new Set(Array.isArray(draft.markings) ? draft.markings : []);
  detail.querySelectorAll('input[name="marking"]').forEach(input => { input.checked = selected.has(input.value); });
  restoredKeys.add(key);
  showRecoveryBanner(detail, draft);
}

function bindDraftInputs(root = document) {
  const detail = root.querySelector('.doc-detail');
  if (!detail || detail.dataset.fieldRecoveryBound === '1') return;
  if (!currentFingerprint(root)) return;
  detail.dataset.fieldRecoveryBound = '1';

  detail.querySelectorAll('#found-revision, #copy-quantity, #comment, input[name="marking"]').forEach(input => {
    input.addEventListener('input', scheduleSave);
    input.addEventListener('change', scheduleSave);
  });

  const armClear = () => {
    saveCurrentDraft();
    pendingClearKey = currentFingerprint(root);
    window.setTimeout(() => {
      if (!pendingClearKey) return;
      const liveKey = currentFingerprint(document);
      if (!liveKey || liveKey !== pendingClearKey) clearDraft(pendingClearKey);
      pendingClearKey = null;
    }, 900);
  };
  detail.querySelector('#save-verification')?.addEventListener('click', armClear);
  detail.querySelector('#mark-not-found')?.addEventListener('click', armClear);
}

function reconcile(root = document) {
  if (pendingClearKey) {
    const liveKey = currentFingerprint(root);
    if (!liveKey || liveKey !== pendingClearKey) {
      clearDraft(pendingClearKey);
      pendingClearKey = null;
    }
  }
  restoreDraftIfNeeded(root);
  bindDraftInputs(root);
}

function start() {
  reconcile();
  const app = document.querySelector('#app');
  if (!app || observer) return;
  observer = new MutationObserver(() => reconcile(app));
  observer.observe(app, { childList: true, subtree: true });
  window.addEventListener('pagehide', saveCurrentDraft);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveCurrentDraft();
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
else start();
