import assert from 'node:assert/strict';
import fs from 'node:fs';

const retirement = fs.readFileSync(new URL('../js/pdf-upload-retirement.js', import.meta.url), 'utf8');
const index = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const sw = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');

assert.match(retirement, /#confidential-upload/);
assert.match(retirement, /#confidential-upload-input/);
assert.match(retirement, /button\.hidden = true/);
assert.match(retirement, /button\.disabled = true/);
assert.match(retirement, /input\.hidden = true/);
assert.match(retirement, /input\.disabled = true/);
assert.match(retirement, /style\.setProperty\('display', 'none', 'important'\)/, 'controles aposentados devem permanecer visualmente ocultos mesmo com CSS de botão');
assert.match(retirement, /stopImmediatePropagation\(\)/, 'eventos de upload aposentados devem ser bloqueados antes do handler legado');
assert.match(retirement, /addEventListener\('click', blockRetiredUpload, true\)/, 'bloqueio deve ocorrer em capture phase');
assert.match(retirement, /addEventListener\('change', blockRetiredUpload, true\)/, 'change do file input também deve ser bloqueado em capture phase');
assert.match(retirement, /PDFs já existentes continuam disponíveis para consulta/);
assert.match(index, /src="js\/pdf-upload-retirement\.js"/);
assert.match(sw, /\.\/js\/pdf-upload-retirement\.js/);

console.log('PDF upload retirement regression checks passed.');
