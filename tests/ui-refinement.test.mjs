import assert from 'node:assert/strict';
import fs from 'node:fs';

const index = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const sw = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const pwa = fs.readFileSync(new URL('../js/pwa.js', import.meta.url), 'utf8');
const script = fs.readFileSync(new URL('../js/ui-refinement.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../visual-refinement.css', import.meta.url), 'utf8');

assert.match(index, /href="visual-refinement\.css"/, 'refinamento visual deve usar a mesma URL pré-cacheada pelo app shell offline');
assert.match(index, /src="js\/ui-refinement\.js"/, 'comportamentos de refinamento devem ser carregados no app');
assert.match(sw, /const VERSION = '0\.9\.25';/, 'Service Worker deve permanecer na versão validada desta branch');
assert.match(sw, /await self\.skipWaiting\(\)/, 'novo app shell deve ativar sem permanecer preso em waiting');
assert.match(sw, /\.\/visual-refinement\.css/, 'refinamento visual deve continuar no shell offline');
assert.match(sw, /\.\/js\/ui-refinement\.js/, 'navegação refinada deve funcionar offline');
assert.match(pwa, /updateViaCache: 'none'/, 'registro do PWA deve buscar sw.js sem reutilizar cache HTTP antigo');
assert.match(pwa, /registration\.update\(\)/, 'PWA deve verificar explicitamente por nova versão');
assert.match(pwa, /SKIP_WAITING/, 'PWA deve promover worker em espera');
assert.match(pwa, /controllerchange/, 'troca de controlador deve ser tratada de forma determinística');

assert.match(app, /inspection-more-menu/, 'ações secundárias da inspeção devem ser renderizadas pelo app principal');
assert.match(app, /data-update-inspection-list/, 'menu nativo deve manter atualização segura da lista');
assert.doesNotMatch(script, /refineInspectionActions/, 'camada de refinamento não deve reconstruir nem mover ações da inspeção');
assert.match(script, /previous-document/, 'deve existir navegação para documento anterior');
assert.match(script, /previous\.disabled = index === 0/, 'documento anterior deve desabilitar no início da lista');
assert.match(script, /next\.disabled = index === documents\.length - 1/, 'próximo documento deve desabilitar no fim da lista');
assert.match(script, /suggestions\.replaceChildren\(\)/, 'busca vazia não deve exibir documentos ou sugestões');
assert.match(script, /Pesquise por Código PW ou por palavras da descrição\./, 'descrição da busca deve ficar como ajuda discreta abaixo do campo');
assert.match(script, /Status da revisão esperada/, 'status proveniente da lista deve deixar clara sua relação com a revisão esperada');

assert.match(css, /position: fixed;[\s\S]*inset: 0 auto 0 0;/, 'sidebar desktop deve ficar ancorada do topo ao rodapé da viewport');
assert.match(css, /inspection-menu-popover[\s\S]*bottom: calc\(100% \+ 8px\)/, 'menu de inspeção deve abrir acima do gatilho e evitar corte no rodapé');
assert.match(css, /global-search-box #find-pw \{ display: none !important; \}/, 'busca deve funcionar por Enter sem botão Localizar redundante');
assert.match(css, /scan-actions #scan-document[\s\S]*width: 48px;[\s\S]*height: 48px;/, 'câmera deve ter o mesmo tamanho do botão de limpar');
assert.match(css, /scan-actions #scan-document span \{ display: none; \}/, 'ação fotográfica deve exibir apenas o SVG da câmera');
assert.match(css, /:has\(#pw-search:placeholder-shown\)[\s\S]*doc-detail/, 'busca vazia não deve manter documento antigo visível');
assert.match(css, /doc-kicker[\s\S]*font-weight: 600;[\s\S]*letter-spacing: 0;[\s\S]*text-transform: none;/, 'identificação do sistema deve usar tipografia mais natural');
assert.match(css, /previous-document-button::before[\s\S]*next-document-button::before/, 'navegação anterior e próxima deve usar o mesmo desenho base');
assert.match(css, /#filter-inspection,[\s\S]*#sort-docs,[\s\S]*#clear-doc-filters \{ display: none !important; \}/, 'toolbar deve manter apenas busca, sistema, resultado e status visíveis');
assert.match(css, /settings-grid \.settings-wide \{ grid-column: auto; \}/, 'dados e backup devem usar grade consistente sem caixotes arbitrariamente largos');
assert.match(css, /\.modal:has\(#save-copy-edit\)[\s\S]*overflow: hidden;/, 'edição de cópia deve caber sem scroll interno em desktop normal');

console.log('ui-refinement.test.mjs: OK');
