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

assert.match(engineering, /^@import url\('\.\/visual-hardening\.css'\);/,
  'a camada de invariantes visuais deve carregar junto do CSS final da aplicação');
assert.match(sw, /\.\/visual-hardening\.css/,
  'hardening visual precisa fazer parte do app shell offline');

assert.match(hardening, /grid-template-columns:\s*minmax\(320px,\s*2fr\)\s*minmax\(0,\s*3fr\)/,
  'Verificar deve dividir o espaço restante em frações, sem 40% + 60% + gap');
assert.match(verify, /grid-template-columns:\s*minmax\(320px,40%\)\s*minmax\(0,60%\)/,
  'o teste deve continuar cobrindo a regra legada que motivou a proteção final');

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
assert.match(engineering, /@media \(max-width: 900px\), \(max-width: 1024px\) and \(any-pointer: coarse\)[\s\S]*\.mobile-nav:has\(\[data-engineering-launcher\]\)[\s\S]*grid-template-columns:\s*repeat\(5,\s*minmax\(0,\s*1fr\)\)/,
  'barra inferior com Engenharia deve permanecer em uma linha no mesmo breakpoint tablet/coarse-pointer que ativa a mobile-nav');

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

assert.match(sw, /const VERSION = '0\.9\.50';/,
  'alteração de asset do app shell deve avançar a identidade do cache');

console.log('Visual layout hardening contracts passed.');
