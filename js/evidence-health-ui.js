import { getEvidence, listInspections } from './db.js';
import { getSyncConfig, getSyncStatus, syncNow } from './sync.js';

const LARGE_EVIDENCE_BYTES = 4 * 1024 * 1024;
let observer = null;
let refreshTimer = null;
let lastSummary = null;

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

async function inspectCopy(copy) {
  const status = {
    copyId: copy.id,
    state: 'none',
    label: 'Sem foto',
    detail: '',
    size: null,
    attempts: 0,
    error: null
  };

  if (copy.evidenceUnavailableAt) {
    status.state = 'unavailable';
    status.label = 'Foto indisponível';
    status.detail = copy.evidenceUnavailableReason || 'O arquivo original não está disponível neste aparelho nem no Storage.';
    return status;
  }

  if (copy.evidencePath) {
    status.state = 'synced';
    status.label = 'Foto sincronizada';
    status.detail = copy.evidenceSyncedAt ? `Confirmada na nuvem em ${new Date(copy.evidenceSyncedAt).toLocaleString('pt-BR')}.` : 'Arquivo confirmado no espaço sincronizado.';
    if (copy.evidenceId) {
      const local = await getEvidence(copy.evidenceId).catch(() => null);
      if (local?.blob?.size) status.size = local.blob.size;
    }
    return status;
  }

  if (!copy.evidenceId) return status;

  const evidence = await getEvidence(copy.evidenceId).catch(() => null);
  status.size = evidence?.blob?.size || null;
  status.attempts = Math.max(0, Number(evidence?.syncAttempts) || 0);
  status.error = evidence?.lastSyncError || null;

  if (!evidence?.blob) {
    status.state = 'missing-local';
    status.label = 'Foto local ausente';
    status.detail = 'O registro existe, mas o arquivo local não foi encontrado. A sincronização tentará reconciliar com o Storage.';
    return status;
  }

  if (status.error) {
    status.state = 'failed';
    status.label = 'Falha no envio';
    status.detail = `${status.attempts ? `${status.attempts} tentativa(s). ` : ''}${status.error}`;
    return status;
  }

  status.state = navigator.onLine ? 'pending' : 'offline';
  status.label = navigator.onLine ? 'Aguardando sincronização' : 'Salva somente neste aparelho';
  status.detail = navigator.onLine
    ? 'A foto está protegida localmente e será enviada no próximo ciclo de sincronização.'
    : 'A foto permanece no aparelho e será enviada quando a conexão retornar.';
  return status;
}

async function collectEvidenceHealth() {
  const inspections = await listInspections();
  const entries = [];
  for (const inspection of inspections) {
    for (const document of inspection.documents || []) {
      for (const copy of document.fieldCopies || []) {
        if (!copy.evidenceId && !copy.evidencePath && !copy.evidenceUnavailableAt) continue;
        entries.push({ inspection, document, copy, health: await inspectCopy(copy) });
      }
    }
  }

  const counts = {
    total: entries.length,
    synced: 0,
    pending: 0,
    offline: 0,
    failed: 0,
    unavailable: 0,
    missingLocal: 0,
    large: 0
  };
  for (const entry of entries) {
    const { health } = entry;
    if (health.state === 'synced') counts.synced += 1;
    else if (health.state === 'pending') counts.pending += 1;
    else if (health.state === 'offline') counts.offline += 1;
    else if (health.state === 'failed') counts.failed += 1;
    else if (health.state === 'unavailable') counts.unavailable += 1;
    else if (health.state === 'missing-local') counts.missingLocal += 1;
    if (health.size && health.size >= LARGE_EVIDENCE_BYTES) counts.large += 1;
  }
  return { entries, counts };
}

function badgeClass(state) {
  if (state === 'synced') return 'evidence-health-ok';
  if (state === 'failed' || state === 'unavailable' || state === 'missing-local') return 'evidence-health-error';
  return 'evidence-health-pending';
}

