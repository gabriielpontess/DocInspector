import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const storage = await readFile('js/confidential-storage.js', 'utf8');
const linkingUi = await readFile('js/confidential-pdf-linking-ui.js', 'utf8');
const permissionUi = await readFile('js/permission-ui.js', 'utf8');

// Quantity has no frontend numeric source of truth: it is read from the singleton row.
assert.doesNotMatch(storage, /CONFIDENTIAL_PDF_MAX_FILES_PER_INSPECTION/);
assert.match(storage, /from\('docinspector_confidential_pdf_config'\)/);
assert.match(storage, /select\('max_files_per_inspection'\)/);
assert.match(storage, /eq\('singleton_key', 'global'\)/);
assert.match(storage, /maxFilesPerInspection/);

// document_id is plaintext linkage metadata, not part of encryptConfidentialPdf metadata/AAD.
assert.match(storage, /document_id:\s*optionalUuid\(documentId, 'documentId'\)/);
assert.match(storage, /listConfidentialDocuments\(\{ workspaceId, inspectionId, documentId \} = \{\}\)/);
assert.doesNotMatch(storage, /metadata:\s*\{[^}]*documentId/is);
assert.doesNotMatch(storage, /metadataAad\([^)]*documentId/i);

// Selection only opens the review flow. File bytes are consumed inside the upload routine,
// which is invoked only by the explicit confirmation button in the review modal.
assert.match(linkingUi, /input\.multiple = true/);
assert.match(linkingUi, /input\.onchange\s*=\s*\(\)\s*=>\s*\{[\s\S]*?openBatchReview\(files\)/);
assert.match(linkingUi, /matchConfidentialPdfBatch/);
assert.match(linkingUi, /REVISÃO OBRIGATÓRIA/);
assert.match(linkingUi, /Confirmar vínculos e enviar/);
assert.match(linkingUi, /data-confidential-document-select/);
assert.match(linkingUi, /Não vinculado/);
assert.match(linkingUi, /#confirm-confidential-batch-upload['"]?\)\?\.addEventListener\('click',[\s\S]*?uploadReviewedBatch\(/);
assert.match(linkingUi, /async function uploadReviewedBatch[\s\S]*?file\.arrayBuffer\(\)[\s\S]*?uploadConfidentialPdf\(/);

// UI preflight consumes the same runtime config and keeps the aggregate cap independent.
assert.match(linkingUi, /getConfidentialPdfConfig/);
assert.match(linkingUi, /config\.maxFilesPerInspection/);
assert.match(linkingUi, /CONFIDENTIAL_PDF_MAX_AGGREGATE_BYTES/);
assert.doesNotMatch(linkingUi, /maxFilesPerInspection\s*=\s*10/);
assert.doesNotMatch(linkingUi, /\.rpc\(/, 'Não criar RPC/UI administrativa para alterar o limite.');

// Document detail lists only records filtered by documentId.
assert.match(linkingUi, /listConfidentialDocuments\(\{ workspaceId: context\.workspaceId, inspectionId, documentId \}\)/);
assert.match(linkingUi, /PDFS DO PROJETO/);
assert.match(linkingUi, /Nenhum PDF vinculado a este documento/);

assert.match(permissionUi, /import ['\"]\.\/confidential-pdf-linking-ui\.js['\"]/);

console.log('Confidential PDF linking UI/runtime-limit regression checks passed.');