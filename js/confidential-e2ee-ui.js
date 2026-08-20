import { getAuthContext } from './auth-context.js';
import { listInspections } from './db.js';
import { CAPABILITY, ROLE, can } from './permissions.js';
import { escapeHtml, openModal, setButtonBusy, showToast } from './ui.js';
import {
  enrollConfidentialMember,
  getConfidentialKeyStatus,
  grantWorkspaceKeyToMember,
  listWorkspaceCryptoTargets,
  recoverConfidentialMemberKey,
  unwrapConfidentialWorkspaceKeyBytes
} from './confidential-keyring.js';
import {
  cacheCurrentWorkspaceEnvelope,
  hasCachedWorkspaceEnvelope,
  unlockConfidentialWorkspaceKeyResilient
} from './confidential-offline-key.js';
import {
  deleteConfidentialDocument,
  listConfidentialDocuments,
  uploadConfidentialPdf
} from './confidential-storage.js';
import {
  deleteCachedConfidentialCiphertext,
  listCachedConfidentialDocuments
} from './confidential-offline.js';
import {
  openConfidentialPdfForViewer,
  resolveConfidentialCiphertext
} from './confidential-viewer.js';

let observer = null;
let busy = false;
let selectedInspectionId = '';
let cachedInspectionIds = new Set();

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

function inspectionLabel(inspection) {
  const primary = inspection?.name || inspection?.title || inspection?.project || inspection?.system || 'Inspeção';
  const secondary = inspection?.location || inspection?.sector || inspection?.id || '';
  return `${primary}${secondary && secondary !== primary ? ` · ${secondary}` : ''}`;
}

function keyStatusText(status) {
  if (!status?.enrolled) return 'E2EE ainda não provisionado para sua conta neste workspace.';
  if (!status.localPrivateKey) return 'Sua MEK existe, mas a chave privada não está neste aparelho. Use o Recovery Secret.';
  if (!status.workspaceKey) return 'Sua MEK está pronta. A Workspace Key ainda não foi inicializada.';
  if (status.workspaceKey.status !== 'ACTIVE') return `Workspace Key v${status.workspaceKey.key_version} está em rotação.`;
  if (!status.envelope) return 'Sua conta aguarda um ADMIN distribuir o envelope da Workspace Key.';
  return `E2EE pronto neste aparelho · MEK v${status.publicKey?.key_version} · WK v${status.workspaceKey?.key_version}.`;
}

function docsCardHtml(context) {
  return `
    <section class="card documents-catalog" id="confidential-documents-card" aria-labelledby="confidential-documents-title">
      <div class="section-title">
        <div><span class="section-kicker">E2EE · ENGENHARIA</span><h2 id="confidential-documents-title">PDFs confidenciais</h2></div>
        <span class="subtitle">${escapeHtml(context.workspaceName || 'Workspace atual')} · DIPDF1</span>
      </div>
      <p class="subtitle">Chaves privadas e plaintext permanecem no navegador. O Supabase recebe apenas material público, backups cifrados, envelopes e arquivos <code>.dipdf</code>.</p>
      <div id="confidential-key-status" class="field-readiness-result">Carregando estado criptográfico…</div>
      <div id="confidential-key-actions" class="actions detail-actions"></div>
      <div class="spacer small"></div>
      <div class="field">
        <label for="confidential-inspection-select">Inspeção dos PDFs de engenharia</label>
        <select id="confidential-inspection-select"><option value="">Carregando inspeções…</option></select>
      </div>
      <div id="confidential-documents-actions" class="actions detail-actions"></div>
      <div id="confidential-documents-list" aria-live="polite"><div class="subtitle">Selecione uma inspeção.</div></div>
    </section>`;
}

function showRecoverySecret(secret) {
  const modal = openModal(`
    <div class="modal-head"><div><span class="section-kicker">RECOVERY SECRET</span><h2>Salve este segredo agora</h2></div></div>
    <p>Ele será exibido somente nesta etapa de provisionamento. Guarde-o fora do DocInspector para recuperar sua chave privada em outro aparelho.</p>
    <label class="field"><span>Recovery Secret</span><textarea id="confidential-recovery-output" rows="4" readonly spellcheck="false">${escapeHtml(secret)}</textarea></label>
    <div class="alert">Quem possuir este segredo e o backup cifrado poderá recuperar sua MEK. Não envie por chat, e-mail ou chamado.</div>
    <div class="actions"><button class="btn" id="confidential-copy-recovery" type="button">Copiar</button><button class="btn btn-primary" id="confidential-recovery-done" type="button">Já salvei em local seguro</button></div>
  `, { label: 'Recovery Secret E2EE' });
  modal.querySelector('#confidential-copy-recovery')?.addEventListener('click', async () => {
    await navigator.clipboard.writeText(secret);
    showToast('Recovery Secret copiado. Remova-o da área de transferência depois de guardá-lo.', 'success');
  });
  modal.querySelector('#confidential-recovery-done')?.addEventListener('click', () => modal.closeModal());
}

