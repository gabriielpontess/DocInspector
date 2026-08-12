
import assert from 'node:assert/strict';
import fs from 'node:fs';

const report = fs.readFileSync(new URL('../js/report.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

assert.doesNotMatch(report, /addPage\('a4',\s*'landscape'\)/, 'PDF não deve criar páginas em paisagem');
assert.doesNotMatch(report, /pageOrientation:\s*'landscape'/, 'tabelas PDF não devem usar landscape');
assert.match(report, /doc\.addPage\('a4', 'portrait'\)/, 'páginas adicionais devem permanecer em retrato');
assert.match(css, /\.revision-chip[\s\S]*white-space:\s*nowrap/, 'chip de revisão não deve quebrar em múltiplas linhas');
assert.match(css, /@media \(max-width: 520px\)[\s\S]*\.copy-card-head/, 'histórico de cópias deve possuir tratamento mobile');
console.log('v0.9.5 PDF/mobile layout tests OK');
