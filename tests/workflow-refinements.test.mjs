import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const refinement = fs.readFileSync(new URL('../js/ui-refinement.js', import.meta.url), 'utf8');
const recovery = fs.readFileSync(new URL('../js/recovery-ui.js', import.meta.url), 'utf8');
const ui = fs.readFileSync(new URL('../js/ui.js', import.meta.url), 'utf8');
const sw = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');

assert.match(app, /function compareAlphabetically\(a, b\)/, 'app deve centralizar comparação A-Z');
assert.match(app, /const homeInspections = sortedInspections\(\)/, 'Home deve usar listas ordenadas');
assert.match(app, /Código PW · A–Z/, 'Documentos deve expor ordenação A-Z de forma explícita');
assert.match(app, /const documents = sortedInspectionDocuments\(context\.inspection\)/, 'Próximo documento em campo deve seguir A-Z');
assert.match(app, /keepVerificationSelection\(savedInspectionId, savedDocumentId\)/, 'verificação salva deve permanecer selecionada');
assert.doesNotMatch(app, /showToast\([^;]*cópia registrada[^;]*;\s*returnToSearch\(\)/s, 'salvar verificação não deve expulsar o documento da tela');
assert.match(app, /verificationMutationInFlight/, 'gravações de verificação devem ser single-flight');
assert.match(app, /button\.dataset\.searchBound = '1'/, 'sugestões não podem acumular handlers duplicados');
assert.match(refinement, /sortedDocuments\(inspection\.documents \|\| \[\]\)/, 'navegação refinada deve respeitar A-Z');
assert.match(recovery, /row\.remove\(\)/, 'restauração deve atualizar a lixeira sem fechá-la');
assert.doesNotMatch(recovery, /Documento restaurado[\s\S]{0,220}modal\.closeModal\(\)/, 'restauração não pode fechar a lixeira automaticamente');
assert.match(ui, /data-modal-label/, 'modais duplicados com o mesmo rótulo devem ser reutilizados');
assert.match(ui, /let closed = false/, 'fechamento de modal deve ser idempotente');
assert.match(ui, /busyDepth/, 'estado busy deve tolerar handlers concorrentes sem reabilitar cedo');
assert.match(sw, /workflow-refinements-1/, 'PWA deve rotacionar o app shell para entregar as correções');

console.log('Workflow refinements regression contracts passed.');
