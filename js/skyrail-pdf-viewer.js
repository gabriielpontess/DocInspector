export const SKYRAIL_PDFJS_VERSION = '6.2.108';
export const SKYRAIL_PDFJS_MODULE_URL = new URL('../vendor/pdfjs/pdf.min.mjs', import.meta.url).href;
export const SKYRAIL_PDFJS_WORKER_URL = new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;

let pdfjsPromise = null;

async function loadPdfJs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import(SKYRAIL_PDFJS_MODULE_URL)
      .then(pdfjs => {
        if (String(pdfjs.version) !== SKYRAIL_PDFJS_VERSION) {
          throw new Error(`Versão PDF.js inesperada: ${pdfjs.version || 'desconhecida'}.`);
        }
        pdfjs.GlobalWorkerOptions.workerSrc = SKYRAIL_PDFJS_WORKER_URL;
        return pdfjs;
      })
      .catch(error => {
        pdfjsPromise = null;
        throw error;
      });
  }
  return pdfjsPromise;
}

function assertPdf(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 5) throw new Error('PDF inválido.');
  const signature = new TextDecoder().decode(bytes.subarray(0, 5));
  if (signature !== '%PDF-') throw new Error('O arquivo recebido não é um PDF válido.');
}

export async function createSkyrailPdfViewer(blob, { maxPages = 1000 } = {}) {
  if (!(blob instanceof Blob)) throw new Error('PDF offline indisponível.');
  const source = new Uint8Array(await blob.arrayBuffer());
  assertPdf(source);
  const pdfjs = await loadPdfJs();
  const loadingTask = pdfjs.getDocument({
    data: source,
    isEvalSupported: false,
    enableXfa: false,
    useSystemFonts: true,
    verbosity: 0
  });

  let pdf;
  try {
    pdf = await loadingTask.promise;
  } catch (error) {
    await loadingTask.destroy().catch(() => {});
    throw new Error('Não foi possível abrir este PDF.');
  }

  if (!Number.isInteger(pdf.numPages) || pdf.numPages < 1 || pdf.numPages > maxPages) {
    await loadingTask.destroy().catch(() => {});
    throw new Error('Quantidade de páginas não suportada.');
  }

  let destroyed = false;
  return {
    numPages: pdf.numPages,
    async renderPage({ pageNumber, canvas, scale = 1.2 } = {}) {
      if (destroyed) throw new Error('O visualizador já foi fechado.');
      if (!canvas?.getContext) throw new Error('Área de visualização indisponível.');
      if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > pdf.numPages) {
        throw new Error('Página inválida.');
      }

      const page = await pdf.getPage(pageNumber);
      try {
        const viewport = page.getViewport({ scale: Math.min(Math.max(Number(scale) || 1.2, 0.5), 3) });
        const outputScale = Math.min(Math.max(Number(globalThis.devicePixelRatio) || 1, 1), 2);
        const context = canvas.getContext('2d', { alpha: false });
        if (!context) throw new Error('Canvas 2D indisponível.');

        canvas.width = Math.max(1, Math.floor(viewport.width * outputScale));
        canvas.height = Math.max(1, Math.floor(viewport.height * outputScale));
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;

        await page.render({
          canvasContext: context,
          viewport,
          transform: outputScale === 1 ? null : [outputScale, 0, 0, outputScale, 0, 0]
        }).promise;
      } finally {
        page.cleanup();
      }
    },
    async destroy() {
      if (destroyed) return;
      destroyed = true;
      try { await pdf.cleanup(); } catch {}
      try { await loadingTask.destroy(); } catch {}
    }
  };
}
