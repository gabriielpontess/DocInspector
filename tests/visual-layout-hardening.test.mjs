import assert from 'node:assert/strict';
import fs from 'node:fs';

const hardening = fs.readFileSync(new URL('../visual-hardening.css', import.meta.url), 'utf8');
const engineering = fs.readFileSync(new URL('../engineering-tracker.css', import.meta.url), 'utf8');
const verify = fs.readFileSync(new URL('../visual-verify.css', import.meta.url), 'utf8');
const responsive = fs.readFileSync(new URL('../visual-responsive.css', import.meta.url), 'utf8');
const refinement = fs.readFileSync(new URL('../visual-refinement.css', import.meta.url), 'utf8');
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

assert.match(hardening, /\.modal:has\(#save-copy-edit\),[\s\S]*\.modal:has\(#generate-pdf\)[\s\S]*overflow-y:\s*auto !important/,
  'modais com conteúdo dinâmico devem rolar verticalmente em vez de cortar conteúdo');
assert.match(refinement, /\.modal:has\(#save-copy-edit\)[\s\S]*overflow:\s*hidden/,
  'o contrato deve proteger contra regressão da regra legada de clipping');
assert.match(index, /\.modal:has\(#generate-pdf\)[\s\S]*overflow:\s*hidden/,
  'o contrato deve proteger contra regressão da regra inline de clipping');

assert.match(responsive, /\.home-summary\s*\{\s*margin-inline:\s*calc\(var\(--space-3\) \* -1\)/,
  'a antiga sangria mobile deve continuar coberta explicitamente como causa de overflow');
assert.match(hardening, /@media \(max-width: 430px\)[\s\S]*\.home-summary[\s\S]*margin-inline:\s*0 !important;[\s\S]*max-width:\s*100%/,
  'o scroller da Home deve permanecer fisicamente contido na viewport');

assert.match(hardening, /\.toast,[\s\S]*overflow-wrap:\s*anywhere/,
  'mensagens longas devem quebrar linha');
assert.match(hardening, /\.user-admin-access-head\s*\{\s*flex-wrap:\s*wrap;/,
  'cabeçalho administrativo deve poder quebrar linha');
assert.match(hardening, /\.auth-password-dialog[\s\S]*max-height:\s*calc\(100dvh - 24px\)[\s\S]*overflow-y:\s*auto/,
  'diálogo de senha deve continuar utilizável em telas de baixa altura');
assert.match(hardening, /font-size:\s*clamp\(10px,\s*2\.8vw,\s*11px\) !important/,
  'item Engenharia não deve cair abaixo do piso legível no mobile');

assert.match(sw, /const VERSION = '0\.9\.47';/,
  'alteração de asset do app shell deve avançar a identidade do cache');

console.log('Visual layout hardening contracts passed.');
