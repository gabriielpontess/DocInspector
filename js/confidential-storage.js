import { getAuthClient } from './auth.js';
import { getAuthContext } from './auth-context.js';
import {
  PDF_CONTAINER_VERSION,
  AES_GCM_IV_BYTES,
  generateFileKeyBytes,
  importAes256Key,
  encryptAesGcm,
  decryptAesGcm,
  encryptFileKeyEnvelope,
  decryptFileKeyEnvelope,
  encryptPdfChunk,
  decryptPdfChunk
} from './confidential-crypto.js';

export const CONFIDENTIAL_PDF_BUCKET = 'docinspector-confidential-pdfs';
export const CONFIDENTIAL_PDF_MIME = 'application/octet-stream';
export const CONFIDENTIAL_PDF_MAX_PLAINTEXT_BYTES = 20 * 1024 * 1024;
export const CONFIDENTIAL_PDF_CHUNK_BYTES = 1024 * 1024;
export const CONFIDENTIAL_PDF_MAX_FILES_PER_INSPECTION = 10;
export const CONFIDENTIAL_PDF_MAX_AGGREGATE_BYTES = 200 * 1024 * 1024;

const MAGIC = new TextEncoder().encode(`${PDF_CONTAINER_VERSION}\n`);
const METADATA_CONTEXT = 'docinspector:pdf-metadata:v1';
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function asBytes(value, label = 'valor') {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  throw new TypeError(`${label} deve ser binário.`);
}

function requireUuid(value, label) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!UUID_RE.test(normalized)) throw new Error(`${label} inválido.`);
  return normalized;
}

