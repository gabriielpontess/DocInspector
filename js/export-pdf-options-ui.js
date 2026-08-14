function ensurePdfCopiesOption() {
  const generatePdf = document.querySelector('#generate-pdf');
  const modal = generatePdf?.closest('.modal') || generatePdf?.closest('[role="dialog"]');
  if (!generatePdf || !modal || modal.querySelector('#exp-pdf-copies')) return false;

  const section = document.createElement('section');
  section.className = 'export-field-evidence-option';
  section.innerHTML = `
    <label for="exp-pdf-copies">
      <input type="checkbox" id="exp-pdf-copies">
      <strong>Incluir cópias de campo no PDF</strong>
    </label>`;

  const note = modal.querySelector('.export-format-note');
  if (note) note.insertAdjacentElement('beforebegin', section);
  else generatePdf.closest('.actions')?.insertAdjacentElement('beforebegin', section);
  return true;
}

function watchForExportModal() {
  if (ensurePdfCopiesOption()) return;

  const bodyObserver = new MutationObserver(() => {
    if (!ensurePdfCopiesOption()) return;
    bodyObserver.disconnect();
  });
  bodyObserver.observe(document.body, { childList: true, subtree: true });

  window.setTimeout(() => bodyObserver.disconnect(), 1500);
}

document.addEventListener('click', event => {
  if (!event.target?.closest?.('[data-export-inspection], #export-selected-inspection')) return;
  watchForExportModal();
}, true);

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', ensurePdfCopiesOption, { once: true });
} else {
  ensurePdfCopiesOption();
}
