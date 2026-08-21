import { getAuthClient } from './auth.js';
import { normalizeSkyrailDocument, sortSkyrailDocuments } from './skyrail-model.js';

export const SKYRAIL_DOCUMENTS_BUCKET = 'byd-skyrail-documents';
const DOCUMENT_COLUMNS = 'id,workspace_id,code,title,discipline,revision,file_path,updated_at,active';

function value(value) {
  return String(value ?? '').trim();
}

function requireWorkspaceId(workspaceId) {
  const normalized = value(workspaceId);
  if (!normalized) throw new Error('Workspace inválido.');
  return normalized;
}

function validatePdf(file, { required = true } = {}) {
  if (!file && !required) return null;
  if (!(file instanceof File)) throw new Error('Selecione um arquivo PDF.');
  if (file.type && file.type !== 'application/pdf') throw new Error('Somente arquivos PDF são aceitos.');
  if (!/\.pdf$/i.test(file.name || '')) throw new Error('O arquivo precisa possuir extensão .pdf.');
  if (file.size <= 0) throw new Error('O PDF selecionado está vazio.');
  return file;
}

function documentPayload(input = {}) {
  const code = value(input.code);
  const title = value(input.title);
  const discipline = value(input.discipline);
  const revision = value(input.revision);
  if (!code) throw new Error('Informe o código do documento.');
  if (!title) throw new Error('Informe o título do documento.');
  if (!discipline) throw new Error('Informe a disciplina do documento.');
  if (!revision) throw new Error('Informe a revisão do documento.');
  return { code, title, discipline, revision, active: input.active !== false };
}

function newObjectPath(workspaceId, documentId) {
  return `${workspaceId}/${documentId}/${crypto.randomUUID()}.pdf`;
}

async function uploadPdf(path, file) {
  const client = getAuthClient();
  const { error } = await client.storage
    .from(SKYRAIL_DOCUMENTS_BUCKET)
    .upload(path, file, {
      contentType: 'application/pdf',
      cacheControl: '0',
      upsert: false
    });
  if (error) throw new Error('Não foi possível enviar o PDF para a biblioteca.');
}

async function removeObjectBestEffort(path) {
  const normalized = value(path);
  if (!normalized) return;
  try {
    await getAuthClient().storage.from(SKYRAIL_DOCUMENTS_BUCKET).remove([normalized]);
  } catch {
    // O registro principal continua consistente mesmo se a limpeza do objeto antigo falhar.
  }
}

async function findSkyrailDocumentByCode(workspaceId, code) {
  const { data, error } = await getAuthClient()
    .from('documents')
    .select(DOCUMENT_COLUMNS)
    .eq('workspace_id', workspaceId)
    .eq('code', code)
    .maybeSingle();

  if (error) throw new Error('Não foi possível validar o código do documento.');
  return normalizeSkyrailDocument(data);
}

export async function listActiveSkyrailDocuments(workspaceId) {
  const id = requireWorkspaceId(workspaceId);
  const { data, error } = await getAuthClient()
    .from('documents')
    .select(DOCUMENT_COLUMNS)
    .eq('workspace_id', id)
    .eq('active', true)
    .order('discipline', { ascending: true })
    .order('code', { ascending: true });

  if (error) throw new Error('Não foi possível carregar a biblioteca oficial.');
  return sortSkyrailDocuments((data || []).map(normalizeSkyrailDocument).filter(Boolean));
}

export async function listAdminSkyrailDocuments(workspaceId) {
  const id = requireWorkspaceId(workspaceId);
  const { data, error } = await getAuthClient()
    .from('documents')
    .select(DOCUMENT_COLUMNS)
    .eq('workspace_id', id)
    .order('discipline', { ascending: true })
    .order('code', { ascending: true });

  if (error) throw new Error('Não foi possível carregar os documentos para administração.');
  return sortSkyrailDocuments((data || []).map(normalizeSkyrailDocument).filter(Boolean));
}

export async function downloadSkyrailPdf(filePath) {
  const path = value(filePath);
  if (!path) throw new Error('O documento não possui um arquivo associado.');
  const { data, error } = await getAuthClient().storage.from(SKYRAIL_DOCUMENTS_BUCKET).download(path);
  if (error || !(data instanceof Blob)) throw new Error('Não foi possível baixar o PDF.');
  return data;
}

export async function createSkyrailDocument({ workspaceId, code, title, discipline, revision, active = true, file } = {}) {
  const id = requireWorkspaceId(workspaceId);
  const pdf = validatePdf(file);
  const payload = documentPayload({ code, title, discipline, revision, active });

  // Na V1 o código identifica o documento. Se ele já existir, trate o envio
  // como atualização para evitar upload órfão seguido de conflito 409.
  const existing = await findSkyrailDocumentByCode(id, payload.code);
  if (existing) {
    return updateSkyrailDocument(existing, {
      ...payload,
      file: pdf
    });
  }

  const documentId = crypto.randomUUID();
  const filePath = newObjectPath(id, documentId);
  const updatedAt = new Date().toISOString();

  await uploadPdf(filePath, pdf);
  const { data, error } = await getAuthClient()
    .from('documents')
    .insert({
      id: documentId,
      workspace_id: id,
      ...payload,
      file_path: filePath,
      updated_at: updatedAt
    })
    .select(DOCUMENT_COLUMNS)
    .single();

  if (error || !data) {
    await removeObjectBestEffort(filePath);
    if (String(error?.code || '') === '23505') throw new Error('Já existe um documento com este código neste workspace.');
    throw new Error('Não foi possível cadastrar o documento.');
  }

  return normalizeSkyrailDocument(data);
}

export async function updateSkyrailDocument(document, { code, title, discipline, revision, active = true, file = null } = {}) {
  const current = normalizeSkyrailDocument(document);
  if (!current) throw new Error('Documento inválido para edição.');

  const payload = documentPayload({ code, title, discipline, revision, active });
  const pdf = validatePdf(file, { required: false });
  const oldPath = current.file_path;
  const nextPath = pdf ? newObjectPath(current.workspace_id, current.id) : oldPath;

  if (pdf) await uploadPdf(nextPath, pdf);

  const { data, error } = await getAuthClient()
    .from('documents')
    .update({
      ...payload,
      file_path: nextPath,
      updated_at: new Date().toISOString()
    })
    .eq('workspace_id', current.workspace_id)
    .eq('id', current.id)
    .select(DOCUMENT_COLUMNS)
    .single();

  if (error || !data) {
    if (pdf) await removeObjectBestEffort(nextPath);
    if (String(error?.code || '') === '23505') throw new Error('Já existe um documento com este código neste workspace.');
    throw new Error('Não foi possível atualizar o documento.');
  }

  if (pdf && oldPath !== nextPath) await removeObjectBestEffort(oldPath);
  return normalizeSkyrailDocument(data);
}
