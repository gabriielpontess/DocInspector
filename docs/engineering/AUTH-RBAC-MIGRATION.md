# Migração de autenticação e perfis — DocInspector

## Objetivo

Introduzir identidade individual via Supabase Auth e autorização por perfil sem interromper o modo offline-first, a sincronização existente ou o uso de campo durante a transição.

## Perfis

- `ADMIN` — acesso total, incluindo gestão de usuários.
- `INSPECTOR` — acesso operacional total, sem gestão de usuários.
- `SUPERVISOR` — visualização de documentos e comentários.
- `FOREMAN` — visualização de documentos e comentários.

A interface pode ocultar ações não autorizadas, mas isso não é a fronteira de segurança. Toda operação privilegiada deve ser validada novamente no Supabase.

## Rollout seguro

A migração é dividida em gates. `AUTH_CONFIG.enabled` permanece `false` enquanto não existir ao menos um Administrador provisionado e validado. Isso evita bloquear todos os aparelhos atuais durante a transição.

### Gate A — fundação no cliente — concluído

- modelo central de papéis e capacidades;
- cliente Supabase Auth separado do cliente legado de sincronização;
- sessão persistente com auto-refresh;
- login por e-mail e senha;
- logout somente da sessão atual;
- testes de regressão do mapa de permissões.

### Gate B — schema de identidade — concluído em 2026-08-17

Migrations:
- `20260817162807_add_auth_profiles_and_workspace_memberships.sql`;
- `20260817162939_add_authenticated_workspace_discovery.sql`.

Inclui `docinspector_profiles`, `docinspector_workspace_members`, RLS, criação automática de profile e `docinspector_my_workspaces()` com `SECURITY INVOKER`. Papéis ficam exclusivamente na membership do workspace, não em metadata editável do usuário.

### Gate C — autorização das operações existentes — concluído em 2026-08-17

Migrations:
- `20260817163849_add_authenticated_inspection_and_storage_access.sql`;
- `20260817163910_restrict_legacy_sync_to_anon_during_auth_rollout.sql`;
- `20260817163946_close_internal_legacy_helpers_to_authenticated_clients.sql`.

O novo caminho autenticado usa exclusivamente `auth.uid()` + membership ativa:
- leitura de inspeções e tombstones: `ADMIN`, `INSPECTOR`, `SUPERVISOR`, `FOREMAN`;
- criação/alteração/exclusão de inspeções: somente `ADMIN` e `INSPECTOR`;
- leitura de evidências: todos os quatro perfis com membership ativa;
- upload/update/delete de evidências: somente `ADMIN` e `INSPECTOR`;
- novas RPCs `docinspector_*` são `SECURITY INVOKER` e dependem da RLS das tabelas;
- `authenticated` não pode executar as RPCs legadas de sincronização `sky17_*`;
- as políticas legadas do bucket de evidências permanecem temporariamente apenas para `anon`, preservando o app atual enquanto Auth continua desligado;
- os helpers legados `sky17_has_workspace_access` e `sky17_secret_hash` não são APIs executáveis por clientes Auth/anon.

A transição é intencionalmente dupla, mas sem bypass entre os mundos: o app atual continua no fluxo `anon + workspaceId + syncKey`; usuários autenticados ficam obrigatoriamente no caminho `docinspector_* + membership + role`.

Estado de dados antes/depois do Gate C: 13 inspeções, 3 tombstones e 1 evidência; nenhum registro operacional foi alterado pela migration.

### Gate D — interface e cliente autenticado — implementado em modo staged em 2026-08-17

O Gate D foi implementado sem ativar o corte global, pois o projeto ainda possui zero usuários Supabase Auth e zero memberships.

Componentes:
- `auth-entry.js` é o único bootstrap do aplicativo;
- quando Auth está ativo, `app.js` e módulos auxiliares só são carregados depois da validação da sessão/membership;
- tela de login por e-mail e senha;
- `auth-context.js` carrega perfil, workspaces e papel a partir do servidor;
- contexto offline é aceito somente após uma validação online anterior no mesmo aparelho e para o mesmo `user_id` da sessão armazenada;
- `sync-auth.js` usa as RPCs `docinspector_*` e o mesmo cliente Supabase Auth para Storage;
- nenhuma chamada autenticada envia `p_secret` ou a antiga sync key;
- o caminho legado continua delegado somente quando a flag de rollout está desligada;
- `permission-ui.js` aplica a UX compatível com o papel do usuário, enquanto o servidor continua sendo a autoridade;
- Supervisor/Encarregado têm experiência somente de leitura nesta fase, até a implantação do módulo separado de comentários;
- logout encerra a sessão local e limpa o contexto autenticado;
- assets do Gate D, inclusive a dependência `sync.js?legacy=1` do adaptador de rollout, são incluídos no shell offline;
- o browser gate Chromium/WebKit do Gate D foi concluído com sucesso antes do início do Gate E.

### Gate E — gestão/provisionamento de usuários — implementado em modo staged em 2026-08-17

Foi implantada a Edge Function `docinspector-user-admin` com `verify_jwt=true` e sua fonte foi versionada em `supabase/functions/docinspector-user-admin/index.ts`.

Regras do servidor:
- valida o JWT da sessão no Supabase Auth;
- exige membership ativa `ADMIN` no workspace solicitado;
- somente então usa `SUPABASE_SERVICE_ROLE_KEY`, que permanece exclusivamente no ambiente server-side da Edge Function;
- permite listar membros, convidar por e-mail, vincular usuário existente, alterar papel e ativar/desativar membership;
- não oferece exclusão física de usuário nesta fase;
- protege o último Administrador ativo contra rebaixamento ou desativação.

Cliente:
- `user-admin-ui.js` é carregado somente pelo bootstrap autenticado;
- a tela de gestão aparece apenas para `CAPABILITY.MANAGE_USERS`;
- `ADMIN` possui essa capability; `INSPECTOR` mantém acesso operacional total, mas não administra contas;
- convites e alterações usam `functions.invoke('docinspector-user-admin')` com a sessão corrente;
- nenhuma credencial privilegiada existe no navegador;
- o módulo foi incluído no app shell e o cache técnico do Service Worker avançou para `0.9.29`.

O Gate E continua staged porque ainda não existe um usuário Auth para ser promovido ao primeiro Administrador. Sem uma identidade/e-mail real não é seguro inventar ou provisionar uma conta. `AUTH_CONFIG.enabled` permanece `false` até o bootstrap da primeira conta e a homologação real de login/RLS/sync/Storage.

## Compatibilidade e rollback

Enquanto `AUTH_CONFIG.enabled` for `false`, a versão de campo continua operando como antes. Depois dos Gates B/C/D/E, rollback funcional deve preservar tabelas, migrations, Edge Function e módulos, mantendo o app no caminho legado. Não apagar usuários, memberships, inspeções ou evidências como mecanismo de rollback.

## Estratégia de revisão independente

Claude não deve ser executado em commits intermediários. A revisão Anthropic será solicitada uma única vez quando houver um primeiro Administrador provisionado, os fluxos autenticados reais estiverem homologados e CI/E2E estiverem verdes. Reexecutar somente diante de achado `BLOCKER`/`HIGH`, mudança substancial posterior ou alteração em área crítica que invalide a revisão anterior.
