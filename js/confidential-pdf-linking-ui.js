import { getAuthContext } from './auth-context.js';
import { getInspection } from './db.js';
import { CAPABILITY, can } from './permissions.js';
import { escapeHtml, openModal, setButtonBusy, showToast } from './ui.js';
import {
  CONFIDENTIAL_PDF_MAX_AGGREGATE_BYTES,
  CONFIDENTIAL_PDF_MAX_PLAINTEXT_BYTES,
  getConfidentialPdfConfig,
  listConfidentialDocuments,
  uploadConfidentialPdf
} from './confidential-storage.js';
import { CONFIDENTIAL_PDF_MATCH, matchConfidentialPdfBatch } from './confidential-pdf-matcher.js';
import { listCachedConfidentialDocuments } from './confidential-offline.js';
import { unlockConfidentialWorkspaceKeyResilient } from './confidential-offline-key.js';
import { openConfidentialPdfForViewer, resolveConfidentialCiphertext } from './confidential-viewer.js';
import { refreshAll as refreshConfidentialCatalog } from './confidential-e2ee-ui.js';

let observer = null;
let batchBusy = false;
let detailToken = 0;

function contextOrThrow() {
  const context = getAuthContext();
  if (!context?.workspaceId || !context?.userId) throw new Error('Sessão autenticada não disponível.');
  return context;
}

