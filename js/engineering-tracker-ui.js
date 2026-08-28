import { authRolloutEnabled } from './auth-config.js';
import { getAuthContext } from './auth-context.js';
import { getInspection, listInspections, saveInspection } from './db.js';
import {
  ENGINEERING_AUDIT_ACTION,
  appendEngineeringAuditEvent,
  currentEngineeringState,
  engineeringElapsedDays,
  engineeringStatus,
  listEngineeringContexts
} from './engineering-tracker-core.js';
import { CAPABILITY, can } from './permissions.js';
import { openDocumentTrash } from './recovery-ui.js';
import { syncNow } from './sync.js';
import { escapeHtml, openModal, setButtonBusy, showToast } from './ui.js';

let observer = null;
let mountQueued = false;
let trackerBusy = false;

function canManageEngineering() {
  if (document.documentElement.dataset.authTestBypass === 'true') return true;
  if (!authRolloutEnabled()) return true;
  return can(getAuthContext()?.role, CAPABILITY.MANAGE_DOCUMENTS);
}

function actorIdentity() {
  const context = getAuthContext();
  return context?.email || context?.displayName || context?.userId || null;
}

function todayDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function statusLabel(state) {
  const status = engineeringStatus(state);
  const elapsed = engineeringElapsedDays(state, todayDate());
  if (status === 'RETURNED') return `Retornado · ${elapsed ?? 0} dia(s) no fluxo`;
  if (status === 'AWAITING_RETURN') return `Na Engenharia · ${elapsed ?? 0} dia(s) sem retorno`;
  return 'Ainda não enviado à Engenharia';
}

function markingBadges(markings = []) {
  return markings.map(marking => {
    const className = marking === 'Vermelho' ? 'red' : 'yellow';
    return `<span class="engineering-marking ${className}"><span aria-hidden="true"></span>${escapeHtml(marking)}</span>`;
  }).join('');
}

function engineeringEvents(inspection, documentId) {
  return (inspection?.documentAudit || [])
    .filter(event => event?.action === ENGINEERING_AUDIT_ACTION && event?.documentId === documentId)
    .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')))
    .slice(0, 8);
}

function auditHtml(inspection, documentId) {
  const events = engineeringEvents(inspection, documentId);
  if (!events.length) return '<small>Nenhuma movimentação de Engenharia registrada.</small>';
  return `<ol class="engineering-audit-list">${events.map(event => {
    const state = event.changes || {};
    const when = String(event.at || '').replace('T', ' ').slice(0, 16);
    return `<li><strong>${escapeHtml(statusLabel(state))}</strong><span>${escapeHtml(when)}${event.actor ? ` · ${escapeHtml(event.actor)}` : ''}</span>${state.note ? `<small>${escapeHtml(state.note)}</small>` : ''}</li>`;
  }).join('')}</ol>`;
}

function rowHtml(row, editable) {
  const { inspection, document, markings, engineering } = row;
  const status = engineeringStatus(engineering);
  const disabled = editable ? '' : 'disabled';
  return `<article class="engineering-item" data-engineering-row
      data-inspection-id="${escapeHtml(inspection.id)}"
      data-document-id="${escapeHtml(document.id)}"
      data-code="${escapeHtml(document.code.toLowerCase())}"
      data-markings="${escapeHtml(markings.join('|'))}"
      data-engineering-status="${status}">
    <div class="engineering-item-head">
      <div class="engineering-item-copy">
        <div class="engineering-badges">${markingBadges(markings)}</div>
        <strong>${escapeHtml(document.code)}</strong>
        <span>${escapeHtml(document.description || 'Sem descrição')}</span>
        <small>${escapeHtml(inspection.system || 'Sem sistema')} · ${escapeHtml(inspection.name || inspection.project || 'Inspeção')}</small>
      </div>
      <div class="engineering-status-copy" data-engineering-status-copy>${escapeHtml(statusLabel(engineering))}</div>
    </div>
    <div class="engineering-fields">
      <div class="field"><label>Enviado à Engenharia</label><input data-engineering-sent type="date" value="${escapeHtml(engineering.sentAt || '')}" ${disabled}></div>
      <div class="field"><label>Retorno da Engenharia</label><input data-engineering-returned type="date" value="${escapeHtml(engineering.returnedAt || '')}" ${disabled}></div>
      <div class="field engineering-note"><label>Observação</label><input data-engineering-note maxlength="1000" value="${escapeHtml(engineering.note || '')}" placeholder="Ex.: aguardando revisão do projeto" ${disabled}></div>
    </div>
    ${editable ? '<div class="engineering-actions"><button class="btn btn-primary" data-save-engineering type="button">Salvar acompanhamento</button></div>' : '<div class="field-help">Seu perfil pode consultar este acompanhamento, mas não alterá-lo.</div>'}
    <details class="engineering-audit"><summary>Histórico deste documento</summary>${auditHtml(inspection, document.id)}</details>
  </article>`;
}

