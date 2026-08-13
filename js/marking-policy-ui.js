const ALLOWED_MARKINGS = new Set(['Amarelo', 'Vermelho']);
let observer = null;

function enforceMarkingPolicy(root = document) {
  root.querySelectorAll('.marking-option input[name="marking"]').forEach(input => {
    if (ALLOWED_MARKINGS.has(input.value)) return;
    input.checked = false;
    input.disabled = true;
    input.closest('.marking-option')?.remove();
  });
}

function start() {
  enforceMarkingPolicy(document);
  if (!document.body || observer) return;
  observer = new MutationObserver(() => enforceMarkingPolicy(document.body));
  observer.observe(document.body, { childList: true, subtree: true });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
else start();

export { ALLOWED_MARKINGS, enforceMarkingPolicy };
