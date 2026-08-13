import { getInspection, saveInspection } from './db.js';
import { buildInspectionListUpdate, inspectionUpdateHasRisk } from './inspection-update.js';
import { syncNow } from './sync.js';
import { escapeHtml, openModal, setButtonBusy, showToast } from './ui.js';
import { mapRows, readWorkbook, suggestMapping } from './xlsx.js';

let observer = null;

function injectUpdateButtons(root = document) {
  root.querySelectorAll('.inspection-item[data-open-inspection]').forEach(card => {
    const actions = card.querySelector('.inspection-actions');
    if (!actions || actions.querySelector('[data-update-inspection-list]')) return;

    const button = document.createElement('button');
    button.className = 'btn';
    button.type = 'button';
    button.dataset.updateInspectionList = card.dataset.openInspection || '';
    button.textContent = 'Atualizar lista';
    button.title = 'Importar uma nova versão da planilha preservando os documentos já revisados';
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      openUpdateListModal(button.dataset.updateInspectionList);
    });

    const exportButton = actions.querySelector('[data-export-inspection]');
    if (exportButton) actions.insertBefore(button, exportButton);
    else actions.appendChild(button);
  });
}

function mappingOptions(headers, suggested, key) {
  return `<option value="">Selecione</option>${headers.map(header =>
    `<option value="${escapeHtml(header)}" ${suggested[key] === header ? 'selected' : ''}>${escapeHtml(header)}</option>`
  ).join('')}`;
}

export async function openUpdateListModal(inspectionId) {
  const inspection = await getInspection(inspectionId).catch(() => null);
  if (!inspection) return showToast('Inspeção não encontrada.', 'error');

  const reviewed = (inspection.documents || []).filter(document => document.result !== 'Pendente' || document.verifiedAt || (document.fieldCopies || []).length).length;
  const modal = openModal(`
    <div class="modal-head">
      <div><span class="section-kicker">ATUALIZAÇÃO SEGURA</span><h2>Atualizar lista da inspeção</h2></div>
      <button class="icon-button" data-close type="button" aria-label="Fechar">×</button>
    </div>
    <p class="subtitle">Importe uma nova versão da planilha. O DocInspector compara os Códigos PW e preserva revisões de campo, cópias, comentários e evidências já registradas.</p>
    <div class="alert soft-alert">
      <strong>${reviewed} documento(s) já revisado(s) estão protegidos.</strong><br>
      Documentos revisados que não existirem na nova planilha serão mantidos para impedir perda silenciosa de histórico.
    </div>
    <div class="field full">
      <label for="inspection-update-file">Nova lista de documentos (.xlsx ou .xls)</label>
      <input id="inspection-update-file" type="file" accept=".xlsx,.xls" required>
    </div>
    <div class="actions">
      <button class="btn" data-close type="button">Cancelar</button>
      <button class="btn btn-primary" id="inspection-update-read" type="button">Ler nova lista</button>
    </div>`, { label: 'Atualizar lista da inspeção' });

  modal.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => modal.closeModal()));
  modal.querySelector('#inspection-update-read')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    try {
      const file = modal.querySelector('#inspection-update-file')?.files?.[0];
      if (!file) throw new Error('Selecione a nova planilha.');
      setButtonBusy(button, true, 'Lendo…');
      const parsed = await readWorkbook(file);
      modal.closeModal();
      openUpdateMappingModal(inspectionId, parsed);
    } catch (error) {
      showToast(error.message || 'Falha ao ler a nova lista.', 'error');
    } finally {
      if (button?.isConnected) setButtonBusy(button, false);
    }
  });
}