async function refreshKeyCard() {
  const statusNode = document.querySelector('#confidential-key-status');
  const actions = document.querySelector('#confidential-key-actions');
  if (!statusNode || !actions) return null;
  const context = contextOrThrow();
  if (!navigator.onLine) {
    const cachedEnvelope = await hasCachedWorkspaceEnvelope({ workspaceId: context.workspaceId }).catch(() => false);
    statusNode.className = `field-readiness-result ${cachedEnvelope ? 'success' : 'warning'}`;
    statusNode.textContent = cachedEnvelope
      ? 'Offline: MEK local e envelope cifrado da WK estão disponíveis neste aparelho.'
      : 'Offline: o envelope da Workspace Key ainda não foi preparado neste aparelho. Conecte-se uma vez para habilitar abertura offline após reinício.';
    actions.innerHTML = '';
    return null;
  }
  try {
    const status = await getConfidentialKeyStatus({ workspaceId: context.workspaceId });
    if (status.cryptoReady) {
      await cacheCurrentWorkspaceEnvelope({ workspaceId: context.workspaceId, status }).catch(() => {});
    }
    statusNode.className = `field-readiness-result ${status.cryptoReady ? 'success' : 'warning'}`;
    statusNode.textContent = keyStatusText(status);
    const buttons = [];
    if (!status.enrolled) buttons.push('<button class="btn btn-primary" id="confidential-enroll" type="button">Ativar E2EE neste aparelho</button>');
    if (status.enrolled && !status.localPrivateKey) buttons.push('<button class="btn btn-primary" id="confidential-recover" type="button">Recuperar chave neste aparelho</button>');
    if (context.role === ROLE.ADMIN && status.cryptoReady) buttons.push('<button class="btn" id="confidential-grant" type="button">Distribuir WK a membros prontos</button>');
    buttons.push('<button class="btn" id="confidential-refresh-keys" type="button">Atualizar estado</button>');
    actions.innerHTML = buttons.join('');
    bindKeyActions(status);
    return status;
  } catch (error) {
    statusNode.className = 'field-readiness-result error';
    statusNode.textContent = error?.message || 'Não foi possível consultar o estado E2EE.';
    actions.innerHTML = '<button class="btn" id="confidential-refresh-keys" type="button">Tentar novamente</button>';
    actions.querySelector('#confidential-refresh-keys')?.addEventListener('click', () => refreshKeyCard());
    return null;
  }
}

function bindKeyActions(status) {
  const context = contextOrThrow();
  document.querySelector('#confidential-refresh-keys')?.addEventListener('click', () => refreshAll());
  document.querySelector('#confidential-enroll')?.addEventListener('click', async event => {
    if (busy) return;
    const button = event.currentTarget;
    try {
      busy = true;
      setButtonBusy(button, true, 'Gerando chaves…');
      const enrolled = await enrollConfidentialMember({ workspaceId: context.workspaceId });
      showRecoverySecret(enrolled.recoverySecret);
      if (enrolled.workspaceInitializationError) showToast(enrolled.workspaceInitializationError, 'error');
      await refreshAll();
    } catch (error) {
      showToast(error?.message || 'Falha ao provisionar E2EE.', 'error');
    } finally {
      busy = false;
      if (button?.isConnected) setButtonBusy(button, false);
    }
  });
  document.querySelector('#confidential-recover')?.addEventListener('click', () => openRecoveryModal());
  document.querySelector('#confidential-grant')?.addEventListener('click', async event => {
    if (busy) return;
    const button = event.currentTarget;
    let unlocked = null;
    try {
      busy = true;
      setButtonBusy(button, true, 'Distribuindo…');
      const targets = await listWorkspaceCryptoTargets({ workspaceId: context.workspaceId });
      const pending = targets.filter(item => item?.public_jwk && Number(item?.key_version) > 0 && !item?.has_current_envelope);
      if (!pending.length) {
        showToast('Todos os membros com MEK já possuem envelope da WK ativa.', 'success');
        return;
      }
      unlocked = await unwrapConfidentialWorkspaceKeyBytes({ workspaceId: context.workspaceId });
      let granted = 0;
      for (const target of pending) {
        await grantWorkspaceKeyToMember({
          workspaceId: context.workspaceId,
          targetUserId: target.user_id,
          workspaceKeyBytes: unlocked.bytes
        });
        granted += 1;
      }
      showToast(`${granted} envelope(s) de WK distribuído(s).`, 'success');
      await refreshAll();
    } catch (error) {
      showToast(error?.message || 'Não foi possível distribuir a Workspace Key.', 'error');
    } finally {
      unlocked?.bytes?.fill(0);
      busy = false;
      if (button?.isConnected) setButtonBusy(button, false);
    }
  });
}

