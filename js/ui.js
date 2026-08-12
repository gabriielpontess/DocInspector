const ICONS = {
  home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5 10.5V20h14v-9.5"/><path d="M9 20v-6h6v6"/>',
  inspect: '<path d="M9 11l2 2 4-5"/><path d="M5 4h14v16H5z"/><path d="M8 4V2h8v2"/>',
  docs: '<path d="M6 3h9l3 3v15H6z"/><path d="M15 3v4h4"/><path d="M9 11h6M9 15h6"/>',
  settings: '<path d="M4 5h16M4 12h16M4 19h16"/><circle cx="8" cy="5" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="10" cy="19" r="2"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  download: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>',
  warning: '<path d="M12 3 2.5 20h19z"/><path d="M12 9v4M12 17h.01"/>',
  install: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 19h14v2H5z"/>',
  sync: '<path d="M20 7h-5V2"/><path d="M20 2l-3.2 3.2A8 8 0 1 0 19.5 15"/><path d="M4 17h5v5"/><path d="M4 22l3.2-3.2"/>',
  copy: '<rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  total: '<path d="M5 4h14v16H5z"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  verified: '<path d="M4 12l5 5L20 6"/><path d="M4 5h7M4 19h16"/>',
  conforming: '<circle cx="12" cy="12" r="9"/><path d="m8 12 2.5 2.5L16 9"/>',
  nonconforming: '<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/>',
  notfound: '<path d="M3 6h18v12H3z"/><path d="M8 10h8M8 14h5"/><path d="M19 4v4"/>',
  pending: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  cloud: '<path d="M7 18h10a4 4 0 0 0 .5-8 6 6 0 0 0-11.3-1.8A4.5 4.5 0 0 0 7 18Z"/>',
  database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v7c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 12v7c0 1.7 3.6 3 8 3s8-1.3 8-3v-7"/>',
  shield: '<path d="M12 3 5 6v5c0 4.6 2.8 8.2 7 10 4.2-1.8 7-5.4 7-10V6z"/><path d="m9 12 2 2 4-4"/>',
  device: '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M9 18h6"/>',
  camera: '<path d="M4 7h4l2-2h4l2 2h4v12H4z"/><circle cx="12" cy="13" r="4"/>',
  edit: '<path d="M4 20h4l11-11-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  trash: '<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M7 7l1 13h8l1-13"/><path d="M10 11v5M14 11v5"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 15-5-5L5 20"/>'
};

export function icon(name, className = 'icon') {
  const body = ICONS[name] || ICONS.docs;
  return `<svg class="${className}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}

export function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  })[char]);
}

export function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('pt-BR');
}

export function showToast(message, type = '') {
  const root = document.querySelector('#toast-root');
  if (!root || !message) return;

  const element = document.createElement('div');
  element.className = `toast ${type}`.trim();
  element.setAttribute('role', type === 'error' ? 'alert' : 'status');
  element.textContent = message;
  root.append(element);

  window.setTimeout(() => {
    element.classList.add('toast-out');
    window.setTimeout(() => element.remove(), 180);
  }, 3200);
}

export function setButtonBusy(button, busy, busyText = 'Processando…') {
  if (!button) return;

  if (busy) {
    button.dataset.originalText = button.innerHTML;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    button.textContent = busyText;
    return;
  }

  if (button.dataset.originalText) button.innerHTML = button.dataset.originalText;
  button.disabled = false;
  button.removeAttribute('aria-busy');
  delete button.dataset.originalText;
}

export function openModal(content, { label = 'Janela de diálogo' } = {}) {
  const previousFocus = document.activeElement;
  const element = document.createElement('div');
  element.className = 'modal-backdrop';
  element.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-label="${escapeHtml(label)}">
      ${content}
    </div>`;

  function close() {
    element.remove();
    document.body.classList.remove('modal-open');
    if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
  }

  element.addEventListener('click', event => {
    if (event.target === element) close();
  });

  element.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }

    if (event.key !== 'Tab') return;
    const focusable = [...element.querySelectorAll(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
    )].filter(item => !item.hidden && item.offsetParent !== null);

    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable.at(-1);

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  element.closeModal = close;
  document.body.classList.add('modal-open');
  document.body.append(element);
  requestAnimationFrame(() => {
    const initialFocus = element.querySelector(
      'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
    );
    initialFocus?.focus();
  });
  return element;
}
