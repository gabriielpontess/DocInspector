import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  buildRestoredDocumentGeneration,
  listRestorableDeletedDocuments
} from '../js/recovery-core.js';

const archivedId = '11111111-1111-4111-8111-111111111111';
const restoredId = '22222222-2222-4222-8222-222222222222';
const copyId = '33333333-3333-4333-8333-333333333333';
const inspection = {
  id: '44444444-4444-4444-8444-444444444444',
  project: 'Linha 17',
  system: 'TRILHO',
  responsible: 'Teste',
  documents: [{ id: '55555555-5555-4555-8555-555555555555', code: 'PW-OUTRO', description: 'Ativo' }],
  deletedDocumentIds: [archivedId],
  deletedDocuments: [{
    document: {
      id: archivedId,
      code: 'PW-RESTORE',
      sourceCode: 'PW-RESTORE',
      description: 'Documento arquivado',
      expectedRevision: 'A',
      fieldCopies: [{
        id: copyId,
        foundRevision: 'A',
        evidenceId: 'evidence-local',
        evidencePath: 'workspace/inspection/old-document/copy.jpg'
      }],
      deletedCopyIds: [],
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-02T00:00:00.000Z'
    },
    deletedAt: '2026-08-24T10:00:00.000Z',
    deletedBy: 'user@example.com',
    reason: null
  }],
  documentAudit: [{
    id: '66666666-6666-4666-8666-666666666666',
    action: 'document.deleted',
    documentId: archivedId,
    at: '2026-08-24T10:00:00.000Z',
    actor: 'user@example.com',
    changes: { code: 'PW-RESTORE' }
  }]
};

const restored = buildRestoredDocumentGeneration(inspection, archivedId, {
  newDocumentId: restoredId,
  actor: 'restorer@example.com',
  at: '2026-08-24T11:00:00.000Z'
});
assert.equal(restored.restoredDocument.id, restoredId, 'restauração deve criar nova geração interna');
assert.equal(restored.restoredDocument.fieldCopies[0].id, copyId, 'cópias de campo devem manter identidade');
assert.equal(restored.restoredDocument.fieldCopies[0].evidencePath, 'workspace/inspection/old-document/copy.jpg', 'evidencePath existente deve ser preservado');
assert.ok(restored.inspection.deletedDocumentIds.includes(archivedId), 'UUID antigo deve permanecer tombstonado');
assert.equal(restored.inspection.deletedDocuments.some(item => item.document?.id === archivedId), true, 'snapshot arquivado deve permanecer preservado como histórico');
assert.ok(restored.inspection.documentAudit.some(event => event.action === 'document.restored' && event.changes?.restoredFromDocumentId === archivedId), 'auditoria deve ligar nova geração ao UUID tombstonado');
assert.deepEqual(listRestorableDeletedDocuments(restored.inspection), [], 'documento já restaurado não pode reaparecer como restaurável');
assert.throws(() => buildRestoredDocumentGeneration(restored.inspection, archivedId, { newDocumentId: restoredId }), /já foi restaurado|não encontrado/i);

const staleMergedArchive = structuredClone(restored.inspection);
staleMergedArchive.deletedDocuments.push(structuredClone(inspection.deletedDocuments[0]));
assert.deepEqual(
  listRestorableDeletedDocuments(staleMergedArchive),
  [],
  'arquivo antigo reintroduzido por merge não pode reaparecer na lixeira após a nova geração ativa'
);

const ui = fs.readFileSync(new URL('../js/recovery-ui.js', import.meta.url), 'utf8');
const core = fs.readFileSync(new URL('../js/recovery-core.js', import.meta.url), 'utf8');
const index = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const sw = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
assert.match(ui, /Lixeira de documentos/, 'interface deve continuar oferecendo recuperação de documentos');
assert.match(ui, /contextOrThrow\(CAPABILITY\.MANAGE_DOCUMENTS\)/, 'restauração deve exigir apenas gestão de documentos');
assert.match(ui, /await syncNow\(\{ announce: false \}\)/, 'restauração deve sincronizar antes de criar nova geração');
assert.doesNotMatch(ui, /confidential|docinspector_project_documents|MANAGE_PROJECT_FILES|\bPDFs?\b/i, 'recuperação de documentos não deve depender do subsistema de PDF confidencial');
assert.doesNotMatch(core, /buildPdf|splitConfidential|\bPDFs? confidenciais\b/i, 'core de recuperação não deve carregar helpers do subsistema retirado');
assert.match(index, /src="js\/recovery-ui\.js"/, 'recovery UI deve continuar carregando no app');
assert.match(sw, /\.\/js\/recovery-core\.js/, 'core de recuperação deve permanecer no app shell');
assert.match(sw, /\.\/js\/recovery-ui\.js/, 'UI de recuperação deve permanecer no app shell');

console.log('Document recovery regression checks passed.');
