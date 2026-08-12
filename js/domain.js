export const RESULT = Object.freeze({
  PENDING: 'Pendente',
  CONFORMING: 'Conforme',
  NONCONFORMING: 'Não conforme',
  NOT_FOUND: 'Não encontrado'
});

export const MARKING = Object.freeze({
  YELLOW: 'Amarelo',
  RED: 'Vermelho',
  BLUE: 'Azul',
  GREEN: 'Verde',
  ORANGE: 'Laranja',
  OTHER: 'Outra'
});

const VALID_RESULTS = new Set(Object.values(RESULT));
const VALID_MARKINGS = new Set(Object.values(MARKING));

export function normalize(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

export function normalizeCode(value) {
  return normalize(value).toUpperCase();
}

export function codeIdentity(value) {
  return normalizeCode(value).replace(/[^A-Z0-9]/g, '');
}

export function normalizeRevision(value) {
  return normalize(value).toUpperCase();
}

export function createId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error('Este navegador não oferece um gerador criptográfico seguro para criar identificadores.');
  }

  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function createInspection(meta) {
  const now = new Date().toISOString();
  return {
    id: createId(),
    name: normalize(meta.name) || normalize(meta.project),
    project: normalize(meta.project),
    system: normalize(meta.system),
    responsible: normalize(meta.responsible),
    location: normalize(meta.location),
    createdAt: now,
    updatedAt: now,
    documents: []
  };
}

export function makeDocument(row) {
  return {
    id: createId(),
    code: normalizeCode(row.code),
    description: normalize(row.description),
    status: normalize(row.status),
    expectedRevision: normalizeRevision(row.expectedRevision),
    foundRevision: '',
    copyCount: null,
    fieldCopies: [],
    deletedCopyIds: [],
    result: RESULT.PENDING,
    comment: '',
    verifiedAt: null
  };
}

function sanitizeResult(value) {
  return VALID_RESULTS.has(value) ? value : RESULT.PENDING;
}

function sanitizeMarkings(markings) {
  if (!Array.isArray(markings)) return [];
  return [...new Set(markings.map(normalize).filter(value => VALID_MARKINGS.has(value)))];
}

export function hydrateFieldCopy(copy = {}, index = 0) {
  const capturedAt = normalize(copy.capturedAt) || normalize(copy.updatedAt) || new Date().toISOString();
  return {
    id: normalize(copy.id) || createId(),
    sequence: Number.isInteger(Number(copy.sequence)) && Number(copy.sequence) > 0 ? Number(copy.sequence) : index + 1,
    foundRevision: normalizeRevision(copy.foundRevision ?? copy.confirmedRevision ?? copy.detectedRevision),
    markings: sanitizeMarkings(copy.markings),
    comment: normalize(copy.comment),
    source: ['camera', 'manual', 'legacy'].includes(copy.source) ? copy.source : 'manual',
    evidenceId: normalize(copy.evidenceId) || null,
    evidencePath: normalize(copy.evidencePath) || null,
    evidenceSyncedAt: normalize(copy.evidenceSyncedAt) || null,
    photoName: normalize(copy.photoName) || null,
    capturedAt,
    updatedAt: normalize(copy.updatedAt) || capturedAt,
    recognition: {
      detectedCode: normalizeCode(copy.recognition?.detectedCode),
      detectedRevision: normalizeRevision(copy.recognition?.detectedRevision),
      codeCandidates: Array.isArray(copy.recognition?.codeCandidates)
        ? copy.recognition.codeCandidates.map(normalizeCode).filter(Boolean).slice(0, 8)
        : [],
      exactCodeMatch: copy.recognition?.exactCodeMatch === true,
      text: normalize(copy.recognition?.text),
      confidence: Number.isFinite(Number(copy.recognition?.confidence)) ? Number(copy.recognition.confidence) : null,
      regions: Array.isArray(copy.recognition?.regions)
        ? copy.recognition.regions.slice(0, 8).map(region => ({
            region: normalize(region?.region),
            confidence: Number.isFinite(Number(region?.confidence)) ? Number(region.confidence) : null
          })).filter(region => region.region)
        : [],
      colorConfidence: copy.recognition?.colorConfidence && typeof copy.recognition.colorConfidence === 'object'
        ? { ...copy.recognition.colorConfidence }
        : {}
    },
    confirmed: copy.confirmed !== false
  };
}

