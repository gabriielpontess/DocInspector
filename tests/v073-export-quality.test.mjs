import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const app = await readFile(new URL('../js/app.js', import.meta.url), 'utf8');
const xlsx = await readFile(new URL('../js/xlsx.js', import.meta.url), 'utf8');
const report = await readFile(new URL('../js/report.js', import.meta.url), 'utf8');
const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const sw = await readFile(new URL('../sw.js', import.meta.url), 'utf8');

assert.doesNotMatch(app, /window\.open\(/, 'PDF não pode depender de popup/about:blank');
assert.match(app, /exportInspectionPdf/, 'PDF deve usar o gerador dedicado');
assert.match(xlsx, /ExcelJS/, 'XLSX visual deve usar engine com suporte a estilos');
assert.match(xlsx, /DOCINSPECTOR/, 'XLSX precisa conter branding do relatório');
assert.match(xlsx, /buildDonutDataUrl/, 'Resumo XLSX precisa incluir visual de resultados');
assert.match(xlsx, /resultFill/, 'Resultado XLSX precisa ter diferenciação visual');
assert.match(report, /doc\.output\('blob'\)/, 'PDF deve ser gerado como arquivo Blob');
assert.match(report, /LISTA DE DOCUMENTOS/, 'PDF deve incluir seção visual de documentos');
assert.match(report, /DETALHAMENTO POR RESULTADO/, 'PDF deve incluir resumo gráfico');
assert.match(index, /exceljs@4\.4\.0/, 'ExcelJS deve estar carregado no navegador');
assert.match(index, /jspdf@4\.0\.0/, 'jsPDF deve estar carregado no navegador');
assert.match(sw, /EXCELJS_URL/, 'PWA deve armazenar ExcelJS em cache');
assert.match(sw, /JSPDF_URL/, 'PWA deve armazenar jsPDF em cache');
assert.match(sw, /'\.\/js\/report\.js'/, 'Gerador PDF deve estar no app shell');
console.log('v073-export-quality.test.mjs: OK');
