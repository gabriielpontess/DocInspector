import { codeIdentity, documentMarkings, makeDocument, metrics } from './domain.js';

const MAX_FILE_SIZE = 25 * 1024 * 1024;
const HEADER_SCAN_LIMIT = 100;
const HEADER_FIELD_PATTERNS = Object.freeze([
  [/codigo\s*pw/, /^pw$/, /^codigo$/, /^codigo\s+(?:do\s+)?documento$/, /^document(?:\s+code)?$/],
  [/descricao/, /description/, /^titulo$/],
  [/status/, /situacao/],
  [/revisao/, /revision/, /^rev\.?$/]
]);

function ensureXLSX() {
  if (!window.XLSX) {
    throw new Error('A biblioteca de planilhas não foi carregada. Conecte-se à internet, recarregue o aplicativo e tente novamente.');
  }
  return window.XLSX;
}

function normalizeHeader(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function nonEmptyCells(row) {
  return Array.isArray(row)
    ? row.map(value => String(value ?? '').trim()).filter(Boolean)
    : [];
}

function semanticHeaderScore(row) {
  const cells = nonEmptyCells(row).map(normalizeHeader);
  return HEADER_FIELD_PATTERNS.reduce((score, patterns) => (
    score + (cells.some(cell => patterns.some(pattern => pattern.test(cell))) ? 1 : 0)
  ), 0);
}

export function detectHeaderRowIndex(matrix) {
  if (!Array.isArray(matrix) || !matrix.length) return -1;

  const candidates = matrix.slice(0, HEADER_SCAN_LIMIT).map((row, index) => ({
    index,
    semanticScore: semanticHeaderScore(row),
    nonEmptyCount: nonEmptyCells(row).length
  })).filter(candidate => candidate.nonEmptyCount > 0);

  if (!candidates.length) return -1;

  const semanticCandidates = candidates
    .filter(candidate => candidate.semanticScore >= 2)
    .sort((a, b) =>
      b.semanticScore - a.semanticScore ||
      b.nonEmptyCount - a.nonEmptyCount ||
      a.index - b.index
    );

  if (semanticCandidates.length) return semanticCandidates[0].index;

  const structuralCandidates = candidates
    .filter(candidate => candidate.nonEmptyCount >= 2)
    .sort((a, b) => b.nonEmptyCount - a.nonEmptyCount || a.index - b.index);

  return structuralCandidates[0]?.index ?? candidates[0].index;
}

function isSyntheticHeader(value) {
  return /^__EMPTY(?:_\d+)?$/i.test(String(value ?? '').trim());
}

function collectImportHeaders(rows) {
  return [...new Set(rows.flatMap(row => Object.keys(row || {})))]
    .filter(header => String(header).trim() && !isSyntheticHeader(header));
}

function resolveImportRange(sheet, headerRowIndex, XLSX) {
  const worksheetRef = String(sheet?.['!ref'] || '').trim();
  if (!worksheetRef) return headerRowIndex;

  const sourceRange = XLSX.utils.decode_range(worksheetRef);
  const absoluteHeaderRow = sourceRange.s.r + headerRowIndex;
  if (absoluteHeaderRow < sourceRange.s.r || absoluteHeaderRow > sourceRange.e.r) return headerRowIndex;

  return XLSX.utils.encode_range({
    s: { r: absoluteHeaderRow, c: sourceRange.s.c },
    e: sourceRange.e
  });
}

export async function readWorkbook(file) {
  const XLSX = ensureXLSX();
  if (!(file instanceof File)) throw new Error('Selecione uma planilha válida.');
  if (!/\.(xlsx|xls)$/i.test(file.name)) throw new Error('Selecione um arquivo .xlsx ou .xls.');
  if (file.size > MAX_FILE_SIZE) throw new Error('A planilha excede o limite de 25 MB.');

  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, {
    type: 'array',
    cellDates: true,
    dense: true
  });

  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error('A planilha não possui abas válidas.');

  const sheet = workbook.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: '',
    raw: false,
    blankrows: true
  });
  const headerRowIndex = detectHeaderRowIndex(matrix);
  if (headerRowIndex < 0) throw new Error('Não foi possível identificar os cabeçalhos da planilha.');

  const importRange = resolveImportRange(sheet, headerRowIndex, XLSX);
  const rows = XLSX.utils.sheet_to_json(sheet, {
    range: importRange,
    defval: '',
    raw: false,
    blankrows: false
  });

  if (!rows.length) throw new Error('A planilha não contém registros.');

  const headers = collectImportHeaders(rows);
  if (!headers.length) throw new Error('Não foi possível identificar os cabeçalhos da planilha.');

  return { rows, headers, sheetName, headerRowIndex };
}

