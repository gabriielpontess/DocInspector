import { getAuthClient } from './auth.js';
import { getAuthContext } from './auth-context.js';
import { getInspection, listInspections, saveInspection } from './db.js';
import { CAPABILITY, can } from './permissions.js';
import { deleteCachedConfidentialCiphertext } from './confidential-offline.js';
import { syncNow } from './sync.js';
import { escapeHtml, formatDate, openModal, setButtonBusy, showToast } from './ui.js';
import {
  buildPdfRestorePatch,
  buildPdfSoftDeletePatch,
  buildRestoredDocumentGeneration,
  listRestorableDeletedDocuments,
  splitConfidentialObjectPath
} from './recovery-core.js';

const PROJECT_DOCUMENTS_TABLE = 'docinspector_project_documents';
const CONFIDENTIAL_BUCKET = 'docinspector-confidential-pdfs';
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
    throw new Error('Conecte-se à internet para alterar a lixeira.');
  }
}

function formatBytes(value) {
  const bytes = Number(value) || 0;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 ** 2)).toFixed(1)} MiB`;
}

async function fetchPdfRecord(fileId) {
  requireOnline();
  const context = contextOrThrow(CAPABILITY.MANAGE_PROJECT_FILES);
  const client = getAuthClient();
  const { data, error } = await client
    .from(PROJECT_DOCUMENTS_TABLE)
    .select('*')
    .eq('workspace_id', context.workspaceId)
    .eq('id', String(fileId || ''))
    .maybeSingle();
  if (error || !data) throw new Error('PDF confidencial não encontrado no workspace.');
  return data;
}

async function listDeletedPdfs(inspectionId) {
  requireOnline();
  const context = contextOrThrow(CAPABILITY.MANAGE_PROJECT_FILES);
  const client = getAuthClient();
  const { data, error } = await client
    .from(PROJECT_DOCUMENTS_TABLE)
    .select('*')
    .eq('workspace_id', context.workspaceId)
    .eq('inspection_id', inspectionId)
    .eq('status', 'DELETED')
    .order('deleted_at', { ascending: false });
  if (error) throw new Error('Não foi possível carregar a lixeira de PDFs.');
  return data || [];
}

async function softDeletePdf(record) {
  requireOnline();
  const context = contextOrThrow(CAPABILITY.MANAGE_PROJECT_FILES);
  if (record?.status !== 'ACTIVE') throw new Error('Somente PDFs ativos podem ser movidos para a lixeira.');
  const client = getAuthClient();
  const patch = buildPdfSoftDeletePatch();
  const { data, error } = await client
    .from(PROJECT_DOCUMENTS_TABLE)
    .update(patch)
    .eq('workspace_id', context.workspaceId)
    .eq('id', record.id)
    .eq('status', 'ACTIVE')
    .select('*')
    .single();
  if (error || !data) throw new Error('Não foi possível mover o PDF para a lixeira.');

  // A cópia local é removida para que um aparelho offline não continue exibindo
  // um PDF já excluído. O ciphertext remoto permanece intacto para restauração.
  await deleteCachedConfidentialCiphertext({
    workspaceId: data.workspace_id,
    inspectionId: data.inspection_id,
    fileId: data.id
  }).catch(() => {});
  return data;
}

async function confidentialObjectExists(record) {
  const client = getAuthClient();
  const { folder, filename } = splitConfidentialObjectPath(record?.object_path);
  const { data, error } = await client.storage.from(CONFIDENTIAL_BUCKET).list(folder, {
    limit: 20,
    search: filename
  });
  if (error) throw new Error('Não foi possível verificar o ciphertext antes da restauração.');
  return (data || []).some(item => item?.name === filename);
}

async function restorePdf(record) {
  requireOnline();
  const context = contextOrThrow(CAPABILITY.MANAGE_PROJECT_FILES);
  if (record?.status !== 'DELETED') throw new Error('Somente PDFs da lixeira podem ser restaurados.');
  if (!await confidentialObjectExists(record)) {
    throw new Error('O ciphertext deste PDF não existe mais no Storage. Ele não pode ser restaurado automaticamente.');
  }
  const client = getAuthClient();
  const { data, error } = await client
    .from(PROJECT_DOCUMENTS_TABLE)
    .update(buildPdfRestorePatch())
    .eq('workspace_id', context.workspaceId)
    .eq('id', record.id)
    .eq('status', 'DELETED')
    .select('*')
    .single();
  if (error || !data) throw new Error('Não foi possível restaurar o PDF confidencial.');
  return data;
}

async function refreshPdfSurfaces() {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  const [{ refreshAll }, { mountDetailPdfSection }] = await Promise.all([
    import('./confidential-e2ee-ui.js'),
    import('./confidential-pdf-linking-ui.js')
  ]);
  await refreshAll().catch(() => {});
  await mountDetailPdfSection({ force: true }).catch(() => {});
}

function documentLookup(inspection) {
  const map = new Map();
  for (const document of inspection?.documents || []) map.set(document.id, document);
  for (const entry of inspection?.deletedDocuments || []) {
    if (entry?.document?.id && !map.has(entry.document.id)) map.set(entry.document.id, entry.document);
  }
  return map;
}

async function openPdfTrash() {
  if (recoveryBusy) return;
  requireOnline();
  contextOrThrow(CAPABILITY.MANAGE_PROJECT_FILES);
  const inspectionId = document.querySelector('#confidential-inspection-select')?.value || '';
  if (!inspectionId) throw new Error('Selecione uma inspeção antes de abrir a lixeira de PDFs.');
  const [rows, inspection] = await Promise.all([
    listDeletedPdfs(inspectionId),
    getInspection(inspectionId).catch(() => null)
  ]);
  const documents = documentLookup(inspection);
  const modal = openModal(`
    <div class="modal-head"><div><span class="section-kicker">LIXEIRA DE PDFS</span><h2>PDFs removidos desta inspeção</h2></div></div>
    <p>Restaurar reativa o mesmo arquivo cifrado e o mesmo vínculo. O documento da inspeção não é alterado.</p>
    <div class="user-admin-list" data-pdf-trash-list>
      ${rows.length ? rows.map(row => {
        const linked = documents.get(row.document_id);
        const label = linked?.code ? ` · PW ${linked.code}` : '';
        return `<article class="user-admin-member" data-pdf-trash-id="${escapeHtml(row.id)}">
          <div class="user-admin-member-copy"><strong>PDF ${escapeHtml(String(row.id).slice(0, 8))}${escapeHtml(label)}</strong><span>${escapeHtml(formatBytes(row.plaintext_size))} · excluído ${escapeHtml(formatDate(row.deleted_at || row.updated_at || row.created_at))}</span></div>
          <div class="user-admin-member-controls"><button class="btn btn-primary" data-restore-pdf type="button">Restaurar PDF</button></div>
        </article>`;
      }).join('') : '<div class="card empty"><div><strong>Lixeira vazia.</strong><small>Nenhum PDF desta inspeção está excluído.</small></div></div>'}
    </div>
  `, { label: 'Lixeira de PDFs' });

  const byId = new Map(rows.map(row => [row.id, row]));
  modal.querySelectorAll('[data-pdf-trash-id]').forEach(row => {
    row.querySelector('[data-restore-pdf]')?.addEventListener('click', async event => {
      const button = event.currentTarget;
      const record = byId.get(row.dataset.pdfTrashId);
      if (!record || recoveryBusy) return;
      try {
        recoveryBusy = true;
        setButtonBusy(button, true, 'Restaurando…');
        await restorePdf(record);
        showToast('PDF restaurado sem alterar o documento da inspeção.', 'success');
        modal.closeModal();
        await refreshPdfSurfaces();
      } catch (error) {
        showToast(error?.message || 'Não foi possível restaurar o PDF.', 'error');
      } finally {
        recoveryBusy = false;
        if (button?.isConnected) setButtonBusy(button, false);
      }
    });
  });
}

async function relinkConfidentialPdfs({ workspaceId, inspectionId, fromDocumentId, toDocumentId }) {
  const client = getAuthClient();
  const { data, error } = await client
    .from(PROJECT_DOCUMENTS_TABLE)
    .update({ document_id: toDocumentId })
    .eq('workspace_id', workspaceId)
    .eq('inspection_id', inspectionId)
    .eq('document_id', fromDocumentId)
    .select('id');
  if (error) throw new Error('Não foi possível relincar os PDFs do documento restaurado.');
  return (data || []).map(item => item.id);
}

async function rollbackPdfRelink({ workspaceId, inspectionId, fromDocumentId, toDocumentId, pdfIds }) {
  if (!pdfIds?.length) return;
  const client = getAuthClient();
  await client
    .from(PROJECT_DOCUMENTS_TABLE)
    .update({ document_id: fromDocumentId })
    .eq('workspace_id', workspaceId)
    .eq('inspection_id', inspectionId)
    .eq('document_id', toDocumentId)
    .in('id', pdfIds);
}

async function restoreDeletedDocument(inspectionId, archivedDocumentId) {
  requireOnline();
  const context = contextOrThrow(CAPABILITY.MANAGE_DOCUMENTS);
  if (!can(context.role, CAPABILITY.MANAGE_PROJECT_FILES)) {
    throw new Error('A restauração exige permissão para relincar PDFs de projeto com segurança.');
  }

  // Antes de criar a nova geração, consolida a exclusão/evidências pendentes e
  // puxa a versão mais recente para não restaurar sobre um payload obsoleto.
  await syncNow({ announce: false });
  const fresh = await getInspection(inspectionId);
  if (!fresh) throw new Error('A inspeção não está mais disponível.');

  const restored = buildRestoredDocumentGeneration(fresh, archivedDocumentId, {
    actor: context.email || context.displayName || context.userId
  });
  const relinkedPdfIds = await relinkConfidentialPdfs({
    workspaceId: context.workspaceId,
    inspectionId,
    fromDocumentId: restored.archivedDocumentId,
    toDocumentId: restored.restoredDocument.id
  });

  try {
    await saveInspection(restored.inspection);
  } catch (error) {
    await rollbackPdfRelink({
      workspaceId: context.workspaceId,
      inspectionId,
      fromDocumentId: restored.archivedDocumentId,
      toDocumentId: restored.restoredDocument.id,
      pdfIds: relinkedPdfIds
    }).catch(() => {});
    throw error;
  }

  window.dispatchEvent(new CustomEvent('sky17:sync-complete', {
    detail: { localMutation: true, at: new Date().toISOString() }
  }));

  try {
    await syncNow({ announce: true });
    return { ...restored, relinkedPdfCount: relinkedPdfIds.length, syncPending: false };
  } catch {
    return { ...restored, relinkedPdfCount: relinkedPdfIds.length, syncPending: true };
  }
}

async function openDocumentTrash() {
  contextOrThrow(CAPABILITY.MANAGE_DOCUMENTS);
  const inspections = await listInspections();
  const entries = inspections.flatMap(inspection =>
    listRestorableDeletedDocuments(inspection).map(entry => ({ inspection, entry }))
  );
  const online = navigator.onLine !== false;
  const modal = openModal(`
    <div class="modal-head"><div><span class="section-kicker">LIXEIRA DE DOCUMENTOS</span><h2>Documentos excluídos</h2></div></div>
    <p>A exclusão lógica preserva cópias de campo, comentários e evidências. A restauração cria uma nova geração interna e mantém o UUID antigo tombstonado contra aparelhos desatualizados.</p>
    ${online ? '' : '<div class="alert">Você pode consultar a lixeira offline, mas a restauração exige conexão para relincar PDFs com segurança.</div>'}
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
        const pdfNote = result.relinkedPdfCount ? ` ${result.relinkedPdfCount} PDF(s) foram relincados.` : '';
        const syncNote = result.syncPending ? ' A alteração ficou salva localmente e a sincronização será repetida.' : '';
        showToast(`Documento restaurado com histórico preservado.${pdfNote}${syncNote}`, result.syncPending ? '' : 'success');
        modal.closeModal();
        await refreshPdfSurfaces();
      } catch (error) {
        showToast(error?.message || 'Não foi possível restaurar o documento.', 'error');
      } finally {
        recoveryBusy = false;
        if (button?.isConnected) setButtonBusy(button, false);
      }
    });
  });
}

