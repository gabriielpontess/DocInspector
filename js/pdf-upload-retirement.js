const UPLOAD_BUTTON = '#confidential-upload';
const UPLOAD_INPUT = '#confidential-upload-input';
let observer = null;
let queued = false;

function retirePdfUploadControls(root = document) {
  const button = root.querySelector?.(UPLOAD_BUTTON);
  if (button) {
    button.hidden = true;
    button.disabled = true;
    button.setAttribute('aria-hidden', 'true');
    button.tabIndex = -1;
    // `.btn { display: inline-flex; }` pode sobrescrever o comportamento visual
    // nativo de `hidden` em alguns navegadores. Como este controle foi
    // aposentado, garantimos que ele permaneça realmente fora da interface.
    button.style.setProperty('display', 'none', 'important');
  }

  const input = root.querySelector?.(UPLOAD_INPUT);
  if (input) {
    input.hidden = true;
    input.disabled = true;
    input.setAttribute('aria-hidden', 'true');
    input.tabIndex = -1;
    input.value = '';
    input.style.setProperty('display', 'none', 'important');
  }

  const actions = root.querySelector?.('#confidential-documents-actions');
  if (actions && !actions.querySelector('[data-pdf-upload-retired]')) {
    const note = document.createElement('small');
    note.dataset.pdfUploadRetired = 'true';
    note.className = 'subtitle';
    note.textContent = 'Novos uploads de PDF foram descontinuados. PDFs já existentes continuam disponíveis para consulta.';
    actions.append(note);
  }
}

function scheduleRetirement() {
  if (queued) return;
  queued = true;
  queueMicrotask(() => {
    queued = false;
    retirePdfUploadControls(document);
  });
}

function blockRetiredUpload(event) {
  const target = event.target instanceof Element ? event.target : null;
  if (!target?.closest(`${UPLOAD_BUTTON}, ${UPLOAD_INPUT}`)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
}

function start() {
  document.addEventListener('click', blockRetiredUpload, true);
  document.addEventListener('change', blockRetiredUpload, true);
  retirePdfUploadControls(document);
  if (!document.body || observer) return;
  observer = new MutationObserver(scheduleRetirement);
  observer.observe(document.body, { childList: true, subtree: true });
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
}

export { retirePdfUploadControls };
