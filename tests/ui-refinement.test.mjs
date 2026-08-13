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
assert.match(index, /navigator\.serviceWorker\.getRegistration\(\)[\s\S]*registration\?\.update\(\)/, 'bootstrap deve verificar atualização do Service Worker em toda abertura online');
assert.doesNotMatch(index, /src="js\/inspection-update-ui\.js"/, 'inspection-update-ui deve ser carregado somente pelo app principal');
assert.match(sw, /const VERSION = '0\.9\.26';/, 'Service Worker deve permanecer na versão validada desta branch');
assert.doesNotMatch(sw, /install[\s\S]{0,500}self\.skipWaiting\(\)/, 'install não deve trocar o worker durante trabalho ativo');
assert.match(sw, /\.\/visual-refinement\.css/, 'refinamento visual deve continuar no shell offline');
assert.match(sw, /\.\/js\/ui-refinement\.js/, 'navegação refinada deve funcionar offline');
assert.match(pwa, /updateViaCache: 'none'/, 'registro do PWA deve buscar sw.js sem reutilizar cache HTTP antigo');
assert.match(pwa, /registration\.update\(\)/, 'PWA deve verificar explicitamente por nova versão');
assert.doesNotMatch(pwa, /controllerchange|location\.reload/, 'PWA não deve recarregar automaticamente durante trabalho ativo');

assert.match(app, /inspection-more-menu/, 'ações secundárias da inspeção devem continuar declaradas pelo app principal');
assert.match(app, /data-update-inspection-list/, 'ações devem manter atualização segura da lista');
assert.match(script, /function refineInspectionActionMenus\(\)/, 'refinamento deve neutralizar o menu nativo após o bind principal');
assert.match(script, /nativeMenu\.replaceWith\(host\)/, 'details deve ser substituído por um host não interativo com botão real');
assert.match(script, /trigger\.type = 'button'/, 'gatilho de mais opções deve ser um botão real');
assert.match(script, /document\.body\.append\(backdrop\)/, 'Action Sheet deve viver diretamente no body, fora do card clicável');
assert.match(script, /list\.appendChild\(button\)/, 'Action Sheet deve mover os próprios botões já vinculados, sem proxy de click');
assert.match(script, /active\.popover\.appendChild\(button\)/, 'botões reais devem retornar ao host ao fechar o Action Sheet');
assert.match(script, /event\.stopPropagation\(\)/, 'ações devem impedir propagação para o card clicável');
assert.match(script, /previous-document/, 'deve existir navegação para documento anterior');
assert.match(script, /previous\.disabled = index === 0/, 'documento anterior deve desabilitar no início da lista');
assert.match(script, /next\.disabled = index === documents\.length - 1/, 'próximo documento deve desabilitar no fim da lista');
assert.match(script, /suggestions\.replaceChildren\(\)/, 'busca vazia não deve exibir documentos ou sugestões');
assert.match(script, /Pesquise por Código PW ou por palavras da descrição\./, 'descrição da busca deve ficar como ajuda discreta abaixo do campo');
assert.match(script, /Status da revisão esperada/, 'status proveniente da lista deve deixar clara sua relação com a revisão esperada');

assert.match(css, /position: fixed;[\s\S]*inset: 0 auto 0 0;/, 'sidebar desktop deve ficar ancorada do topo ao rodapé da viewport');
assert.match(css, /inspection-menu-popover[\s\S]*bottom: calc\(100% \+ 8px\)/, 'fallback visual legado deve continuar estável antes do refinamento');
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