function enhanceVisibleCopyCards(summary, root = document) {
  const byCopyId = new Map(summary.entries.map(entry => [entry.copy.id, entry]));
  root.querySelectorAll('.copy-card').forEach(card => {
    const copyId = card.querySelector('[data-view-copy]')?.dataset.viewCopy
      || card.querySelector('[data-copy-edit]')?.dataset.copyEdit
      || card.querySelector('[data-copy-delete]')?.dataset.copyDelete;
    if (!copyId) return;
    const entry = byCopyId.get(copyId);
    if (!entry || card.querySelector('[data-evidence-health]')) return;

    const { health } = entry;
    const panel = document.createElement('div');
    panel.dataset.evidenceHealth = '1';
    panel.className = `evidence-health-row ${badgeClass(health.state)}`;
    const size = health.size ? ` · ${formatBytes(health.size)}` : '';
    const large = health.size && health.size >= LARGE_EVIDENCE_BYTES ? ' · arquivo grande' : '';
    panel.innerHTML = `<strong>${health.label}</strong><small>${health.detail}${size}${large}</small>`;
    card.appendChild(panel);
  });
}

function settingsPanelHtml(summary) {
  const { counts } = summary;
  const config = getSyncConfig();
  const problematic = counts.failed + counts.unavailable + counts.missingLocal;
  const waiting = counts.pending + counts.offline;
  const stateClass = problematic ? 'error' : waiting ? 'warning' : 'success';
  const headline = !counts.total
    ? 'Nenhuma evidência fotográfica registrada.'
    : problematic
      ? `${problematic} evidência(s) exigem atenção.`
      : waiting
        ? `${waiting} evidência(s) ainda não chegaram à nuvem.`
        : 'Todas as evidências estão sincronizadas.';

  return `<section class="evidence-health-panel ${stateClass}" data-evidence-health-panel>
    <div><span class="section-kicker">EVIDÊNCIAS</span><strong>${headline}</strong>
      <small>${counts.synced} sincronizadas · ${counts.pending + counts.offline} aguardando · ${counts.failed} com falha · ${counts.unavailable + counts.missingLocal} indisponíveis${counts.large ? ` · ${counts.large} arquivo(s) ≥ 4 MB` : ''}</small>
    </div>
    ${config && (waiting || counts.failed || counts.missingLocal) ? '<button class="btn" data-retry-evidence-sync type="button">Tentar sincronizar agora</button>' : ''}
  </section>`;
}

function enhanceSettings(summary, root = document) {
  const syncPanel = root.querySelector('.sync-panel');
  if (!syncPanel) return;
  syncPanel.querySelector('[data-evidence-health-panel]')?.remove();
  syncPanel.insertAdjacentHTML('beforeend', settingsPanelHtml(summary));
  syncPanel.querySelector('[data-retry-evidence-sync]')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    button.disabled = true;
    const original = button.textContent;
    button.textContent = 'Sincronizando…';
    try {
      await syncNow({ announce: true });
    } catch {
      // O estado detalhado da falha já é persistido por sync.js e será exibido na próxima leitura.
    } finally {
      button.disabled = false;
      button.textContent = original;
      scheduleRefresh(100);
    }
  });
}

async function refresh() {
  try {
    const summary = await collectEvidenceHealth();
    lastSummary = summary;
    enhanceVisibleCopyCards(summary);
    enhanceSettings(summary);
    window.dispatchEvent(new CustomEvent('docinspector:evidence-health', { detail: summary.counts }));
  } catch {
    // O painel é diagnóstico e nunca deve impedir o fluxo principal do aplicativo.
  }
}

function scheduleRefresh(delay = 80) {
  window.clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(refresh, delay);
}

function start() {
  scheduleRefresh(0);
  const app = document.querySelector('#app');
  if (app && !observer) {
    observer = new MutationObserver(() => {
      if (lastSummary) enhanceVisibleCopyCards(lastSummary, app);
      scheduleRefresh();
    });
    observer.observe(app, { childList: true, subtree: true });
  }
  window.addEventListener('sky17:sync-status', () => scheduleRefresh(50));
  window.addEventListener('sky17:sync-complete', () => scheduleRefresh(50));
  window.addEventListener('online', () => scheduleRefresh(50));
  window.addEventListener('offline', () => scheduleRefresh(50));
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
else start();
