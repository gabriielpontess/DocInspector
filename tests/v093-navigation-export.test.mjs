
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

assert.match(app, /id="page-back"/, 'topbar deve renderizar botão voltar fora da home');
assert.match(app, /function navigateBack\(\)/, 'deve existir navegação de retorno');
assert.match(app, /includeSummary:\s*true/, 'conteúdo do relatório deve permanecer automático');
assert.doesNotMatch(app, /id="exp-summary"/, 'checkbox de conteúdo não deve existir');
assert.doesNotMatch(app, /id="exp-conforming"\s+checked/, 'Conformes não deve iniciar marcado');
assert.doesNotMatch(app, /id="exp-nonconforming"\s+checked/, 'Não conformes não deve iniciar marcado');
assert.doesNotMatch(app, /id="exp-notfound"\s+checked/, 'Não encontrados não deve iniciar marcado');
assert.doesNotMatch(app, /id="exp-pending"\s+checked/, 'Pendentes não deve iniciar marcado');
assert.match(app, /Selecione pelo menos um resultado para exportar/, 'deve impedir exportação sem seleção');
assert.match(css, /\.export-result-options/, 'novo layout da exportação deve existir');
console.log('v0.9.3 navigation/export tests OK');