function formatBytes(value) {
  const bytes = Number(value) || 0;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 ** 2)).toFixed(1)} MiB`;
}

function injectStyles() {
  if (document.querySelector('#confidential-pdf-linking-styles')) return;
  const style = document.createElement('style');
  style.id = 'confidential-pdf-linking-styles';
  style.textContent = `
    .confidential-link-review-list{display:grid;gap:.75rem;margin:1rem 0;max-height:56dvh;overflow:auto;padding-right:.25rem}
    .confidential-link-review-row{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(15rem,1fr);gap:.75rem;align-items:center;border:1px solid var(--border-color,#d9dfe8);border-radius:12px;padding:.85rem}
    .confidential-link-review-file{min-width:0}.confidential-link-review-file strong{display:block;overflow-wrap:anywhere}.confidential-link-review-file small{display:block;margin-top:.3rem}
    .confidential-link-state{display:inline-flex;align-items:center;width:max-content;border-radius:999px;padding:.2rem .5rem;font-size:.78rem;font-weight:700;margin-top:.35rem}
    .confidential-link-state.exact{background:#e8f7ee;color:#166534}.confidential-link-state.suggested{background:#fff7db;color:#854d0e}.confidential-link-state.unlinked{background:#f2f4f7;color:#475467}
    .confidential-link-review-row select{width:100%}.confidential-linked-pdfs{margin-top:1.25rem}.confidential-linked-pdf-list{display:grid;gap:.65rem;margin-top:.75rem}
    @media(max-width:720px){.confidential-link-review-row{grid-template-columns:1fr}}
  `;
  document.head.append(style);
}

function stateLabel(status) {
  if (status === CONFIDENTIAL_PDF_MATCH.EXACT) return 'Código PW exato';
  if (status === CONFIDENTIAL_PDF_MATCH.SUGGESTED) return 'Sugestão por nome';
  return 'Sem vínculo claro';
}

function documentOption(document, selectedId) {
  const label = `${document.code || 'Sem código'}${document.description ? ` · ${document.description}` : ''}`;
  return `<option value="${escapeHtml(document.id)}" ${document.id === selectedId ? 'selected' : ''}>${escapeHtml(label)}</option>`;
}

async function validateBatchCapacity({ context, inspectionId, files }) {
  const [config, existing] = await Promise.all([
    getConfidentialPdfConfig({ workspaceId: context.workspaceId }),
    listConfidentialDocuments({ workspaceId: context.workspaceId, inspectionId })
  ]);
  if (existing.length + files.length > config.maxFilesPerInspection) {
    const available = Math.max(0, config.maxFilesPerInspection - existing.length);
    throw new Error(`Esta inspeção aceita no máximo ${config.maxFilesPerInspection} PDFs confidenciais. Há ${existing.length} ativo(s); cabem ${available} novo(s).`);
  }
  for (const file of files) {
    if (Number(file.size) > CONFIDENTIAL_PDF_MAX_PLAINTEXT_BYTES) {
      throw new Error(`${file.name} excede o limite de ${formatBytes(CONFIDENTIAL_PDF_MAX_PLAINTEXT_BYTES)} por PDF.`);
    }
  }
  const currentBytes = existing.reduce((sum, item) => sum + (Number(item.plaintext_size) || 0), 0);
  const selectedBytes = files.reduce((sum, file) => sum + (Number(file.size) || 0), 0);
  if (currentBytes + selectedBytes > CONFIDENTIAL_PDF_MAX_AGGREGATE_BYTES) {
    throw new Error(`O lote excederia o limite agregado de ${formatBytes(CONFIDENTIAL_PDF_MAX_AGGREGATE_BYTES)} desta inspeção.`);
  }
  return { config, existing };
}

function reviewRowsHtml(matches, documents) {
  return matches.map((match, index) => `
    <article class="confidential-link-review-row" data-confidential-review-row="${index}">
      <div class="confidential-link-review-file">
        <strong>${escapeHtml(match.filename)}</strong>
        <span class="confidential-link-state ${escapeHtml(match.status)}">${escapeHtml(stateLabel(match.status))}</span>
        <small>${escapeHtml(match.reason)}</small>
      </div>
      <label class="field"><span>Documento/projeto</span><select data-confidential-document-select="${index}">
        <option value="" ${match.documentId ? '' : 'selected'}>Não vinculado</option>
        ${documents.map(document => documentOption(document, match.documentId)).join('')}
      </select></label>
    </article>`).join('');
}

async function uploadReviewedBatch({ modal, files, inspection, matches, confirmButton }) {
  if (batchBusy) return;
  const context = contextOrThrow();
  const selections = matches.map((match, index) => {
    const selected = modal.querySelector(`[data-confidential-document-select="${index}"]`)?.value || '';
    if (selected && !inspection.documents?.some(document => document.id === selected)) {
      throw new Error(`O vínculo escolhido para ${match.filename} não pertence mais a esta inspeção.`);
    }
    return selected || null;
  });

  await validateBatchCapacity({ context, inspectionId: inspection.id, files });
  let unlocked = null;
  let completed = 0;
  try {
    batchBusy = true;
    setButtonBusy(confirmButton, true, `Enviando 0/${files.length}…`);
    unlocked = await unlockConfidentialWorkspaceKeyResilient({ workspaceId: context.workspaceId });
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const bytes = new Uint8Array(await file.arrayBuffer());
      try {
        const uploaded = await uploadConfidentialPdf({
          workspaceId: context.workspaceId,
          inspectionId: inspection.id,
          documentId: selections[index],
          plaintext: bytes,
          filename: file.name,
          workspaceKey: unlocked.key,
          workspaceKeyVersion: unlocked.keyVersion
        });
        await resolveConfidentialCiphertext(uploaded).catch(() => null);
        completed += 1;
        if (confirmButton?.isConnected) confirmButton.textContent = `Enviando ${completed}/${files.length}…`;
      } finally {
        bytes.fill(0);
      }
    }
    modal.closeModal();
    showToast(`${completed} PDF(s) cifrado(s) e enviado(s) após revisão dos vínculos.`, 'success');
    await refreshConfidentialCatalog().catch(() => {});
    await mountDetailPdfSection({ force: true }).catch(() => {});
  } catch (error) {
    const prefix = completed ? `${completed} PDF(s) já foram enviados. ` : '';
    showToast(`${prefix}${error?.message || 'Não foi possível concluir o lote.'}`, 'error');
  } finally {
    batchBusy = false;
    if (confirmButton?.isConnected) setButtonBusy(confirmButton, false);
  }
}

async function openBatchReview(files) {
  if (!files.length) return;
  const context = contextOrThrow();
  if (!can(context.role, CAPABILITY.MANAGE_PROJECT_FILES)) throw new Error('Sua função não permite enviar PDFs de projeto.');
  const inspectionId = document.querySelector('#confidential-inspection-select')?.value || '';
  if (!inspectionId) throw new Error('Selecione uma inspeção antes de enviar PDFs.');
  const inspection = await getInspection(inspectionId);
  if (!inspection) throw new Error('A inspeção selecionada não está mais disponível.');

  const { config, existing } = await validateBatchCapacity({ context, inspectionId, files });
  const matches = matchConfidentialPdfBatch(files, inspection.documents || []);
  const unlinked = matches.filter(match => !match.documentId).length;
  const modal = openModal(`
    <div class="modal-head"><div><span class="section-kicker">REVISÃO OBRIGATÓRIA</span><h2>Confirmar vínculos antes do upload</h2></div></div>
    <p>Nenhum arquivo foi cifrado ou enviado ainda. Revise cada associação PDF → documento e corrija os selects quando necessário.</p>
    <div class="alert ${unlinked ? '' : 'soft-alert'}">Limite atual: ${config.maxFilesPerInspection} PDFs por inspeção · existentes: ${existing.length} · neste lote: ${files.length}.${unlinked ? ` ${unlinked} arquivo(s) permanecerão “Não vinculado” se você confirmar sem alterar.` : ''}</div>
    <div class="confidential-link-review-list">${reviewRowsHtml(matches, inspection.documents || [])}</div>
    <div class="actions modal-actions"><button class="btn" data-close-confidential-review type="button">Cancelar</button><button class="btn btn-primary" id="confirm-confidential-batch-upload" type="button">Confirmar vínculos e enviar</button></div>
  `, { label: 'Revisar vínculos dos PDFs confidenciais' });
  modal.querySelector('[data-close-confidential-review]')?.addEventListener('click', () => modal.closeModal());
  modal.querySelector('#confirm-confidential-batch-upload')?.addEventListener('click', event => {
    void uploadReviewedBatch({ modal, files, inspection, matches, confirmButton: event.currentTarget });
  });
}

function bindBatchUpload() {
  const button = document.querySelector('#confidential-upload');
  const input = document.querySelector('#confidential-upload-input');
  if (!button || !input) return;
  if (input.dataset.confidentialBatchBound === '1') return;
  input.dataset.confidentialBatchBound = '1';
  input.multiple = true;
  button.textContent = 'Enviar PDFs confidenciais';
  button.onclick = () => input.click();
  input.onchange = () => {
    const files = [...(input.files || [])];
    input.value = '';
    if (!files.length || batchBusy) return;
    void openBatchReview(files).catch(error => showToast(error?.message || 'Não foi possível preparar o lote.', 'error'));
  };
  const context = getAuthContext();
  if (context?.workspaceId && navigator.onLine) {
    void getConfidentialPdfConfig({ workspaceId: context.workspaceId })
      .then(config => { if (button.isConnected) button.title = `Limite atual: ${config.maxFilesPerInspection} PDFs por inspeção`; })
      .catch(() => { if (button.isConnected) button.title = 'Configuração de limite indisponível; o upload será bloqueado.'; });
  }
}

async function linkedRowsForDetail({ context, inspectionId, documentId }) {
  if (navigator.onLine) {
    return listConfidentialDocuments({ workspaceId: context.workspaceId, inspectionId, documentId });
  }
  const cached = await listCachedConfidentialDocuments({ workspaceId: context.workspaceId, inspectionId }).catch(() => []);
  return cached
    .map(item => item.document)
    .filter(item => item.status === 'ACTIVE' && item.document_id === documentId);
}

function linkedPdfRowHtml(documentRecord) {
  return `<article class="user-admin-member" data-linked-confidential-id="${escapeHtml(documentRecord.id)}">
    <div class="user-admin-member-copy"><strong>PDF confidencial ${escapeHtml(String(documentRecord.id || '').slice(0, 8))}</strong><span>${escapeHtml(formatBytes(documentRecord.plaintext_size))} · WK v${escapeHtml(documentRecord.workspace_key_version)}</span></div>
    <div class="user-admin-member-controls"><button class="btn" data-open-linked-confidential type="button">Abrir</button></div>
  </article>`;
}

async function openLinkedViewer(documentRecord, button) {
  let opened = null;
  try {
    const context = contextOrThrow();
    setButtonBusy(button, true, 'Desbloqueando…');
    const unlocked = await unlockConfidentialWorkspaceKeyResilient({
      workspaceId: context.workspaceId,
      keyVersion: Number(documentRecord.workspace_key_version)
    });
    opened = await openConfidentialPdfForViewer({ document: documentRecord, workspaceKey: unlocked.key, preferCache: true });
    const modal = openModal(`
      <div class="modal-head"><div><span class="section-kicker">PDF DO DOCUMENTO</span><h2>${escapeHtml(opened.metadata?.title || opened.metadata?.filename || 'Documento')}</h2></div></div>
      <p>${escapeHtml(opened.metadata?.description || '')}</p>
      <div class="subtitle">${escapeHtml(opened.metadata?.filename || '')} · ${opened.viewer.numPages} página(s)</div>
      <div class="actions"><button class="btn" id="linked-pdf-prev" type="button">Anterior</button><span id="linked-pdf-page" class="subtitle"></span><button class="btn" id="linked-pdf-next" type="button">Próxima</button></div>
      <div style="overflow:auto;max-height:70dvh"><canvas id="linked-pdf-canvas" aria-label="Página do PDF vinculado"></canvas></div>
    `, { label: 'Visualizador de PDF vinculado' });
    let pageNumber = 1;
    let rendering = false;
    const canvas = modal.querySelector('#linked-pdf-canvas');
    const label = modal.querySelector('#linked-pdf-page');
    const previous = modal.querySelector('#linked-pdf-prev');
    const next = modal.querySelector('#linked-pdf-next');
    const renderPage = async () => {
      if (rendering || !modal.isConnected) return;
      rendering = true;
      try {
        if (label) label.textContent = `Página ${pageNumber} de ${opened.viewer.numPages}`;
        if (previous) previous.disabled = pageNumber <= 1;
        if (next) next.disabled = pageNumber >= opened.viewer.numPages;
        await opened.viewer.renderPage({ pageNumber, canvas });
      } finally {
        rendering = false;
      }
    };
    previous?.addEventListener('click', async () => { if (pageNumber > 1) { pageNumber -= 1; await renderPage(); } });
    next?.addEventListener('click', async () => { if (pageNumber < opened.viewer.numPages) { pageNumber += 1; await renderPage(); } });
    const removalObserver = new MutationObserver(() => {
      if (modal.isConnected) return;
      removalObserver.disconnect();
      opened?.viewer?.destroy().catch(() => {});
      opened = null;
    });
    removalObserver.observe(document.body, { childList: true });
    await renderPage();
  } catch (error) {
    await opened?.viewer?.destroy().catch(() => {});
    opened = null;
    showToast(error?.message || 'Não foi possível abrir o PDF vinculado.', 'error');
  } finally {
    if (button?.isConnected) setButtonBusy(button, false);
  }
}

async function mountDetailPdfSection({ force = false } = {}) {
  const page = document.querySelector('.document-page');
  if (!page) return;
  const context = getAuthContext();
  if (!context || !can(context.role, CAPABILITY.VIEW_DOCUMENTS)) return;
  if (!force && page.querySelector('[data-confidential-linked-pdfs]')) return;
  page.querySelector('[data-confidential-linked-pdfs]')?.remove();

  const token = ++detailToken;
  const inspectionId = localStorage.getItem('sky17-current') || '';
  const code = page.querySelector('.doc-heading h2')?.textContent?.trim() || '';
  if (!inspectionId || !code) return;
  const inspection = await getInspection(inspectionId).catch(() => null);
  if (token !== detailToken || !page.isConnected || !inspection) return;
  const matches = (inspection.documents || []).filter(item => item.code === code);
  if (matches.length !== 1) return;
  const targetDocument = matches[0];

  const section = document.createElement('section');
  section.dataset.confidentialLinkedPdfs = 'true';
  section.className = 'confidential-linked-pdfs';
  section.innerHTML = '<div class="section-title compact-title"><div><span class="section-kicker">PDFS DO PROJETO</span><h3>Arquivos vinculados a este documento</h3></div></div><div data-linked-pdf-list class="subtitle">Carregando…</div>';
  const actions = page.querySelector('.detail-actions');
  if (actions) actions.before(section); else page.append(section);

  try {
    const rows = await linkedRowsForDetail({ context, inspectionId, documentId: targetDocument.id });
    if (token !== detailToken || !section.isConnected) return;
    const list = section.querySelector('[data-linked-pdf-list]');
    list.className = rows.length ? 'confidential-linked-pdf-list' : 'subtitle';
    list.innerHTML = rows.length
      ? rows.map(linkedPdfRowHtml).join('')
      : 'Nenhum PDF vinculado a este documento.';
    const byId = new Map(rows.map(item => [item.id, item]));
    section.querySelectorAll('[data-linked-confidential-id]').forEach(row => {
      row.querySelector('[data-open-linked-confidential]')?.addEventListener('click', event => {
        const record = byId.get(row.dataset.linkedConfidentialId);
        if (record) void openLinkedViewer(record, event.currentTarget);
      });
    });
  } catch (error) {
    const list = section.querySelector('[data-linked-pdf-list]');
    if (list) list.innerHTML = `<div class="alert">${escapeHtml(error?.message || 'Não foi possível listar os PDFs deste documento.')}</div>`;
  }
}

function mount() {
  injectStyles();
  bindBatchUpload();
  void mountDetailPdfSection().catch(() => {});
}

function start() {
  mount();
  observer = new MutationObserver(() => queueMicrotask(mount));
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener('online', () => void mountDetailPdfSection({ force: true }).catch(() => {}));
  window.addEventListener('offline', () => void mountDetailPdfSection({ force: true }).catch(() => {}));
}

if (document.body) start();

export { mount, mountDetailPdfSection, openBatchReview };
