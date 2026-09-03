import assert from 'node:assert/strict';
import fs from 'node:fs';

const index = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const sw = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
const pwa = fs.readFileSync(new URL('../js/pwa.js', import.meta.url), 'utf8');

const handoff = index.match(/<script id="pwa-update-handoff">([\s\S]*?)<\/script>/)?.[1] || '';
assert.ok(handoff, 'index deve declarar o handoff de atualização do PWA antes do bootstrap');
assert.ok(
  index.indexOf('id="pwa-update-handoff"') < index.indexOf('type="module" src="js/auth-entry.js"'),
  'handoff deve executar antes dos módulos da aplicação'
);
assert.match(handoff, /registration\.waiting && navigator\.serviceWorker\.controller/,
  'somente worker já aguardando no início da abertura deve ser promovido automaticamente');
assert.match(handoff, /registration\.waiting\.postMessage\(\{ type: 'SKIP_WAITING' \}\)/,
  'worker aguardando deve receber SKIP_WAITING no startup');
assert.match(handoff, /controllerchange[\s\S]*startupHandoff[\s\S]*window\.location\.reload\(\)/,
  'troca promovida no startup deve recarregar uma única vez para usar o shell coerente');
assert.doesNotMatch(handoff, /updatefound|registration\.installing/,
  'update descoberto durante trabalho ativo não deve provocar promoção/reload automático');
assert.match(handoff, /registration\?\.update\(\)\.catch/,
  'abertura sem worker aguardando deve continuar procurando atualização');

assert.match(sw, /const VERSION = '0\.9\.52';/);
assert.match(sw, /const CACHE_REVISION = `\$\{VERSION\}-settings-admin-1`;/,
  'refinamento de configurações e acesso deve usar uma nova geração atômica');
assert.match(sw, /\.\/js\/settings-refinement-ui\.js/,
  'refinamento das configurações deve fazer parte do app shell offline');
assert.match(sw, /if \(event\.data\?\.type === 'SKIP_WAITING'\) self\.skipWaiting\(\)/,
  'worker em waiting deve aceitar promoção explícita');
const installHandler = sw.match(/self\.addEventListener\('install',[\s\S]*?\n\}\);/)?.[0] || '';
assert.ok(installHandler, 'Service Worker deve declarar o install handler');
assert.doesNotMatch(installHandler, /self\.skipWaiting\(\)/,
  'instalação em segundo plano não deve interromper trabalho ativo');

const navigation = sw.match(/if \(request\.mode === 'navigate'\) \{([\s\S]*?)\n  \}\n\n  if \(request\.url === XLSX_URL/)?.[1] || '';
assert.ok(navigation, 'Service Worker deve ter estratégia explícita para navegação');
const coreOpen = navigation.indexOf('caches.open(CORE_CACHE)');
const coreMatch = navigation.indexOf("cache.match('./index.html')");
const networkFetch = navigation.indexOf('fetch(request)');
assert.ok(coreOpen >= 0 && coreMatch > coreOpen && networkFetch > coreMatch,
  'navegação deve preferir index do CORE_CACHE da mesma geração antes da rede');
assert.doesNotMatch(navigation, /await fetch\(request\)[\s\S]*return \(await caches\.match\('\.\/index\.html'\)\)/,
  'não pode voltar ao padrão network-first que mistura index novo com módulos antigos');

assert.doesNotMatch(pwa, /controllerchange|location\.reload/,
  'registro normal do PWA não deve recarregar a aplicação durante uma inspeção');

console.log('PWA atomic upgrade contracts passed.');
