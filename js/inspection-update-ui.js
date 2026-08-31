import { getAuthContext } from './auth-context.js';
import { getInspection, saveInspection } from './db.js';
import { buildInspectionListUpdate, inspectionUpdateHasRisk } from './inspection-update.js';
import { syncNow } from './sync.js';
import { escapeHtml, openModal, setButtonBusy, showToast } from './ui.js';
import { mapRows, readWorkbook, suggestMapping } from './xlsx.js';

function mappingOptions(headers, suggested, key) {
  return `<option value="">Selecione</option>${headers.map(header =>
    `<option value="${escapeHtml(header)}" ${suggested[key] === header ? 'selected' : ''}>${escapeHtml(header)}</option>`
  ).join('')}`;
}

function actorIdentity() {
  const context = getAuthContext();
  return context?.email || context?.displayName || context?.userId || null;
}

export async function openUpdateListModal(inspectionId) {
  const inspection = await getInspection(inspectionId).catch(() => null);
  if (!inspection) return showToast('Inspeção não encontrada.', 'error');

  const reviewed = (inspection.documents || []).filter(document => document.result !== 'Pendente' || document.verifiedAt || (document.fieldCopies || []).length).length;
  const modal = openModal(`
    <div class="modal-head">
      <div><span class="section-kicker">SUBSTITUIR LISTA</span><h2>Atualizar lista da inspeção</h2></div>
      <button class="icon-button" data-close type="button" aria-label="Fechar">×</button>
    </div>
    <p class="subtitle">Importe a nova versão da planilha. Ela passará a ser a lista ativa desta inspeção. PWs correspondentes preservam todo o trabalho de campo já registrado.</p>
    <div class="alert soft-alert">
      <strong>${reviewed} documento(s) já possuem revisão ou trabalho de campo.</strong><br>
      Se algum deles não existir na nova planilha, sairá da lista ativa e será preservado no histórico para auditoria e eventual restauração.
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
      <div><span class="section-kicker">SUBSTITUIR LISTA</span><h2>Confirmar colunas da nova lista</h2></div>
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
    ? `<div class="alert soft-alert"><strong>Confira a substituição antes de aplicar.</strong><br>${summary.catalogChanged} documento(s) correspondente(s) receberão os dados de catálogo da nova planilha. ${summary.removed} documento(s) que não aparecem mais serão retirados da lista ativa e arquivados; ${summary.reviewedRemoved} deles já possuem revisão/trabalho de campo.</div>`
    : `<div class="alert soft-alert"><strong>Listas equivalentes nos pontos críticos.</strong><br>Nenhum documento ativo será arquivado nesta substituição.</div>`;

  const modal = openModal(`
    <div class="modal-head">
      <div><span class="section-kicker">PRÉVIA DA SUBSTITUIÇÃO</span><h2>Confira antes de aplicar</h2></div>
      <button class="icon-button" data-close type="button" aria-label="Fechar">×</button>
    </div>
    <p class="subtitle">A nova planilha será a fonte autoritativa da lista ativa. A alteração só será gravada após sua confirmação.</p>
    <div class="grid cards">
      <div class="card metric"><div class="metric-head"><span>Na nova lista</span></div><strong>${summary.incomingTotal}</strong></div>
      <div class="card metric verified"><div class="metric-head"><span>Correspondentes preservados</span></div><strong>${summary.matched}</strong></div>
      <div class="card metric green"><div class="metric-head"><span>Novos</span></div><strong>${summary.added}</strong></div>
      <div class="card metric pending"><div class="metric-head"><span>Movidos ao histórico</span></div><strong>${summary.removed}</strong></div>
    </div>
    <div class="spacer small"></div>
    ${warning}
    <p class="field-help">Código PW, descrição, status e revisão esperada passam a seguir a nova planilha. Nos PWs correspondentes, UUID, cópias de campo, fotos, comentários, marcações e histórico são preservados. Itens ausentes não permanecem ativos: ficam disponíveis na área de histórico/recuperação.</p>
    <div class="actions">
      <button class="btn" data-close type="button">Cancelar</button>
      <button class="btn btn-primary" id="apply-inspection-update" type="button">Substituir lista ativa</button>
    </div>`, { label: 'Prévia da atualização da inspeção' });

  modal.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => modal.closeModal()));
  modal.querySelector('#apply-inspection-update')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    try {
      setButtonBusy(button, true, 'Atualizando…');
      let latest = await getInspection(inspectionId);
      if (!latest) throw new Error('A inspeção não existe mais.');
      const options = { actor: actorIdentity() };
      let candidate = buildInspectionListUpdate(latest, incomingDocuments, options).inspection;

      try {
        await saveInspection(candidate);
      } catch (error) {
        if (error?.code !== 'CONCURRENT_MODIFICATION') throw error;
        latest = await getInspection(inspectionId);
        if (!latest) throw new Error('A inspeção foi removida durante a atualização.');
        candidate = buildInspectionListUpdate(latest, incomingDocuments, options).inspection;
        await saveInspection(candidate);
      }

      syncNow({ announce: false }).catch(() => {});
      modal.closeModal();
      showToast('Lista substituída. Itens ausentes foram movidos para o histórico e o trabalho dos PWs correspondentes foi preservado.', 'success');
      window.setTimeout(() => window.location.reload(), 350);
    } catch (error) {
      showToast(error.message || 'Falha ao atualizar a lista.', 'error');
    } finally {
      if (button?.isConnected) setButtonBusy(button, false);
    }
  });
}