async function handlePdfSoftDelete(fileId, button) {
  if (recoveryBusy) return;
  const record = await fetchPdfRecord(fileId);
  if (!confirm('Mover somente este PDF para a lixeira? O documento da inspeção continuará ativo e o ciphertext será preservado para restauração.')) return;
  try {
    recoveryBusy = true;
    setButtonBusy(button, true, 'Movendo…');
    await softDeletePdf(record);
    showToast('PDF movido para a lixeira. O documento da inspeção foi preservado.', 'success');
    await refreshPdfSurfaces();
  } catch (error) {
    showToast(error?.message || 'Não foi possível mover o PDF para a lixeira.', 'error');
  } finally {
    recoveryBusy = false;
    if (button?.isConnected) setButtonBusy(button, false);
  }
}

function interceptPdfDeleteClicks() {
  document.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target : null;
    const legacy = target?.closest('[data-confidential-delete]');
    const linked = target?.closest('[data-recovery-pdf-delete]');
    const button = linked || legacy;
    if (!button) return;

    // Capture phase: impede o handler legado, que removia o ciphertext do Storage.
    event.preventDefault();
    event.stopImmediatePropagation();
    const row = button.closest('[data-linked-confidential-id],[data-confidential-id]');
    const fileId = button.dataset.recoveryPdfDelete || row?.dataset.linkedConfidentialId || row?.dataset.confidentialId || '';
    if (!fileId) return;
    void handlePdfSoftDelete(fileId, button);
  }, true);
}

