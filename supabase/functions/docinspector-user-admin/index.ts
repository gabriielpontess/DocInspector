import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.111.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const ACCESS_REQUEST_PROCESSING_TTL_MS = 10 * 60 * 1000;
const ADMIN_ROLE = 'ADMIN';

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

function normalizeEmail(value: unknown) {
  return String(value ?? '').trim().toLowerCase();
}

function isUuid(value: unknown) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value ?? ''));
}

function isUniqueViolation(error: unknown) {
  return Boolean(error && typeof error === 'object' && 'code' in error && String((error as { code?: unknown }).code || '') === '23505');
}

async function listAllUsers(admin: ReturnType<typeof createClient>) {
  const users = [];
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const batch = data?.users || [];
    users.push(...batch);
    if (batch.length < 1000) break;
  }
  return users;
}

async function ensureUserAccess(admin: ReturnType<typeof createClient>, {
  workspaceId,
  email,
  displayName,
  addedBy
}: {
  workspaceId: string;
  email: string;
  displayName: string;
  addedBy: string;
}) {
  const users = await listAllUsers(admin);
  let user = users.find(item => normalizeEmail(item.email) === email) || null;
  let invited = false;

  if (!user) {
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
      data: displayName ? { display_name: displayName } : undefined
    });
    if (data?.user) {
      user = data.user;
      invited = true;
    } else {
      const refreshedUsers = await listAllUsers(admin);
      user = refreshedUsers.find(item => normalizeEmail(item.email) === email) || null;
      if (!user) throw new Error(error?.message || 'Não foi possível enviar o convite.');
    }
  }

  if (displayName) {
    const { error: profileError } = await admin
      .from('docinspector_profiles')
      .upsert({ user_id: user.id, display_name: displayName }, { onConflict: 'user_id' });
    if (profileError) throw profileError;
  }

  const { error: membershipError } = await admin
    .from('docinspector_workspace_members')
    .upsert({ workspace_id: workspaceId, user_id: user.id, role: ADMIN_ROLE, active: true, added_by: addedBy }, { onConflict: 'workspace_id,user_id' });
  if (membershipError) throw membershipError;

  return { invited, userId: user.id, email, role: ADMIN_ROLE };
}

async function ensureWorkspaceAccessCode(admin: ReturnType<typeof createClient>, workspaceId: string) {
  const readCode = () => admin
    .from('docinspector_workspace_access_codes')
    .select('request_code')
    .eq('workspace_id', workspaceId)
    .maybeSingle();

  let { data, error } = await readCode();
  if (error) throw error;
  if (data?.request_code) return data.request_code;

  const { error: insertError } = await admin.from('docinspector_workspace_access_codes').insert({ workspace_id: workspaceId });
  if (insertError && !isUniqueViolation(insertError)) throw insertError;
  ({ data, error } = await readCode());
  if (error) throw error;
  if (!data?.request_code) throw new Error('Código de solicitação não encontrado.');
  return data.request_code;
}

function staleProcessingBefore() {
  return new Date(Date.now() - ACCESS_REQUEST_PROCESSING_TTL_MS).toISOString();
}

async function requeueStaleAccessRequests(admin: ReturnType<typeof createClient>, workspaceId: string, requestId = '') {
  let query = admin
    .from('docinspector_access_requests')
    .update({ status: 'PENDING', handled_by: null, handled_at: null, processing_token: null, processing_started_at: null })
    .eq('workspace_id', workspaceId)
    .eq('status', 'PROCESSING')
    .lt('processing_started_at', staleProcessingBefore());
  if (requestId) query = query.eq('id', requestId);
  const { error } = await query;
  if (error) throw error;
}

async function claimAccessRequest(admin: ReturnType<typeof createClient>, workspaceId: string, requestId: string, callerId: string) {
  await requeueStaleAccessRequests(admin, workspaceId, requestId);
  const processingToken = crypto.randomUUID();
  const { data: request, error } = await admin
    .from('docinspector_access_requests')
    .update({ status: 'PROCESSING', handled_by: callerId, handled_at: null, processing_token: processingToken, processing_started_at: new Date().toISOString() })
    .eq('id', requestId)
    .eq('workspace_id', workspaceId)
    .eq('status', 'PENDING')
    .select('id,email,display_name,status')
    .maybeSingle();
  if (error) throw error;
  return request ? { request, processingToken } : null;
}