export function mapRows(rows, mapping) {
  if (!Array.isArray(rows) || !rows.length) throw new Error('Não há linhas para importar.');

  const mappedColumns = Object.values(mapping);
  if (mappedColumns.some(value => !value)) throw new Error('Mapeie todas as colunas obrigatórias.');
  if (new Set(mappedColumns).size !== mappedColumns.length) {
    throw new Error('Cada campo deve utilizar uma coluna diferente da planilha.');
  }

  const documents = rows
    .map(row => makeDocument({
      code: row[mapping.code],
      description: row[mapping.description],
      status: row[mapping.status],
      expectedRevision: row[mapping.expectedRevision]
    }))
    .filter(document => document.code);

  const duplicates = new Set();
  const seen = new Set();
  const identities = new Map();
  const ambiguous = new Set();
  for (const document of documents) {
    if (seen.has(document.code)) duplicates.add(document.code);
    seen.add(document.code);
    const identity = codeIdentity(document.code);
    const previous = identities.get(identity);
    if (identity && previous && previous !== document.code) ambiguous.add(`${previous} ↔ ${document.code}`);
    if (identity) identities.set(identity, document.code);
  }

  if (duplicates.size) {
    const preview = [...duplicates].slice(0, 5).join(', ');
    const extra = duplicates.size > 5 ? ` e mais ${duplicates.size - 5}` : '';
    throw new Error(`Códigos PW duplicados: ${preview}${extra}.`);
  }
  if (ambiguous.size) {
    const preview = [...ambiguous].slice(0, 3).join(', ');
    throw new Error(`Há Códigos PW ambíguos para leitura fotográfica (diferem apenas por pontuação): ${preview}.`);
  }
  if (!documents.length) throw new Error('Nenhum Código PW válido foi encontrado.');

  return documents;
}

export function suggestMapping(headers) {
  const normalizedHeaders = headers.map(header => ({
    original: header,
    normalized: normalizeHeader(header)
  }));

  const find = terms => normalizedHeaders.find(({ normalized }) =>
    terms.some(term => normalized.includes(normalizeHeader(term)))
  )?.original || '';

  return {
    code: find(['código pw', 'codigo pw', 'pw', 'documento']),
    description: find(['descrição', 'descricao', 'description', 'título', 'titulo']),
    status: find(['status', 'situação', 'situacao']),
    expectedRevision: find(['revisão', 'revisao', 'revision', 'rev'])
  };
}

function setWorksheetLayout(sheet, widths) {
  sheet['!cols'] = widths.map(width => ({ wch: width }));
  if (sheet['!ref']) sheet['!autofilter'] = { ref: sheet['!ref'] };
}

export const DEFAULT_EXPORT_OPTIONS = Object.freeze({
  format: 'xlsx',
  includeConforming: true,
  includeNonconforming: true,
  includeNotFound: true,
  includePending: true,
  includeSummary: true,
  includeDocuments: true,
  includeCopies: true,
  includeComments: true,
  includeMarkings: true,
  includeEvidence: true
});

const EXPORT_COLORS = Object.freeze({
  navy: '0B2D54',
  navy2: '123F73',
  blue: '2E6EB5',
  gold: 'F5B942',
  green: '2FA866',
  greenSoft: 'E8F7EF',
  red: 'E44A3A',
  redSoft: 'FDECE9',
  amber: 'F39A2B',
  amberSoft: 'FFF3E2',
  gray: '8A95A5',
  graySoft: 'F2F4F7',
  ink: '15253D',
  muted: '66758A',
  line: 'D9E2EF',
  soft: 'F6F8FB',
  white: 'FFFFFF'
});

function ensureExcelJS() {
  if (!window.ExcelJS?.Workbook) {
    throw new Error('A biblioteca de exportação formatada não foi carregada. Recarregue o aplicativo com internet e tente novamente.');
  }
  return window.ExcelJS;
}

