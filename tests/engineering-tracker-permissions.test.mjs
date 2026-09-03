import assert from 'node:assert/strict';
import fs from 'node:fs';
import { CAPABILITY, ROLE, can } from '../js/permissions.js';

const ui = fs.readFileSync(new URL('../js/engineering-tracker-ui.js', import.meta.url), 'utf8');

assert.equal(can(ROLE.ADMIN, CAPABILITY.MANAGE_DOCUMENTS), true);
for (const retiredRole of ['INSPECTOR', 'SUPERVISOR', 'FOREMAN']) {
  assert.equal(can(retiredRole, CAPABILITY.MANAGE_DOCUMENTS), false, `${retiredRole} não pode permanecer como perfil ativo`);
}
assert.match(ui, /editable \? '<button class="btn" data-open-document-history/, 'histórico global deve existir apenas para perfis que podem gerenciar documentos');
assert.match(ui, /data-close-engineering/, 'o painel deve oferecer fechamento explícito independente da permissão');

console.log('engineering-tracker-permissions.test.mjs: OK');
