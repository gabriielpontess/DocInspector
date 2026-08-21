import { normalize, normalizeCode } from './domain.js';

export const CONFIDENTIAL_PDF_MATCH = Object.freeze({
  EXACT: 'exact',
  SUGGESTED: 'suggested',
  UNLINKED: 'unlinked'
});

function stripPdfExtension(value) {
  return String(value ?? '').replace(/\.pdf$/i, '');
}

function foldText(value) {
  return normalize(stripPdfExtension(value))
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function codePattern(value) {
  const chunks = normalizeCode(value).match(/[A-Z0-9]+/g) || [];
  if (!chunks.length) return null;
  return new RegExp(`(^|[^A-Z0-9])${chunks.map(escapeRegex).join('[^A-Z0-9]*')}($|[^A-Z0-9])`, 'i');
}

function documentCodeMatches(filename, document) {
  const values = [...new Set([
    normalizeCode(document?.code),
    normalizeCode(document?.sourceCode)
  ].filter(Boolean))];
  return values.some(value => codePattern(value)?.test(filename));
}

function tokenSet(value) {
  return new Set(foldText(value).split(' ').filter(token => token.length >= 3));
}

function descriptionMatches(filenameBase, description) {
  const fileText = foldText(filenameBase);
  const descriptionText = foldText(description);
  if (fileText.length < 4 || descriptionText.length < 6) return false;
  if (fileText === descriptionText || fileText.includes(descriptionText) || descriptionText.includes(fileText)) return true;

  const fileTokens = tokenSet(fileText);
  const descriptionTokens = tokenSet(descriptionText);
  if (fileTokens.size < 2 || descriptionTokens.size < 2) return false;
  let common = 0;
  for (const token of descriptionTokens) if (fileTokens.has(token)) common += 1;
  const overlap = common / Math.min(fileTokens.size, descriptionTokens.size);
  return common >= 2 && overlap >= 0.75;
}

function uniqueDocuments(documents = []) {
  const byId = new Map();
  for (const document of documents) {
    const id = String(document?.id ?? '').trim();
    if (id && !byId.has(id)) byId.set(id, document);
  }
  return [...byId.values()];
}

export function matchConfidentialPdfFile(file, documents = []) {
  const filename = String(file?.name ?? '').trim();
  const filenameBase = stripPdfExtension(filename);
  const candidates = uniqueDocuments(documents);

  const exact = candidates.filter(document => documentCodeMatches(filenameBase, document));
  if (exact.length === 1) {
    return {
      file,
      filename,
      status: CONFIDENTIAL_PDF_MATCH.EXACT,
      documentId: exact[0].id,
      candidateDocumentIds: [exact[0].id],
      reason: 'Código PW exato e único no nome do arquivo.'
    };
  }
  if (exact.length > 1) {
    return {
      file,
      filename,
      status: CONFIDENTIAL_PDF_MATCH.UNLINKED,
      documentId: null,
      candidateDocumentIds: exact.map(document => document.id),
      reason: 'Código PW ambíguo: mais de um documento corresponde ao nome do arquivo.'
    };
  }

  const suggested = candidates.filter(document => descriptionMatches(filenameBase, document?.description));
  if (suggested.length === 1) {
    return {
      file,
      filename,
      status: CONFIDENTIAL_PDF_MATCH.SUGGESTED,
      documentId: suggested[0].id,
      candidateDocumentIds: [suggested[0].id],
      reason: 'Sugestão por nome/descrição; requer revisão humana.'
    };
  }

  return {
    file,
    filename,
    status: CONFIDENTIAL_PDF_MATCH.UNLINKED,
    documentId: null,
    candidateDocumentIds: suggested.map(document => document.id),
    reason: suggested.length > 1
      ? 'Nome/descrição ambíguos: selecione o documento manualmente.'
      : 'Nenhuma correspondência clara encontrada.'
  };
}

export function matchConfidentialPdfBatch(files = [], documents = []) {
  return [...files].map(file => matchConfidentialPdfFile(file, documents));
}