function requirePositiveInteger(value, label) {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${label} inválido.`);
  return value;
}

function concatBytes(parts) {
  const arrays = parts.map(part => asBytes(part));
  const total = arrays.reduce((sum, item) => sum + item.byteLength, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const item of arrays) {
    result.set(item, offset);
    offset += item.byteLength;
  }
  return result;
}

function u32(value) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, false);
  return bytes;
}

function base64(bytes) {
  let binary = '';
  for (const byte of asBytes(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value) {
  const binary = atob(String(value ?? ''));
  const result = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) result[i] = binary.charCodeAt(i);
  return result;
}

export function toPostgresBytea(value) {
  return `\\x${[...asBytes(value)].map(byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

export function fromPostgresBytea(value) {
  if (value instanceof Uint8Array || value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return asBytes(value);
  const text = String(value ?? '');
  if (!/^\\x[0-9a-f]*$/i.test(text) || (text.length - 2) % 2 !== 0) {
    throw new Error('bytea PostgreSQL inválido.');
  }
  const result = new Uint8Array((text.length - 2) / 2);
  for (let i = 2, out = 0; i < text.length; i += 2, out += 1) {
    result[out] = Number.parseInt(text.slice(i, i + 2), 16);
  }
  return result;
}

export function buildConfidentialObjectPath({ workspaceId, inspectionId, fileId }) {
  return `${requireUuid(workspaceId, 'workspaceId')}/${requireUuid(inspectionId, 'inspectionId')}/${requireUuid(fileId, 'fileId')}.dipdf`;
}

function assertPdf(plaintext) {
  const bytes = asBytes(plaintext, 'PDF');
  if (bytes.byteLength < 5 || textDecoder.decode(bytes.subarray(0, 5)) !== '%PDF-') {
    throw new Error('O arquivo selecionado não possui assinatura PDF válida.');
  }
  if (bytes.byteLength > CONFIDENTIAL_PDF_MAX_PLAINTEXT_BYTES) {
    throw new Error('O PDF confidencial excede o limite de 20 MiB.');
  }
  return bytes;
}

function metadataAad({ workspaceId, inspectionId, fileId }) {
  return textEncoder.encode(JSON.stringify([
    METADATA_CONTEXT,
    requireUuid(workspaceId, 'workspaceId'),
    requireUuid(inspectionId, 'inspectionId'),
    requireUuid(fileId, 'fileId')
  ]));
}

export function packDipdfContainer(encryptedChunks) {
  if (!Array.isArray(encryptedChunks) || !encryptedChunks.length) {
    throw new Error('DIPDF1 exige ao menos um chunk.');
  }
  const header = {
    version: PDF_CONTAINER_VERSION,
    chunks: encryptedChunks.map(chunk => {
      const iv = asBytes(chunk?.iv, 'IV do chunk');
      const ciphertext = asBytes(chunk?.ciphertext, 'ciphertext do chunk');
      if (iv.byteLength !== AES_GCM_IV_BYTES || ciphertext.byteLength <= 16) {
        throw new Error('Chunk DIPDF1 inválido.');
      }
      return { iv: base64(iv), length: ciphertext.byteLength };
    })
  };
  const headerBytes = textEncoder.encode(JSON.stringify(header));
  return concatBytes([
    MAGIC,
    u32(headerBytes.byteLength),
    headerBytes,
    ...encryptedChunks.map(chunk => asBytes(chunk.ciphertext))
  ]);
}

export function unpackDipdfContainer(container) {
  const bytes = asBytes(container, 'DIPDF1');
  const minimum = MAGIC.byteLength + 4;
  if (bytes.byteLength < minimum) throw new Error('Container DIPDF1 truncado.');
  for (let i = 0; i < MAGIC.byteLength; i += 1) {
    if (bytes[i] !== MAGIC[i]) throw new Error('Formato de PDF confidencial não suportado.');
  }

  const headerLength = new DataView(bytes.buffer, bytes.byteOffset + MAGIC.byteLength, 4).getUint32(0, false);
  const headerStart = minimum;
  const headerEnd = headerStart + headerLength;
  if (headerLength < 2 || headerEnd > bytes.byteLength) throw new Error('Cabeçalho DIPDF1 inválido.');

  let header;
  try {
    header = JSON.parse(textDecoder.decode(bytes.subarray(headerStart, headerEnd)));
  } catch {
    throw new Error('Cabeçalho DIPDF1 corrompido.');
  }
  if (header?.version !== PDF_CONTAINER_VERSION || !Array.isArray(header?.chunks) || !header.chunks.length) {
    throw new Error('Cabeçalho DIPDF1 incompatível.');
  }

  let offset = headerEnd;
  const chunks = header.chunks.map(item => {
    const length = requirePositiveInteger(item?.length, 'tamanho do chunk');
    const end = offset + length;
    if (end > bytes.byteLength) throw new Error('Container DIPDF1 truncado.');
    const iv = fromBase64(item.iv);
    if (iv.byteLength !== AES_GCM_IV_BYTES) throw new Error('IV DIPDF1 inválido.');
    const ciphertext = bytes.slice(offset, end);
    offset = end;
    return { iv, ciphertext };
  });
  if (offset !== bytes.byteLength) throw new Error('Container DIPDF1 contém bytes excedentes.');
  return chunks;
}

async function sha256Hex(value) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', asBytes(value)));
  return [...digest].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function splitFileKeyEnvelope(envelope) {
  const bytes = fromPostgresBytea(envelope);
  if (bytes.byteLength <= AES_GCM_IV_BYTES + 16) throw new Error('Envelope FEK inválido.');
  return {
    iv: bytes.slice(0, AES_GCM_IV_BYTES),
    ciphertext: bytes.slice(AES_GCM_IV_BYTES)
  };
}

function normalizeMetadata(metadata = {}) {
  const filename = String(metadata.filename ?? '').trim();
  const title = String(metadata.title ?? '').trim();
  const description = String(metadata.description ?? '').trim();
  if (!filename) throw new Error('Nome original do PDF é obrigatório.');
  return { filename, title, description };
}

export async function encryptConfidentialPdf({
  plaintext,
  workspaceId,
  inspectionId,
  fileId,
  workspaceKey,
  workspaceKeyVersion,
  metadata
}) {
  const pdf = assertPdf(plaintext);
  const context = {
    workspaceId: requireUuid(workspaceId, 'workspaceId'),
    inspectionId: requireUuid(inspectionId, 'inspectionId'),
    fileId: requireUuid(fileId, 'fileId')
  };
  const keyVersion = requirePositiveInteger(workspaceKeyVersion, 'workspaceKeyVersion');
  const fileKeyBytes = generateFileKeyBytes();
  const fileKey = await importAes256Key(fileKeyBytes);

  try {
    const totalChunks = Math.ceil(pdf.byteLength / CONFIDENTIAL_PDF_CHUNK_BYTES);
    const encryptedChunks = [];
    for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex += 1) {
      const start = chunkIndex * CONFIDENTIAL_PDF_CHUNK_BYTES;
      const end = Math.min(start + CONFIDENTIAL_PDF_CHUNK_BYTES, pdf.byteLength);
      encryptedChunks.push(await encryptPdfChunk(pdf.subarray(start, end), fileKey, {
        ...context,
        chunkIndex,
        totalChunks
      }));
    }

    const fileKeyEnvelope = await encryptFileKeyEnvelope(fileKeyBytes, workspaceKey, {
      workspaceId: context.workspaceId,
      fileId: context.fileId,
      keyVersion
    });
    const encryptedMetadata = await encryptAesGcm(
      textEncoder.encode(JSON.stringify(normalizeMetadata(metadata))),
      fileKey,
      { additionalData: metadataAad(context) }
    );
    const container = packDipdfContainer(encryptedChunks);

    return {
      container,
      document: {
        id: context.fileId,
        workspace_id: context.workspaceId,
        inspection_id: context.inspectionId,
        object_path: buildConfidentialObjectPath(context),
        crypto_version: PDF_CONTAINER_VERSION,
        workspace_key_version: keyVersion,
        wrapped_file_key: toPostgresBytea(concatBytes([fileKeyEnvelope.iv, fileKeyEnvelope.ciphertext])),
        metadata_ciphertext: toPostgresBytea(encryptedMetadata.ciphertext),
        metadata_iv: toPostgresBytea(encryptedMetadata.iv),
        plaintext_size: pdf.byteLength,
        ciphertext_size: container.byteLength,
        chunk_count: totalChunks,
        ciphertext_sha256: await sha256Hex(container)
      }
    };
  } finally {
    fileKeyBytes.fill(0);
  }
}

export async function decryptConfidentialPdf({ container, document, workspaceKey }) {
  if (!document || document.crypto_version !== PDF_CONTAINER_VERSION) {
    throw new Error('Metadados de PDF confidencial incompatíveis.');
  }
  const workspaceId = requireUuid(document.workspace_id, 'workspaceId');
  const inspectionId = requireUuid(document.inspection_id, 'inspectionId');
  const fileId = requireUuid(document.id, 'fileId');
  const keyVersion = requirePositiveInteger(Number(document.workspace_key_version), 'workspaceKeyVersion');
  const encrypted = asBytes(container, 'DIPDF1');

  if (document.ciphertext_sha256) {
    const actual = await sha256Hex(encrypted);
    if (actual !== String(document.ciphertext_sha256).toLowerCase()) {
      throw new Error('A integridade do PDF confidencial não confere.');
    }
  }

  const fileKeyBytes = await decryptFileKeyEnvelope(
    splitFileKeyEnvelope(document.wrapped_file_key),
    workspaceKey,
    { workspaceId, fileId, keyVersion }
  );
  const fileKey = await importAes256Key(fileKeyBytes);

  try {
    const chunks = unpackDipdfContainer(encrypted);
    if (Number(document.chunk_count) !== chunks.length) throw new Error('Quantidade de chunks DIPDF1 divergente.');
    const plaintextChunks = [];
    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
      plaintextChunks.push(await decryptPdfChunk(chunks[chunkIndex], fileKey, {
        workspaceId,
        inspectionId,
        fileId,
        chunkIndex,
        totalChunks: chunks.length
      }));
    }
    const plaintext = concatBytes(plaintextChunks);
    assertPdf(plaintext);
    if (plaintext.byteLength !== Number(document.plaintext_size)) {
      throw new Error('Tamanho plaintext do PDF confidencial divergente.');
    }

    const metadataBytes = await decryptAesGcm({
      iv: fromPostgresBytea(document.metadata_iv),
      ciphertext: fromPostgresBytea(document.metadata_ciphertext)
    }, fileKey, { additionalData: metadataAad({ workspaceId, inspectionId, fileId }) });

    return {
      plaintext,
      metadata: JSON.parse(textDecoder.decode(metadataBytes))
    };
  } finally {
    fileKeyBytes.fill(0);
  }
}

function requireOnlineAuthContext(workspaceId) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new Error('Esta operação remota exige conexão. O conteúdo criptografado pode ser mantido offline pela fila confidencial.');
  }
  const context = getAuthContext();
  if (!context?.userId || !context?.workspaceId) throw new Error('Sessão autenticada não disponível.');
  if (requireUuid(context.workspaceId, 'workspaceId') !== requireUuid(workspaceId, 'workspaceId')) {
    throw new Error('O workspace ativo não corresponde ao PDF confidencial.');
  }
  return context;
}