function summaryHtml(rows) {
  const red = rows.filter(row => row.markings.includes('Vermelho')).length;
  const yellow = rows.filter(row => row.markings.includes('Amarelo')).length;
  const awaiting = rows.filter(row => row.status === 'AWAITING_RETURN').length;
  const oldest = rows.filter(row => row.status === 'AWAITING_RETURN').reduce((max, row) => Math.max(max, row.elapsedDays || 0), 0);
  return `<div class="engineering-summary">
    <div class="card metric"><span>Vermelho</span><strong>${red}</strong></div>
    <div class="card metric"><span>Amarelo</span><strong>${yellow}</strong></div>
    <div class="card metric"><span>Sem retorno</span><strong>${awaiting}</strong></div>
    <div class="card metric"><span>Maior espera</span><strong>${oldest} d</strong></div>
  </div>`;
}

function applyFilters(modal) {
  const query = String(modal.querySelector('[data-engineering-search]')?.value || '').trim().toLowerCase();
  const marking = modal.querySelector('[data-engineering-filter-marking]')?.value || '';
  const status = modal.querySelector('[data-engineering-filter-status]')?.value || '';
  let visible = 0;
  modal.querySelectorAll('[data-engineering-row]').forEach(row => {
    const matchesQuery = !query || row.dataset.code.includes(query) || row.textContent.toLowerCase().includes(query);
    const matchesMarking = !marking || String(row.dataset.markings || '').split('|').includes(marking);
    const matchesStatus = !status || row.dataset.engineeringStatus === status;
    row.hidden = !(matchesQuery && matchesMarking && matchesStatus);
    if (!row.hidden) visible += 1;
  });
  const count = modal.querySelector('[data-engineering-visible-count]');
  if (count) count.textContent = `${visible} documento(s) exibido(s)`;
}

async function persistEngineeringState(inspectionId, documentId, state) {
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const inspection = await getInspection(inspectionId);
    if (!inspection) throw new Error('A inspeção não está mais disponível.');
    appendEngineeringAuditEvent(inspection, documentId, state, { actor: actorIdentity() });
    try {
      await saveInspection(inspection);
      syncNow({ announce: false }).catch(() => {});
      return currentEngineeringState(inspection, documentId);
    } catch (error) {
      lastError = error;
      if (error?.code !== 'CONCURRENT_MODIFICATION' || attempt > 0) throw error;
    }
  }
  throw lastError || new Error('Não foi possível salvar o acompanhamento de Engenharia.');
}

function bindRow(modal, row) {
  const button = row.querySelector('[data-save-engineering]');
  if (!button) return;
  button.addEventListener('click', async () => {
    if (trackerBusy) return;
    try {
      trackerBusy = true;
      setButtonBusy(button, true, 'Salvando…');
      const state = {
        sentAt: row.querySelector('[data-engineering-sent]')?.value || '',
        returnedAt: row.querySelector('[data-engineering-returned]')?.value || '',
        note: row.querySelector('[data-engineering-note]')?.value || ''
      };
      const saved = await persistEngineeringState(row.dataset.inspectionId, row.dataset.documentId, state);
      row.dataset.engineeringStatus = engineeringStatus(saved);
      const status = row.querySelector('[data-engineering-status-copy]');
      if (status) status.textContent = statusLabel(saved);
      showToast('Acompanhamento de Engenharia salvo no histórico.', 'success');
      applyFilters(modal);
    } catch (error) {
      showToast(error?.message || 'Não foi possível salvar o acompanhamento de Engenharia.', 'error');
    } finally {
      trackerBusy = false;
      if (button.isConnected) setButtonBusy(button, false);
    }
  });
}

