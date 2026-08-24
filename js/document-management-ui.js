import { getAuthContext } from './auth-context.js';
import { authRolloutEnabled } from './auth-config.js';
import { getInspection, saveInspection } from './db.js';
import { deleteDocumentLogically, updateDocumentMetadata } from './document-lifecycle.js';
import { CAPABILITY, can } from './permissions.js';
import { syncNow } from './sync.js';
import { escapeHtml, icon, openModal, setButtonBusy, showToast } from './ui.js';

let refreshQueued = false;
let detailMountToken = 0;

function canManageDocuments() {
  if (document.documentElement.dataset.authTestBypass === 'true') return true;
  if (!authRolloutEnabled()) return true;
  const role = getAuthContext()?.role;
  return can(role, CAPABILITY.MANAGE_DOCUMENTS);
}

function actorIdentity() {
  const context = getAuthContext();
  return context?.email || context?.displayName || context?.userId || null;
}

function notifyLocalMutation() {
  window.dispatchEvent(new CustomEvent('sky17:sync-complete', {
    detail: { localMutation: true, at: new Date().toISOString() }
  }));
}

function scheduleSync() {
  if (!navigator.onLine) return;
  syncNow({ announce: true }).catch(error => {
    showToast(error?.message || 'A alteração foi salva localmente, mas ainda não sincronizou.', 'error');
  });
}

async function saveMetadata(inspectionId, documentId, values) {
  const inspection = await getInspection(inspectionId);
  if (!inspection) throw new Error('A inspeção não está mais disponível.');
  updateDocumentMetadata(inspection, documentId, values, { actor: actorIdentity() });
  await saveInspection(inspection);
  notifyLocalMutation();
  scheduleSync();
}

async function saveLogicalDeletion(inspectionId, documentId, reason) {
  const inspection = await getInspection(inspectionId);
  if (!inspection) throw new Error('A inspeção não está mais disponível.');
  deleteDocumentLogically(inspection, documentId, { actor: actorIdentity(), reason });
  await saveInspection(inspection);
  notifyLocalMutation();
  scheduleSync();
}

async function editDocument(inspectionId, documentId) {
  const inspection = await getInspection(inspectionId);
  const document = inspection?.documents?.find(item => item.id === documentId);
  if (!inspection || !document) {
    showToast('Documento não encontrado.', 'error');
    return;
  }

  const modal = openModal(`
    <div class="modal-header">
      <div><span class="section-kicker">GERENCIAR DOCUMENTO</span><h2>Editar documento</h2><p class="subtitle">A edição preserva cópias de campo, evidências, comentários e o identificador interno do documento.</p></div>
      <button class="icon-button" data-close-document-editor type="button" aria-label="Fechar">${icon('close')}</button>
    </div>
    <div class="form-grid">
      <div class="field"><label for="manage-document-code">Código PW</label><input id="manage-document-code" value="${escapeHtml(document.code)}" autocomplete="off" autocapitalize="characters" spellcheck="false"></div>
      <div class="field"><label for="manage-document-revision">Revisão esperada</label><input id="manage-document-revision" value="${escapeHtml(document.expectedRevision || '')}" autocomplete="off" autocapitalize="characters" spellcheck="false"></div>
      <div class="field full"><label for="manage-document-description">Descrição</label><textarea id="manage-document-description" rows="3">${escapeHtml(document.description || '')}</textarea></div>
      <div class="field full"><label for="manage-document-status">Status da lista</label><input id="manage-document-status" value="${escapeHtml(document.status || '')}" autocomplete="off"></div>
    </div>
    <div class="modal-message" data-document-management-message hidden></div>
    <div class="actions modal-actions"><button class="btn" data-close-document-editor type="button">Cancelar</button><button class="btn btn-primary" id="save-document-metadata" type="button">Salvar alterações</button></div>
  `, { label: `Editar documento ${document.code}` });

  modal.querySelectorAll('[data-close-document-editor]').forEach(button => button.addEventListener('click', () => modal.closeModal()));
  modal.querySelector('#save-document-metadata')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    const message = modal.querySelector('[data-document-management-message]');
    try {
      setButtonBusy(button, true, 'Salvando…');
      await saveMetadata(inspectionId, documentId, {
        code: modal.querySelector('#manage-document-code')?.value || '',
        expectedRevision: modal.querySelector('#manage-document-revision')?.value || '',
        description: modal.querySelector('#manage-document-description')?.value || '',
        status: modal.querySelector('#manage-document-status')?.value || ''
      });
      showToast('Documento atualizado sem alterar os registros de campo.');
      modal.closeModal();
    } catch (error) {
      if (message) {
        message.hidden = false;
        message.textContent = error?.message || 'Não foi possível atualizar o documento.';
      }
    } finally {
      if (button?.isConnected) setButtonBusy(button, false);
    }
  });
}

