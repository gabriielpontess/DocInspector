import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  documentNeedsDownload,
  listSkyrailDisciplines,
  matchesSkyrailDocument,
  normalizeSkyrailDocument,
  sortSkyrailDocuments
} from '../js/skyrail-model.js';

const baseDocument = {
  id: '00000000-0000-4000-8000-000000000001',
  workspace_id: '00000000-0000-4000-8000-000000000002',
  code: '17-VP-DWG-001',
  title: 'Layout Geral da Via',
  discipline: 'Via Permanente',
  revision: 'F',
  file_path: 'workspace/document/file-f.pdf',
  updated_at: '2026-08-21T12:00:00.000Z',
  active: true
};

const normalized = normalizeSkyrailDocument(baseDocument);
assert.equal(normalized.code, baseDocument.code);
assert.equal(normalized.active, true);
assert.equal(normalizeSkyrailDocument({ ...baseDocument, title: '' }), null);

const offlineDocument = normalizeSkyrailDocument({
  ...baseDocument,
  blob: new Blob(['%PDF-test'], { type: 'application/pdf' }),
  downloaded_at: '2026-08-21T12:05:00.000Z'
});

assert.equal(documentNeedsDownload(offlineDocument, baseDocument), false, 'revisão e arquivo iguais devem reutilizar o PDF local');
assert.equal(documentNeedsDownload(offlineDocument, { ...baseDocument, revision: 'G' }), true, 'nova revisão deve baixar novamente');
assert.equal(documentNeedsDownload(offlineDocument, { ...baseDocument, file_path: 'workspace/document/file-g.pdf' }), true, 'novo objeto deve baixar novamente');
assert.equal(documentNeedsDownload({ ...offlineDocument, blob: null }, baseDocument), true, 'documento sem blob local deve baixar');

assert.equal(matchesSkyrailDocument(baseDocument, { query: '17-vp' }), true);
assert.equal(matchesSkyrailDocument(baseDocument, { query: 'layout geral' }), true);
assert.equal(matchesSkyrailDocument(baseDocument, { query: 'elétrica' }), false);
assert.equal(matchesSkyrailDocument(baseDocument, { discipline: 'Via Permanente' }), true);
assert.equal(matchesSkyrailDocument(baseDocument, { discipline: 'Civil' }), false);

const documents = [
  baseDocument,
  { ...baseDocument, id: '2', code: 'ELE-002', title: 'Diagrama', discipline: 'Elétrica' },
  { ...baseDocument, id: '3', code: 'CIV-001', title: 'Planta', discipline: 'Civil' }
];
assert.deepEqual(listSkyrailDisciplines(documents), ['Civil', 'Elétrica', 'Via Permanente']);
assert.deepEqual(sortSkyrailDocuments(documents).map(item => item.discipline), ['Civil', 'Elétrica', 'Via Permanente']);

const [html, app, api, sync, serviceWorker, migration] = await Promise.all([
  readFile('skyrail.html', 'utf8'),
  readFile('js/skyrail-app.js', 'utf8'),
  readFile('js/skyrail-api.js', 'utf8'),
  readFile('js/skyrail-sync.js', 'utf8'),
  readFile('sw.js', 'utf8'),
  readFile('supabase/migrations/20260821142648_add_byd_skyrail_v1_documents.sql', 'utf8')
]);

assert.match(html, /BYD Skyrail/);
assert.match(html, /src="js\/skyrail-app\.js"/);
assert.match(html, /serviceWorker\.register\('\.\/sw\.js'\)/);

assert.match(app, /Buscar por código ou título/);
assert.match(app, /data-discipline/);
assert.match(app, /Administrar documentos/);
assert.match(app, /globalThis\.document\.body\.append\(backdrop\)/, 'viewer deve usar o document global do navegador');
assert.doesNotMatch(app, /download=|navigator\.share|Compartilhar|Exportar/, 'V1 não deve adicionar compartilhamento/exportação explícitos');

assert.match(api, /byd-skyrail-documents/);
assert.match(api, /\.from\('documents'\)/);
assert.match(api, /\.eq\('active', true\)/);
assert.match(api, /crypto\.randomUUID\(\).*\.pdf/s, 'substituição de PDF deve usar novo objeto imutável');
assert.doesNotMatch(api, /service_role|secretKey|serviceRole/);

assert.match(sync, /listActiveSkyrailDocuments/);
assert.match(sync, /documentNeedsDownload/);
assert.match(sync, /removeCachedSkyrailDocumentsNotIn/);
assert.match(sync, /setSkyrailLastSync/);

for (const asset of [
  './skyrail.html',
  './skyrail.css',
  './js/skyrail-app.js',
  './js/skyrail-model.js',
  './js/skyrail-db.js',
  './js/skyrail-api.js',
  './js/skyrail-sync.js',
  './js/skyrail-pdf-viewer.js'
]) {
  assert.ok(serviceWorker.includes(`'${asset}'`), `Service Worker deve cachear ${asset}`);
}
assert.match(serviceWorker, /navigationFallbackKey/);
assert.match(serviceWorker, /'\.\/skyrail\.html'/);

assert.match(migration, /create table if not exists public\.documents/i);
for (const column of ['code text', 'title text', 'discipline text', 'revision text', 'file_path text', 'updated_at timestamptz', 'active boolean']) {
  assert.ok(migration.includes(column), `migration deve conter ${column}`);
}
assert.match(migration, /alter table public\.documents enable row level security/i);
assert.match(migration, /m\.role = 'ADMIN'/);
assert.match(migration, /'byd-skyrail-documents'/);
assert.match(migration, /false,\s*104857600/s, 'bucket deve permanecer privado');
assert.doesNotMatch(migration, /wrapped_file_key|workspace_key|ciphertext|envelope/i, 'V1 não deve herdar a arquitetura E2EE antiga');

console.log('BYD Skyrail V1: modelo, busca, sincronização, offline shell e schema validados.');