export async function listConfidentialDocuments({ workspaceId, inspectionId }) {
  requireOnlineAuthContext(workspaceId);
  const client = getAuthClient();
  const { data, error } = await client
    .from('docinspector_project_documents')
    .select('*')
    .eq('workspace_id', requireUuid(workspaceId, 'workspaceId'))
    .eq('inspection_id', requireUuid(inspectionId, 'inspectionId'))
    .eq('status', 'ACTIVE')
    .order('created_at', { ascending: true });
  if (error) throw new Error('Não foi possível listar os PDFs confidenciais.');
  return data || [];
}

export async function uploadConfidentialPdf({
  workspaceId,
  inspectionId,
  plaintext,
  filename,
  title = '',
  description = '',
  workspaceKey,
  workspaceKeyVersion
}) {
  const context = requireOnlineAuthContext(workspaceId);
  const fileId = crypto.randomUUID();
  const encrypted = await encryptConfidentialPdf({
    plaintext,
    workspaceId,
    inspectionId,
    fileId,
    workspaceKey,
    workspaceKeyVersion,
    metadata: { filename, title, description }
  });
  const client = getAuthClient();
  const row = {
    ...encrypted.document,
    created_by: context.userId,
    status: 'UPLOADING'
  };

  const inserted = await client.from('docinspector_project_documents').insert(row).select('*').single();
  if (inserted.error || !inserted.data) {
    throw new Error('O servidor recusou os metadados do PDF confidencial.');
  }

  const storage = client.storage.from(CONFIDENTIAL_PDF_BUCKET);
  const upload = await storage.upload(row.object_path, encrypted.container, {
    contentType: CONFIDENTIAL_PDF_MIME,
    cacheControl: '0',
    upsert: false
  });
  if (upload.error) {
    await client.from('docinspector_project_documents').delete().eq('id', fileId).eq('workspace_id', row.workspace_id);
    throw new Error('Não foi possível enviar o ciphertext do PDF confidencial.');
  }

  const activated = await client
    .from('docinspector_project_documents')
    .update({ status: 'ACTIVE' })
    .eq('id', fileId)
    .eq('workspace_id', row.workspace_id)
    .select('*')
    .single();

  if (activated.error || !activated.data) {
    await storage.remove([row.object_path]).catch(() => {});
    await client.from('docinspector_project_documents').delete().eq('id', fileId).eq('workspace_id', row.workspace_id);
    throw new Error('O PDF foi enviado, mas não foi possível ativar seus metadados; o upload foi revertido.');
  }
  return activated.data;
}