async function deleteDocument(inspectionId, documentId) {
  const inspection = await getInspection(inspectionId);
  const document = inspection?.documents?.find(item => item.id === documentId);
  if (!inspection || !document) {
    showToast('Documento não encontrado.', 'error');
    return;
  }

  const copyCount = document.fieldCopies?.length || 0;
  const modal = openModal(`
    <div class="modal-header">
      <div><span class="section-kicker">EXCLUSÃO LÓGICA DO DOCUMENTO</span><h2>Excluir documento ${escapeHtml(document.code)}?</h2><p class="subtitle">Esta ação remove o documento da lista ativa. PDFs vinculados não são excluídos por esta ação, e o histórico do documento permanece preservado para recuperação, sincronização e auditoria.</p></div>
      <button class="icon-button" data-close-document-delete type="button" aria-label="Fechar">${icon('close')}</button>
    </div>
    <div class="alert">${copyCount ? `Este documento possui ${copyCount} ${copyCount === 1 ? 'cópia de campo registrada' : 'cópias de campo registradas'}. Esses dados e as evidências não serão apagados.` : 'O documento será tombstonado para não reaparecer automaticamente em uma atualização da planilha.'}</div>
    <div class="field"><label for="delete-document-reason">Motivo (opcional)</label><textarea id="delete-document-reason" rows="3" placeholder="Ex.: removido da lista operacional"></textarea></div>
    <div class="modal-message" data-document-management-message hidden></div>
    <div class="actions modal-actions"><button class="btn" data-close-document-delete type="button">Cancelar</button><button class="btn btn-danger" id="confirm-document-delete" type="button">Excluir documento da lista ativa</button></div>
  `, { label: `Excluir documento ${document.code}` });

  modal.querySelectorAll('[data-close-document-delete]').forEach(button => button.addEventListener('click', () => modal.closeModal()));
  modal.querySelector('#confirm-document-delete')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    const message = modal.querySelector('[data-document-management-message]');
    try {
      setButtonBusy(button, true, 'Excluindo documento…');
      await saveLogicalDeletion(inspectionId, documentId, modal.querySelector('#delete-document-reason')?.value || '');
      showToast('Documento removido da lista ativa com histórico preservado.');
      modal.closeModal();
    } catch (error) {
      if (message) {
        message.hidden = false;
        message.textContent = error?.message || 'Não foi possível excluir o documento.';
      }
    } finally {
      if (button?.isConnected) setButtonBusy(button, false);
    }
  });
}

function actionButtons(inspectionId, documentId, { compact = false } = {}) {
  const compactClass = compact ? ' btn-compact' : '';
  return `<button class="btn${compactClass}" data-edit-document="${escapeHtml(documentId)}" data-document-inspection="${escapeHtml(inspectionId)}" type="button">${icon('edit')}<span>Editar</span></button><button class="btn btn-danger${compactClass}" data-delete-document="${escapeHtml(documentId)}" data-document-inspection="${escapeHtml(inspectionId)}" type="button" title="Excluir o documento da inspeção (não exclui apenas o PDF)">${icon('trash')}<span>Excluir documento</span></button>`;
}

function bindManagementButton(button) {
  if (button.dataset.documentManagementBound === '1') return;
  button.dataset.documentManagementBound = '1';
  button.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    const inspectionId = button.dataset.documentInspection;
    const documentId = button.dataset.editDocument || button.dataset.deleteDocument;
    if (!inspectionId || !documentId) return;
    if (button.hasAttribute('data-edit-document')) void editDocument(inspectionId, documentId);
    else void deleteDocument(inspectionId, documentId);
  });
}

function mountListActions() {
  document.querySelectorAll('tr[data-doc-row][data-inspection-row]').forEach(row => {
    const cell = row.querySelector('.details-cell');
    if (!cell || cell.querySelector('[data-document-management-actions]')) return;
    const wrapper = document.createElement('span');
    wrapper.dataset.documentManagementActions = 'true';
    wrapper.className = 'document-management-row-actions';
    wrapper.innerHTML = actionButtons(row.dataset.inspectionRow || '', row.dataset.docRow || '', { compact: true });
    cell.append(wrapper);
    wrapper.querySelectorAll('[data-edit-document],[data-delete-document]').forEach(bindManagementButton);
  });
}

async function mountDetailActions() {
  const page = document.querySelector('.document-page');
  if (!page || page.querySelector('[data-document-management-actions]')) return;
  const token = ++detailMountToken;
  const inspectionId = localStorage.getItem('sky17-current') || '';
  const code = page.querySelector('.doc-heading h2')?.textContent?.trim() || '';
  if (!inspectionId || !code) return;
  const inspection = await getInspection(inspectionId).catch(() => null);
  if (token !== detailMountToken || !page.isConnected || !inspection) return;
  const matches = (inspection.documents || []).filter(item => item.code === code);
  if (matches.length !== 1) return;
  const targetDocument = matches[0];
  const actions = page.querySelector('.detail-actions');
  if (!actions) return;
  const wrapper = document.createElement('span');
  wrapper.dataset.documentManagementActions = 'true';
  wrapper.className = 'document-management-detail-actions';
  wrapper.innerHTML = actionButtons(inspection.id, targetDocument.id);
  actions.prepend(wrapper);
  wrapper.querySelectorAll('[data-edit-document],[data-delete-document]').forEach(bindManagementButton);
}

async function refreshManagementUi() {
  refreshQueued = false;
  if (!canManageDocuments()) return;
  mountListActions();
  await mountDetailActions();
}

function scheduleRefresh() {
  if (refreshQueued) return;
  refreshQueued = true;
  queueMicrotask(() => void refreshManagementUi());
}

const observer = new MutationObserver(scheduleRefresh);
observer.observe(document.body, { childList: true, subtree: true });
scheduleRefresh();
