import assert from 'node:assert/strict';
import { mapRows } from '../js/xlsx.js';

const mapping = { code: 'PW', description: 'Desc', status: 'Status', expectedRevision: 'Rev' };
assert.equal(mapRows([{ PW:'A-01', Desc:'A', Status:'OK', Rev:'0' }], mapping).length, 1);
assert.throws(() => mapRows([
  { PW:'AB-12.34-567', Desc:'A', Status:'OK', Rev:'0' },
  { PW:'AB12-34567', Desc:'B', Status:'OK', Rev:'0' }
], mapping), /ambíguos/);
console.log('xlsx.test.mjs: OK');
