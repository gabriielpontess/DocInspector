import { getAuthContext } from './auth-context.js';
import { getInspection, listInspections, saveInspection } from './db.js';
import { CAPABILITY, can } from './permissions.js';
import { syncNow } from './sync.js';
import { escapeHtml, formatDate, openModal, setButtonBusy, showToast } from './ui.js';
import { buildRestoredDocumentGeneration, listRestorableDeletedDocuments } from './recovery-core.js';

let enhanceQueued = false;
let recoveryBusy = false;

function contextOrThrow(capability = null) {
  const context = getAuthContext();
  if (!context?.workspaceId || !context?.userId) throw new Error('Sessão autenticada não disponível.');
  if (capability && !can(context.role, capability)) throw new Error('Sua função não permite esta operação.');
  return context;
}

function requireOnline() {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new Error('Conecte-se à internet para restaurar um documento com o estado mais recente do workspace.');
  }
}

async function restoreDeletedDocument(inspectionId, archivedDocumentId) {
  requireOnline();
  const context = contextOrThrow(CAPABILITY.MANAGE_DOCUMENTS);

  // Consolida alterações pendentes e puxa a versão mais recente antes de criar
  // a nova geração, evitando restaurar sobre um payload obsoleto.
  await syncNow({ announce: false });
  const fresh = await getInspection(inspectionId);
  if (!fresh) throw new Error('A inspeção não está mais disponível.');

  const restored = buildRestoredDocumentGeneration(fresh, archivedDocumentId, {
    actor: context.email || context.displayName || context.userId
  });
  await saveInspection(restored.inspection);

  window.dispatchEvent(new CustomEvent('sky17:sync-complete', {
    detail: { localMutation: true, at: new Date().toISOString() }
  }));

  try {
    await syncNow({ announce: true });
    return { ...restored, syncPending: false };
  } catch {
    return { ...restored, syncPending: true };
  }
}

async function openDocumentTrash() {
  contextOrThrow(CAPABILITY.MANAGE_DOCUMENTS);
  const inspections = await listInspections();
  const entries = inspections.flatMap(inspection =>
    listRestorableDeletedDocuments(inspection).map(entry => ({ inspection, entry }))
  ).sort((a, b) => String(a.entry.document.code || '').localeCompare(String(b.entry.document.code || ''), 'pt-BR', { numeric: true, sensitivity: 'base' }));
  const online = navigator.onLine !== false;
  const modal = openModal(`
    <div class="modal-head"><div><span class="section-kicker">LIXEIRA DE DOCUMENTOS</span><h2>Documentos excluídos</h2></div></div>
    <p>A exclusão lógica preserva cópias de campo, comentários e evidências. A restauração cria uma nova geração interna e mantém o UUID antigo tombstonado contra aparelhos desatualizados.</p>
    ${online ? '' : '<div class="alert">Você pode consultar a lixeira offline, mas a restauração exige conexão para sincronizar o estado mais recente.</div>'}
    <div class="user-admin-list" data-document-trash-list>
      ${entries.length ? entries.map(({ inspection, entry }) => `<article class="user-admin-member" data-document-trash-inspection="${escapeHtml(inspection.id)}" data-document-trash-id="${escapeHtml(entry.document.id)}">
        <div class="user-admin-member-copy"><strong>${escapeHtml(entry.document.code)}</strong><span>${escapeHtml(inspection.system || 'Sem sistema')} · ${escapeHtml(inspection.name || inspection.project || 'Inspeção')}</span><small>${escapeHtml(entry.document.description || '')} · excluído ${escapeHtml(formatDate(entry.deletedAt))}</small></div>
        <div class="user-admin-member-controls"><button class="btn btn-primary" data-restore-document type="button" ${online ? '' : 'disabled'}>Restaurar documento</button></div>
      </article>`).join('') : '<div class="card empty"><div><strong>Lixeira vazia.</strong><small>Nenhum documento excluído está aguardando recuperação.</small></div></div>'}
    </div>
  `, { label: 'Lixeira de documentos' });

  modal.querySelectorAll('[data-document-trash-id]').forEach(row => {
    row.querySelector('[data-restore-document]')?.addEventListener('click', async event => {
      if (recoveryBusy) return;
      const button = event.currentTarget;
      try {
        recoveryBusy = true;
        setButtonBusy(button, true, 'Restaurando…');
        const result = await restoreDeletedDocument(row.dataset.documentTrashInspection, row.dataset.documentTrashId);
        const syncNote = result.syncPending ? ' A alteração ficou salva localmente e a sincronização será repetida.' : '';
        showToast(`Documento restaurado com histórico preservado.${syncNote}`, result.syncPending ? '' : 'success');
        row.remove();
        const list = modal.querySelector('[data-document-trash-list]');
        if (list && !list.querySelector('[data-document-trash-id]')) {
          list.innerHTML = '<div class="card empty"><div><strong>Lixeira vazia.</strong><small>Nenhum documento excluído está aguardando recuperação.</small></div></div>';
        }
      } catch (error) {
        showToast(error?.message || 'Não foi possível restaurar o documento.', 'error');
      } finally {
        recoveryBusy = false;
        if (button?.isConnected) setButtonBusy(button, false);
      }
    });
  });
}

function enhanceDocumentDeleteLabels() {
  const title = 'Excluir o documento da inspeção';
  document.querySelectorAll('[data-delete-document]').forEach(button => {
    const label = button.querySelector('span');
    if (label && label.textContent !== 'Excluir documento') label.textContent = 'Excluir documento';
    if (button.title !== title) button.title = title;
  });
}

function enhanceDocumentCatalog() {
  const context = getAuthContext();
  if (!context || !can(context.role, CAPABILITY.MANAGE_DOCUMENTS)) return;
  const catalog = document.querySelector('.documents-catalog');
  const title = catalog?.querySelector(':scope > .section-title');
  if (!title || title.querySelector('[data-document-trash-launcher]')) return;
  const wrapper = document.createElement('span');
  wrapper.dataset.documentTrashLauncher = 'true';
  wrapper.innerHTML = '<button class="btn" type="button">Lixeira de documentos</button>';
  wrapper.querySelector('button')?.addEventListener('click', () => void openDocumentTrash().catch(error => showToast(error?.message || 'Não foi possível abrir a lixeira de documentos.', 'error')));
  title.append(wrapper);
}

function enhanceUi() {
  enhanceQueued = false;
  if (typeof document === 'undefined') return;
  enhanceDocumentDeleteLabels();
  enhanceDocumentCatalog();
}

function scheduleEnhance() {
  if (enhanceQueued) return;
  enhanceQueued = true;
  queueMicrotask(enhanceUi);
}

function start() {
  const observer = new MutationObserver(scheduleEnhance);
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener('online', scheduleEnhance);
  window.addEventListener('offline', scheduleEnhance);
  window.addEventListener('sky17:sync-complete', scheduleEnhance);
  scheduleEnhance();
}

if (typeof document !== 'undefined' && document.body) start();

export { openDocumentTrash, restoreDeletedDocument };
