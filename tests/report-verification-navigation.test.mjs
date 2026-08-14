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
const index = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

// O fallback histórico para uma linha maior que a própria página continua disponível.
const lineSets = [['a1', 'a2', 'a3'], ['b1'], ['c1', 'c2']];
const first = sliceRowLineSets(lineSets, [0, 0, 0], 2);
assert.deepEqual(first.chunkSets, [['a1', 'a2'], ['b1'], ['c1', 'c2']]);
assert.equal(first.done, false);
assert.equal(availableRowLines(7), 1);

// Uma linha normal deve ser medida inteira e movida para a página seguinte,
// nunca dividida só porque começou perto do rodapé.
assert.ok(Math.abs(tableRowHeight([['a1', 'a2', 'a3'], ['b1']]) - 12.4) < 1e-9);
assert.equal(shouldStartRowOnNextPage(24, 10, 230), true);
assert.equal(shouldStartRowOnNextPage(24, 30, 230), false);
assert.equal(shouldStartRowOnNextPage(260, 10, 230), false, 'linha maior que a página usa o fallback de continuação');
assert.match(report, /shouldStartRowOnNextPage\(fullRowH, currentAvailableHeight, freshPageAvailableHeight\)/, 'linha normal deve ser movida antes de ser fragmentada');
assert.match(report, /fullRowH <= contentBottom - y/, 'linha que cabe deve ser desenhada integralmente');

// Verificação global ou restrita a uma lista.
assert.match(refinement, /id="verification-scope"/, 'Verificação deve oferecer seleção de escopo');
assert.match(refinement, /Todas as inspeções \(global\)/, 'Escopo global deve permanecer disponível');
assert.match(refinement, /data-search-inspection/, 'Filtro deve usar a identidade real da inspeção nas sugestões');
assert.match(refinement, /handleScopedSearchAction/, 'Enter e ação de localizar devem respeitar a lista escolhida');
assert.match(refinement, /A identificação por câmera continua global/, 'UI deve deixar explícito que o filtro atual é da busca manual');
assert.match(refinement, /escapeHtml\(String\(item\.system/, 'Rótulos do filtro de inspeção devem ser escapados');

// Navegação na página Mais detalhes.
assert.match(refinement, /id="detail-previous-document"/, 'Detalhes deve possuir botão de documento anterior');
assert.match(refinement, /id="detail-next-document"/, 'Detalhes deve possuir botão de próximo documento');
assert.match(refinement, /openDocumentDetailThroughCatalog/, 'Navegação deve reutilizar o caminho funcional do catálogo de Documentos');
assert.match(refinement, /previous\.disabled = index === 0/, 'Anterior deve desabilitar no primeiro documento');
assert.match(refinement, /next\.disabled = index === documents\.length - 1/, 'Próximo deve desabilitar no último documento');

// Cópias de campo passam a ser opcionais somente no PDF principal.
assert.match(refinement, /id="exp-pdf-copies"/, 'Geração PDF deve conhecer a opção de cópias de campo');
assert.match(refinement, /includeCopies: checked\('exp-pdf-copies'\)/, 'PDF deve obedecer ao checkbox de cópias');
assert.match(refinement, /buildInspectionExportData\(inspection, options\)/, 'PDF deve reconstruir dados com a opção escolhida');
assert.match(index, /src="js\/export-pdf-options-ui\.js"/, 'HTML deve carregar o montador da opção do PDF');
assert.match(exportPdfOptionsUi, /id="exp-pdf-copies"/, 'Modal deve receber o checkbox de cópias de campo');
assert.doesNotMatch(exportPdfOptionsUi, /id="exp-pdf-copies"[^>]*checked/, 'Checkbox de cópias de campo não pode vir pré-selecionado');
assert.match(exportPdfOptionsUi, /MutationObserver/, 'Montador deve observar brevemente o modal que é anexado ao body');
assert.match(exportPdfOptionsUi, /bodyObserver\.disconnect\(\)/, 'Observador temporário deve ser desconectado após montar a opção');

console.log('report-verification-navigation.test.mjs: OK');
