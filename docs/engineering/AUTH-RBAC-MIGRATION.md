# Migração de autenticação e perfis — DocInspector

## Objetivo

Introduzir identidade individual via Supabase Auth e autorização por perfil sem interromper o modo offline-first, a sincronização existente ou o uso de campo durante a transição.

## Perfis

- `ADMIN` — acesso total, incluindo gestão de usuários.
- `INSPECTOR` — acesso operacional total, sem gestão de usuários.
- `SUPERVISOR` — visualização de documentos e comentários.
- `FOREMAN` — visualização de documentos e comentários.

A interface pode ocultar ações não autorizadas, mas isso não é a fronteira de segurança. Toda operação privilegiada é revalidada no Supabase.

## Estado atual — 2026-08-17

Os Gates A–E foram implementados. O primeiro Administrador foi provisionado e possui membership `ADMIN` ativa nos 12 workspaces legados. O estado operacional permanece preservado: 13 inspeções, 3 tombstones e 1 evidência.

`AUTH_CONFIG.enabled` está `true` no branch `feature/auth-rbac-foundation` para homologação controlada. O PR continua draft e não deve ser mergeado enquanto o primeiro login real, troca de senha, RLS, sincronização, Storage e comportamento offline não forem homologados.

### Gate A — fundação no cliente — concluído

- modelo central de papéis e capacidades;
- cliente Supabase Auth com sessão persistente e auto-refresh;
- login por e-mail e senha;
- logout da sessão atual;
- testes do mapa de permissões.

### Gate B — schema de identidade — concluído

Migrations:
- `20260817162807_add_auth_profiles_and_workspace_memberships.sql`;
- `20260817162939_add_authenticated_workspace_discovery.sql`.

Inclui `docinspector_profiles`, `docinspector_workspace_members`, RLS, criação automática de profile e `docinspector_my_workspaces()` com `SECURITY INVOKER`. Papéis ficam na membership do workspace, nunca em metadata editável do usuário.

### Gate C — autorização de dados e Storage — concluído

Migrations:
- `20260817163849_add_authenticated_inspection_and_storage_access.sql`;
- `20260817163910_restrict_legacy_sync_to_anon_during_auth_rollout.sql`;
- `20260817163946_close_internal_legacy_helpers_to_authenticated_clients.sql`.

Regras:
- leitura de inspeções/tombstones: todos os quatro perfis com membership ativa;
- escrita/exclusão de inspeções: `ADMIN` e `INSPECTOR`;
- leitura de evidências: todos os quatro perfis;
- upload/update/delete de evidências: `ADMIN` e `INSPECTOR`;
- RPCs `docinspector_*` usam `SECURITY INVOKER` e RLS;
- usuários `authenticated` não executam as RPCs legadas `sky17_*`;
- o legado `anon + syncKey` permanece apenas como ponte temporária de rollback até a homologação final.

### Gate D — cliente e interface autenticada — concluído

Componentes:
- `auth-entry.js` como único bootstrap;
- aplicação só carrega após validação de sessão/membership quando Auth está ativo;
- `auth-context.js` carrega perfil, workspaces e role;
- primeiro acesso autenticado prefere o `workspaceId` legado já usado pelo aparelho;
- contexto offline só é aceito após validação online anterior para o mesmo `user_id`;
- `sync-auth.js` usa RPCs `docinspector_*` e sessão Auth para Storage;
- nenhuma chamada autenticada envia `p_secret` ou sync key;
- `permission-ui.js` aplica UX por capability enquanto o servidor continua sendo a autoridade;
- troca de senha disponível dentro do aplicativo;
- logout limpa sessão e contexto local.

### Gate E — provisionamento e gestão administrativa — concluído

A Edge Function `docinspector-user-admin` foi implantada com JWT obrigatório e fonte versionada em `supabase/functions/docinspector-user-admin/index.ts`.

Regras:
- valida o JWT do chamador;
- exige membership ativa `ADMIN` no workspace;
- só então utiliza `SUPABASE_SERVICE_ROLE_KEY`, exclusivamente no ambiente server-side;
- permite listar membros, convidar/vincular contas, alterar papel e ativar/desativar membership;
- não oferece exclusão física de usuário;
- protege o último Administrador ativo contra rebaixamento ou desativação.

O primeiro Administrador foi bootstrapado em 2026-08-17. O mecanismo temporário de bootstrap foi neutralizado imediatamente depois. `pg_net`, utilizado somente para a chamada one-shot, foi removido novamente e o histórico real foi espelhado nas migrations:
- `20260817173420_enable_pg_net_for_one_time_admin_bootstrap.sql`;
- `20260817173503_disable_pg_net_after_one_time_admin_bootstrap.sql`.

## Ativação controlada

O branch de autenticação agora usa `AUTH_CONFIG.enabled=true`. Os testes Playwright mantêm os fluxos operacionais antigos por um bypass exclusivamente local, aceito somente em `127.0.0.1`/`localhost` e com parâmetro explícito `e2e-auth-bypass=1`. Esse bypass não funciona em preview ou produção. Há também teste de navegador confirmando que, sem sessão e sem bypass local, a aplicação exibe a tela de login e não carrega a Home.

Antes do merge ainda é obrigatório homologar com uma sessão real:
1. login do primeiro Administrador;
2. troca da senha inicial;
3. workspace legado correto selecionado;
4. leitura e sincronização de inspeções;
5. leitura/upload de evidência no Storage;
6. logout e novo login;
7. uso offline após uma validação online;
8. validação posterior dos perfis restritos antes de liberar usuários adicionais.

## Compatibilidade e rollback

O PR permanece draft. Se a homologação real encontrar um bloqueio, o rollback imediato do cliente é retornar `AUTH_CONFIG.enabled` para `false`, sem apagar usuários, memberships, migrations, inspeções ou evidências. O caminho legado continua disponível apenas para essa janela de transição e deve ser removido depois da homologação autenticada.

## Estratégia de revisão independente

Claude não é executado em commits intermediários. A revisão Anthropic será solicitada uma única vez quando o login real, RLS, sync, Storage, offline e CI/E2E estiverem homologados. Reexecutar somente diante de achado `BLOCKER`/`HIGH`, mudança substancial posterior ou alteração em área crítica que invalide a revisão anterior.