function openRecoveryModal() {
  const context = contextOrThrow();
  const modal = openModal(`
    <div class="modal-head"><div><span class="section-kicker">RECUPERAÇÃO E2EE</span><h2>Recuperar chave privada</h2></div></div>
    <p>Informe o Recovery Secret salvo quando esta conta foi provisionada. O segredo é usado somente em memória para decifrar o backup da MEK.</p>
    <label class="field"><span>Recovery Secret</span><textarea id="confidential-recovery-input" rows="4" autocomplete="off" autocapitalize="off" spellcheck="false"></textarea></label>
    <div class="actions"><button class="btn btn-primary" id="confidential-recovery-submit" type="button">Recuperar neste aparelho</button></div>
  `, { label: 'Recuperar chave privada E2EE' });
  modal.querySelector('#confidential-recovery-submit')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    const input = modal.querySelector('#confidential-recovery-input');
    const recoverySecret = input?.value || '';
    try {
      setButtonBusy(button, true, 'Recuperando…');
      await recoverConfidentialMemberKey({ workspaceId: context.workspaceId, recoverySecret });
      if (input) input.value = '';
      modal.closeModal();
      showToast('Chave privada recuperada neste aparelho.', 'success');
      await refreshAll();
    } catch (error) {
      showToast(error?.message || 'Não foi possível recuperar a chave privada.', 'error');
    } finally {
      if (button?.isConnected) setButtonBusy(button, false);
    }
  });
}

async function loadInspectionOptions() {
  const select = document.querySelector('#confidential-inspection-select');
  if (!select) return [];
  const inspections = await listInspections();
  if (!selectedInspectionId || !inspections.some(item => item.id === selectedInspectionId)) selectedInspectionId = inspections[0]?.id || '';
  select.innerHTML = inspections.length
    ? inspections.map(item => `<option value="${escapeHtml(item.id)}" ${item.id === selectedInspectionId ? 'selected' : ''}>${escapeHtml(inspectionLabel(item))}</option>`).join('')
    : '<option value="">Nenhuma inspeção local</option>';
  select.onchange = () => {
    selectedInspectionId = select.value;
    refreshDocuments().catch(error => showToast(error?.message || 'Falha ao listar PDFs confidenciais.', 'error'));
  };
  return inspections;
}

async function mergedDocumentList(context, inspectionId) {
  const cacheRows = await listCachedConfidentialDocuments({ workspaceId: context.workspaceId, inspectionId }).catch(() => []);
  const cached = new Map(cacheRows.map(item => [item.document.id, item]));
  cachedInspectionIds = new Set(cached.keys());
  if (!navigator.onLine) return cacheRows.map(item => ({ ...item.document, cachedAt: item.cachedAt, offlineOnly: true }));
  const remote = await listConfidentialDocuments({ workspaceId: context.workspaceId, inspectionId });
  return remote.map(document => ({ ...document, cachedAt: cached.get(document.id)?.cachedAt || null }));
}

