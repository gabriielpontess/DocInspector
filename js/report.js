const COLORS = {
  navy: '#0B2D54',
  navy2: '#123F73',
  blue: '#2E6EB5',
  gold: '#F5B942',
  green: '#2FA866',
  red: '#E44A3A',
  amber: '#F39A2B',
  gray: '#8A95A5',
  ink: '#15253D',
  muted: '#66758A',
  line: '#D9E2EF',
  soft: '#F4F7FB',
  white: '#FFFFFF'
};

function ensureJsPDF() {
  const ctor = window.jspdf?.jsPDF;
  if (!ctor) throw new Error('A biblioteca de PDF não foi carregada. Recarregue o aplicativo com internet e tente novamente.');
  return ctor;
}


function downloadPdfBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function safeFileName(value) {
  return String(value || 'Inspecao')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90) || 'Inspecao';
}

function hexRgb(hex) {
  const value = String(hex).replace('#', '');
  return [parseInt(value.slice(0, 2), 16), parseInt(value.slice(2, 4), 16), parseInt(value.slice(4, 6), 16)];
}

function setFill(doc, color) { doc.setFillColor(...hexRgb(color)); }
function setText(doc, color) { doc.setTextColor(...hexRgb(color)); }
function setDraw(doc, color) { doc.setDrawColor(...hexRgb(color)); }

function truncate(doc, value, width) {
  const text = String(value ?? '');
  if (doc.getTextWidth(text) <= width) return text;
  let result = text;
  while (result.length > 3 && doc.getTextWidth(`${result}…`) > width) result = result.slice(0, -1);
  return `${result}…`;
}

function drawBrand(doc, x, y) {
  setFill(doc, COLORS.navy);
  doc.roundedRect(x, y, 13, 13, 2.6, 2.6, 'F');
  setDraw(doc, COLORS.white);
  doc.setLineWidth(1.15);
  doc.circle(x + 6, y + 5.8, 3.15, 'S');
  doc.line(x + 8.3, y + 8.1, x + 11.1, y + 10.9);
  doc.setLineWidth(0.25);
  doc.line(x + 3.9, y + 5.1, x + 8, y + 5.1);
  doc.line(x + 4.2, y + 6.3, x + 7.5, y + 6.3);

  setText(doc, COLORS.navy);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text('DOCINSPECTOR', x + 17, y + 5.8);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  setText(doc, COLORS.muted);
  doc.text('Relatório de inspeção documental', x + 17, y + 10.7);
}

function drawMetaBox(doc, inspection, y) {
  const x = 14;
  const width = 182;
  const h = 31;
  setFill(doc, '#F8FAFD');
  setDraw(doc, COLORS.line);
  doc.roundedRect(x, y, width, h, 3, 3, 'FD');
  doc.setFontSize(8.2);
  const items = [
    ['Responsável', inspection.responsible || '-'],
    ['Local', inspection.location || '-'],
    ['Projeto', inspection.project || '-'],
    ['Nome da lista', inspection.name || inspection.project || '-']
  ];
  const positions = [[20, y + 8], [108, y + 8], [20, y + 21], [108, y + 21]];
  items.forEach(([label, value], i) => {
    const [px, py] = positions[i];
    setText(doc, COLORS.muted);
    doc.setFont('helvetica', 'normal');
    doc.text(label, px, py);
    setText(doc, COLORS.ink);
    doc.setFont('helvetica', 'bold');
    doc.text(truncate(doc, value, 75), px, py + 5);
  });
}

function drawKpiCards(doc, data, y) {
  const cards = [
    ['Total', data.total, COLORS.navy],
    ['Verificados', data.verified, COLORS.blue],
    ['Conformes', data.conforming, COLORS.green],
    ['Não conformes', data.nonconforming, COLORS.red],
    ['Não encontrados', data.notFound, COLORS.amber],
    ['Pendentes', data.pending, COLORS.gray]
  ];
  const gap = 2.3;
  const x = 14;
  const totalWidth = 182;
  const w = (totalWidth - gap * 5) / 6;
  cards.forEach(([label, value, color], index) => {
    const cx = x + index * (w + gap);
    setFill(doc, COLORS.white);
    setDraw(doc, COLORS.line);
    doc.roundedRect(cx, y, w, 20, 2.2, 2.2, 'FD');
    setFill(doc, color);
    doc.roundedRect(cx, y, w, 2.1, 2.2, 2.2, 'F');
    setText(doc, COLORS.ink);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12.5);
    doc.text(String(value ?? 0), cx + 3, y + 9.5);
    setText(doc, COLORS.muted);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    const lines = doc.splitTextToSize(label, w - 5);
    doc.text(lines, cx + 3, y + 14);
  });
}

