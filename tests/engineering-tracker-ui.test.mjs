import assert from 'node:assert/strict';
import fs from 'node:fs';

const ui = fs.readFileSync(new URL('../js/engineering-tracker-ui.js', import.meta.url), 'utf8');
const index = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const sw = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../engineering-tracker.css', import.meta.url), 'utf8');

assert.match(index, /href="engineering-tracker\.css"/);
assert.match(index, /src="js\/engineering-tracker-ui\.js"/);
assert.match(sw, /\.\/engineering-tracker\.css/);
assert.match(sw, /\.\/visual-hardening\.css/);
assert.match(sw, /\.\/js\/engineering-tracker-core\.js/);
assert.match(sw, /\.\/js\/engineering-tracker-ui\.js/);
assert.match(sw, /const VERSION = '0\.9\.49';/);

assert.match(ui, /modal\.querySelector\('\.modal'\)\?\.classList\.add\('engineering-tracker-modal'\)/,
  'dimensionamento deve ser aplicado ao painel do diálogo, nunca ao backdrop');
assert.doesNotMatch(ui, /modal\.classList\.add\('engineering-tracker-modal'\)/,
  'backdrop deve continuar cobrindo toda a viewport');
assert.match(ui, /refreshAuditInPlace\(row, saved\.inspection, row\.dataset\.documentId\)/,
  'histórico visível deve refletir o save sem reabrir o modal');
assert.match(ui, /refreshSummaryInPlace\(modal\)/,
  'indicadores devem refletir o save sem reabrir o modal');
assert.match(ui, /data-engineering-summary-awaiting/);
assert.match(ui, /data-engineering-summary-oldest/);
assert.match(ui, /data-engineering-elapsed/);
assert.match(ui, /CONCURRENT_MODIFICATION/);

assert.match(css, /^@import url\('\.\/visual-hardening\.css'\);/);
assert.match(css, /\.engineering-tracker-modal\s*\{/);
assert.match(css, /@media \(max-width: 767px\)[\s\S]*repeat\(5, minmax\(0, 1fr\)\)/,
  'navegação móvel deve reservar uma coluna real para Engenharia');
assert.match(css, /\.engineering-toolbar,[\s\S]*\.engineering-fields \{ grid-template-columns: 1fr; \}/,
  'campos da Engenharia devem empilhar em celular');

console.log('engineering-tracker-ui.test.mjs: OK');