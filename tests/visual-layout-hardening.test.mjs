import assert from 'node:assert/strict';
import fs from 'node:fs';

const hardening = fs.readFileSync(new URL('../visual-hardening.css', import.meta.url), 'utf8');
const engineering = fs.readFileSync(new URL('../engineering-tracker.css', import.meta.url), 'utf8');
const verify = fs.readFileSync(new URL('../visual-verify.css', import.meta.url), 'utf8');
const responsive = fs.readFileSync(new URL('../visual-responsive.css', import.meta.url), 'utf8');
const refinement = fs.readFileSync(new URL('../visual-refinement.css', import.meta.url), 'utf8');
const auth = fs.readFileSync(new URL('../auth.css', import.meta.url), 'utf8');
const index = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const sw = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');

const hardeningLink = '<link rel="stylesheet" href="visual-hardening.css">';
assert.match(index, /<link rel="stylesheet" href="visual-hardening\.css">/,
  'a camada de invariantes visuais deve ser carregada explicitamente pela página');
assert.ok(index.indexOf(hardeningLink) > index.indexOf('engineering-tracker.css'),
  'hardening visual deve ficar depois dos estilos de Engenharia na cascata');
assert.ok(index.indexOf(hardeningLink) > index.lastIndexOf('</style>'),
  'hardening visual deve ficar depois dos estilos inline do shell');
