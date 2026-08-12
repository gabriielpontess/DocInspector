import assert from 'node:assert/strict';
import { createInspection, makeDocument, addFieldCopy, metrics } from '../js/domain.js';

const a = createInspection({ project: 'Projeto A', system: 'Sistema A', responsible: 'QA' });
const b = createInspection({ project: 'Projeto B', system: 'Sistema B', responsible: 'QA' });
a.documents = [makeDocument({ code: 'PW-001', description: 'Documento comum', status: 'Ativo', expectedRevision: 'A' })];
b.documents = [makeDocument({ code: 'PW-001', description: 'Documento comum', status: 'Ativo', expectedRevision: 'B' })];

assert.notEqual(a.id, b.id, 'Inspeções precisam de IDs independentes');
assert.notEqual(a.documents[0].id, b.documents[0].id, 'O mesmo PW em listas diferentes precisa continuar sendo dois registros independentes');
addFieldCopy(a.documents[0], { foundRevision: 'A', source: 'manual' });
assert.equal(a.documents[0].copyCount, 1);
assert.equal(b.documents[0].fieldCopies.length, 0, 'Alterar uma lista não pode alterar a outra');
const consolidated = metrics([...a.documents, ...b.documents]);
assert.equal(consolidated.total, 2, 'Dashboard global deve contar os registros de cada lista separadamente');
assert.equal(consolidated.verified, 1);
assert.equal(consolidated.pending, 1);
console.log('global-catalog.test.mjs: OK');
