function safeName(value) {
  return String(value || 'Inspecao').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 90) || 'Inspecao';
}

function htmlEscape(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);
}

function rowsHtml(rows, columns) {
  return rows.map(row => `<tr>${columns.map(column => `<td>${htmlEscape(row[column] ?? '')}</td>`).join('')}</tr>`).join('');
}

function downloadWord(html, filename) {
  const blob = new Blob(['\ufeff', html], { type: 'application/msword;charset=utf-8' });
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

export function exportInspectionWord(inspection, data) {
  if (!inspection?.documents?.length) throw new Error('Não há documentos para exportar.');
  if (!data?.documents?.length) throw new Error('Nenhum documento atende aos filtros selecionados para exportação.');
  const generatedAt = new Date().toLocaleString('pt-BR');
  const documentColumns = ['Código PW', 'Descrição', 'Revisão esperada', 'Revisão encontrada', 'Resultado', 'Status'];
  const copyColumns = ['Código PW', 'Cópia', 'Revisão encontrada', 'Resultado da cópia', 'Marcações', 'Comentário']
    .filter(column => (column !== 'Marcações' || data.options.includeMarkings) && (column !== 'Comentário' || data.options.includeComments));
  const metrics = data.metrics || {};
  const html = `<!doctype html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" lang="pt-BR">
<head><meta charset="utf-8"><title>DocInspector</title><style>
@page { size: A4 portrait; margin: 1.5cm; } body { font-family: Arial, sans-serif; color:#15253D; font-size:10pt; }
h1 { color:#0B2D54; font-size:20pt; margin:0; } h2 { color:#0B2D54; margin:18pt 0 8pt; font-size:13pt; }
.muted { color:#66758A; } .meta { width:100%; border-collapse:collapse; margin:12pt 0; } .meta td { width:50%; padding:7pt; border:1px solid #D9E2EF; }
.kpis { width:100%; border-collapse:collapse; margin:12pt 0; } .kpis td { padding:7pt; border:1px solid #D9E2EF; text-align:center; }
table.data { width:100%; border-collapse:collapse; table-layout:fixed; } table.data th { background:#0B2D54; color:white; padding:6pt; border:1px solid #0B2D54; font-size:8pt; }
table.data td { padding:5pt; border:1px solid #D9E2EF; vertical-align:top; overflow-wrap:anywhere; } tr { page-break-inside:avoid; }
.footer { margin-top:16pt; border-top:1px solid #D9E2EF; padding-top:6pt; color:#66758A; font-size:8pt; }
</style></head><body>
<h1>DOCINSPECTOR</h1><div class="muted">Relatório de inspeção documental · ${htmlEscape(generatedAt)}</div>
<h2>${htmlEscape(String(inspection.system || 'Sistema não informado').toUpperCase())}</h2><div class="muted">${htmlEscape(inspection.name || inspection.project || 'Inspeção')}</div>
<table class="meta"><tr><td><b>Responsável</b><br>${htmlEscape(inspection.responsible || '-')}</td><td><b>Local</b><br>${htmlEscape(inspection.location || '-')}</td></tr><tr><td><b>Projeto</b><br>${htmlEscape(inspection.project || '-')}</td><td><b>Nome da lista</b><br>${htmlEscape(inspection.name || inspection.project || '-')}</td></tr></table>
${data.options.includeSummary ? `<table class="kpis"><tr><td><b>Total</b><br>${metrics.total || 0}</td><td><b>Verificados</b><br>${metrics.verified || 0}</td><td><b>Conformes</b><br>${metrics.conforming || 0}</td><td><b>Não conformes</b><br>${metrics.nonconforming || 0}</td><td><b>Não encontrados</b><br>${metrics.notFound || 0}</td><td><b>Pendentes</b><br>${metrics.pending || 0}</td></tr></table>` : ''}
${data.options.includeDocuments ? `<h2>Lista de documentos</h2><table class="data"><thead><tr>${documentColumns.map(column => `<th>${htmlEscape(column)}</th>`).join('')}</tr></thead><tbody>${rowsHtml(data.documents, documentColumns)}</tbody></table>` : ''}
${data.options.includeCopies && data.copies.length ? `<h2>Cópias de campo</h2><table class="data"><thead><tr>${copyColumns.map(column => `<th>${htmlEscape(column)}</th>`).join('')}</tr></thead><tbody>${rowsHtml(data.copies, copyColumns)}</tbody></table>` : ''}
<div class="footer">Arquivo editável gerado pelo DocInspector. Revise o conteúdo antes de distribuir uma versão alterada.</div>
</body></html>`;
  downloadWord(html, `DocInspector-${safeName(`${inspection.system || inspection.project}-${inspection.name || inspection.project}`)}.doc`);
}
