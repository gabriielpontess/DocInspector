import assert from 'node:assert/strict';
import { addFieldCopy, makeDocument } from '../js/domain.js';
import {
  ENGINEERING_AUDIT_ACTION,
  appendEngineeringAuditEvent,
  currentEngineeringState,
  engineeringElapsedDays,
  engineeringStatus,
  listEngineeringContexts,
  normalizeEngineeringState
} from '../js/engineering-tracker-core.js';

function document(id, code, marking = null) {
  const item = makeDocument({ code, description: `Descrição ${code}`, status: 'Emitido', expectedRevision: 'A' });
  item.id = id;
  if (marking) addFieldCopy(item, { id: `${id}-copy`, foundRevision: 'A', markings: [marking] });
  return item;
}

function inspection(documents) {
  return {
    id: 'inspection-engineering',
    name: 'Tracker', project: 'Linha 17', system: 'SYS', responsible: 'Equipe', location: '',
    createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
    documents, deletedDocumentIds: [], deletedDocuments: [], documentAudit: []
  };
}

const red = document('red-id', 'PW-RED', 'Vermelho');
const yellow = document('yellow-id', 'PW-YELLOW', 'Amarelo');
const unmarked = document('plain-id', 'PW-PLAIN');
const base = inspection([red, yellow, unmarked]);

assert.equal(engineeringStatus({}), 'NOT_SENT');
assert.equal(engineeringElapsedDays({}), null);
assert.equal(engineeringElapsedDays({ sentAt: '2026-08-20' }, '2026-08-28'), 8);
assert.equal(engineeringElapsedDays({ sentAt: '2026-08-20', returnedAt: '2026-08-25' }, '2026-08-28'), 5);
assert.equal(engineeringStatus({ sentAt: '2026-08-20' }), 'AWAITING_RETURN');
assert.equal(engineeringStatus({ sentAt: '2026-08-20', returnedAt: '2026-08-25' }), 'RETURNED');
assert.throws(() => normalizeEngineeringState({ returnedAt: '2026-08-25' }), /data de envio/i);
assert.throws(() => normalizeEngineeringState({ sentAt: '2026-08-25', returnedAt: '2026-08-20' }), /anterior/i);

const first = appendEngineeringAuditEvent(base, 'red-id', {
  sentAt: '2026-08-20', note: 'Enviado para revisão'
}, {
  actor: 'inspector@example.com', at: '2026-08-20T12:00:00.000Z', eventId: 'engineering-event-1'
});
assert.equal(first.action, ENGINEERING_AUDIT_ACTION);
assert.equal(first.changes.status, 'AWAITING_RETURN');
assert.deepEqual(first.changes.markings, ['Vermelho']);
assert.equal(currentEngineeringState(base, 'red-id').sentAt, '2026-08-20');

appendEngineeringAuditEvent(base, 'red-id', {
  sentAt: '2026-08-20', returnedAt: '2026-08-26', note: 'Retornado com orientação'
}, {
  actor: 'inspector@example.com', at: '2026-08-26T15:00:00.000Z', eventId: 'engineering-event-2'
});
const current = currentEngineeringState(base, 'red-id');
assert.equal(current.returnedAt, '2026-08-26');
assert.equal(current.note, 'Retornado com orientação');
assert.equal(engineeringStatus(current), 'RETURNED');

assert.throws(
  () => appendEngineeringAuditEvent(base, 'plain-id', { sentAt: '2026-08-20' }),
  /Amarelo ou Vermelho/i,
  'documento sem marcação crítica não deve entrar no acompanhamento'
);

const rows = listEngineeringContexts([base]);
assert.equal(rows.length, 2, 'apenas Amarelo/Vermelho ativos devem aparecer');
assert.deepEqual(new Set(rows.map(row => row.document.id)), new Set(['red-id', 'yellow-id']));
assert.equal(rows.find(row => row.document.id === 'red-id')?.status, 'RETURNED');
assert.equal(rows.find(row => row.document.id === 'yellow-id')?.status, 'NOT_SENT');

const archived = structuredClone(base);
archived.deletedDocumentIds.push('yellow-id');
archived.deletedDocuments.push({ document: structuredClone(yellow), deletedAt: '2026-08-27T10:00:00.000Z' });
archived.documents = archived.documents.filter(item => item.id !== 'yellow-id');
assert.equal(listEngineeringContexts([archived]).some(row => row.document.id === 'yellow-id'), false, 'documento arquivado não deve permanecer na fila ativa de Engenharia');

console.log('engineering-tracker.test.mjs: OK');
