import assert from 'node:assert/strict';
import fs from 'node:fs';

const index = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const sw = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
const script = fs.readFileSync(new URL('../js/ui-refinement.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../visual-refinement.css', import.meta.url), 'utf8');

assert.match(index, /href="visual-refinement\.css"/, 'refinamento visual deve ser carregado após as camadas aprovadas');
assert.match(index, /src="js\/ui-refinement\.js"/, 'comportamentos de refinamento devem ser carregados no app');
assert.match(sw, /const VERSION = '0\.9\.22';/, 'PWA deve invalidar o cache para o refinamento final');
assert.match(sw, /\.\/visual-refinement\.css/, 'refinamento visual deve funcionar offline');
assert.match(sw, /\.\/js\/ui-refinement\.js/, 'navegação refinada deve funcionar offline');

assert.match(script, /inspection-more-menu/, 'ações secundárias da inspeção devem ser agrupadas em menu');
assert.match(script, /Atualizar lista/, 'menu deve manter atualização segura da lista');
assert.match(script, /previous-document/, 'deve existir navegação para documento anterior');
assert.match(script, /previous\.disabled = index === 0/, 'documento anterior deve desabilitar no início da lista');
assert.match(script, /next\.disabled = index === documents\.length - 1/, 'próximo documento deve desabilitar no fim da lista');
assert.match(script, /suggestions\.replaceChildren\(\)/, 'busca vazia não deve exibir documentos ou sugestões');
assert.match(script, /Pesquise por Código PW ou por palavras da descrição\./, 'descrição da busca deve ficar como ajuda discreta abaixo do campo');
assert.match(script, /Status da revisão esperada/, 'status proveniente da lista deve deixar clara sua relação com a revisão esperada');

assert.match(css, /height: 100dvh/, 'sidebar desktop deve preencher a viewport durante scroll');
assert.match(css, /position: sticky/, 'sidebar deve permanecer estruturalmente presa à viewport');
assert.match(css, /inspection-menu-popover/, 'menu de inspeção deve ter apresentação dedicada');
assert.match(css, /documents-toolbar/, 'filtros de documentos devem ter redistribuição de espaço');
assert.match(css, /global-search-box/, 'área de localizar documento deve receber refinamento dedicado');

console.log('ui-refinement.test.mjs: OK');
