import { codeIdentity, normalizeCode, normalizeRevision } from './domain.js';

const MAX_IMAGE_DIMENSION = 1800;
const JPEG_QUALITY = 0.84;

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Não foi possível abrir a imagem selecionada.'));
    };
    image.src = url;
  });
}

function scaledSize(width, height, maxDimension = MAX_IMAGE_DIMENSION) {
  const scale = Math.min(1, maxDimension / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

function canvasToBlob(canvas, type = 'image/jpeg', quality = JPEG_QUALITY) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Não foi possível preparar a fotografia.')), type, quality);
  });
}

export async function prepareEvidenceImage(file) {
  if (!(file instanceof File) || !file.type.startsWith('image/')) throw new Error('Selecione uma fotografia válida.');
  if (file.size > 25 * 1024 * 1024) throw new Error('A fotografia excede o limite de 25 MB.');

  const image = await loadImage(file);
  const size = scaledSize(image.naturalWidth, image.naturalHeight);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
  context.fillStyle = '#fff';
  context.fillRect(0, 0, size.width, size.height);
  context.drawImage(image, 0, 0, size.width, size.height);
  const blob = await canvasToBlob(canvas);
  return { blob, canvas, width: size.width, height: size.height };
}

function rgbToHsv(r, g, b) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  let h = 0;
  if (delta) {
    if (max === rn) h = 60 * (((gn - bn) / delta) % 6);
    else if (max === gn) h = 60 * (((bn - rn) / delta) + 2);
    else h = 60 * (((rn - gn) / delta) + 4);
  }
  if (h < 0) h += 360;
  const s = max === 0 ? 0 : delta / max;
  return { h, s, v: max };
}

export function detectMarkingColors(canvas) {
  const sample = document.createElement('canvas');
  const targetWidth = Math.min(640, canvas.width);
  const scale = targetWidth / canvas.width;
  sample.width = targetWidth;
  sample.height = Math.max(1, Math.round(canvas.height * scale));
  const ctx = sample.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(canvas, 0, 0, sample.width, sample.height);
  const { data } = ctx.getImageData(0, 0, sample.width, sample.height);

  const counts = { Amarelo: 0, Vermelho: 0, Azul: 0, Verde: 0, Laranja: 0 };
  let considered = 0;
  for (let index = 0; index < data.length; index += 16) {
    const { h, s, v } = rgbToHsv(data[index], data[index + 1], data[index + 2]);
    if (s < 0.38 || v < 0.25 || v > 0.98) continue;
    considered += 1;
    if (h <= 14 || h >= 346) counts.Vermelho += 1;
    else if (h >= 38 && h <= 68) counts.Amarelo += 1;
    else if (h > 14 && h < 38) counts.Laranja += 1;
    else if (h >= 82 && h <= 160) counts.Verde += 1;
    else if (h >= 190 && h <= 250) counts.Azul += 1;
  }

  const denominator = Math.max(1, considered);
  const confidence = Object.fromEntries(Object.entries(counts).map(([name, count]) => [name, count / denominator]));
  const markings = Object.entries(confidence)
    .filter(([, ratio]) => ratio >= 0.012)
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name);
  return { markings, confidence };
}

export function compactCode(value) {
  return codeIdentity(value);
}

export function codesEquivalent(left, right) {
  const a = compactCode(left);
  const b = compactCode(right);
  return Boolean(a && b && a === b);
}

function cleanDetectedCode(value) {
  return normalizeCode(value)
    .replace(/^[^A-Z0-9]+|[^A-Z0-9]+$/g, '')
    .replace(/\s*([.\-\/])\s*/g, '$1')
    .replace(/\s+/g, ' ');
}

function candidateScore(value, labeled = false) {
  const compact = compactCode(value);
  const separators = (value.match(/[.\-\/]/g) || []).length;
  const digits = (compact.match(/\d/g) || []).length;
  const letters = (compact.match(/[A-Z]/g) || []).length;
  return (labeled ? 100 : 0) + Math.min(40, compact.length) + separators * 5 + Math.min(12, digits) + Math.min(5, letters);
}