assert.doesNotMatch(engineering, /@import\s+url\(['"]\.\/visual-hardening\.css['"]\)/,
  'Engenharia não deve antecipar a camada final de hardening via @import');
assert.match(sw, /\.\/visual-hardening\.css/,
  'hardening visual precisa fazer parte do app shell offline');

assert.match(hardening, /grid-template-columns:\s*minmax\(320px,\s*2fr\)\s*minmax\(0,\s*3fr\)/,
  'Verificar deve dividir o espaço restante em frações, sem 40% + 60% + gap');
assert.match(verify, /grid-template-columns:\s*minmax\(320px,40%\)\s*minmax\(0,60%\)/,
  'o teste deve continuar cobrindo a regra legada que motivou a proteção final');

assert.match(hardening, /button,[\s\S]*\[role="button"\],[\s\S]*\[role="menuitem"\],[\s\S]*summary[\s\S]*overflow-wrap:\s*normal;[\s\S]*word-break:\s*normal;/,
  'rótulos interativos não podem quebrar no meio das palavras');
assert.match(hardening, /\.btn\s*\{[\s\S]*white-space:\s*normal;[\s\S]*overflow-wrap:\s*normal;[\s\S]*word-break:\s*normal;/,
  'botões podem quebrar entre palavras, mas nunca fragmentar palavras');
assert.doesNotMatch(hardening, /\.btn\s*\{[\s\S]{0,220}overflow-wrap:\s*anywhere/,
  'a regra global de botão não pode reintroduzir quebra arbitrária de palavras');

assert.match(hardening, /@media \(min-width: 768px\) and \(min-height: 521px\)[\s\S]*\.compact-doc-table td\.details-cell[\s\S]*width:\s*196px;[\s\S]*\.document-management-row-actions[\s\S]*display:\s*grid;/,
  'coluna de ações desktop deve reservar espaço suficiente e empilhar ações de forma previsível');

assert.match(hardening, /\.compact-doc-table \.code-cell strong[\s\S]*white-space:\s*normal !important/,
  'Código PW não pode ser truncado em uma linha');
assert.match(responsive, /\.compact-doc-table \.code-cell strong[\s\S]*text-overflow:\s*ellipsis[\s\S]*white-space:\s*nowrap/,
  'o teste deve detectar a regra legada sobrescrita pela camada de hardening');

assert.match(hardening, /\.search-suggestion-list[\s\S]*overflow-x:\s*hidden;[\s\S]*overflow-y:\s*auto;/,
  'lista de sugestões deve rolar dentro da própria caixa sem gerar overflow lateral');
assert.match(verify, /\.search-suggestion-list[\s\S]*max-height:\s*340px/,
  'o contrato deve continuar cobrindo o componente cuja altura limitada exige rolagem interna');
assert.match(hardening, /\.search-suggestion-code,[\s\S]*\.search-suggestion-meta,[\s\S]*overflow-wrap:\s*anywhere/,
  'Código PW, origem e metadados de sugestões devem aceitar tokens longos');
assert.match(hardening, /\.inspection-system-title,[\s\S]*\.inspection-list-name,[\s\S]*overflow-wrap:\s*anywhere/,
  'identificadores da inspeção na Home devem quebrar tokens longos');

assert.match(hardening, /\.pill,[\s\S]*\.revision-chip,[\s\S]*\.evidence-sync-badge,[\s\S]*white-space:\s*normal/,
  'chips e badges operacionais devem crescer verticalmente em vez de ultrapassar o container');

assert.match(hardening, /\.modal:has\(#save-copy-edit\),[\s\S]*\.modal:has\(#generate-pdf\)[\s\S]*overflow-y:\s*auto !important/,
  'modais com conteúdo dinâmico devem rolar verticalmente em vez de cortar conteúdo');
assert.match(refinement, /\.modal:has\(#save-copy-edit\)[\s\S]*overflow:\s*hidden/,
  'o contrato deve proteger contra regressão da regra legada de clipping');
assert.match(index, /\.modal:has\(#generate-pdf\)[\s\S]*overflow:\s*hidden/,
  'o contrato deve proteger contra regressão da regra inline de clipping');

assert.match(refinement, /@media \(max-width: 1199px\) and \(min-width: 768px\)[\s\S]*\.documents-toolbar\s*\{\s*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\);\s*\}[\s\S]*\.documents-toolbar #filter-text\s*\{\s*grid-column:\s*1 \/ -1;\s*\}/,
  'toolbar de Documentos em tablet deve permitir encolhimento real e manter a busca em linha inteira');
assert.doesNotMatch(refinement, /@media \(max-width: 1199px\) and \(min-width: 768px\)[\s\S]*minmax\(240px,\s*1\.35fr\)[\s\S]*minmax\(150px,\s*1fr\)/,
  'breakpoint de tablet não pode reintroduzir mínimos rígidos que ultrapassem a largura útil do card');
assert.match(hardening, /\.documents-toolbar\s*\{[\s\S]*overflow-x:\s*clip;/,
  'toolbar de Documentos deve impedir que a área anônima de options nativos propague overflow no WebKit');
assert.match(hardening, /\.documents-toolbar select\s*\{[\s\S]*overflow:\s*hidden;[\s\S]*text-overflow:\s*ellipsis;[\s\S]*white-space:\s*nowrap;/,
  'selects nativos de Documentos devem conter opções longas sem ampliar o body no WebKit');
assert.match(engineering, /@media \(max-width: 900px\), \(max-width: 1024px\) and \(any-pointer: coarse\)[\s\S]*\.mobile-nav:has\(\[data-engineering-launcher\]\)[\s\S]*grid-template-columns:\s*repeat\(5,\s*minmax\(0,\s*1fr\)\)/,
  'barra inferior com Engenharia deve permanecer em uma linha no mesmo breakpoint tablet/coarse-pointer que ativa a mobile-nav');
assert.match(hardening, /\.mobile-nav \[data-engineering-launcher\][\s\S]*overflow-wrap:\s*normal;[\s\S]*word-break:\s*normal;/,
  'Engenharia na navegação móvel não pode quebrar no meio da palavra');
assert.match(engineering, /@media \(max-width: 350px\)[\s\S]*\.mobile-nav \[data-engineering-launcher\]\s*\{\s*font-size:\s*10px;/,
  'o menor breakpoint da Engenharia não pode cair abaixo do piso legível');

assert.match(responsive, /\.compact-doc-table \.details-cell > \.btn\[data-doc-details\][\s\S]*font-size:\s*0;/,
  'somente o botão de detalhes pode virar chevron no card mobile');
assert.doesNotMatch(responsive, /\.compact-doc-table \.details-cell \.btn\s*\{/,
  'ações injetadas de Editar/Excluir não podem herdar genericamente o chevron');
assert.match(responsive, /\.document-management-row-actions[\s\S]*display:\s*flex;[\s\S]*\.document-management-row-actions \.btn[\s\S]*min-width:\s*44px;/,
  'ações de gerenciamento mobile devem manter grupo e alvo de toque próprios');

assert.match(responsive, /\.home-summary\s*\{\s*margin-inline:\s*calc\(var\(--space-3\) \* -1\)/,
  'a antiga sangria mobile deve continuar coberta explicitamente como causa de overflow');
assert.match(hardening, /@media \(max-width: 430px\)[\s\S]*\.home-summary[\s\S]*margin-inline:\s*0 !important;[\s\S]*max-width:\s*100%/,
  'o scroller da Home deve permanecer fisicamente contido na viewport');

assert.match(hardening, /\.toast,[\s\S]*overflow-wrap:\s*anywhere/,
  'mensagens longas devem quebrar linha');
assert.match(hardening, /\.user-admin-access-head\s*\{\s*flex-wrap:\s*wrap;/,
  'cabeçalho administrativo deve poder quebrar linha');
assert.match(auth, /\.auth-account-copy span, \.auth-account-copy strong, \.auth-account-copy small\s*\{\s*overflow:\s*hidden;\s*text-overflow:\s*ellipsis;\s*white-space:\s*nowrap;/,
  'o teste deve manter registrada a regra antiga que truncava a identidade da conta');
assert.match(hardening, /\.auth-account-copy strong,[\s\S]*\.auth-account-copy small[\s\S]*text-overflow:\s*clip;[\s\S]*white-space:\s*normal/,
  'nome/e-mail da conta devem permanecer legíveis sem ellipsis');
assert.match(hardening, /\.auth-password-dialog[\s\S]*max-height:\s*calc\(100dvh - 24px\)[\s\S]*overflow-y:\s*auto/,
  'diálogo de senha deve continuar utilizável em telas de baixa altura');
assert.match(hardening, /font-size:\s*clamp\(10px,\s*2\.8vw,\s*11px\) !important/,
  'item Engenharia não deve cair abaixo do piso legível no mobile');

assert.match(sw, /const VERSION = '0\.9\.52';/,
  'alteração de asset do app shell deve manter a identidade funcional desta release');
assert.match(sw, /const CACHE_REVISION = `\$\{VERSION\}-settings-admin-1`;/,
  'alteração visual do app shell deve rotacionar a geração de cache instalada');

console.log('Visual layout hardening contracts passed.');
