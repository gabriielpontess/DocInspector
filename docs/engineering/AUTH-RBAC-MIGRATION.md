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

A migração é dividida em gates. O rollout autenticado foi ativado no branch de homologação somente depois do primeiro Administrador ser provisionado e validado.

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
- as políticas legadas do bucket de evidências permanecem temporariamente apenas para `anon` enquanto existe rollback operacional;
- os helpers legados `sky17_has_workspace_access` e `sky17_secret_hash` não são APIs executáveis por clientes Auth/anon.

### Gate D — interface e cliente autenticado — concluído

Componentes:
- `auth-entry.js` é o único bootstrap do aplicativo;
- quando Auth está ativo, `app.js` e módulos auxiliares só são carregados depois da validação da sessão/membership;
- tela de login por e-mail e senha;
- `auth-context.js` carrega perfil, workspaces e papel a partir do servidor;
- contexto offline é aceito somente após uma validação online anterior no mesmo aparelho e para o mesmo `user_id` da sessão armazenada;
- `sync-auth.js` usa as RPCs `docinspector_*` e o mesmo cliente Supabase Auth para Storage;
- nenhuma chamada autenticada envia `p_secret` ou a antiga sync key;
- `permission-ui.js` aplica a UX compatível com o papel do usuário, enquanto o servidor continua sendo a autoridade;
- logout encerra a sessão local e limpa o contexto autenticado.

### Gate E — gestão/provisionamento de usuários — concluído

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
- nenhuma credencial privilegiada existe no navegador.

## Consolidação do workspace operacional

O ambiente legado possuía 12 workspaces criados durante ciclos anteriores de teste/sincronização. O workspace operacional foi padronizado como:

- `816d7fa6-d9ac-440f-ae40-19e23d54e376` — `DocInspector Principal`;
- uma membership `ADMIN` ativa;
- onze memberships legadas desativadas sem exclusão dos dados históricos;
- quatro inspeções operacionais atuais: 3°/4° Trilho, SSC, PSD e AMV.

Foi detectado que a versão inicial do sync autenticado podia adotar e enviar para o workspace corrente uma inspeção local sem origem conhecida. Esse comportamento chegou a copiar o PSD legado de 124 documentos para o workspace principal. A cópia indevida foi removida e tombstonada no principal; o registro histórico permanece nos workspaces legados inativos.

Hardening aplicado em `sync-auth.js`:
- vínculo local explícito com o workspace autenticado;
- quarentena de filas pendentes ao trocar o vínculo;
- inspeções locais anteriores ao vínculo e ausentes no remoto não são enviadas automaticamente;
- esses registros são preservados em quarentena local recuperável e removidos da lista operacional ativa;
- evidências são sincronizadas apenas para inspeções aceitas no workspace atual.

## Recuperação de senha

Após a primeira homologação foi observada uma tentativa de login sem criação de sessão Auth, enquanto a conta, o e-mail confirmado e a membership `ADMIN` permaneciam íntegros. Para eliminar dependência de resets administrativos manuais, o cliente recebeu o fluxo oficial de recuperação por e-mail do Supabase:

- `auth.js` usa `resetPasswordForEmail()`;
- `detectSessionInUrl` fica habilitado para processar o retorno seguro do link;
- `auth-entry.js` reconhece `PASSWORD_RECOVERY` e apresenta formulário para definir e confirmar a nova senha;
- a nova senha é aplicada por `auth.updateUser()` em uma sessão de recuperação válida;
- a tela de login possui `Esqueci minha senha`;
- o Service Worker avançou para `0.9.33` para substituir os módulos Auth pré-cacheados.

O primeiro e-mail de recuperação foi disparado pelo endpoint público oficial do Supabase Auth. `pg_net` foi habilitado apenas durante essa chamada e removido imediatamente em seguida; nenhuma chave privilegiada ou senha foi enviada por SQL.

## Compatibilidade e rollback

O legado `anon + workspaceId + syncKey` permanece apenas como ponte de rollback até a homologação final autenticada. Rollback não deve apagar usuários, memberships, migrations, inspeções, evidências ou workspaces históricos.

## Estratégia de revisão independente

Claude não deve ser executado em commits intermediários. A revisão Anthropic será solicitada uma única vez quando login/recuperação, workspace principal, sincronização, Storage e CI/E2E estiverem homologados. Reexecutar somente diante de achado `BLOCKER`/`HIGH`, mudança substancial posterior ou alteração em área crítica que invalide a revisão anterior.