/**
 * Extrai o que o OCR realmente leu. Esta função não consulta a lista importada
 * e nunca altera caracteres para aproximar o código de um documento existente.
 */
export function extractCodeCandidates(text) {
  const normalized = normalizeCode(text)
    .replace(/[“”"'`]/g, ' ')
    .replace(/[–—−]/g, '-')
    .replace(/\\/g, '/')
    .replace(/[ \t]+/g, ' ');

  const candidates = [];
  const seen = new Set();
  const add = (raw, labeled = false) => {
    const value = cleanDetectedCode(raw);
    const compact = compactCode(value);
    if (compact.length < 8 || compact.length > 48) return;
    const separatorCount = (value.match(/[.\-\/]/g) || []).length;
    if ((!labeled && separatorCount < 2) || (labeled && separatorCount < 1 && compact.length < 10)) return;
    if (!/\d/.test(compact)) return;
    if (seen.has(compact)) return;
    seen.add(compact);
    candidates.push({ value, compact, labeled, score: candidateScore(value, labeled) });
  };

  const lines = normalized.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const codePattern = /[A-Z0-9]{1,10}(?:\s*[.\-\/]\s*[A-Z0-9]{1,12}){2,}/g;

  for (const line of lines) {
    const label = line.match(/\b(?:CODIGO|CÓDIGO|CODE|PW)\b\s*[:#.-]?\s*(.*)$/i);
    if (label?.[1]) {
      const matches = label[1].match(codePattern) || [];
      matches.forEach(value => add(value, true));
      // Alguns OCRs removem pontuação do código. Aceitamos o token contínuo
      // somente quando ele está explicitamente após o rótulo Código/PW; a
      // validação contra a lista continua sendo estritamente alfanumérica.
      const compactLabel = label[1].match(/[A-Z0-9][A-Z0-9.\/-]{7,}/g) || [];
      compactLabel.forEach(value => add(value, true));
    }
  }

  for (const line of lines) {
    const matches = line.match(codePattern) || [];
    matches.forEach(value => add(value, false));
  }

  return candidates.sort((a, b) => b.score - a.score || b.value.length - a.value.length);
}

/**
 * Faz somente correspondência exata dos caracteres alfanuméricos. Diferenças
 * de pontuação (por exemplo '/' lido como '-') são toleradas, mas 12 jamais é
 * convertido para 02, B para 8, O para 0 etc. para “caber” na lista.
 */
export function analyzeDocumentFromText(text, documents = []) {
  const candidates = extractCodeCandidates(text);
  const detectedCode = candidates[0]?.value || '';
  if (!detectedCode) {
    return { document: null, detectedCode: '', confidence: 0, exact: false, candidates: [] };
  }

  for (const candidate of candidates) {
    const matches = documents.filter(item => codesEquivalent(item.code, candidate.value));
    if (matches.length === 1) {
      return {
        document: matches[0],
        detectedCode: candidate.value,
        confidence: 1,
        exact: true,
        ambiguous: false,
        candidates: candidates.map(item => item.value)
      };
    }
    if (matches.length > 1) {
      return {
        document: null,
        detectedCode: candidate.value,
        confidence: 0,
        exact: false,
        ambiguous: true,
        candidates: candidates.map(item => item.value)
      };
    }
  }

  return {
    document: null,
    detectedCode,
    confidence: 0,
    exact: false,
    ambiguous: false,
    candidates: candidates.map(item => item.value)
  };
}

// Compatibilidade interna: somente retorna resultado quando a correspondência é exata.
export function identifyDocumentFromText(text, documents = []) {
  const analysis = analyzeDocumentFromText(text, documents);
  return analysis.document ? analysis : null;
}

const REVISION_STOPWORDS = new Set([
  'DE', 'DA', 'DO', 'DAS', 'DOS', 'EM', 'PARA', 'POR', 'PROJETO', 'PROJECT',
  'REV', 'REVISAO', 'REVISION', 'DATA', 'DATE', 'DESCRICAO', 'DESCRIPTION',
  'DESENHO', 'DRAWING', 'FOLHA', 'SHEET', 'ESCALA', 'SCALE'
]);

function revisionToken(value) {
  return normalizeRevision(value)
    .replace(/^[^A-Z0-9]+|[^A-Z0-9]+$/g, '')
    .replace(/[|]/g, 'I');
}

function isPlausibleRevision(value) {
  const token = revisionToken(value);
  if (!token || REVISION_STOPWORDS.has(token) || token.length > 4) return false;
  return /^(?:[A-Z]{1,2}|[A-Z]{1,2}\d{1,2}|\d{1,3})$/.test(token);
}

export function detectRevisionFromText(text, _expectedRevision = '') {
  const normalized = normalizeCode(text)
    .replace(/REVISÃO/g, 'REVISAO')
    .replace(/[“”"'`]/g, ' ')
    .replace(/[ \t]+/g, ' ');

  const lines = normalized.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const labelPattern = /\b(?:REV(?:ISAO|ISION)?|REV\.?)\b\s*[:\-#.]?\s*(.*)$/;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const match = line.match(labelPattern);
    if (!match) continue;

    let tokens = String(match[1] || '')
      .split(/\s+/)
      .slice(0, 6)
      .map(revisionToken)
      .filter(Boolean);

    // Em carimbos técnicos estreitos, o OCR pode separar “Rev.” e o valor
    // em linhas consecutivas. Só consulta a linha imediatamente seguinte.
    if (!tokens.length && lines[lineIndex + 1]) {
      tokens = lines[lineIndex + 1]
        .split(/\s+/)
        .slice(0, 3)
        .map(revisionToken)
        .filter(Boolean);
    }

    const candidate = tokens.find(isPlausibleRevision);
    if (candidate) return candidate;
  }

  const compactMatches = [...normalized.matchAll(/\b(?:REV|R)\s*[:\-.]\s*([A-Z0-9]{1,4})\b/g)];
  for (const match of compactMatches) {
    const candidate = revisionToken(match[1]);
    if (isPlausibleRevision(candidate)) return candidate;
  }

  // Nunca usamos a revisão esperada para completar ou corrigir o OCR. Isso
  // evita enviesar a inspeção para “Conforme”. Sem leitura segura, fica vazio.
  return '';
}

function cropCanvas(source, { x = 0, y = 0, width = 1, height = 1, scale = 1.8, threshold = false } = {}) {
  const sx = Math.max(0, Math.floor(source.width * x));
  const sy = Math.max(0, Math.floor(source.height * y));
  const sw = Math.max(1, Math.min(source.width - sx, Math.floor(source.width * width)));
  const sh = Math.max(1, Math.min(source.height - sy, Math.floor(source.height * height)));
  const maxSide = 2400;
  const requested = Math.max(1, scale);
  const applied = Math.min(requested, maxSide / Math.max(sw, sh));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(sw * applied));
  canvas.height = Math.max(1, Math.round(sh * applied));
  const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);

  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = image.data;
  let min = 255;
  let max = 0;
  for (let i = 0; i < data.length; i += 16) {
    const gray = Math.round(data[i] * .299 + data[i + 1] * .587 + data[i + 2] * .114);
    min = Math.min(min, gray);
    max = Math.max(max, gray);
  }
  const range = Math.max(32, max - min);
  for (let i = 0; i < data.length; i += 4) {
    const gray = Math.round(data[i] * .299 + data[i + 1] * .587 + data[i + 2] * .114);
    let value = Math.max(0, Math.min(255, ((gray - min) * 255) / range));
    value = Math.max(0, Math.min(255, (value - 128) * 1.24 + 128));
    if (threshold) value = value < 174 ? 0 : 255;
    data[i] = data[i + 1] = data[i + 2] = value;
    data[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

async function createOcrWorker(onProgress = null) {
  if (!globalThis.Tesseract?.createWorker) {
    throw new Error('O módulo de reconhecimento de texto ainda não foi carregado. Conecte-se à internet e recarregue o aplicativo uma vez.');
  }
  return globalThis.Tesseract.createWorker('eng', 1, {
    logger: event => {
      if (typeof onProgress === 'function' && event?.status) onProgress(event);
    }
  });
}

export async function prepareOcrRuntime(onProgress = null) {
  const worker = await createOcrWorker(onProgress);
  try {
    // A criação do worker carrega o núcleo e o idioma necessários ao OCR.
    // Executar esta preparação online reduz dependências descobertas apenas em campo.
    return true;
  } finally {
    await worker.terminate().catch(() => {});
  }
}

async function recognizeCanvas(worker, canvas, parameters = null) {
  if (parameters && typeof worker.setParameters === 'function') {
    await worker.setParameters(parameters);
  }
  const result = await worker.recognize(canvas);
  return {
    text: String(result?.data?.text || '').slice(0, 16000),
    confidence: Number.isFinite(Number(result?.data?.confidence)) ? Number(result.data.confidence) / 100 : null
  };
}

function mergeOcr(parts) {
  const valid = parts.filter(part => part?.text);
  const text = valid.map(part => `\n[${part.region}]\n${part.text}`).join('\n').slice(0, 30000);
  const confidences = valid.map(part => part.confidence).filter(Number.isFinite);
  return {
    text,
    confidence: confidences.length ? confidences.reduce((a, b) => a + b, 0) / confidences.length : null,
    regions: valid.map(part => ({ region: part.region, text: part.text, confidence: part.confidence }))
  };
}

/**
 * OCR em múltiplas passagens para desenhos de engenharia. A ordem privilegia a
 * legenda/carimbo inferior, onde Código e Rev. normalmente ficam impressos.
 * A lista importada só é usada para validar correspondência exata; jamais para
 * trocar caracteres lidos pela câmera.
 */
export async function recognizeEngineeringDrawing(canvas, documents = [], onProgress = null) {
  const worker = await createOcrWorker(onProgress);
  const parts = [];
  try {
    const regions = [
      { region: 'legenda-inferior', canvas: cropCanvas(canvas, { x: 0.10, y: 0.58, width: 0.90, height: 0.42, scale: 2.2 }) },
      { region: 'legenda-inferior-binaria', canvas: cropCanvas(canvas, { x: 0.10, y: 0.58, width: 0.90, height: 0.42, scale: 2.2, threshold: true }) },
      { region: 'imagem-completa', canvas: cropCanvas(canvas, { x: 0, y: 0, width: 1, height: 1, scale: 1.15 }) }
    ];

    for (let index = 0; index < regions.length; index += 1) {
      const region = regions[index];
      if (typeof onProgress === 'function') onProgress({ status: `Analisando ${index + 1}/${regions.length}: ${region.region}`, progress: index / regions.length });
      const result = await recognizeCanvas(worker, region.canvas, {
        preserve_interword_spaces: '1'
      });
      parts.push({ ...result, region: region.region });

      const merged = mergeOcr(parts);
      const analysis = analyzeDocumentFromText(merged.text, documents);
      const revision = detectRevisionFromText(merged.text);
      if (analysis.exact && revision && index >= 1) break;
    }

    let merged = mergeOcr(parts);
    let revision = detectRevisionFromText(merged.text);

    // Se a revisão ainda não estiver segura, executa uma leitura dedicada no
    // canto inferior direito, ampliada e com alfabeto restrito. O resultado só
    // é aceito se vier contextualizado por Rev./Revisão na própria leitura.
    if (!revision) {
      const revisionCanvas = cropCanvas(canvas, { x: 0.62, y: 0.62, width: 0.38, height: 0.38, scale: 3.2, threshold: true });
      const result = await recognizeCanvas(worker, revisionCanvas, {
        preserve_interword_spaces: '1',
        tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.:#- '
      });
      parts.push({ ...result, region: 'revisao-dedicada' });
      merged = mergeOcr(parts);
      revision = detectRevisionFromText(merged.text);
    }

    const analysis = analyzeDocumentFromText(merged.text, documents);
    return { ...merged, analysis, revision };
  } finally {
    await worker.terminate().catch(() => {});
  }
}

// Mantida para compatibilidade e testes unitários simples.
export async function recognizeText(blob, onProgress = null) {
  const worker = await createOcrWorker(onProgress);
  const url = URL.createObjectURL(blob);
  try {
    return await recognizeCanvas(worker, url);
  } finally {
    URL.revokeObjectURL(url);
    await worker.terminate().catch(() => {});
  }
}
