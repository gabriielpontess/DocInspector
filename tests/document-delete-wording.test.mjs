import assert from 'node:assert/strict';
import fs from 'node:fs';

const management = fs.readFileSync(new URL('../js/document-management-ui.js', import.meta.url), 'utf8');

assert.match(management, /<span>Excluir documento<\/span>/, 'ação destrutiva deve nomear explicitamente o documento');
assert.match(management, /<h2>Excluir documento \$\{escapeHtml\(document\.code\)\}\?<\/h2>/, 'confirmação deve nomear explicitamente o documento');
assert.doesNotMatch(management, /PDFs? vinculados|apenas o PDF/i, 'gestão de documentos não deve mencionar o subsistema de PDF retirado');
assert.match(management, /Excluir documento da lista ativa/, 'CTA destrutivo deve permanecer inequívoco');

console.log('Document deletion wording checks passed.');