function documentRowHtml(document, canManage) {
  const cached = Boolean(document.cachedAt);
  const idShort = String(document.id || '').slice(0, 8);
  return `
    <article class="user-admin-member" data-confidential-id="${escapeHtml(document.id)}">
      <div class="user-admin-member-copy">
        <strong>PDF confidencial ${escapeHtml(idShort)}</strong>
        <span>WK v${escapeHtml(document.workspace_key_version)} · ${escapeHtml(formatBytes(document.plaintext_size))} · ${escapeHtml(document.chunk_count)} chunk(s)</span>
        <small>${cached ? 'Disponível offline neste aparelho' : 'Somente remoto neste aparelho'}${document.offlineOnly ? ' · metadados locais' : ''}</small>
      </div>
      <div class="user-admin-member-controls">
        <button class="btn" data-confidential-view type="button">Abrir</button>
        ${navigator.onLine && !cached ? '<button class="btn" data-confidential-cache type="button">Manter offline</button>' : ''}
        ${canManage && navigator.onLine ? '<button class="btn" data-confidential-delete type="button">Excluir</button>' : ''}
      </div>
    </article>`;
}

async function refreshDocuments() {
  const list = document.querySelector('#confidential-documents-list');
  const actions = document.querySelector('#confidential-documents-actions');
  if (!list || !actions) return;
  const context = contextOrThrow();
  const canManage = can(context.role, CAPABILITY.MANAGE_PROJECT_FILES);
  if (!selectedInspectionId) {
    actions.innerHTML = '';
    list.innerHTML = '<div class="subtitle">Nenhuma inspeção disponível.</div>';
    return;
  }
  actions.innerHTML = canManage && navigator.onLine
    ? '<button class="btn btn-primary" id="confidential-upload" type="button">Enviar PDF confidencial</button><input id="confidential-upload-input" type="file" accept="application/pdf,.pdf" hidden>'
    : '';
  bindUpload();
  list.innerHTML = '<div class="subtitle">Carregando PDFs confidenciais…</div>';
  try {
    const documents = await mergedDocumentList(context, selectedInspectionId);
    list.innerHTML = documents.length
      ? documents.map(item => documentRowHtml(item, canManage)).join('')
      : '<div class="card empty"><div><strong>Nenhum PDF confidencial nesta inspeção.</strong><small>Os arquivos enviados ficam cifrados no Storage como DIPDF1.</small></div></div>';
    bindDocumentActions(documents);
  } catch (error) {
    list.innerHTML = `<div class="alert">${escapeHtml(error?.message || 'Não foi possível listar os PDFs confidenciais.')}</div>`;
  }
}

function bindUpload() {
  const button = document.querySelector('#confidential-upload');
  const input = document.querySelector('#confidential-upload-input');
  if (!button || !input) return;
  button.onclick = () => input.click();
  input.onchange = async () => {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (busy) return;
    const context = contextOrThrow();
    try {
      busy = true;
      setButtonBusy(button, true, 'Cifrando e enviando…');
      const unlocked = await unlockConfidentialWorkspaceKeyResilient({ workspaceId: context.workspaceId });
      const bytes = new Uint8Array(await file.arrayBuffer());
      try {
        const uploaded = await uploadConfidentialPdf({
          workspaceId: context.workspaceId,
          inspectionId: selectedInspectionId,
          plaintext: bytes,
          filename: file.name,
          workspaceKey: unlocked.key,
          workspaceKeyVersion: unlocked.keyVersion
        });
        await resolveConfidentialCiphertext(uploaded).catch(() => null);
        showToast('PDF cifrado e enviado com sucesso.', 'success');
      } finally {
        bytes.fill(0);
      }
      await refreshDocuments();
    } catch (error) {
      showToast(error?.message || 'Não foi possível enviar o PDF confidencial.', 'error');
    } finally {
      busy = false;
      if (button?.isConnected) setButtonBusy(button, false);
    }
  };
}

