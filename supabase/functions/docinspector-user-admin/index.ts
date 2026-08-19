import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.111.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const ROLES = new Set(['ADMIN', 'INSPECTOR', 'SUPERVISOR', 'FOREMAN']);

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' }
  });
}

function normalizeEmail(value: unknown) {
  return String(value ?? '').trim().toLowerCase();
}

function normalizeRole(value: unknown) {
  const role = String(value ?? '').trim().toUpperCase();
  return ROLES.has(role) ? role : null;
}

function isUuid(value: unknown) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value ?? ''));
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

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { error: 'Método não permitido.' });

  try {
    const url = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !serviceRoleKey) return json(500, { error: 'Configuração server-side indisponível.' });

    const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '').trim();
    if (!token) return json(401, { error: 'Autenticação obrigatória.' });

    const admin = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    });

    const { data: userData, error: userError } = await admin.auth.getUser(token);
    const caller = userData?.user;
    if (userError || !caller) return json(401, { error: 'Sessão inválida ou expirada.' });

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action ?? '').trim();
    const workspaceId = String(body?.workspaceId ?? '').trim();
    if (!isUuid(workspaceId)) return json(400, { error: 'Workspace inválido.' });

    const { data: callerMembership, error: callerMembershipError } = await admin
      .from('docinspector_workspace_members')
      .select('workspace_id,user_id,role,active')
      .eq('workspace_id', workspaceId)
      .eq('user_id', caller.id)
      .maybeSingle();

    if (callerMembershipError) throw callerMembershipError;
    if (!callerMembership?.active || callerMembership.role !== 'ADMIN') {
      return json(403, { error: 'Somente Administradores podem gerenciar usuários deste workspace.' });
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
      return json(200, {
        members: (memberships || []).map(member => ({
          userId: member.user_id,
          email: userMap.get(member.user_id)?.email || '',
          displayName: profileMap.get(member.user_id)?.display_name || '',
          role: member.role,
          active: member.active !== false,
          createdAt: member.created_at,
          invitedAt: userMap.get(member.user_id)?.invited_at || null,
          confirmedAt: userMap.get(member.user_id)?.email_confirmed_at || null,
          lastSignInAt: userMap.get(member.user_id)?.last_sign_in_at || null,
          self: member.user_id === caller.id
        }))
      });
    }

    if (action === 'invite') {
      const email = normalizeEmail(body?.email);
      const role = normalizeRole(body?.role);
      const displayName = String(body?.displayName ?? '').trim().slice(0, 120);
      if (!email || !email.includes('@') || email.length > 254) return json(400, { error: 'Informe um e-mail válido.' });
      if (!role) return json(400, { error: 'Perfil inválido.' });

      const users = await listAllUsers(admin);
      let user = users.find(item => normalizeEmail(item.email) === email) || null;
      let invited = false;

      if (!user) {
        const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
          data: displayName ? { display_name: displayName } : undefined
        });
        if (error || !data?.user) return json(400, { error: error?.message || 'Não foi possível enviar o convite.' });
        user = data.user;
        invited = true;
      }

      if (displayName) {
        const { error: profileError } = await admin
          .from('docinspector_profiles')
          .upsert({ user_id: user.id, display_name: displayName }, { onConflict: 'user_id' });
        if (profileError) throw profileError;
      }

      const { error: membershipError } = await admin
        .from('docinspector_workspace_members')
        .upsert({ workspace_id: workspaceId, user_id: user.id, role, active: true, added_by: caller.id }, { onConflict: 'workspace_id,user_id' });
      if (membershipError) throw membershipError;

      return json(200, { ok: true, invited, userId: user.id, email, role });
    }

    if (action === 'update') {
      const userId = String(body?.userId ?? '').trim();
      const role = normalizeRole(body?.role);
      const active = body?.active === true;
      if (!isUuid(userId)) return json(400, { error: 'Usuário inválido.' });
      if (!role) return json(400, { error: 'Perfil inválido.' });

      const { data: current, error: currentError } = await admin
        .from('docinspector_workspace_members')
        .select('user_id,role,active')
        .eq('workspace_id', workspaceId)
        .eq('user_id', userId)
        .maybeSingle();
      if (currentError) throw currentError;
      if (!current) return json(404, { error: 'Membership não encontrada.' });

      if (current.role === 'ADMIN' && current.active && (role !== 'ADMIN' || !active)) {
        const { count, error: countError } = await admin
          .from('docinspector_workspace_members')
          .select('user_id', { count: 'exact', head: true })
          .eq('workspace_id', workspaceId)
          .eq('role', 'ADMIN')
          .eq('active', true);
        if (countError) throw countError;
        if ((count || 0) <= 1) {
          return json(409, { error: 'O último Administrador ativo não pode ser desativado ou rebaixado.' });
        }
      }

      const { error: updateError } = await admin
        .from('docinspector_workspace_members')
        .update({ role, active, added_by: caller.id })
        .eq('workspace_id', workspaceId)
        .eq('user_id', userId);
      if (updateError) throw updateError;

      return json(200, { ok: true, userId, role, active });
    }

    return json(400, { error: 'Ação administrativa inválida.' });
  } catch (error) {
    console.error('docinspector-user-admin', error);
    return json(500, { error: 'Falha interna ao gerenciar usuários.' });
  }
});
