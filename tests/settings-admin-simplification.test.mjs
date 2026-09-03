import assert from 'node:assert/strict';
import fs from 'node:fs';

const refinement = fs.readFileSync(new URL('../js/settings-refinement-ui.js', import.meta.url), 'utf8');
const userAdmin = fs.readFileSync(new URL('../js/user-admin-ui.js', import.meta.url), 'utf8');
const accessAdmin = fs.readFileSync(new URL('../js/access-request-admin-ui.js', import.meta.url), 'utf8');
const permissions = fs.readFileSync(new URL('../js/permissions.js', import.meta.url), 'utf8');
const adminEdge = fs.readFileSync(new URL('../supabase/functions/docinspector-user-admin/index.ts', import.meta.url), 'utf8');

assert.match(refinement, /cardByTitle\(grid, 'Instalação PWA'\)/);
assert.match(refinement, /button && !button\.disabled/);
assert.match(refinement, /card\.remove\(\)/, 'large PWA card must be removed');
assert.match(refinement, /Backup e restauração/);
assert.match(refinement, /actions\.append\(backupButton, restoreButton, restoreInput\)/, 'backup controls must share one card without cloning listeners');
assert.match(refinement, /cardByTitle\(grid, 'Importante'\)\?\.remove\(\)/);
assert.match(refinement, /user-admin-active input\[type="checkbox"\][\s\S]*width: 20px !important[\s\S]*min-height: 20px !important/);

assert.doesNotMatch(userAdmin, /id="user-admin-role"|data-member-role/);
assert.match(userAdmin, /role: ROLE\.ADMIN/);
assert.match(userAdmin, /admin-role-badge">Administrador/);
assert.doesNotMatch(accessAdmin, /data-request-role|roleOptions/);
assert.match(accessAdmin, /Aprovar como Administrador/);
assert.match(accessAdmin, /role: ROLE\.ADMIN/);

assert.match(permissions, /ADMIN: 'ADMIN'/);
assert.doesNotMatch(permissions, /INSPECTOR|SUPERVISOR|FOREMAN/);
assert.doesNotMatch(adminEdge, /INSPECTOR|SUPERVISOR|FOREMAN/);
assert.match(adminEdge, /const ADMIN_ROLE = 'ADMIN'/);
assert.match(adminEdge, /Somente o perfil Administrador está disponível/);

console.log('Settings/admin simplification checks passed.');