function bindDocumentActions(documents) {
  const byId = new Map(documents.map(item => [item.id, item]));
  document.querySelectorAll('[data-confidential-id]').forEach(row => {
    const documentRecord = byId.get(row.dataset.confidentialId);
    row.querySelector('[data-confidential-cache]')?.addEventListener('click', async event => {
      const button = event.currentTarget;
      try {
        setButtonBusy(button, true, 'Baixando ciphertext…');
        await resolveConfidentialCiphertext(documentRecord, { preferCache: false });
        await cacheCurrentWorkspaceEnvelope({ workspaceId: documentRecord.workspace_id }).catch(() => {});
        showToast('Ciphertext e envelope da WK salvos para uso offline neste aparelho.', 'success');
        await refreshDocuments();
      } catch (error) {
        showToast(error?.message || 'Não foi possível manter este PDF offline.', 'error');
      } finally {
        if (button?.isConnected) setButtonBusy(button, false);
      }
    });
    row.querySelector('[data-confidential-view]')?.addEventListener('click', event => openViewer(documentRecord, event.currentTarget));
    row.querySelector('[data-confidential-delete]')?.addEventListener('click', async event => {
      const button = event.currentTarget;
      if (!confirm('Excluir este PDF confidencial do workspace? O ciphertext será removido do Storage quando possível.')) return;
      try {
        setButtonBusy(button, true, 'Excluindo…');
        const result = await deleteConfidentialDocument(documentRecord);
        await deleteCachedConfidentialCiphertext({
          workspaceId: documentRecord.workspace_id,
          inspectionId: documentRecord.inspection_id,
          fileId: documentRecord.id
        }).catch(() => {});
        showToast(result.cleanupPending ? 'PDF excluído logicamente; limpeza do Storage ficará pendente.' : 'PDF confidencial excluído.', result.cleanupPending ? '' : 'success');
        await refreshDocuments();
      } catch (error) {
        showToast(error?.message || 'Não foi possível excluir o PDF confidencial.', 'error');
      } finally {
        if (button?.isConnected) setButtonBusy(button, false);
      }
    });
  });
}

async function openViewer(documentRecord, button) {
  const context = contextOrThrow();
  let opened = null;
  try {
    setButtonBusy(button, true, 'Desbloqueando…');
    const unlocked = await unlockConfidentialWorkspaceKeyResilient({
      workspaceId: context.workspaceId,
      keyVersion: Number(documentRecord.workspace_key_version)
    });
    opened = await openConfidentialPdfForViewer({ document: documentRecord, workspaceKey: unlocked.key, preferCache: true });
    const modal = openModal(`
      <div class="modal-head"><div><span class="section-kicker">PDF CONFIDENCIAL</span><h2>${escapeHtml(opened.metadata?.title || opened.metadata?.filename || 'Documento')}</h2></div></div>
      <p>${escapeHtml(opened.metadata?.description || '')}</p>
      <div class="subtitle">${escapeHtml(opened.metadata?.filename || '')} · ${opened.viewer.numPages} página(s) · fonte: ${escapeHtml(opened.source)} · chave: ${escapeHtml(unlocked.source || 'local')}</div>
      <div class="actions"><button class="btn" id="confidential-prev-page" type="button">Anterior</button><span id="confidential-page-label" class="subtitle"></span><button class="btn" id="confidential-next-page" type="button">Próxima</button></div>
      <div style="overflow:auto;max-height:70dvh"><canvas id="confidential-pdf-canvas" aria-label="Página do PDF confidencial"></canvas></div>
    `, { label: 'Visualizador de PDF confidencial' });
    let pageNumber = 1;
    let rendering = false;
    const canvas = modal.querySelector('#confidential-pdf-canvas');
    const label = modal.querySelector('#confidential-page-label');
    const previous = modal.querySelector('#confidential-prev-page');
    const next = modal.querySelector('#confidential-next-page');
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
    showToast(error?.message || 'Não foi possível abrir o PDF confidencial.', 'error');
  } finally {
    if (button?.isConnected) setButtonBusy(button, false);
  }
}

async function refreshAll() {
  await refreshKeyCard();
  await loadInspectionOptions();
  await refreshDocuments();
}

function mount() {
  const context = getAuthContext();
  if (!context || !can(context.role, CAPABILITY.VIEW_DOCUMENTS)) {
    document.querySelector('#confidential-documents-card')?.remove();
    return;
  }
  const catalog = document.querySelector('.documents-catalog');
  if (!catalog) return;
  if (!document.querySelector('#confidential-documents-card')) catalog.insertAdjacentHTML('afterend', docsCardHtml(context));
  const docsCard = document.querySelector('#confidential-documents-card');
  if (docsCard?.dataset.loaded === '1') return;
  docsCard.dataset.loaded = '1';
  refreshAll().catch(error => showToast(error?.message || 'Não foi possível iniciar a interface E2EE.', 'error'));
}

function start() {
  mount();
  window.addEventListener('online', () => refreshAll().catch(() => {}));
  window.addEventListener('offline', () => refreshAll().catch(() => {}));
  observer = new MutationObserver(() => mount());
  observer.observe(document.body, { childList: true, subtree: true });
}

if (document.body) start();

export { mount, refreshAll };
