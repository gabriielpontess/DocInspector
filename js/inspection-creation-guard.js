const CREATION_STAGE_SELECTOR = '#read-file, #finish-import';
const CREATION_LAUNCHER_SELECTOR = '#new-inspection-hero';

export function createSingleFlightGate() {
  const active = new Set();
  return Object.freeze({
    enter(key) {
      if (key == null || active.has(key)) return false;
      active.add(key);
      return true;
    },
    release(key) {
      active.delete(key);
    },
    has(key) {
      return active.has(key);
    }
  });
}

const submitGate = createSingleFlightGate();
const trackedButtons = new Set();

function blockDuplicateEvent(event) {
  event.preventDefault();
  event.stopImmediatePropagation();
}

function closestElement(target, selector) {
  if (typeof Element === 'undefined' || !(target instanceof Element)) return null;
  return target.closest(selector);
}

function releaseSettledButtons() {
  for (const button of [...trackedButtons]) {
    if (!button.isConnected || !button.disabled) {
      submitGate.release(button);
      trackedButtons.delete(button);
    }
  }
}

function guardCreationClick(event) {
  const launcher = closestElement(event.target, CREATION_LAUNCHER_SELECTOR);
  if (launcher) {
    // A primeira abertura é síncrona. Se um segundo click chegar depois dela,
    // o modal já contém um dos controles abaixo e o evento deve ser descartado.
    if (document.querySelector(CREATION_STAGE_SELECTOR)) blockDuplicateEvent(event);
    return;
  }

  const button = closestElement(event.target, CREATION_STAGE_SELECTOR);
  if (!button) return;

  // `disabled` já bloqueia interação normal. Esta checagem também cobre
  // dispatchEvent()/eventos duplicados que poderiam ignorar a semântica visual.
  if (button.disabled || !submitGate.enter(button)) {
    blockDuplicateEvent(event);
    return;
  }

  trackedButtons.add(button);

  // Os handlers reais chamam setButtonBusy() sincronamente antes do primeiro
  // await. Se uma validação falhar antes disso, libera o gate no microtask.
  queueMicrotask(releaseSettledButtons);
}

if (typeof document !== 'undefined') {
  document.addEventListener('click', guardCreationClick, true);

  if (typeof MutationObserver !== 'undefined' && document.documentElement) {
    const observer = new MutationObserver(releaseSettledButtons);
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['disabled']
    });
  }
}