function drawDonut(doc, metrics, cx, cy, radius = 18) {
  const values = [
    [metrics.conforming, COLORS.green],
    [metrics.nonconforming, COLORS.red],
    [metrics.notFound, COLORS.amber],
    [metrics.pending, COLORS.blue]
  ];
  const total = values.reduce((sum, [v]) => sum + Number(v || 0), 0) || 1;
  let start = -Math.PI / 2;
  values.forEach(([value, color]) => {
    const portion = Number(value || 0) / total;
    if (!portion) return;
    const steps = Math.max(3, Math.ceil(portion * 90));
    setDraw(doc, color);
    doc.setLineWidth(6.5);
    let previous = [cx + Math.cos(start) * radius, cy + Math.sin(start) * radius];
    for (let i = 1; i <= steps; i += 1) {
      const angle = start + portion * Math.PI * 2 * (i / steps);
      const next = [cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius];
      doc.line(previous[0], previous[1], next[0], next[1]);
      previous = next;
    }
    start += portion * Math.PI * 2;
  });
  doc.setLineWidth(0.2);
  setText(doc, COLORS.ink);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text(`${metrics.verified || 0}`, cx, cy - 0.5, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(5.8);
  setText(doc, COLORS.muted);
  doc.text('verificados', cx, cy + 3.5, { align: 'center' });
}

function drawSummaryChart(doc, metrics, y) {
  setFill(doc, COLORS.white);
  setDraw(doc, COLORS.line);
  doc.roundedRect(14, y, 182, 49, 3, 3, 'FD');
  setText(doc, COLORS.navy);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('DETALHAMENTO POR RESULTADO', 20, y + 8);
  drawDonut(doc, metrics, 45, y + 29, 14);

  const legend = [
    ['Conformes', metrics.conforming, COLORS.green],
    ['Não conformes', metrics.nonconforming, COLORS.red],
    ['Não encontrados', metrics.notFound, COLORS.amber],
    ['Pendentes', metrics.pending, COLORS.blue]
  ];
  legend.forEach(([label, value, color], i) => {
    const py = y + 16 + i * 7.2;
    setFill(doc, color);
    doc.circle(85, py - 1.2, 1.4, 'F');
    setText(doc, COLORS.ink);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.text(label, 90, py);
    doc.setFont('helvetica', 'bold');
    doc.text(String(value || 0), 178, py, { align: 'right' });
  });
}

function resultColor(result) {
  if (result === 'Conforme') return COLORS.green;
  if (result === 'Não conforme') return COLORS.red;
  if (result === 'Não encontrado') return COLORS.amber;
  return COLORS.gray;
}

function drawTable(doc, {
  title,
  columns,
  rows,
  startY,
  pageTitle,
  pageOrientation = 'portrait'
}) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const left = 12;
  const right = 12;
  const usable = pageWidth - left - right;
  const headerH = 8;
  const fontSize = 6.15;
  let y = startY;

  const widths = columns.map(col => usable * col.width);
  const drawSectionTitle = () => {
    setText(doc, COLORS.navy);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.2);
    doc.text(title, left, y);
    y += 4;
  };
  const drawHeader = () => {
    setFill(doc, COLORS.navy);
    setDraw(doc, COLORS.navy);
    doc.rect(left, y, usable, headerH, 'F');
    let x = left;
    columns.forEach((col, i) => {
      setText(doc, COLORS.white);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6.4);
      doc.text(truncate(doc, col.label, widths[i] - 3), x + 1.5, y + 5.2);
      x += widths[i];
    });
    y += headerH;
  };
  const newPage = () => {
    doc.addPage('a4', 'portrait');
    y = 14;
    drawBrand(doc, left, 10);
    setText(doc, COLORS.muted);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.text(pageTitle, pageWidth - right, 16, { align: 'right' });
    y = 29;
    drawSectionTitle();
    drawHeader();
  };

  drawSectionTitle();
  drawHeader();

  rows.forEach((row, rowIndex) => {
    const values = columns.map(col => String(row[col.key] ?? ''));
    const lineSets = values.map((value, i) => doc.splitTextToSize(value, widths[i] - 3));
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

  return y;
}

function addPageFooters(doc, generatedAt) {
  const count = doc.getNumberOfPages();
  for (let page = 1; page <= count; page += 1) {
    doc.setPage(page);
    const size = doc.internal.pageSize;
    const width = size.getWidth();
    const height = size.getHeight();
    setDraw(doc, COLORS.line);
    doc.line(14, height - 10, width - 14, height - 10);
    setText(doc, COLORS.muted);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.6);
    doc.text(`Gerado pelo DocInspector em ${generatedAt}`, 14, height - 6);
    doc.text(`Página ${page} de ${count}`, width - 14, height - 6, { align: 'right' });
  }
}