function safeExportName(inspection) {
  const rawName = `${inspection.system || inspection.project}-${inspection.name || inspection.project}`.trim();
  return rawName.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').slice(0, 90) || 'Inspecao';
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function normalizeExportOptions(options = {}) {
  return { ...DEFAULT_EXPORT_OPTIONS, ...options };
}

export function shouldExportDocument(document, options = {}) {
  const opts = normalizeExportOptions(options);
  const result = document?.result || '';
  if (result === 'Conforme') return opts.includeConforming;
  if (result === 'Não conforme') return opts.includeNonconforming;
  if (result === 'Não encontrado') return opts.includeNotFound;
  if (result === 'Pendente') return opts.includePending;
  return true;
}

function uniqueBy(items, keyFor) {
  const seen = new Set();
  return items.filter((item, index) => {
    const key = String(keyFor(item, index) ?? '');
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function documentRows(inspection, options = {}) {
  const opts = normalizeExportOptions(options);
  return uniqueBy((inspection.documents || []), document => document.id || document.code)
    .filter(document => shouldExportDocument(document, opts))
    .map(document => {
      const row = {
        'Sistema': inspection.system,
        'Nome da lista': inspection.name || inspection.project,
        'Código PW': document.code,
        'Descrição': document.description,
        'Status': document.status,
        'Revisão esperada': document.expectedRevision,
        'Revisão encontrada': document.foundRevision,
        'Quantidade de cópias': document.copyCount ?? '',
        'Resultado': document.result,
        'Data e hora': document.verifiedAt ? new Date(document.verifiedAt).toLocaleString('pt-BR') : '',
        'Responsável': inspection.responsible,
        'Projeto': inspection.project,
        'Local': inspection.location
      };
      if (opts.includeMarkings) row['Marcações'] = documentMarkings(document).join(', ');
      if (opts.includeComments) row['Comentário'] = document.comment;
      return row;
    });
}

function copyRows(inspection, options = {}) {
  const opts = normalizeExportOptions(options);
  if (!opts.includeCopies) return [];
  return uniqueBy((inspection.documents || []), document => document.id || document.code)
    .filter(document => shouldExportDocument(document, opts))
    .flatMap(document => uniqueBy((document.fieldCopies || []), copy => copy.id || `${document.id}:${copy.sequence}:${copy.foundRevision}:${copy.capturedAt || ''}`).map(copy => {
      const row = {
        'Sistema': inspection.system,
        'Nome da lista': inspection.name || inspection.project,
        'Código PW': document.code,
        'Descrição': document.description,
        'Cópia': copy.sequence,
        'Revisão esperada': document.expectedRevision,
        'Revisão encontrada': copy.foundRevision,
        'Resultado da cópia': copy.foundRevision === document.expectedRevision ? 'Conforme' : 'Não conforme',
        'Origem': copy.source === 'camera' ? 'Foto' : copy.source === 'legacy' ? 'Registro anterior' : 'Manual',
        'Data e hora': copy.capturedAt ? new Date(copy.capturedAt).toLocaleString('pt-BR') : ''
      };
      if (opts.includeMarkings) row['Marcações'] = (copy.markings || []).join(', ');
      if (opts.includeComments) row['Comentário'] = copy.comment;
      if (opts.includeEvidence) {
        row['Evidência local'] = copy.evidenceId ? 'Sim' : 'Não';
        row['Evidência sincronizada'] = copy.evidencePath ? 'Sim' : 'Não';
      }
      return row;
    }));
}

function selectedMetrics(inspection, options = {}) {
  const selected = uniqueBy((inspection.documents || []), document => document.id || document.code)
    .filter(document => shouldExportDocument(document, options));
  return metrics(selected);
}

function applyBorder(cell, color = EXPORT_COLORS.line) {
  cell.border = {
    top: { style: 'thin', color: { argb: color } },
    left: { style: 'thin', color: { argb: color } },
    bottom: { style: 'thin', color: { argb: color } },
    right: { style: 'thin', color: { argb: color } }
  };
}

function styleSectionTitle(sheet, row, text, endColumn) {
  sheet.mergeCells(row, 1, row, endColumn);
  const cell = sheet.getCell(row, 1);
  cell.value = text;
  cell.font = { name: 'Arial', size: 11, bold: true, color: { argb: EXPORT_COLORS.navy } };
  cell.alignment = { vertical: 'middle' };
  sheet.getRow(row).height = 24;
}

function resultFill(result) {
  if (result === 'Conforme') return { fill: EXPORT_COLORS.greenSoft, font: EXPORT_COLORS.green };
  if (result === 'Não conforme') return { fill: EXPORT_COLORS.redSoft, font: EXPORT_COLORS.red };
  if (result === 'Não encontrado') return { fill: EXPORT_COLORS.amberSoft, font: EXPORT_COLORS.amber };
  return { fill: EXPORT_COLORS.graySoft, font: EXPORT_COLORS.gray };
}

function buildDonutDataUrl(metricsData) {
  const canvas = document.createElement('canvas');
  canvas.width = 460;
  canvas.height = 260;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const values = [
    [metricsData.conforming, '#2FA866'],
    [metricsData.nonconforming, '#E44A3A'],
    [metricsData.notFound, '#F39A2B'],
    [metricsData.pending, '#2E6EB5']
  ];
  const total = values.reduce((sum, [value]) => sum + Number(value || 0), 0) || 1;
  const cx = 120, cy = 130, radius = 74, thickness = 28;
  let start = -Math.PI / 2;
  values.forEach(([value, color]) => {
    const portion = Number(value || 0) / total;
    if (!portion) return;
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = thickness;
    ctx.arc(cx, cy, radius, start, start + portion * Math.PI * 2);
    ctx.stroke();
    start += portion * Math.PI * 2;
  });
  ctx.fillStyle = '#15253D';
  ctx.textAlign = 'center';
  ctx.font = 'bold 28px Arial';
  ctx.fillText(String(metricsData.verified || 0), cx, cy - 1);
  ctx.fillStyle = '#66758A';
  ctx.font = '14px Arial';
  ctx.fillText('verificados', cx, cy + 22);
  const legends = [
    ['Conformes', metricsData.conforming, '#2FA866'],
    ['Não conformes', metricsData.nonconforming, '#E44A3A'],
    ['Não encontrados', metricsData.notFound, '#F39A2B'],
    ['Pendentes', metricsData.pending, '#2E6EB5']
  ];
  ctx.textAlign = 'left';
  legends.forEach(([label, value, color], i) => {
    const y = 70 + i * 38;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(255, y - 5, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#15253D';
    ctx.font = '15px Arial';
    ctx.fillText(label, 272, y);
    ctx.font = 'bold 15px Arial';
    ctx.fillText(String(value || 0), 402, y);
  });
  return canvas.toDataURL('image/png');
}

function styleWorkbookHeader(sheet, inspection, generatedAt, endColumn = 8) {
  sheet.mergeCells(1, 1, 2, endColumn - 2);
  const title = sheet.getCell('A1');
  title.value = 'DOCINSPECTOR';
  title.font = { name: 'Arial', size: 20, bold: true, color: { argb: EXPORT_COLORS.white } };
  title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: EXPORT_COLORS.navy } };
  title.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  sheet.getRow(1).height = 28;
  sheet.getRow(2).height = 14;

  sheet.mergeCells(3, 1, 3, endColumn - 2);
  const system = sheet.getCell('A3');
  system.value = String(inspection.system || 'Sistema não informado').toUpperCase();
  system.font = { name: 'Arial', size: 16, bold: true, color: { argb: EXPORT_COLORS.navy } };
  sheet.getRow(3).height = 26;

  sheet.mergeCells(4, 1, 4, endColumn - 2);
  const listName = sheet.getCell('A4');
  listName.value = inspection.name || inspection.project || 'Inspeção';
  listName.font = { name: 'Arial', size: 11, color: { argb: EXPORT_COLORS.muted } };

  sheet.getCell(1, endColumn - 1).value = 'Gerado em';
  sheet.getCell(1, endColumn).value = generatedAt;
  sheet.getCell(2, endColumn - 1).value = 'Versão';
  sheet.getCell(2, endColumn).value = 'v0.9.11';
  for (const cell of [sheet.getCell(1, endColumn - 1), sheet.getCell(1, endColumn), sheet.getCell(2, endColumn - 1), sheet.getCell(2, endColumn)]) {
    cell.font = { name: 'Arial', size: 9, color: { argb: EXPORT_COLORS.white } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: EXPORT_COLORS.navy } };
    cell.alignment = { vertical: 'middle', horizontal: cell.column === endColumn ? 'right' : 'left' };
  }
}

function addMetadataBlock(sheet, inspection, startRow = 6) {
  const rows = [
    ['Responsável', inspection.responsible || '-', 'Local', inspection.location || '-'],
    ['Projeto', inspection.project || '-', 'Nome da lista', inspection.name || inspection.project || '-']
  ];
  rows.forEach((values, offset) => {
    const row = startRow + offset;
    sheet.mergeCells(row, 2, row, 4);
    sheet.mergeCells(row, 6, row, 8);
    sheet.getCell(row, 1).value = values[0];
    sheet.getCell(row, 2).value = values[1];
    sheet.getCell(row, 5).value = values[2];
    sheet.getCell(row, 6).value = values[3];
    for (const col of [1, 2, 5, 6]) {
      const cell = sheet.getCell(row, col);
      applyBorder(cell);
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: EXPORT_COLORS.soft } };
      cell.font = { name: 'Arial', size: 9, bold: col === 1 || col === 5, color: { argb: col === 1 || col === 5 ? EXPORT_COLORS.muted : EXPORT_COLORS.ink } };
      cell.alignment = { vertical: 'middle', wrapText: true };
    }
    for (const col of [3, 4, 7, 8]) {
      const cell = sheet.getCell(row, col);
      applyBorder(cell);
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: EXPORT_COLORS.soft } };
    }
    sheet.getRow(row).height = 23;
  });
}

