export const ROLE = Object.freeze({
  ADMIN: 'ADMIN'
});

export const ROLE_LABEL = Object.freeze({
  [ROLE.ADMIN]: 'Administrador'
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

const ADMIN_ACCESS = Object.freeze(Object.values(CAPABILITY));
const ROLE_CAPABILITIES = Object.freeze({
  [ROLE.ADMIN]: ADMIN_ACCESS
});

export function normalizeRole(value) {
  const role = String(value ?? '').trim().toUpperCase();
  return role === ROLE.ADMIN ? ROLE.ADMIN : null;
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
