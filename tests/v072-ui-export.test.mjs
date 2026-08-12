import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const app = await readFile(new URL('../js/app.js', import.meta.url), 'utf8');
const xlsx = await readFile(new URL('../js/xlsx.js', import.meta.url), 'utf8');

assert.match(app, /data-view-inspection/, 'Ver documentos de uma lista precisa filtrar por inspectionId, não apenas por sistema');
assert.match(app, /filter-inspection/, 'A aba Documentos precisa permitir filtrar por lista específica');
assert.match(app, /editInspectionModal/, 'A lista precisa poder editar metadados');
assert.match(app, /edit-system/, 'A edição precisa permitir alterar Sistema');
assert.match(app, /edit-responsible/, 'A edição precisa permitir alterar Responsável');
assert.match(app, /edit-location/, 'A edição precisa permitir alterar Local');
assert.match(app, /exportInspectionModal/, 'Exportação precisa abrir modal de seleção');
assert.match(app, /generate-pdf/, 'Exportação precisa oferecer PDF');
assert.match(app, /generate-xlsx/, 'Exportação precisa oferecer XLSX');
assert.match(xlsx, /shouldExportDocument/, 'XLSX precisa respeitar filtros de resultados');
assert.match(xlsx, /includeConforming/, 'XLSX precisa permitir incluir conformes/aprovados');
console.log('v072-ui-export.test.mjs: OK');