function addSummarySheet(workbook, inspection, summaryMetrics, generatedAt) {
  const sheet = workbook.addWorksheet('Resumo', { views: [{ showGridLines: false }] });
  sheet.properties.tabColor = { argb: EXPORT_COLORS.navy };
  sheet.columns = [
    { width: 17 }, { width: 16 }, { width: 16 }, { width: 16 },
    { width: 17 }, { width: 18 }, { width: 18 }, { width: 20 }
  ];
  styleWorkbookHeader(sheet, inspection, generatedAt, 8);
  addMetadataBlock(sheet, inspection, 6);
  styleSectionTitle(sheet, 9, 'RESUMO GERAL', 8);

  const cards = [
    ['Total', summaryMetrics.total, EXPORT_COLORS.navy],
    ['Verificados', summaryMetrics.verified, EXPORT_COLORS.blue],
    ['Conformes', summaryMetrics.conforming, EXPORT_COLORS.green],
    ['Não conformes', summaryMetrics.nonconforming, EXPORT_COLORS.red],
    ['Não encontrados', summaryMetrics.notFound, EXPORT_COLORS.amber],
    ['Pendentes', summaryMetrics.pending, EXPORT_COLORS.gray]
  ];
  cards.forEach(([label, value, color], i) => {
    const col = i + 1;
    const valueCell = sheet.getCell(11, col);
    valueCell.value = value;
    valueCell.font = { name: 'Arial', size: 18, bold: true, color: { argb: EXPORT_COLORS.ink } };
    valueCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: EXPORT_COLORS.white } };
    valueCell.alignment = { horizontal: 'center', vertical: 'middle' };
    applyBorder(valueCell);
    const labelCell = sheet.getCell(12, col);
    labelCell.value = label;
    labelCell.font = { name: 'Arial', size: 8, color: { argb: EXPORT_COLORS.muted } };
    labelCell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    labelCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: EXPORT_COLORS.white } };
    applyBorder(labelCell);
    sheet.getCell(10, col).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
    sheet.getRow(10).height = 4;
    applyBorder(sheet.getCell(10, col), color);
  });
  sheet.getRow(11).height = 28;
  sheet.getRow(12).height = 29;

  styleSectionTitle(sheet, 15, 'DETALHAMENTO POR RESULTADO', 8);
  const chart = buildDonutDataUrl(summaryMetrics);
  if (chart) {
    const imageId = workbook.addImage({ base64: chart, extension: 'png' });
    sheet.addImage(imageId, { tl: { col: 0.2, row: 15.2 }, ext: { width: 460, height: 260 } });
    for (let row = 16; row <= 29; row += 1) sheet.getRow(row).height = 16;
  }

  sheet.pageSetup = { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 1, margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 } };
  sheet.headerFooter.oddFooter = '&LRelatório gerado pelo DocInspector&R&P de &N';
  return sheet;
}

