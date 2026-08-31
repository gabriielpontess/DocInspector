import { createId, documentMarkings, normalize } from './domain.js';

export const ENGINEERING_AUDIT_ACTION = 'document.engineering.updated';
export const ENGINEERING_MARKINGS = Object.freeze(['Vermelho', 'Amarelo']);

function dateOnly(value) {
  const raw = normalize(value);
  if (!raw) return null;
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) throw new Error('Data de Engenharia inválida.');
  const [, year, month, day] = match;
  const timestamp = Date.UTC(Number(year), Number(month) - 1, Number(day));
  const date = new Date(timestamp);
  if (date.getUTCFullYear() !== Number(year) || date.getUTCMonth() !== Number(month) - 1 || date.getUTCDate() !== Number(day)) {
    throw new Error('Data de Engenharia inválida.');
  }
  return `${year}-${month}-${day}`;
}

export function normalizeEngineeringState(state = {}) {
  const sentAt = dateOnly(state.sentAt);
  const returnedAt = dateOnly(state.returnedAt);
  if (returnedAt && !sentAt) throw new Error('Informe a data de envio antes da data de retorno.');
  if (sentAt && returnedAt && returnedAt < sentAt) throw new Error('A data de retorno não pode ser anterior ao envio.');
  return {
    sentAt,
    returnedAt,
    note: normalize(state.note).slice(0, 1000)
  };
}

export function engineeringStatus(state = {}) {
  const normalized = normalizeEngineeringState(state);
  if (normalized.returnedAt) return 'RETURNED';
  if (normalized.sentAt) return 'AWAITING_RETURN';
  return 'NOT_SENT';
}

function dateUtc(value) {
  const [year, month, day] = String(value).split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}

export function engineeringElapsedDays(state = {}, today = null) {
  const normalized = normalizeEngineeringState(state);
  if (!normalized.sentAt) return null;
  const end = normalized.returnedAt || dateOnly(today || new Date().toISOString());
  return Math.max(0, Math.floor((dateUtc(end) - dateUtc(normalized.sentAt)) / 86400000));
}

export function currentEngineeringState(inspection, documentId) {
  const events = (inspection?.documentAudit || [])
    .filter(event => event?.action === ENGINEERING_AUDIT_ACTION && event?.documentId === documentId)
    .sort((a, b) => {
      const time = String(a.at || '').localeCompare(String(b.at || ''));
      return time || String(a.id || '').localeCompare(String(b.id || ''));
    });
  const latest = events.at(-1);
  if (!latest) return { sentAt: null, returnedAt: null, note: '', updatedAt: null, actor: null };
  const state = normalizeEngineeringState(latest.changes || {});
  return {
    ...state,
    updatedAt: normalize(latest.at) || null,
    actor: normalize(latest.actor) || null
  };
}

export function appendEngineeringAuditEvent(inspection, documentId, state, {
  actor = null,
  at = null,
  eventId = null
} = {}) {
  if (!inspection || !Array.isArray(inspection.documents)) throw new Error('Inspeção inválida.');
  const document = inspection.documents.find(item => item.id === documentId);
  if (!document) throw new Error('Documento não encontrado na lista ativa.');
  const markings = documentMarkings(document).filter(marking => ENGINEERING_MARKINGS.includes(marking));
  if (!markings.length) throw new Error('Somente documentos com marcação Amarelo ou Vermelho podem entrar no acompanhamento de Engenharia.');

  const normalized = normalizeEngineeringState(state);
  const timestamp = at ? new Date(at) : new Date();
  if (!Number.isFinite(timestamp.getTime())) throw new Error('Data de auditoria inválida.');
  const event = {
    id: eventId || createId(),
    action: ENGINEERING_AUDIT_ACTION,
    documentId,
    at: timestamp.toISOString(),
    actor: normalize(actor) || null,
    changes: {
      ...normalized,
      status: engineeringStatus(normalized),
      markings
    }
  };
  inspection.documentAudit = [...(inspection.documentAudit || []), event].slice(-1000);
  return event;
}

export function listEngineeringContexts(inspections = []) {
  const rows = [];
  for (const inspection of inspections || []) {
    for (const document of inspection?.documents || []) {
      const markings = documentMarkings(document).filter(marking => ENGINEERING_MARKINGS.includes(marking));
      if (!markings.length) continue;
      const state = currentEngineeringState(inspection, document.id);
      rows.push({
        inspection,
        document,
        markings,
        engineering: state,
        status: engineeringStatus(state),
        elapsedDays: engineeringElapsedDays(state)
      });
    }
  }
  return rows.sort((a, b) => {
    const red = Number(b.markings.includes('Vermelho')) - Number(a.markings.includes('Vermelho'));
    if (red) return red;
    const awaiting = Number(b.status === 'AWAITING_RETURN') - Number(a.status === 'AWAITING_RETURN');
    if (awaiting) return awaiting;
    const elapsed = (b.elapsedDays ?? -1) - (a.elapsedDays ?? -1);
    if (elapsed) return elapsed;
    return String(a.document.code).localeCompare(String(b.document.code), 'pt-BR', { numeric: true });
  });
}
