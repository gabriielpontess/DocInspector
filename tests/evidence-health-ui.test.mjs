import assert from 'node:assert/strict';
import fs from 'node:fs';

const moduleSource = fs.readFileSync(new URL('../js/evidence-health-ui.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const sw = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');

assert.match(moduleSource, /lastSyncError/, 'falha persistida de upload deve aparecer no diagnóstico');
assert.match(moduleSource, /syncAttempts/, 'número de tentativas de upload deve ser exposto');
assert.match(moduleSource, /Foto sincronizada/, 'estado sincronizado deve ser explícito');
assert.match(moduleSource, /Aguardando sincronização|Salva somente neste aparelho/, 'estado local/pendente deve ser explícito');
assert.match(moduleSource, /Foto indisponível|Foto local ausente/, 'perda de evidência deve ser diferenciada de pendência');
assert.match(moduleSource, /Tentar sincronizar agora/, 'usuário deve conseguir solicitar nova tentativa');
assert.match(moduleSource, /LARGE_SOURCE_BYTES/, 'fotos grandes devem possuir guarda de armazenamento local');
assert.match(moduleSource, /MIN_FREE_STORAGE_BYTES/, 'guarda deve exigir reserva mínima de armazenamento');
assert.match(moduleSource, /navigator\.storage\?\.estimate/, 'guarda deve usar quota real do navegador quando disponível');
assert.match(html, /js\/evidence-health-ui\.js/, 'diagnóstico deve ser carregado pela aplicação');
assert.match(sw, /\.\/js\/evidence-health-ui\.js/, 'diagnóstico deve funcionar offline');

console.log('evidence-health-ui.test.mjs: OK');