function addDataSheet(workbook, name, inspection, rows, generatedAt) {
  const headers = rows.length ? Object.keys(rows[0]) : ['Informação'];
  const sheet = workbook.addWorksheet(name, { views: [{ showGridLines: false, state: 'frozen', ySplit: 6 }] });
  sheet.properties.tabColor = { argb: name === 'Documentos' ? EXPORT_COLORS.blue : EXPORT_COLORS.gold };
  headers.forEach((header, index) => {
    const widthMap = {
      'Código PW': 26, 'Descrição': 42, 'Sistema': 20, 'Nome da lista': 28,
      'Status': 18, 'Revisão esperada': 17, 'Revisão encontrada': 18,
      'Quantidade de cópias': 18, 'Resultado': 18, 'Resultado da cópia': 20,
      'Data e hora': 21, 'Responsável': 24, 'Projeto': 26, 'Local': 24,
      'Marcações': 26, 'Comentário': 42, 'Origem': 16, 'Cópia': 10,
      'Evidência local': 16, 'Evidência sincronizada': 20
    };
    sheet.getColumn(index + 1).width = widthMap[header] || 20;
  });
  styleWorkbookHeader(sheet, inspection, generatedAt, Math.max(headers.length, 8));
  const titleRow = 6;
  headers.forEach((header, i) => {
    const cell = sheet.getCell(titleRow, i + 1);
    cell.value = header;
    cell.font = { name: 'Arial', size: 9, bold: true, color: { argb: EXPORT_COLORS.white } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: EXPORT_COLORS.navy } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    applyBorder(cell, EXPORT_COLORS.navy);
  });
  sheet.getRow(titleRow).height = 30;

  const sourceRows = rows.length ? rows : [{ Informação: 'Nenhum registro nos filtros selecionados.' }];
  sourceRows.forEach((rowData, rowIndex) => {
    const excelRow = titleRow + 1 + rowIndex;
    headers.forEach((header, colIndex) => {
      const cell = sheet.getCell(excelRow, colIndex + 1);
      cell.value = rowData[header] ?? '';
      cell.font = { name: 'Arial', size: 9, color: { argb: EXPORT_COLORS.ink } };
      cell.alignment = { vertical: 'top', wrapText: true };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowIndex % 2 ? 'F8FAFC' : EXPORT_COLORS.white } };
      applyBorder(cell, 'E5EAF1');
      if (header === 'Código PW') cell.font = { name: 'Arial', size: 9, bold: true, color: { argb: EXPORT_COLORS.navy } };
      if (header === 'Resultado' || header === 'Resultado da cópia') {
        const palette = resultFill(String(cell.value || ''));
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: palette.fill } };
        cell.font = { name: 'Arial', size: 9, bold: true, color: { argb: palette.font } };
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      }
    });
    sheet.getRow(excelRow).height = 31;
  });

  const lastRow = titleRow + sourceRows.length;
  const lastCol = String.fromCharCode(64 + Math.min(headers.length, 26));
  if (headers.length <= 26) sheet.autoFilter = `${sheet.getCell(titleRow, 1).address}:${lastCol}${lastRow}`;
  sheet.pageSetup = { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.25, right: 0.25, top: 0.35, bottom: 0.35, header: 0.2, footer: 0.2 } };
  sheet.headerFooter.oddFooter = '&LDocInspector&R&P de &N';
  return sheet;
}

