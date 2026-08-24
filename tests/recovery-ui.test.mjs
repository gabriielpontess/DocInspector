import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  buildPdfRestorePatch,
  buildPdfSoftDeletePatch,
  buildRestoredDocumentGeneration,
  listRestorableDeletedDocuments,
  splitConfidentialObjectPath
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

const deletePatch = buildPdfSoftDeletePatch('2026-08-24T12:00:00.000Z');
assert.deepEqual(deletePatch, { status: 'DELETED', deleted_at: '2026-08-24T12:00:00.000Z' });
assert.deepEqual(buildPdfRestorePatch(), { status: 'ACTIVE', deleted_at: null });
assert.deepEqual(splitConfidentialObjectPath('workspace/inspection/file.dipdf'), { folder: 'workspace/inspection', filename: 'file.dipdf' });

const ui = fs.readFileSync(new URL('../js/recovery-ui.js', import.meta.url), 'utf8');
const index = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const sw = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
assert.match(ui, /stopImmediatePropagation\(\)/, 'exclusão de PDF deve bloquear o handler legado destrutivo em capture phase');
assert.match(ui, /addEventListener\('click',[\s\S]*true\);/, 'interceptador de PDF deve operar em capture phase');
assert.match(ui, /Mover somente este PDF para a lixeira/, 'confirmação deve distinguir PDF de documento da inspeção');
assert.match(ui, /Excluir documento/, 'ação destrutiva do documento deve ter rótulo inequívoco');
assert.match(ui, /Lixeira de PDFs/, 'interface deve oferecer recuperação de PDFs');
assert.match(ui, /Lixeira de documentos/, 'interface deve oferecer recuperação de documentos');
assert.doesNotMatch(ui, /storage\.from\(CONFIDENTIAL_BUCKET\)\.remove/, 'exclusão comum não deve remover ciphertext remoto');
assert.doesNotMatch(ui, /^import .*confidential-e2ee-ui/m, 'UI confidencial pesada não deve virar dependência estática do boot offline');
assert.doesNotMatch(ui, /^import .*confidential-pdf-linking-ui/m, 'linking UI não deve virar dependência estática do boot offline');
assert.match(ui, /import\('\.\/confidential-e2ee-ui\.js'\)/, 'refresh online pode carregar a UI confidencial dinamicamente');
assert.match(ui, /import\('\.\/confidential-pdf-linking-ui\.js'\)/, 'refresh online pode carregar linking dinamicamente');
assert.match(ui, /label && label\.textContent !== 'Excluir documento'/, 'observer não deve reescrever o mesmo rótulo de documento e gerar feedback loop');
assert.match(ui, /button\.textContent !== 'Excluir PDF'/, 'observer não deve reescrever o mesmo rótulo de PDF e gerar feedback loop');
assert.match(ui, /button\.title !== title/, 'atributos de refinamento devem ser atualizados somente quando mudarem');
assert.match(index, /src="js\/recovery-ui\.js"/, 'recovery UI deve carregar no app');
assert.match(sw, /\.\/js\/recovery-core\.js/, 'core de recuperação deve estar no app shell');
assert.match(sw, /\.\/js\/recovery-ui\.js/, 'UI de recuperação deve estar no app shell');

console.log('Document/PDF recovery regression checks passed.');