export function exportInspectionPdf(inspection, data) {
  const JsPDF = ensureJsPDF();
  if (!inspection?.documents?.length) throw new Error('Não há documentos para exportar.');
  if (!data?.documents?.length) throw new Error('Nenhum documento atende aos filtros selecionados para exportação.');

  const doc = new JsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
  const generatedAt = new Date().toLocaleString('pt-BR');
  drawBrand(doc, 14, 12);
  setText(doc, COLORS.muted);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.2);
  doc.text(`Exportado em ${generatedAt}`, 196, 17, { align: 'right' });
  doc.text('Versão do relatório: v0.9.8', 196, 22, { align: 'right' });

  setText(doc, COLORS.navy);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text(String(inspection.system || 'Sistema não informado').toUpperCase(), 14, 39);
  setText(doc, COLORS.muted);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(inspection.name || inspection.project || 'Inspeção', 14, 46);

  drawMetaBox(doc, inspection, 52);
  if (data.options.includeSummary) {
    drawKpiCards(doc, data.metrics, 88);
    drawSummaryChart(doc, data.metrics, 113);
  }

  let y = data.options.includeSummary ? 169 : 92;
  if (data.options.includeDocuments) {
    const columns = [
      { key: 'Código PW', label: 'Código PW', width: 0.18 },
      { key: 'Descrição', label: 'Descrição', width: 0.30 },
      { key: 'Revisão esperada', label: 'Rev. esperada', width: 0.12 },
      { key: 'Revisão encontrada', label: 'Rev. encontrada', width: 0.13 },
      { key: 'Resultado', label: 'Resultado', width: 0.15 },
      { key: 'Status', label: 'Status', width: 0.12 }
    ];
    y = drawTable(doc, {
      title: 'LISTA DE DOCUMENTOS',
      columns,
      rows: data.documents,
      startY: y,
      pageTitle: `${inspection.system || ''} - ${inspection.name || inspection.project || ''}`
    });
  }

  if (data.options.includeCopies && data.copies.length) {
    // Mantém todo o relatório em A4 retrato. A tabela de cópias usa
    // proporções compactas e quebra de texto para evitar páginas mistas.
    doc.addPage('a4', 'portrait');
    const columns = [
      { key: 'Código PW', label: 'Código PW', width: 0.17 },
      { key: 'Descrição', label: 'Descrição', width: 0.22 },
      { key: 'Cópia', label: 'Cópia', width: 0.055 },
      { key: 'Revisão encontrada', label: 'Rev.', width: 0.065 },
      { key: 'Resultado da cópia', label: 'Resultado', width: 0.12 },
      { key: 'Origem', label: 'Origem', width: 0.08 },
      { key: 'Marcações', label: 'Marcações', width: 0.105 },
      { key: 'Comentário', label: 'Comentário', width: 0.185 }
    ].filter(col => (col.key !== 'Marcações' || data.options.includeMarkings) && (col.key !== 'Comentário' || data.options.includeComments));
    const total = columns.reduce((sum, col) => sum + col.width, 0);
    columns.forEach(col => { col.width /= total; });
    drawTable(doc, {
      title: 'CÓPIAS DE CAMPO',
      columns,
      rows: data.copies,
      startY: 29,
      pageTitle: `${inspection.system || ''} - ${inspection.name || inspection.project || ''}`,
      pageOrientation: 'portrait'
    });
  }

  addPageFooters(doc, generatedAt);
  const name = safeFileName(`${inspection.system || inspection.project}-${inspection.name || inspection.project}`);
  const blob = doc.output('blob');
  downloadPdfBlob(blob, `DocInspector-${name}.pdf`);
}
