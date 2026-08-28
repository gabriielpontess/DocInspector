import assert from 'node:assert/strict';
import { File as NodeFile } from 'node:buffer';
import { detectHeaderRowIndex, mapRows, readWorkbook, suggestMapping } from '../js/xlsx.js';

const mapping = { code: 'PW', description: 'Desc', status: 'Status', expectedRevision: 'Rev' };
assert.equal(mapRows([{ PW:'A-01', Desc:'A', Status:'OK', Rev:'0' }], mapping).length, 1);
assert.throws(() => mapRows([
  { PW:'AB-12.34-567', Desc:'A', Status:'OK', Rev:'0' },
  { PW:'AB12-34567', Desc:'B', Status:'OK', Rev:'0' }
], mapping), /ambíguos/);

const titledMatrix = [
  ['LISTA DE DOCUMENTOS - LINHA 17'],
  [],
  ['', 'Código PW', 'Descrição', 'Status', 'Revisão'],
  ['', 'PW-001', 'Documento teste', 'Ativo', 'A']
];
assert.equal(detectHeaderRowIndex(titledMatrix), 2, 'título/linhas preliminares não podem virar cabeçalho');
assert.equal(detectHeaderRowIndex([
  ['RELATÓRIO'],
  [],
  ['Identificador', 'Texto', 'Condição', 'Versão'],
  ['PW-001', 'Documento teste', 'Ativo', 'A']
]), 2, 'nomes personalizados devem usar fallback estrutural sem escolher o título');
assert.equal(detectHeaderRowIndex([
  ['Código PW', 'Descrição', 'Status', 'Revisão'],
  ['PW-001', 'Documento teste', 'Ativo', 'A']
]), 0, 'planilha com cabeçalho na primeira linha deve manter o comportamento atual');
assert.deepEqual(suggestMapping(['Código PW', 'Descrição', 'Status', 'Revisão']), {
  code: 'Código PW',
  description: 'Descrição',
  status: 'Status',
  expectedRevision: 'Revisão'
});

const originalWindow = globalThis.window;
const originalFile = globalThis.File;
const calls = [];
globalThis.File = NodeFile;
globalThis.window = {
  XLSX: {
    read() {
      return { SheetNames: ['Lista'], Sheets: { Lista: {} } };
    },
    utils: {
      sheet_to_json(_sheet, options) {
        calls.push(options);
        if (options.header === 1) return titledMatrix;
        assert.equal(options.range, 2, 'segunda leitura deve iniciar exatamente na linha de cabeçalho detectada');
        return [{
          __EMPTY: '',
          'Código PW': 'PW-001',
          'Descrição': 'Documento teste',
          'Status': 'Ativo',
          'Revisão': 'A'
        }];
      }
    }
  }
};

try {
  const parsed = await readWorkbook(new NodeFile([new Uint8Array([1])], 'lista.xlsx'));
  assert.equal(parsed.headerRowIndex, 2);
  assert.deepEqual(parsed.headers, ['Código PW', 'Descrição', 'Status', 'Revisão']);
  assert.equal(calls[0].header, 1, 'primeira leitura deve ser matriz para detectar a linha real');
  assert.equal(calls[0].blankrows, true, 'linhas físicas vazias devem ser preservadas para o range permanecer correto');
  assert.equal(calls[1].range, 2);
  assert.equal(parsed.headers.some(header => /^__EMPTY/i.test(header)), false, 'placeholders internos do SheetJS nunca devem aparecer no seletor');
} finally {
  if (originalWindow === undefined) delete globalThis.window;
  else globalThis.window = originalWindow;
  if (originalFile === undefined) delete globalThis.File;
  else globalThis.File = originalFile;
}

console.log('xlsx.test.mjs: OK');