function legacyCopies(document, result) {
  if (![RESULT.CONFORMING, RESULT.NONCONFORMING].includes(result)) return [];
  const count = Math.min(9999, Math.max(1, Number.parseInt(document.copyCount, 10) || 1));
  const at = normalize(document.verifiedAt) || new Date().toISOString();
  return Array.from({ length: count }, (_, index) => hydrateFieldCopy({
    id: `${normalize(document.id) || 'documento'}-legacy-${index + 1}`,
    sequence: index + 1,
    foundRevision: document.foundRevision,
    comment: index === 0 ? document.comment : '',
    source: 'legacy',
    capturedAt: at,
    updatedAt: at,
    confirmed: true
  }, index));
}

export function recalculateDocument(document) {
  const deleted = new Set(Array.isArray(document.deletedCopyIds) ? document.deletedCopyIds.map(normalize).filter(Boolean) : []);
  document.deletedCopyIds = [...deleted].slice(-10000);
  document.fieldCopies = (document.fieldCopies || []).filter(copy => !deleted.has(copy.id));
  const confirmed = document.fieldCopies.filter(copy => copy.confirmed !== false);
  confirmed.forEach((copy, index) => { copy.sequence = index + 1; });

  if (confirmed.length) {
    const revisions = [...new Set(confirmed.map(copy => normalizeRevision(copy.foundRevision)).filter(Boolean))];
    document.copyCount = confirmed.length;
    document.foundRevision = revisions.join(' / ');
    document.result = confirmed.every(copy => normalizeRevision(copy.foundRevision) === normalizeRevision(document.expectedRevision))
      ? RESULT.CONFORMING
      : RESULT.NONCONFORMING;
    document.verifiedAt = confirmed
      .map(copy => copy.capturedAt)
      .filter(Boolean)
      .sort()
      .at(-1) || new Date().toISOString();
    return document;
  }

  if (document.result === RESULT.NOT_FOUND) {
    document.copyCount = 0;
    document.foundRevision = '';
    document.verifiedAt ||= new Date().toISOString();
    return document;
  }

  document.copyCount = null;
  document.foundRevision = '';
  document.result = RESULT.PENDING;
  document.verifiedAt = null;
  return document;
}

export function hydrateDocument(document = {}) {
  const originalResult = sanitizeResult(document.result);
  const rawCopies = Array.isArray(document.fieldCopies) ? document.fieldCopies : legacyCopies(document, originalResult);
  const fieldCopies = rawCopies.map(hydrateFieldCopy).filter(copy => copy.foundRevision);

  const hydrated = {
    id: normalize(document.id) || createId(),
    code: normalizeCode(document.code),
    description: normalize(document.description),
    status: normalize(document.status),
    expectedRevision: normalizeRevision(document.expectedRevision),
    foundRevision: originalResult === RESULT.NOT_FOUND ? '' : normalizeRevision(document.foundRevision),
    copyCount: originalResult === RESULT.NOT_FOUND ? 0 : null,
    fieldCopies,
    deletedCopyIds: Array.isArray(document.deletedCopyIds)
      ? [...new Set(document.deletedCopyIds.map(normalize).filter(Boolean))].slice(-10000)
      : [],
    result: originalResult,
    comment: normalize(document.comment),
    verifiedAt: originalResult === RESULT.PENDING ? null : normalize(document.verifiedAt) || null
  };

  return recalculateDocument(hydrated);
}

export function hydrateInspection(inspection) {
  if (!inspection || typeof inspection !== 'object') return null;

  const documents = Array.isArray(inspection.documents)
    ? inspection.documents.map(hydrateDocument).filter(document => document.code)
    : [];

  return {
    id: normalize(inspection.id) || createId(),
    name: normalize(inspection.name) || normalize(inspection.project),
    project: normalize(inspection.project),
    system: normalize(inspection.system),
    responsible: normalize(inspection.responsible),
    location: normalize(inspection.location),
    createdAt: normalize(inspection.createdAt) || new Date().toISOString(),
    updatedAt: normalize(inspection.updatedAt) || normalize(inspection.createdAt) || new Date().toISOString(),
    documents
  };
}

export function validateInspection(inspection) {
  if (!inspection || typeof inspection !== 'object' || !Array.isArray(inspection.documents)) {
    throw new Error('Inspeção inválida.');
  }
  const originalDocumentCount = inspection.documents.length;
  const normalized = hydrateInspection(inspection);
  if (!normalized) throw new Error('Inspeção inválida.');
  if (!normalized.project || !normalized.system || !normalized.responsible) {
    throw new Error('A inspeção não possui projeto, sistema ou responsável válido.');
  }
  if (!normalized.documents.length) throw new Error('A inspeção não possui documentos válidos.');
  if (normalized.documents.length !== originalDocumentCount) {
    throw new Error('A inspeção contém documentos sem Código PW válido. A restauração foi cancelada para evitar perda silenciosa de dados.');
  }

  const codes = new Set();
  const identities = new Map();
  for (const document of normalized.documents) {
    if (codes.has(document.code)) throw new Error(`Código PW duplicado no backup: ${document.code}`);
    codes.add(document.code);
    const identity = codeIdentity(document.code);
    const previous = identities.get(identity);
    if (identity && previous && previous !== document.code) {
      throw new Error(`Códigos PW ambíguos para leitura fotográfica: ${previous} e ${document.code}. Diferencie os códigos na lista antes de continuar.`);
    }
    if (identity) identities.set(identity, document.code);
  }
  return normalized;
}