async function releaseAccessRequestClaim(admin: ReturnType<typeof createClient>, workspaceId: string, requestId: string, processingToken: string) {
  const { error } = await admin
    .from('docinspector_access_requests')
    .update({ status: 'PENDING', handled_by: null, handled_at: null, processing_token: null, processing_started_at: null })
    .eq('id', requestId)
    .eq('workspace_id', workspaceId)
    .eq('status', 'PROCESSING')
    .eq('processing_token', processingToken);
  if (error) throw error;
}

async function finalizeAccessRequest(admin: ReturnType<typeof createClient>, workspaceId: string, requestId: string, processingToken: string, callerId: string, status: 'APPROVED' | 'REJECTED') {
  const { data, error } = await admin
    .from('docinspector_access_requests')
    .update({ status, handled_by: callerId, handled_at: new Date().toISOString(), processing_token: null, processing_started_at: null })
    .eq('id', requestId)
    .eq('workspace_id', workspaceId)
    .eq('status', 'PROCESSING')
    .eq('processing_token', processingToken)
    .select('id')
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('A solicitação perdeu o claim antes da finalização.');
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { error: 'Método não permitido.' });

  try {
    const url = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !serviceRoleKey) return json(500, { error: 'Configuração server-side indisponível.' });

    const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '').trim();
    if (!token) return json(401, { error: 'Autenticação obrigatória.' });

    const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    const { data: userData, error: userError } = await admin.auth.getUser(token);
    const caller = userData?.user;
    if (userError || !caller) return json(401, { error: 'Sessão inválida ou expirada.' });

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action ?? '').trim();
    const workspaceId = String(body?.workspaceId ?? '').trim();
    if (!isUuid(workspaceId)) return json(400, { error: 'Workspace inválido.' });

    const { data: callerMembership, error: membershipError } = await admin
      .from('docinspector_workspace_members')
      .select('workspace_id,user_id,role,active')
      .eq('workspace_id', workspaceId)
      .eq('user_id', caller.id)
      .maybeSingle();
    if (membershipError) throw membershipError;
    if (!callerMembership?.active || callerMembership.role !== ADMIN_ROLE) {
      return json(403, { error: 'Somente Administradores podem gerenciar usuários deste workspace.' });
    }

    if (action === 'access-request-code') {
      return json(200, { requestCode: await ensureWorkspaceAccessCode(admin, workspaceId) });
    }

    if (action === 'access-requests') {
      await requeueStaleAccessRequests(admin, workspaceId);
      const { data, error } = await admin
        .from('docinspector_access_requests')
        .select('id,email,display_name,message,status,created_at')
        .eq('workspace_id', workspaceId)
        .eq('status', 'PENDING')
        .order('created_at', { ascending: true })
        .limit(100);
      if (error) throw error;
      return json(200, { requests: (data || []).map(item => ({ id: item.id, email: item.email, displayName: item.display_name, message: item.message || '', status: item.status, createdAt: item.created_at })) });
    }

    if (action === 'resolve-access-request') {
      const requestId = String(body?.requestId ?? '').trim();
      const decision = String(body?.decision ?? '').trim().toUpperCase();
      if (!isUuid(requestId)) return json(400, { error: 'Solicitação inválida.' });
      if (!['APPROVE', 'REJECT'].includes(decision)) return json(400, { error: 'Decisão inválida.' });
      if (body?.role && String(body.role).toUpperCase() !== ADMIN_ROLE) return json(400, { error: 'Somente o perfil Administrador está disponível.' });

      const claim = await claimAccessRequest(admin, workspaceId, requestId, caller.id);
      if (!claim) {
        const { data: current, error: currentError } = await admin.from('docinspector_access_requests').select('status').eq('id', requestId).eq('workspace_id', workspaceId).maybeSingle();
        if (currentError) throw currentError;
        if (!current) return json(404, { error: 'Solicitação não encontrada.' });
        return json(409, { error: 'Esta solicitação já está sendo processada ou foi concluída.' });
      }

      const { request, processingToken } = claim;
      try {
        let accessResult = null;
        if (decision === 'APPROVE') {
          accessResult = await ensureUserAccess(admin, {
            workspaceId,
            email: normalizeEmail(request.email),
            displayName: String(request.display_name || '').trim().slice(0, 120),
            addedBy: caller.id
          });
        }
        const status = decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
        await finalizeAccessRequest(admin, workspaceId, requestId, processingToken, caller.id, status);
        return json(200, { ok: true, status, ...(accessResult || {}) });
      } catch (error) {
        await releaseAccessRequestClaim(admin, workspaceId, requestId, processingToken).catch(releaseError => console.error('release-access-request-claim', releaseError));
        throw error;
      }
    }

    if (action === 'list') {
      const [{ data: memberships, error: membershipsError }, { data: profiles, error: profilesError }, users] = await Promise.all([
        admin.from('docinspector_workspace_members').select('user_id,role,active,created_at').eq('workspace_id', workspaceId).order('created_at', { ascending: true }),
        admin.from('docinspector_profiles').select('user_id,display_name'),
        listAllUsers(admin)
      ]);
      if (membershipsError) throw membershipsError;
      if (profilesError) throw profilesError;
      const userMap = new Map(users.map(user => [user.id, user]));
      const profileMap = new Map((profiles || []).map(profile => [profile.user_id, profile]));
      return json(200, { members: (memberships || []).map(member => ({ userId: member.user_id, email: userMap.get(member.user_id)?.email || '', displayName: profileMap.get(member.user_id)?.display_name || '', role: ADMIN_ROLE, active: member.active !== false, createdAt: member.created_at, invitedAt: userMap.get(member.user_id)?.invited_at || null, confirmedAt: userMap.get(member.user_id)?.email_confirmed_at || null, lastSignInAt: userMap.get(member.user_id)?.last_sign_in_at || null, self: member.user_id === caller.id })) });
    }

    if (action === 'invite') {
      const email = normalizeEmail(body?.email);
      const displayName = String(body?.displayName ?? '').trim().slice(0, 120);
      if (!email || !email.includes('@') || email.length > 254) return json(400, { error: 'Informe um e-mail válido.' });
      if (body?.role && String(body.role).toUpperCase() !== ADMIN_ROLE) return json(400, { error: 'Somente o perfil Administrador está disponível.' });
      try {
        return json(200, { ok: true, ...(await ensureUserAccess(admin, { workspaceId, email, displayName, addedBy: caller.id })) });
      } catch (error) {
        return json(400, { error: error instanceof Error ? error.message : 'Não foi possível enviar o convite.' });
      }
    }

    if (action === 'update') {
      const userId = String(body?.userId ?? '').trim();
      const active = body?.active === true;
      if (!isUuid(userId)) return json(400, { error: 'Usuário inválido.' });
      if (body?.role && String(body.role).toUpperCase() !== ADMIN_ROLE) return json(400, { error: 'Somente o perfil Administrador está disponível.' });

      const { data: current, error: currentError } = await admin.from('docinspector_workspace_members').select('user_id,role,active').eq('workspace_id', workspaceId).eq('user_id', userId).maybeSingle();
      if (currentError) throw currentError;
      if (!current) return json(404, { error: 'Membership não encontrada.' });
      if (current.active && !active) {
        const { count, error: countError } = await admin.from('docinspector_workspace_members').select('user_id', { count: 'exact', head: true }).eq('workspace_id', workspaceId).eq('role', ADMIN_ROLE).eq('active', true);
        if (countError) throw countError;
        if ((count || 0) <= 1) return json(409, { error: 'O último Administrador ativo não pode ser desativado.' });
      }
      const { error: updateError } = await admin.from('docinspector_workspace_members').update({ role: ADMIN_ROLE, active, added_by: caller.id }).eq('workspace_id', workspaceId).eq('user_id', userId);
      if (updateError) throw updateError;
      return json(200, { ok: true, userId, role: ADMIN_ROLE, active });
    }

    return json(400, { error: 'Ação administrativa inválida.' });
  } catch (error) {
    console.error('docinspector-user-admin', error);
    return json(500, { error: error instanceof Error ? error.message : 'Falha interna ao gerenciar usuários.' });
  }
});
