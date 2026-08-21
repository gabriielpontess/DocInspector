function text(value) {
  return String(value ?? '').trim();
}

export function normalizeSkyrailDocument(record) {
  if (!record || typeof record !== 'object') return null;

  const id = text(record.id);
  const workspaceId = text(record.workspace_id);
  const code = text(record.code);
  const title = text(record.title);
  const discipline = text(record.discipline);
  const revision = text(record.revision);
  const filePath = text(record.file_path);
  const updatedAt = text(record.updated_at);

  if (!id || !workspaceId || !code || !title || !discipline || !revision || !filePath || !updatedAt) {
    return null;
  }

  return {
    ...record,
    id,
    workspace_id: workspaceId,
    code,
    title,
    discipline,
    revision,
    file_path: filePath,
    updated_at: updatedAt,
    active: record.active !== false,
    blob: record.blob instanceof Blob ? record.blob : null,
    downloaded_at: text(record.downloaded_at) || null
  };
}

export function sortSkyrailDocuments(documents = []) {
  return [...documents].sort((a, b) => {
    const disciplineOrder = text(a?.discipline).localeCompare(text(b?.discipline), 'pt-BR', { sensitivity: 'base' });
    if (disciplineOrder !== 0) return disciplineOrder;
    return text(a?.code).localeCompare(text(b?.code), 'pt-BR', { numeric: true, sensitivity: 'base' });
  });
}

export function documentNeedsDownload(localDocument, remoteDocument) {
  if (!localDocument?.blob) return true;
  return text(localDocument.file_path) !== text(remoteDocument?.file_path) ||
    text(localDocument.revision) !== text(remoteDocument?.revision) ||
    text(localDocument.updated_at) !== text(remoteDocument?.updated_at);
}

export function matchesSkyrailDocument(document, { query = '', discipline = 'ALL' } = {}) {
  const normalizedDiscipline = text(discipline);
  if (normalizedDiscipline && normalizedDiscipline !== 'ALL' && text(document?.discipline) !== normalizedDiscipline) {
    return false;
  }

  const needle = text(query).toLocaleLowerCase('pt-BR');
  if (!needle) return true;

  const haystack = `${text(document?.code)} ${text(document?.title)}`.toLocaleLowerCase('pt-BR');
  return haystack.includes(needle);
}

export function listSkyrailDisciplines(documents = []) {
  return [...new Set(documents.map(document => text(document?.discipline)).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }));
}
