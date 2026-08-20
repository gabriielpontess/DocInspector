import { getAuthClient } from './auth.js';
import { getAuthContext } from './auth-context.js';
import {
  CONFIDENTIAL_PDF_BUCKET,
  buildConfidentialObjectPath,
  decryptConfidentialPdf
} from './confidential-storage.js';
import {
  cacheConfidentialCiphertext,
  getCachedConfidentialCiphertext
} from './confidential-offline.js';

export const PDFJS_VERSION = '6.2.108';
export const PDFJS_MODULE_URL = new URL('../vendor/pdfjs/pdf.min.mjs', import.meta.url).href;
export const PDFJS_WORKER_URL = new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
let pdfjsPromise = null;

function uuid(value, label) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!UUID_RE.test(normalized)) throw new Error(`${label} inválido.`);
  return normalized;
}

function asBytes(value, label = 'PDF') {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  throw new TypeError(`${label} deve ser binário.`);
}

function validateDocument(document) {
  if (!document || document.crypto_version !== 'DIPDF1') throw new Error('Documento confidencial incompatível.');
  if (document.status && document.status !== 'ACTIVE') throw new Error('O PDF confidencial não está ativo.');
  const workspaceId = uuid(document.workspace_id, 'workspaceId');
  const inspectionId = uuid(document.inspection_id, 'inspectionId');
  const fileId = uuid(document.id, 'fileId');
  const expectedPath = buildConfidentialObjectPath({ workspaceId, inspectionId, fileId });
  if (String(document.object_path ?? '') !== expectedPath) throw new Error('Path confidencial inconsistente.');
  return { workspaceId, inspectionId, fileId };
}

function assertOnlineWorkspace(workspaceId) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error('Sem conexão para baixar o ciphertext confidencial.');
  const context = getAuthContext();
  if (!context?.userId || uuid(context.workspaceId, 'workspaceId') !== workspaceId) {
    throw new Error('Sessão autenticada incompatível com o workspace do PDF.');
  }
}

export async function loadPinnedPdfJs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import(PDFJS_MODULE_URL).then(pdfjs => {
      if (String(pdfjs.version) !== PDFJS_VERSION) {
        throw new Error(`Versão PDF.js inesperada: ${pdfjs.version || 'desconhecida'}.`);
      }
      if (!pdfjs.GlobalWorkerOptions) throw new Error('PDF.js não expôs configuração do worker.');
      pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
      return pdfjs;
    }).catch(error => {
      pdfjsPromise = null;
      throw error;
    });
  }
  return pdfjsPromise;
}

export async function downloadConfidentialCiphertext(document) {
  const ids = validateDocument(document);
  assertOnlineWorkspace(ids.workspaceId);
  const response = await getAuthClient()
    .storage
    .from(CONFIDENTIAL_PDF_BUCKET)
    .download(document.object_path);
  if (response.error || !response.data) throw new Error('Não foi possível baixar o ciphertext do PDF confidencial.');
  return new Uint8Array(await response.data.arrayBuffer());
}

export async function resolveConfidentialCiphertext(document, { preferCache = true } = {}) {
  const ids = validateDocument(document);
  let onlineError = null;

  if (typeof navigator === 'undefined' || navigator.onLine !== false) {
    try {
      const container = await downloadConfidentialCiphertext(document);
      await cacheConfidentialCiphertext({ document, container });
      return { container, source: 'network' };
    } catch (error) {
      onlineError = error;
      if (!preferCache) throw error;
    }
  }

  const cached = await getCachedConfidentialCiphertext(ids);
  if (cached?.container) return { container: cached.container, source: 'offline-cache' };
  throw onlineError || new Error('Este PDF confidencial ainda não está disponível offline neste aparelho.');
}

export async function createConfidentialPdfViewer({ plaintext, pdfjs = null, maxPages = 500 } = {}) {
  const source = asBytes(plaintext);
  if (source.byteLength < 5 || new TextDecoder().decode(source.subarray(0, 5)) !== '%PDF-') {
    throw new Error('O plaintext de visualização não é um PDF válido.');
  }
  const library = pdfjs || await loadPinnedPdfJs();
  const pdfData = source.slice();
  const loadingTask = library.getDocument({
    data: pdfData,
    isEvalSupported: false,
    enableXfa: false,
    useSystemFonts: true,
    verbosity: 0
  });
  let pdf;
  try {
    pdf = await loadingTask.promise;
  } catch (error) {
    try { pdfData.fill(0); } catch {}
    await loadingTask.destroy().catch(() => {});
    throw error;
  }
  if (!Number.isInteger(pdf.numPages) || pdf.numPages < 1 || pdf.numPages > maxPages) {
    await loadingTask.destroy().catch(() => {});
    try { pdfData.fill(0); } catch {}
    throw new Error('Quantidade de páginas do PDF confidencial não suportada.');
  }

  let destroyed = false;
  return {
    numPages: pdf.numPages,
    async renderPage({ pageNumber, canvas, scale = 1.25 } = {}) {
      if (destroyed) throw new Error('Viewer confidencial já foi encerrado.');
      if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > pdf.numPages) throw new Error('Página inválida.');
      if (!canvas?.getContext) throw new Error('Canvas de visualização inválido.');
      const page = await pdf.getPage(pageNumber);
      try {
        const viewport = page.getViewport({ scale: Number(scale) > 0 ? Number(scale) : 1.25 });
        const outputScale = Math.min(Math.max(Number(globalThis.devicePixelRatio) || 1, 1), 2);
        const context = canvas.getContext('2d', { alpha: false });
        if (!context) throw new Error('Canvas 2D indisponível.');
        canvas.width = Math.max(1, Math.floor(viewport.width * outputScale));
        canvas.height = Math.max(1, Math.floor(viewport.height * outputScale));
        if (canvas.style) {
          canvas.style.width = `${Math.floor(viewport.width)}px`;
          canvas.style.height = `${Math.floor(viewport.height)}px`;
        }
        await page.render({
          canvasContext: context,
          viewport,
          transform: outputScale === 1 ? null : [outputScale, 0, 0, outputScale, 0, 0]
        }).promise;
        return { width: viewport.width, height: viewport.height };
      } finally {
        page.cleanup();
      }
    },
    async destroy() {
      if (destroyed) return;
      destroyed = true;
      try { await pdf.cleanup(); } catch {}
      try { await loadingTask.destroy(); } catch {}
      try { pdfData.fill(0); } catch {}
    }
  };
}

export async function openConfidentialPdfForViewer({ document, workspaceKey, preferCache = true, pdfjs = null } = {}) {
  const resolved = await resolveConfidentialCiphertext(document, { preferCache });
  const decrypted = await decryptConfidentialPdf({
    container: resolved.container,
    document,
    workspaceKey
  });
  try {
    const viewer = await createConfidentialPdfViewer({ plaintext: decrypted.plaintext, pdfjs });
    return {
      viewer,
      metadata: decrypted.metadata,
      source: resolved.source
    };
  } finally {
    try { decrypted.plaintext.fill(0); } catch {}
  }
}

export function resetPinnedPdfJsForTests() {
  pdfjsPromise = null;
}
