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
assert.deepEqual(suggestMapping(['SISTEMA', 'CÓDIGO PW METRÔ', 'DESCRIÇÃO', 'STATUS', 'REVISÃO']), {
  code: 'CÓDIGO PW METRÔ',
  description: 'DESCRIÇÃO',
  status: 'STATUS',
  expectedRevision: 'REVISÃO'
});

const offsetMatrix = [
  ['SISTEMA', 'CÓDIGO PW METRÔ', 'DESCRIÇÃO', 'STATUS', 'REVISÃO'],
  ['AMV', 'PW-001', 'Documento teste', 'Ativo', 'A']
];

const originalWindow = globalThis.window;
const originalFile = globalThis.File;
const calls = [];
globalThis.File = NodeFile;
globalThis.window = {
  XLSX: {
    read() {
      return { SheetNames: ['Lista'], Sheets: { Lista: { '!ref': 'B2:F3' } } };
    },
    utils: {
      decode_range(ref) {
        assert.equal(ref, 'B2:F3');
        return { s: { r: 1, c: 1 }, e: { r: 2, c: 5 } };
      },
      encode_range(range) {
        assert.deepEqual(range, { s: { r: 1, c: 1 }, e: { r: 2, c: 5 } });
        return 'B2:F3';
      },
      sheet_to_json(_sheet, options) {
        calls.push(options);
        if (options.header === 1) return offsetMatrix;
        assert.equal(options.range, 'B2:F3', 'segunda leitura deve preservar a origem física B2 do worksheet');
        return [{
          SISTEMA: 'AMV',
          'CÓDIGO PW METRÔ': 'PW-001',
          'DESCRIÇÃO': 'Documento teste',
          'STATUS': 'Ativo',
          'REVISÃO': 'A'
        }];
      }
    }
  }
};

try {
  const parsed = await readWorkbook(new NodeFile([new Uint8Array([1])], 'lista.xlsx'));
  assert.equal(parsed.headerRowIndex, 0, 'índice detectado permanece relativo ao !ref');
  assert.deepEqual(parsed.headers, ['SISTEMA', 'CÓDIGO PW METRÔ', 'DESCRIÇÃO', 'STATUS', 'REVISÃO']);
  assert.equal(calls[0].header, 1, 'primeira leitura deve ser matriz para detectar a linha real');
  assert.equal(calls[0].blankrows, true, 'linhas físicas vazias devem ser preservadas para o range permanecer correto');
  assert.equal(calls[1].range, 'B2:F3', 'range final deve começar no cabeçalho real sem voltar para A1');
  assert.equal(parsed.headers.some(header => /^__EMPTY/i.test(header)), false, 'placeholders internos do SheetJS nunca devem aparecer no seletor');
} finally {
  if (originalWindow === undefined) delete globalThis.window;
  else globalThis.window = originalWindow;
  if (originalFile === undefined) delete globalThis.File;
  else globalThis.File = originalFile;
}

console.log('xlsx.test.mjs: OK');
