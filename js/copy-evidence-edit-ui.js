import { deleteEvidence, listInspections, saveEvidence, saveInspection } from './db.js';
import { createId } from './domain.js';
import { syncNow } from './sync.js';
import { showToast } from './ui.js';
import { prepareEvidenceImage } from './vision.js';

let lastEditCopyId = null;
let observer = null;

async function findCopyContext(copyId) {
  const inspections = await listInspections();
  for (const inspection of inspections) {
    for (const document of inspection.documents || []) {
      const copy = document.fieldCopies?.find(item => item.id === copyId);
      if (copy) return { inspection, document, copy };
    }
  }
  return null;
}

function formatSize(bytes) {
  const size = Number(bytes) || 0;
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

async function persistEvidenceForCopy(copyId, pending) {
  const context = await findCopyContext(copyId);
  if (!context) throw new Error('A cópia editada não está mais disponível.');
  if (context.copy.evidenceId || context.copy.evidencePath) {
    throw new Error('Esta cópia já possui uma evidência fotográfica vinculada.');
  }

  const evidenceId = createId();
  let stored = false;
  try {
    await saveEvidence({ id: evidenceId, blob: pending.blob, name: pending.name });
    stored = true;
    const now = new Date().toISOString();
    context.copy.evidenceId = evidenceId;
    context.copy.photoName = pending.name;
    context.copy.evidencePath = null;
    context.copy.evidenceUnavailableAt = null;
    context.copy.evidenceUnavailableReason = null;
    context.copy.updatedAt = now;
    context.document.verifiedAt = now;
    await saveInspection(context.inspection);
    syncNow({ announce: false }).catch(() => {});
    window.dispatchEvent(new CustomEvent('sky17:sync-complete'));
    showToast('Foto adicionada à cópia existente.');
  } catch (error) {
    if (stored) await deleteEvidence(evidenceId).catch(() => {});
    throw error;
  }
}

function waitUntilModalCloses(modal, timeoutMs = 12000) {
  return new Promise(resolve => {
    const started = Date.now();
    const tick = () => {
      if (!modal.isConnected) return resolve(true);
      if (Date.now() - started >= timeoutMs) return resolve(false);
      window.setTimeout(tick, 80);
    };
    tick();
  });
}

async function enhanceEditModal(modal) {
  if (!modal || modal.dataset.copyEvidenceEnhanced || !lastEditCopyId) return;
  modal.dataset.copyEvidenceEnhanced = '1';
  const copyId = lastEditCopyId;
  const context = await findCopyContext(copyId).catch(() => null);
  if (!modal.isConnected || !context) return;

  const actions = modal.querySelector('.actions');
  if (!actions) return;

  const section = document.createElement('div');
  section.className = 'field full copy-evidence-edit-field';
  section.innerHTML = context.copy.evidenceId || context.copy.evidencePath
    ? `<label>Foto / Evidência</label><div class="copy-evidence-existing">Esta cópia já possui uma foto vinculada. Use o histórico para visualizar a evidência atual.</div>`
    : `<label>Foto / Evidência</label>
       <input type="file" accept="image/*" capture="environment" data-copy-evidence-input hidden>
       <div class="copy-evidence-picker">
         <div data-copy-evidence-state><strong>Nenhuma foto adicionada</strong><small>Você pode vincular uma foto a esta mesma cópia sem criar outro registro.</small></div>
         <button class="btn" data-copy-evidence-pick type="button">+ Adicionar foto</button>
       </div>`;
  actions.before(section);

  const input = section.querySelector('[data-copy-evidence-input]');
  const picker = section.querySelector('[data-copy-evidence-pick]');
  const state = section.querySelector('[data-copy-evidence-state]');
  if (!input || !picker || !state) return;

  picker.addEventListener('click', () => input.click());
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      picker.disabled = true;
      picker.textContent = 'Preparando foto…';
      const prepared = await prepareEvidenceImage(file);
      modal.__pendingCopyEvidence = { blob: prepared.blob, name: file.name || `evidencia-${Date.now()}.jpg` };
      state.innerHTML = `<strong>${file.name || 'Fotografia'}</strong><small>${formatSize(prepared.blob.size)} · será adicionada ao salvar as alterações</small>`;
      picker.textContent = 'Substituir seleção';
    } catch (error) {
      modal.__pendingCopyEvidence = null;
      showToast(error.message || 'Não foi possível preparar a foto.', 'error');
      picker.textContent = '+ Adicionar foto';
    } finally {
      picker.disabled = false;
    }
  });

  const saveButton = modal.querySelector('#save-copy-edit');
  saveButton?.addEventListener('click', async () => {
    const pending = modal.__pendingCopyEvidence;
    if (!pending || modal.dataset.copyEvidenceCommitScheduled) return;
    modal.dataset.copyEvidenceCommitScheduled = '1';
    const saved = await waitUntilModalCloses(modal);
    if (!saved) {
      delete modal.dataset.copyEvidenceCommitScheduled;
      return;
    }
    try {
      await persistEvidenceForCopy(copyId, pending);
    } catch (error) {
      showToast(error.message || 'As alterações foram salvas, mas não foi possível anexar a foto.', 'error');
    }
  });
}

function inspectForEditModal() {
  document.querySelectorAll('.modal').forEach(modal => {
    if (modal.querySelector('#save-copy-edit')) enhanceEditModal(modal);
  });
}

function start() {
  document.addEventListener('click', event => {
    const button = event.target.closest?.('[data-copy-edit]');
    if (button?.dataset.copyEdit) lastEditCopyId = button.dataset.copyEdit;
  }, true);

  observer = new MutationObserver(inspectForEditModal);
  observer.observe(document.body, { childList: true, subtree: true });
  inspectForEditModal();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
else start();
