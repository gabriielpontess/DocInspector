import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  availableRowLines,
  shouldStartRowOnNextPage,
  sliceRowLineSets,
  tableRowHeight
} from '../js/report.js';

const report = fs.readFileSync(new URL('../js/report.js', import.meta.url), 'utf8');
const refinement = fs.readFileSync(new URL('../js/ui-refinement.js', import.meta.url), 'utf8');
const exportPdfOptionsUi = fs.readFileSync(new URL('../js/export-pdf-options-ui.js', import.meta.url), 'utf8');
const authEntry = fs.readFileSync(new URL('../js/auth-entry.js', import.meta.url), 'utf8');
const index = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const serviceWorker = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');

const lineSets = [['a1', 'a2', 'a3'], ['b1'], ['c1', 'c2']];
const first = sliceRowLineSets(lineSets, [0, 0, 0], 2);
assert.deepEqual(first.chunkSets, [['a1', 'a2'], ['b1'], ['c1', 'c2']]);
assert.equal(first.done, false);
assert.equal(availableRowLines(7), 1);
assert.ok(Math.abs(tableRowHeight([['a1', 'a2', 'a3'], ['b1']]) - 12.4) < 1e-9);
assert.equal(shouldStartRowOnNextPage(24, 10, 230), true);
assert.equal(shouldStartRowOnNextPage(24, 30, 230), false);
assert.equal(shouldStartRowOnNextPage(260, 10, 230), false, 'linha maior que a página usa o fallback de continuação');
assert.match(report, /shouldStartRowOnNextPage\(fullRowH, currentAvailableHeight, freshPageAvailableHeight\)/);
assert.match(report, /fullRowH <= contentBottom - y/);

assert.match(refinement, /id="verification-scope"/);
assert.match(refinement, /Todas as inspeções \(global\)/);
assert.match(refinement, /data-search-inspection/);
assert.match(refinement, /handleScopedSearchAction/);
assert.match(refinement, /A identificação por câmera continua global/);
assert.match(refinement, /escapeHtml\(String\(item\.system/);
assert.match(refinement, /id="detail-previous-document"/);
assert.match(refinement, /id="detail-next-document"/);
assert.match(refinement, /openDocumentDetailThroughCatalog/);
assert.match(refinement, /previous\.disabled = index === 0/);
assert.match(refinement, /next\.disabled = index === documents\.length - 1/);
assert.match(refinement, /id="exp-pdf-copies"/);
assert.match(refinement, /includeCopies: checked\('exp-pdf-copies'\)/);
assert.match(refinement, /buildInspectionExportData\(inspection, options\)/);
assert.match(authEntry, /import\('\.\/export-pdf-options-ui\.js'\)/, 'bootstrap autenticado deve carregar o montador da opção do PDF');
assert.match(serviceWorker, /\.\/js\/export-pdf-options-ui\.js/);
assert.match(serviceWorker, /const VERSION = '0\.9\.34'/, 'password recovery diagnostics deve avançar a identidade técnica do cache');
assert.match(exportPdfOptionsUi, /id="exp-pdf-copies"/);
assert.doesNotMatch(exportPdfOptionsUi, /id="exp-pdf-copies"[^>]*checked/);
assert.doesNotMatch(exportPdfOptionsUi, /Opcional\. Acrescenta revisão encontrada/);
assert.match(exportPdfOptionsUi, /MutationObserver/);
assert.match(exportPdfOptionsUi, /bodyObserver\.disconnect\(\)/);
assert.match(index, /#exp-pdf-copies[\s\S]*width: 18px !important/);
assert.match(index, /\.modal:has\(#generate-pdf\)[\s\S]*overflow: hidden/);
assert.match(index, /grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/);
assert.match(index, /\.modal:has\(#sync-inline-status\)[\s\S]*overflow: hidden/);
assert.match(index, /\.modal:has\(#sync-inline-status\) \.sync-setup-tabs[\s\S]*overflow-y: auto/);
assert.match(index, /\.sync-setup-tabs::\-webkit-scrollbar-thumb/);

console.log('report-verification-navigation.test.mjs: OK');