export function addFieldCopy(document, data = {}) {
  if (!document) throw new Error('Nenhum documento selecionado.');
  const revision = normalizeRevision(data.foundRevision);
  if (!revision) throw new Error('Informe ou confirme a revisão encontrada.');

  if (!Array.isArray(document.fieldCopies)) document.fieldCopies = [];
  if (document.fieldCopies.length >= 9999) throw new Error('O limite de 9.999 cópias foi atingido para este documento.');

  const now = new Date().toISOString();
  const copy = hydrateFieldCopy({
    id: data.id || createId(),
    sequence: document.fieldCopies.length + 1,
    foundRevision: revision,
    markings: data.markings,
    comment: data.comment,
    source: data.source || 'manual',
    evidenceId: data.evidenceId,
    evidencePath: data.evidencePath,
    evidenceSyncedAt: data.evidenceSyncedAt,
    photoName: data.photoName,
    capturedAt: data.capturedAt || now,
    updatedAt: now,
    recognition: data.recognition,
    confirmed: true
  }, document.fieldCopies.length);

  document.deletedCopyIds = (document.deletedCopyIds || []).filter(id => id !== copy.id);
  document.fieldCopies.push(copy);
  document.comment = normalize(data.documentComment ?? document.comment);
  if (document.result === RESULT.NOT_FOUND) document.result = RESULT.PENDING;
  recalculateDocument(document);
  return copy;
}

export function removeFieldCopy(document, copyId, { tombstone = true } = {}) {
  if (!document || !copyId) return false;
  const index = (document.fieldCopies || []).findIndex(copy => copy.id === copyId);
  if (index < 0) return false;
  document.fieldCopies.splice(index, 1);
  if (tombstone) {
    document.deletedCopyIds = [...new Set([...(document.deletedCopyIds || []), normalize(copyId)])].filter(Boolean).slice(-10000);
  }
  if (!document.fieldCopies.length && document.result !== RESULT.NOT_FOUND) document.result = RESULT.PENDING;
  recalculateDocument(document);
  return true;
}

// Compatibilidade com o fluxo legado: registra N cópias manuais de uma única vez.
export function verifyDocument(document, foundRevision, copyCount, comment = '') {
  if (!document) throw new Error('Nenhum documento selecionado.');
  const revision = normalizeRevision(foundRevision);
  const copies = Number(copyCount);
  if (!revision) throw new Error('Informe a revisão encontrada.');
  if (!Number.isInteger(copies) || copies < 1 || copies > 9999) {
    throw new Error('Informe uma quantidade de cópias entre 1 e 9.999.');
  }

  document.fieldCopies = [];
  for (let index = 0; index < copies; index += 1) {
    addFieldCopy(document, { foundRevision: revision, comment: index === 0 ? comment : '', source: 'manual' });
  }
  document.comment = normalize(comment);
  return recalculateDocument(document);
}

export function markNotFound(document, comment = '') {
  if (!document) throw new Error('Nenhum documento selecionado.');
  if ((document.fieldCopies || []).length) {
    throw new Error('Este documento já possui cópias confirmadas. Remova as cópias registradas antes de marcá-lo como não encontrado.');
  }
  document.fieldCopies = [];
  document.foundRevision = '';
  document.copyCount = 0;
  document.result = RESULT.NOT_FOUND;
  document.comment = normalize(comment);
  document.verifiedAt = new Date().toISOString();
  return document;
}

export function documentMarkings(document) {
  return [...new Set((document?.fieldCopies || []).flatMap(copy => copy.markings || []))];
}

export function metrics(documents = []) {
  const total = documents.length;
  const conforming = documents.filter(document => document.result === RESULT.CONFORMING).length;
  const nonconforming = documents.filter(document => document.result === RESULT.NONCONFORMING).length;
  const notFound = documents.filter(document => document.result === RESULT.NOT_FOUND).length;
  const verified = conforming + nonconforming;
  const pending = Math.max(0, total - verified - notFound);
  return { total, verified, conforming, nonconforming, notFound, pending };
}
