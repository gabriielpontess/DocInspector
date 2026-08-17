export const ROLE = Object.freeze({
  ADMIN: 'ADMIN',
  INSPECTOR: 'INSPECTOR',
  SUPERVISOR: 'SUPERVISOR',
  FOREMAN: 'FOREMAN'
});

export const ROLE_LABEL = Object.freeze({
  [ROLE.ADMIN]: 'Administrador',
  [ROLE.INSPECTOR]: 'Inspetor',
  [ROLE.SUPERVISOR]: 'Supervisor',
  [ROLE.FOREMAN]: 'Encarregado'
});

export const CAPABILITY = Object.freeze({
  VIEW_DOCUMENTS: 'VIEW_DOCUMENTS',
  COMMENT_DOCUMENTS: 'COMMENT_DOCUMENTS',
  MANAGE_INSPECTIONS: 'MANAGE_INSPECTIONS',
  VERIFY_DOCUMENTS: 'VERIFY_DOCUMENTS',
  MANAGE_DOCUMENTS: 'MANAGE_DOCUMENTS',
  MANAGE_PROJECT_FILES: 'MANAGE_PROJECT_FILES',
  EXPORT_DATA: 'EXPORT_DATA',
  MANAGE_USERS: 'MANAGE_USERS'
});

const FULL_ACCESS = Object.freeze(Object.values(CAPABILITY));
const READ_AND_COMMENT = Object.freeze([
  CAPABILITY.VIEW_DOCUMENTS,
  CAPABILITY.COMMENT_DOCUMENTS
]);

const ROLE_CAPABILITIES = Object.freeze({
  [ROLE.ADMIN]: FULL_ACCESS,
  [ROLE.INSPECTOR]: FULL_ACCESS,
  [ROLE.SUPERVISOR]: READ_AND_COMMENT,
  [ROLE.FOREMAN]: READ_AND_COMMENT
});

export function normalizeRole(value) {
  const role = String(value ?? '').trim().toUpperCase();
  return Object.values(ROLE).includes(role) ? role : null;
}

export function roleLabel(value) {
  const role = normalizeRole(value);
  return role ? ROLE_LABEL[role] : 'Sem perfil';
}

export function capabilitiesForRole(value) {
  const role = normalizeRole(value);
  return role ? [...ROLE_CAPABILITIES[role]] : [];
}

export function can(value, capability) {
  if (!Object.values(CAPABILITY).includes(capability)) return false;
  return capabilitiesForRole(value).includes(capability);
}

export function canAny(value, capabilities = []) {
  return capabilities.some(capability => can(value, capability));
}

export function canAll(value, capabilities = []) {
  return capabilities.every(capability => can(value, capability));
}
