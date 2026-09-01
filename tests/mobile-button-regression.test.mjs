import assert from 'node:assert/strict';
import fs from 'node:fs';

const index = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const responsive = fs.readFileSync(new URL('../visual-responsive.css', import.meta.url), 'utf8');
const engineering = fs.readFileSync(new URL('../engineering-tracker.css', import.meta.url), 'utf8');
const hardening = fs.readFileSync(new URL('../visual-hardening.css', import.meta.url), 'utf8');
const sw = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');

const hardeningLink = '<link rel="stylesheet" href="visual-hardening.css">';
const hardeningIndex = index.indexOf(hardeningLink);
assert.ok(hardeningIndex >= 0, 'visual-hardening.css deve ser carregado explicitamente pela página');
assert.ok(hardeningIndex > index.indexOf('engineering-tracker.css'),
  'hardening visual deve carregar depois da Engenharia para ser a camada final da cascata');
assert.ok(hardeningIndex > index.lastIndexOf('</style>'),
  'hardening visual deve carregar depois dos estilos inline do shell');
assert.doesNotMatch(engineering, /@import\s+url\(['"]\.\/visual-hardening\.css['"]\)/,
  'Engenharia não deve importar hardening antes das próprias regras');

assert.match(hardening, /button,[\s\S]*overflow-wrap:\s*normal;[\s\S]*word-break:\s*normal;/,
  'rótulos de controles devem manter palavras inteiras');
assert.match(engineering, /@media \(max-width: 350px\)[\s\S]*data-engineering-launcher[^\{]*\{\s*font-size:\s*10px;/,
  'Engenharia deve respeitar o piso de 10 px no menor breakpoint');
assert.doesNotMatch(engineering, /data-engineering-launcher[^\{]*\{[^}]*font-size:\s*9\.5px/,
  'Engenharia não pode reintroduzir fonte abaixo do piso visual');

assert.match(responsive, /\.details-cell\s*>\s*\.btn\[data-doc-details\][\s\S]*width:\s*44px;[\s\S]*font-size:\s*0;/,
  'somente Mais detalhes deve receber o tratamento de chevron no card mobile');
assert.match(responsive, /\.details-cell\s*>\s*\.btn\[data-doc-details\]::before[\s\S]*content:\s*'›';/,
  'gatilho de detalhes deve manter o chevron mobile');
assert.doesNotMatch(responsive, /\.compact-doc-table\s+\.details-cell\s+\.btn\s*\{/,
  'nenhuma regra genérica pode transformar todas as ações da célula em chevrons');
assert.doesNotMatch(responsive, /\.compact-doc-table\s+\.details-cell\s+\.btn::before/,
  'pseudo-elemento de chevron não pode atingir Editar/Excluir');

assert.match(responsive, /\.document-management-row-actions\s*\{[\s\S]*display:\s*flex;[\s\S]*gap:\s*4px;/,
  'ações de gerenciamento devem ter grupo próprio no card mobile');
assert.match(responsive, /\.document-management-row-actions \.btn\s*\{[\s\S]*width:\s*44px;[\s\S]*min-width:\s*44px;[\s\S]*height:\s*44px;[\s\S]*min-height:\s*44px;/,
  'Editar/Excluir devem preservar alvo de toque 44x44');
assert.match(responsive, /\.document-management-row-actions \.btn \.icon[\s\S]*width:\s*18px;[\s\S]*height:\s*18px;/,
  'ações compactas devem preservar seus ícones reais');
assert.match(responsive, /\.document-management-detail-actions\s*\{[\s\S]*display:\s*grid;[\s\S]*width:\s*100%;/,
  'ações na página de detalhes devem ocupar uma coluna estável em mobile');

assert.match(sw, /const CACHE_REVISION = `\$\{VERSION\}-pwa-upgrade-2`;/,
  'mudanças no app shell precisam chegar ao PWA instalado em uma nova geração de cache');

console.log('Mobile button regression contracts passed.');
