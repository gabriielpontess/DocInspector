import assert from 'node:assert/strict';
import { addFieldCopy, makeDocument } from '../js/domain.js';
import { appendEngineeringAuditEvent, currentEngineeringState } from '../js/engineering-tracker-core.js';
import { mergeInspection } from '../js/sync.js';

function createBase() {
  const document = makeDocument({ code: 'PW-ENG-001', description: 'Documento Engenharia', status: 'Emitido', expectedRevision: 'A' });
  document.id = 'engineering-doc';
  addFieldCopy(document, { id: 'engineering-copy', foundRevision: 'A', markings: ['Vermelho'] });
  document.createdAt = '2026-08-20T10:00:00.000Z';
  document.updatedAt = '2026-08-20T10:00:00.000Z';
  document.fieldCopies[0].capturedAt = '2026-08-20T10:00:00.000Z';
  document.fieldCopies[0].updatedAt = '2026-08-20T10:00:00.000Z';
  return {
    id: 'engineering-inspection', name: 'Engenharia', project: 'Linha 17', system: 'SYS', responsible: 'Equipe', location: '',
    createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-20T10:00:00.000Z',
    documents: [document], deletedDocumentIds: [], deletedDocuments: [], documentAudit: []
  };
}

const base = createBase();
const deviceA = structuredClone(base);
appendEngineeringAuditEvent(deviceA, 'engineering-doc', {
  sentAt: '2026-08-20', note: 'Enviado por A'
}, {
  actor: 'device-a', at: '2026-08-20T11:00:00.000Z', eventId: 'eng-a'
});
deviceA.updatedAt = '2026-08-20T11:00:00.000Z';

// Dispositivo B estava stale e registra uma alteração de campo mais tarde, sem
// conhecer o evento de Engenharia de A. O evento precisa sobreviver ao merge.
const deviceB = structuredClone(base);
deviceB.updatedAt = '2026-08-20T12:00:00.000Z';
deviceB.documents[0].updatedAt = '2026-08-20T12:00:00.000Z';
deviceB.documents[0].fieldCopies[0].comment = 'Comentário salvo no aparelho B';
deviceB.documents[0].fieldCopies[0].updatedAt = '2026-08-20T12:00:00.000Z';

const mergedStale = mergeInspection(deviceA, deviceB);
const stateAfterStale = currentEngineeringState(mergedStale, 'engineering-doc');
assert.equal(stateAfterStale.sentAt, '2026-08-20', 'evento de Engenharia não pode ser perdido por payload stale mais novo');
assert.equal(stateAfterStale.note, 'Enviado por A');
assert.ok(mergedStale.documentAudit.some(event => event.id === 'eng-a'));
assert.equal(mergedStale.documents[0].fieldCopies[0].comment, 'Comentário salvo no aparelho B', 'merge deve conservar também a alteração de campo mais nova');

// Agora B registra legitimamente um retorno depois de receber o estado. Os dois
// eventos devem coexistir e a derivação deve escolher o evento mais recente.
const deviceBWithReturn = structuredClone(mergedStale);
appendEngineeringAuditEvent(deviceBWithReturn, 'engineering-doc', {
  sentAt: '2026-08-20', returnedAt: '2026-08-27', note: 'Retornado por B'
}, {
  actor: 'device-b', at: '2026-08-27T09:00:00.000Z', eventId: 'eng-b'
});
deviceBWithReturn.updatedAt = '2026-08-27T09:00:00.000Z';

const concurrentDeviceA = structuredClone(deviceA);
concurrentDeviceA.updatedAt = '2026-08-27T10:00:00.000Z';
concurrentDeviceA.documents[0].updatedAt = '2026-08-27T10:00:00.000Z';

const mergedReturn = mergeInspection(concurrentDeviceA, deviceBWithReturn);
assert.deepEqual(new Set(mergedReturn.documentAudit.map(event => event.id)), new Set(['eng-a', 'eng-b']));
const finalState = currentEngineeringState(mergedReturn, 'engineering-doc');
assert.equal(finalState.returnedAt, '2026-08-27');
assert.equal(finalState.note, 'Retornado por B');
assert.equal(finalState.actor, 'device-b');

console.log('engineering-tracker-sync.test.mjs: OK');