export async function openEngineeringTracker() {
  const inspections = await listInspections();
  const rows = listEngineeringContexts(inspections);
  const editable = canManageEngineering();
  const modal = openModal(`
    <div class="modal-head engineering-modal-head">
      <div><span class="section-kicker">ENGENHARIA</span><h2>Documentos Amarelo / Vermelho</h2><p class="subtitle">Localize pendências, registre o envio à Engenharia e acompanhe há quanto tempo cada documento está sem retorno.</p></div>
      <button class="btn" data-open-document-history type="button">Histórico de documentos</button>
    </div>
    ${summaryHtml(rows)}
    <div class="engineering-toolbar">
      <div class="field"><label>Buscar PW / descrição</label><input data-engineering-search placeholder="Digite o Código PW"></div>
      <div class="field"><label>Marcação</label><select data-engineering-filter-marking><option value="">Amarelo e Vermelho</option><option value="Vermelho">Vermelho</option><option value="Amarelo">Amarelo</option></select></div>
      <div class="field"><label>Situação</label><select data-engineering-filter-status><option value="">Todas</option><option value="NOT_SENT">Não enviados</option><option value="AWAITING_RETURN">Sem retorno</option><option value="RETURNED">Retornados</option></select></div>
    </div>
    <div class="engineering-result-head"><strong data-engineering-visible-count>${rows.length} documento(s) exibido(s)</strong><small>Os dados de acompanhamento ficam registrados na auditoria da inspeção.</small></div>
    <div class="engineering-list" data-engineering-list>
      ${rows.length ? rows.map(row => rowHtml(row, editable)).join('') : '<div class="card empty"><div><strong>Nenhuma pendência Amarelo/Vermelho.</strong><small>Quando uma cópia de campo receber uma dessas marcações, o documento aparecerá aqui.</small></div></div>'}
    </div>
  `, { label: 'Acompanhamento de Engenharia' });
  modal.classList.add('engineering-tracker-modal');

  modal.querySelectorAll('[data-engineering-row]').forEach(row => bindRow(modal, row));
  modal.querySelectorAll('[data-engineering-search],[data-engineering-filter-marking],[data-engineering-filter-status]').forEach(control => {
    control.addEventListener(control.tagName === 'INPUT' ? 'input' : 'change', () => applyFilters(modal));
  });
  modal.querySelector('[data-open-document-history]')?.addEventListener('click', () => {
    modal.closeModal();
    void openDocumentTrash().catch(error => showToast(error?.message || 'Não foi possível abrir o histórico de documentos.', 'error'));
  });
  return modal;
}

function launcherHtml(mobile = false) {
  return `<button data-engineering-launcher type="button" title="Acompanhamento de Engenharia">
    <span class="nav-icon" aria-hidden="true">⚑</span><span class="engineering-nav-label">${mobile ? 'Engenharia' : 'Engenharia'}</span>
  </button>`;
}

function bindLauncher(button) {
  if (!button || button.dataset.engineeringBound === '1') return;
  button.dataset.engineeringBound = '1';
  button.addEventListener('click', () => void openEngineeringTracker().catch(error => showToast(error?.message || 'Não foi possível abrir o acompanhamento de Engenharia.', 'error')));
}

function mountLaunchers() {
  mountQueued = false;
  const desktop = document.querySelector('.sidebar .nav');
  if (desktop && !desktop.querySelector('[data-engineering-launcher]')) {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = launcherHtml(false).trim();
    const button = wrapper.firstElementChild;
    const settings = desktop.querySelector('[data-nav="settings"]');
    if (settings) desktop.insertBefore(button, settings);
    else desktop.append(button);
    bindLauncher(button);
  }
  const mobile = document.querySelector('.mobile-nav');
  if (mobile && !mobile.querySelector('[data-engineering-launcher]')) {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = launcherHtml(true).trim();
    const button = wrapper.firstElementChild;
    const settings = mobile.querySelector('[data-nav="settings"]');
    if (settings) mobile.insertBefore(button, settings);
    else mobile.append(button);
    bindLauncher(button);
  }
  document.querySelectorAll('[data-engineering-launcher]').forEach(bindLauncher);
}

function scheduleMount() {
  if (mountQueued) return;
  mountQueued = true;
  queueMicrotask(mountLaunchers);
}

function start() {
  mountLaunchers();
  if (!document.body || observer) return;
  observer = new MutationObserver(scheduleMount);
  observer.observe(document.body, { childList: true, subtree: true });
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
}