export async function exportInspection(inspection, options = {}) {
  const ExcelJS = ensureExcelJS();
  if (!inspection?.documents?.length) throw new Error('Não há documentos para exportar.');
  const opts = normalizeExportOptions(options);
  const selectedDocuments = uniqueBy((inspection.documents || []), document => document.id || document.code).filter(document => shouldExportDocument(document, opts));
  if (!selectedDocuments.length) throw new Error('Nenhum documento atende aos filtros selecionados para exportação.');

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'DocInspector';
  workbook.company = 'DocInspector';
  workbook.subject = `Relatório de inspeção - ${inspection.system || inspection.project || ''}`;
  workbook.title = `DocInspector - ${inspection.name || inspection.project || 'Inspeção'}`;
  workbook.created = new Date();
  workbook.modified = new Date();
  const generatedAt = new Date().toLocaleString('pt-BR');
  const summaryMetrics = selectedMetrics(inspection, opts);

  if (opts.includeSummary) addSummarySheet(workbook, inspection, summaryMetrics, generatedAt);
  if (opts.includeDocuments) addDataSheet(workbook, 'Documentos', inspection, documentRows(inspection, opts), generatedAt);
  if (opts.includeCopies) addDataSheet(workbook, 'Cópias de campo', inspection, copyRows(inspection, opts), generatedAt);

  const buffer = await workbook.xlsx.writeBuffer();
  downloadBlob(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `DocInspector-${safeExportName(inspection)}.xlsx`);
}

export function buildInspectionExportData(inspection, options = {}) {
  const opts = normalizeExportOptions(options);
  return {
    options: opts,
    documents: documentRows(inspection, opts),
    copies: copyRows(inspection, opts),
    metrics: selectedMetrics(inspection, opts)
  };
}