function enhanceDocumentDeleteLabels() {
  document.querySelectorAll('[data-delete-document]').forEach(button => {
    const label = button.querySelector('span');
    if (label) label.textContent = 'Excluir documento';
    button.title = 'Excluir o documento da inspeção (não exclui apenas o PDF)';
  });
}

function enhanceLinkedPdfRows() {
  const context = getAuthContext();
  if (!context || !can(context.role, CAPABILITY.MANAGE_PROJECT_FILES)) return;
  document.querySelectorAll('[data-linked-confidential-id]').forEach(row => {
    const controls = row.querySelector('.user-admin-member-controls');
    if (!controls) return;
    const fileId = row.dataset.linkedConfidentialId || '';
    let button = controls.querySelector('[data-recovery-pdf-delete]');
    if (navigator.onLine === false) {
      button?.remove();
      return;
    }
    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn-danger';
      button.dataset.recoveryPdfDelete = fileId;
      button.textContent = 'Excluir PDF';
      button.title = 'Mover somente este PDF para a lixeira';
      controls.append(button);
    }
  });
}

function enhanceConfidentialCatalog() {
  const context = getAuthContext();
  if (!context || !can(context.role, CAPABILITY.MANAGE_PROJECT_FILES)) return;
  document.querySelectorAll('[data-confidential-delete]').forEach(button => {
    button.textContent = 'Excluir PDF';
    button.title = 'Mover somente este PDF para a lixeira';
  });
  const actions = document.querySelector('#confidential-documents-actions');
  if (!actions) return;
  let trash = actions.querySelector('#confidential-pdf-trash');
  if (navigator.onLine === false) {
    trash?.remove();
    return;
  }
  if (!trash) {
    trash = document.createElement('button');
    trash.id = 'confidential-pdf-trash';
    trash.type = 'button';
    trash.className = 'btn';
    trash.textContent = 'Lixeira de PDFs';
    trash.addEventListener('click', () => void openPdfTrash().catch(error => showToast(error?.message || 'Não foi possível abrir a lixeira de PDFs.', 'error')));
    actions.append(trash);
  }
}

function enhanceDocumentCatalog() {
  const context = getAuthContext();
  if (!context || !can(context.role, CAPABILITY.MANAGE_DOCUMENTS)) return;
  const catalog = document.querySelector('.documents-catalog:not(#confidential-documents-card)');
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
  enhanceLinkedPdfRows();
  enhanceConfidentialCatalog();
  enhanceDocumentCatalog();
}

function scheduleEnhance() {
  if (enhanceQueued) return;
  enhanceQueued = true;
  queueMicrotask(enhanceUi);
}

function start() {
  interceptPdfDeleteClicks();
  const observer = new MutationObserver(scheduleEnhance);
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener('online', scheduleEnhance);
  window.addEventListener('offline', scheduleEnhance);
  window.addEventListener('sky17:sync-complete', scheduleEnhance);
  scheduleEnhance();
}

if (typeof document !== 'undefined' && document.body) start();

export {
  openDocumentTrash,
  openPdfTrash,
  restoreDeletedDocument,
  restorePdf,
  softDeletePdf
};