export async function downloadConfidentialPdf({ document, workspaceKey }) {
  requireOnlineAuthContext(document?.workspace_id);
  const client = getAuthClient();
  const response = await client.storage.from(CONFIDENTIAL_PDF_BUCKET).download(document.object_path);
  if (response.error || !response.data) throw new Error('Não foi possível baixar o ciphertext do PDF confidencial.');
  const container = new Uint8Array(await response.data.arrayBuffer());
  return decryptConfidentialPdf({ container, document, workspaceKey });
}

export async function deleteConfidentialDocument(document) {
  requireOnlineAuthContext(document?.workspace_id);
  const client = getAuthClient();
  const deletedAt = new Date().toISOString();
  const marked = await client
    .from('docinspector_project_documents')
    .update({ status: 'DELETED', deleted_at: deletedAt })
    .eq('id', requireUuid(document.id, 'fileId'))
    .eq('workspace_id', requireUuid(document.workspace_id, 'workspaceId'))
    .select('*')
    .single();
  if (marked.error || !marked.data) throw new Error('Não foi possível marcar o PDF confidencial como excluído.');

  const removed = await client.storage.from(CONFIDENTIAL_PDF_BUCKET).remove([document.object_path]);
  return {
    document: marked.data,
    cleanupPending: Boolean(removed.error)
  };
}

export async function retryConfidentialCiphertextCleanup(document) {
  requireOnlineAuthContext(document?.workspace_id);
  if (document?.status !== 'DELETED') throw new Error('Somente PDFs marcados como excluídos podem ter limpeza repetida.');
  const client = getAuthClient();
  const removed = await client.storage.from(CONFIDENTIAL_PDF_BUCKET).remove([document.object_path]);
  if (removed.error) throw new Error('O ciphertext excluído ainda não pôde ser removido do Storage.');
  return true;
}