function openUpdateMappingModal(inspectionId, parsed) {
  const headers = Array.isArray(parsed?.headers) ? parsed.headers : [];
  const suggested = suggestMapping(headers);
  const modal = openModal(`
    <div class="modal-head">
      <div><span class="section-kicker">ATUALIZAÇÃO SEGURA</span><h2>Confirmar colunas da nova lista</h2></div>
      <button class="icon-button" data-close type="button" aria-label="Fechar">×</button>
    </div>
    <p class="subtitle">Confirme o mapeamento antes da comparação. Nenhuma alteração é gravada nesta etapa.</p>
    <div class="form-grid">
      <div class="field"><label for="update-map-code">Código PW</label><select id="update-map-code">${mappingOptions(headers, suggested, 'code')}</select></div>
      <div class="field"><label for="update-map-description">Descrição</label><select id="update-map-description">${mappingOptions(headers, suggested, 'description')}</select></div>
      <div class="field"><label for="update-map-status">Status</label><select id="update-map-status">${mappingOptions(headers, suggested, 'status')}</select></div>
      <div class="field"><label for="update-map-revision">Revisão</label><select id="update-map-revision">${mappingOptions(headers, suggested, 'expectedRevision')}</select></div>
    </div>
    <div class="actions">
      <button class="btn" data-close type="button">Cancelar</button>
      <button class="btn btn-primary" id="preview-inspection-update" type="button">Comparar listas</button>
    </div>`, { label: 'Mapear nova lista da inspeção' });

  modal.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => modal.closeModal()));
  modal.querySelector('#preview-inspection-update')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    try {
      const mapping = {
        code: modal.querySelector('#update-map-code')?.value || '',
        description: modal.querySelector('#update-map-description')?.value || '',
        status: modal.querySelector('#update-map-status')?.value || '',
        expectedRevision: modal.querySelector('#update-map-revision')?.value || ''
      };
      if (Object.values(mapping).some(value => !value)) throw new Error('Mapeie todas as colunas.');
      setButtonBusy(button, true, 'Comparando…');
      const incomingDocuments = mapRows(parsed.rows, mapping);
      const latest = await getInspection(inspectionId);
      if (!latest) throw new Error('A inspeção não existe mais.');
      const preview = buildInspectionListUpdate(latest, incomingDocuments);
      modal.closeModal();
      openUpdatePreviewModal(inspectionId, incomingDocuments, preview.summary);
    } catch (error) {
      showToast(error.message || 'Não foi possível comparar as listas.', 'error');
    } finally {
      if (button?.isConnected) setButtonBusy(button, false);
    }
  });
}

function openUpdatePreviewModal(inspectionId, incomingDocuments, summary) {
  const warning = inspectionUpdateHasRisk(summary)
    ? `<div class="alert soft-alert"><strong>Revisão necessária antes de aplicar.</strong><br>${summary.catalogChanged} documento(s) existente(s) tiveram dados de catálogo alterados. ${summary.reviewedRetained} documento(s) revisado(s) não aparecem mais na planilha e serão mantidos para proteger o histórico.</div>`
    : `<div class="alert soft-alert"><strong>Comparação consistente.</strong><br>Nenhum documento revisado seria removido.</div>`;

  const modal = openModal(`
    <div class="modal-head">
      <div><span class="section-kicker">PRÉVIA DA ATUALIZAÇÃO</span><h2>Confira antes de aplicar</h2></div>
      <button class="icon-button" data-close type="button" aria-label="Fechar">×</button>
    </div>
    <p class="subtitle">A atualização só será gravada após sua confirmação.</p>
    <div class="grid cards">
      <div class="card metric"><div class="metric-head"><span>Na nova lista</span></div><strong>${summary.incomingTotal}</strong></div>
      <div class="card metric verified"><div class="metric-head"><span>Revisados preservados</span></div><strong>${summary.reviewedPreserved}</strong></div>
      <div class="card metric green"><div class="metric-head"><span>Novos</span></div><strong>${summary.added}</strong></div>
      <div class="card metric pending"><div class="metric-head"><span>Pendentes removidos</span></div><strong>${summary.pendingRemoved}</strong></div>
    </div>
    <div class="spacer small"></div>
    ${warning}
    <p class="field-help">Campos vindos da planilha — Código PW, descrição, status e revisão esperada — são atualizados nos documentos correspondentes. Registros de campo, IDs, cópias, fotos, comentários e histórico permanecem preservados.</p>
    <div class="actions">
      <button class="btn" data-close type="button">Cancelar</button>
      <button class="btn btn-primary" id="apply-inspection-update" type="button">Aplicar atualização</button>
    </div>`, { label: 'Prévia da atualização da inspeção' });

  modal.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => modal.closeModal()));
  modal.querySelector('#apply-inspection-update')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    try {
      setButtonBusy(button, true, 'Atualizando…');
      let latest = await getInspection(inspectionId);
      if (!latest) throw new Error('A inspeção não existe mais.');
      let candidate = buildInspectionListUpdate(latest, incomingDocuments).inspection;

      try {
        await saveInspection(candidate);
      } catch (error) {
        if (error?.code !== 'CONCURRENT_MODIFICATION') throw error;
        latest = await getInspection(inspectionId);
        if (!latest) throw new Error('A inspeção foi removida durante a atualização.');
        candidate = buildInspectionListUpdate(latest, incomingDocuments).inspection;
        await saveInspection(candidate);
      }

      syncNow({ announce: false }).catch(() => {});
      modal.closeModal();
      showToast('Lista atualizada. Revisões e evidências existentes foram preservadas.');
      window.setTimeout(() => window.location.reload(), 350);
    } catch (error) {
      showToast(error.message || 'Falha ao atualizar a lista.', 'error');
    } finally {
      if (button?.isConnected) setButtonBusy(button, false);
    }
  });
}

function start() {
  injectUpdateButtons();
  const app = document.querySelector('#app');
  if (!app || observer) return;
  observer = new MutationObserver(() => injectUpdateButtons(app));
  observer.observe(app, { childList: true, subtree: true });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
else start();
