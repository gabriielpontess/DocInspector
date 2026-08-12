from pathlib import Path

report = Path('js/report.js')
text = report.read_text(encoding='utf-8')

old = '''function boundedLines(doc, value, width, maxLines = 5) {
  const lines = doc.splitTextToSize(String(value ?? ''), width);
  if (lines.length <= maxLines) return lines;
  const visible = lines.slice(0, maxLines);
  let last = String(visible[maxLines - 1] || '');
  while (last.length > 1 && doc.getTextWidth(`${last}…`) > width) last = last.slice(0, -1);
  visible[maxLines - 1] = `${last}…`;
  return visible;
}
'''
new = '''export function sliceRowLineSets(lineSets, offsets, maxLines) {
  const safeMax = Math.max(1, Number(maxLines) || 1);
  const chunkSets = lineSets.map((lines, index) => lines.slice(offsets[index], offsets[index] + safeMax));
  const nextOffsets = offsets.map((offset, index) => offset + chunkSets[index].length);
  const done = lineSets.every((lines, index) => nextOffsets[index] >= lines.length);
  return { chunkSets, nextOffsets, done };
}
'''
if old not in text:
    raise SystemExit('boundedLines block not found')
text = text.replace(old, new, 1)

old_rows = '''  rows.forEach((row, rowIndex) => {
    const values = columns.map(col => String(row[col.key] ?? ''));
    const lineSets = values.map((value, i) => boundedLines(doc, value, widths[i] - 3, columns[i].maxLines || 5));
    const maxLines = Math.max(...lineSets.map(lines => lines.length), 1);
    const rowH = Math.max(7, maxLines * 3.4 + 2.2);
    if (y + rowH > pageHeight - 16) newPage();

    setFill(doc, rowIndex % 2 ? '#F8FAFC' : COLORS.white);
    doc.rect(left, y, usable, rowH, 'F');
    setDraw(doc, '#E4EAF2');
    doc.setLineWidth(0.2);
    let x = left;
    columns.forEach((col, i) => {
      doc.rect(x, y, widths[i], rowH, 'S');
      if (col.key === 'Resultado' || col.key === 'Resultado da cópia') setText(doc, resultColor(values[i]));
      else setText(doc, COLORS.ink);
      doc.setFont('helvetica', col.key === 'Código PW' ? 'bold' : 'normal');
      doc.setFontSize(fontSize);
      doc.text(lineSets[i], x + 1.5, y + 4.5);
      x += widths[i];
    });
    y += rowH;
  });
'''
new_rows = '''  rows.forEach((row, rowIndex) => {
    const values = columns.map(col => String(row[col.key] ?? ''));
    const lineSets = values.map((value, i) => doc.splitTextToSize(value, widths[i] - 3));
    let offsets = lineSets.map(() => 0);
    let done = false;

    while (!done) {
      const availableHeight = pageHeight - 16 - y;
      const availableLines = Math.floor((availableHeight - 2.2) / 3.4);
      if (availableLines < 1) {
        newPage();
        continue;
      }

      const chunk = sliceRowLineSets(lineSets, offsets, availableLines);
      const maxChunkLines = Math.max(...chunk.chunkSets.map(lines => lines.length), 1);
      const rowH = Math.max(7, maxChunkLines * 3.4 + 2.2);

      setFill(doc, rowIndex % 2 ? '#F8FAFC' : COLORS.white);
      doc.rect(left, y, usable, rowH, 'F');
      setDraw(doc, '#E4EAF2');
      doc.setLineWidth(0.2);
      let x = left;
      columns.forEach((col, i) => {
        doc.rect(x, y, widths[i], rowH, 'S');
        if (col.key === 'Resultado' || col.key === 'Resultado da cópia') setText(doc, resultColor(values[i]));
        else setText(doc, COLORS.ink);
        doc.setFont('helvetica', col.key === 'Código PW' ? 'bold' : 'normal');
        doc.setFontSize(fontSize);
        if (chunk.chunkSets[i].length) doc.text(chunk.chunkSets[i], x + 1.5, y + 4.5);
        x += widths[i];
      });
      y += rowH;
      offsets = chunk.nextOffsets;
      done = chunk.done;
      if (!done) newPage();
    }
  });
'''
if old_rows not in text:
    raise SystemExit('drawTable row block not found')
text = text.replace(old_rows, new_rows, 1)

for before, after in [
    ("{ key: 'Descrição', label: 'Descrição', width: 0.30, maxLines: 3 }", "{ key: 'Descrição', label: 'Descrição', width: 0.30 }"),
    ("{ key: 'Descrição', label: 'Descrição', width: 0.22, maxLines: 3 }", "{ key: 'Descrição', label: 'Descrição', width: 0.22 }"),
    ("{ key: 'Marcações', label: 'Marcações', width: 0.105, maxLines: 2 }", "{ key: 'Marcações', label: 'Marcações', width: 0.105 }"),
    ("{ key: 'Comentário', label: 'Comentário', width: 0.185, maxLines: 4 }", "{ key: 'Comentário', label: 'Comentário', width: 0.185 }"),
]:
    if before not in text:
        raise SystemExit(f'column definition not found: {before}')
    text = text.replace(before, after, 1)

if "Versão do relatório: v0.9.11" not in text:
    raise SystemExit('report version not found')
text = text.replace("Versão do relatório: v0.9.11", "Versão do relatório: v0.9.12", 1)
report.write_text(text, encoding='utf-8')

sw = Path('sw.js')
sw_text = sw.read_text(encoding='utf-8')
if "const VERSION = '0.9.11';" not in sw_text:
    raise SystemExit('service worker version 0.9.11 not found')
sw.write_text(sw_text.replace("const VERSION = '0.9.11';", "const VERSION = '0.9.12';", 1), encoding='utf-8')

test = Path('tests/feature-export-verification-documents.test.mjs')
test_text = test.read_text(encoding='utf-8')
old_import = "import { buildInspectionExportData } from '../js/xlsx.js';"
if "sliceRowLineSets" not in test_text:
    if old_import not in test_text:
        raise SystemExit('xlsx import not found')
    test_text = test_text.replace(old_import, old_import + "\nimport { sliceRowLineSets } from '../js/report.js';", 1)
old_assertions = "assert.match(report, /boundedLines/);\nassert.match(report, /maxLines: 4/);"
new_assertions = """assert.doesNotMatch(report, /boundedLines/);
assert.doesNotMatch(report, /maxLines:/);
const lineSets = [['a1','a2','a3','a4','a5'], ['b1','b2'], ['c1','c2','c3']];
const firstChunk = sliceRowLineSets(lineSets, [0,0,0], 2);
assert.deepEqual(firstChunk.chunkSets, [['a1','a2'], ['b1','b2'], ['c1','c2']]);
assert.deepEqual(firstChunk.nextOffsets, [2,2,2]);
assert.equal(firstChunk.done, false);
const secondChunk = sliceRowLineSets(lineSets, firstChunk.nextOffsets, 2);
assert.deepEqual(secondChunk.chunkSets, [['a3','a4'], [], ['c3']]);
assert.equal(secondChunk.done, false);
const thirdChunk = sliceRowLineSets(lineSets, secondChunk.nextOffsets, 2);
assert.deepEqual(thirdChunk.chunkSets, [['a5'], [], []]);
assert.equal(thirdChunk.done, true);"""
if old_assertions not in test_text:
    raise SystemExit('old PDF assertions not found')
test.write_text(test_text.replace(old_assertions, new_assertions, 1), encoding='utf-8')
