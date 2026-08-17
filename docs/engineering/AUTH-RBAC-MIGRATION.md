# Migração de autenticação e perfis — DocInspector

## Objetivo

Introduzir identidade individual via Supabase Auth e autorização por perfil sem interromper o modo offline-first, a sincronização existente ou o uso de campo durante a transição.

## Perfis

- `ADMIN` — acesso total.
- `INSPECTOR` — acesso total.
- `SUPERVISOR` — visualização de documentos e comentários.
- `FOREMAN` — visualização de documentos e comentários.

A interface pode ocultar ações não autorizadas, mas isso não é a fronteira de segurança. Toda operação privilegiada deverá ser validada novamente no Supabase.

## Rollout seguro

A migração é deliberadamente dividida em gates. `AUTH_CONFIG.enabled` permanece `false` até que todos os gates abaixo tenham sido validados.

### Gate A — fundação no cliente — concluído

- modelo central de papéis e capacidades;
- cliente Supabase Auth separado do cliente legado de sincronização;
- sessão persistente com auto-refresh;
- login por e-mail e senha;
- logout somente da sessão atual;
- testes de regressão do mapa de permissões.

Nenhuma RPC existente foi alterada neste gate.

### Gate B — schema de identidade — concluído em 2026-08-17

Migrations aplicadas e versionadas:

- `20260817162807_add_auth_profiles_and_workspace_memberships.sql`;
- `20260817162939_add_authenticated_workspace_discovery.sql`.

Estruturas criadas:

- `public.docinspector_profiles` — perfil vinculado 1:1 a `auth.users`; não contém papel de autorização;
- `public.docinspector_workspace_members` — associação `workspace_id + user_id`, papel e estado ativo;
- índice parcial por usuário/workspace para memberships ativas;
- trigger privado que cria o perfil automaticamente ao inserir um usuário em `auth.users`;
- triggers privados de `updated_at`;
- RLS em `docinspector_profiles`, `docinspector_workspace_members` e leitura autenticada de `sky17_workspaces`;
- grants mínimos para `authenticated`;
- RPC read-only `public.docinspector_my_workspaces()` com `SECURITY INVOKER`.

Regras de segurança deste gate:

- `anon` não recebe acesso às novas estruturas;
- um usuário autenticado só lê o próprio perfil;
- um usuário autenticado só lê as próprias memberships;
- `display_name` é o único campo de perfil atualizável pelo próprio usuário;
- papéis de autorização não são derivados de `raw_user_meta_data` nem ficam em `docinspector_profiles`;
- somente memberships ativas tornam um workspace visível em `docinspector_my_workspaces()`;
- a RPC de descoberta não usa `SECURITY DEFINER` e respeita RLS.

Estado no momento da aplicação: 12 workspaces, 13 inspeções, 3 tombstones e 0 usuários Auth. Nenhuma inspeção, exclusão ou evidência foi alterada pela migration.

Os advisors após o Gate B não apontaram falha nova nas estruturas de identidade. Avisos existentes permanecem no mecanismo legado `sky17_* SECURITY DEFINER`, que será tratado no Gate C. O índice de memberships aparece inicialmente como não utilizado porque ainda não existem usuários/memberships.

### Gate C — autorização das operações existentes

As RPCs de inspeção e as políticas de Storage devem passar a validar usuário autenticado + associação ativa ao workspace. Durante a migração, o mecanismo `workspaceId + syncKey` pode coexistir somente enquanto necessário para compatibilidade e rollback.

Operações de escrita devem exigir `ADMIN` ou `INSPECTOR`. Leitura deve aceitar os quatro perfis. O futuro sistema de comentários terá política própria para permitir escrita a `SUPERVISOR` e `FOREMAN` sem liberar edição da inspeção.

### Gate D — ativação da interface

Somente após schema, RLS/RPC, testes e CI:

1. habilitar a tela de login;
2. carregar o perfil do usuário após autenticação;
3. filtrar navegação e ações por capacidade;
4. manter validação equivalente no servidor;
5. validar logout, expiração de sessão, offline e retorno online.

### Gate E — gestão de usuários

Criação, convite, desativação e alteração de usuários nunca devem usar `service_role`/secret key no navegador. Essas operações exigirão um componente server-side (por exemplo Edge Function) que autentique o chamador e confirme seu papel antes de usar credenciais elevadas.

## Compatibilidade e rollback

Enquanto `AUTH_CONFIG.enabled` for `false`, a versão de campo continua operando como antes.

Depois do Gate B, rollback funcional deve preservar `docinspector_profiles` e `docinspector_workspace_members` e simplesmente não consumir essas estruturas enquanto Auth estiver desativado. Não apagar usuários, memberships ou inspeções como mecanismo de rollback.

## Estratégia de revisão independente

Claude não deve ser executado em commits intermediários. A revisão Anthropic será solicitada uma única vez quando os gates A–D estiverem implementados, testes/CI estiverem verdes e o PR estiver estabilizado. Reexecutar somente diante de achado `BLOCKER`/`HIGH`, mudança substancial posterior ou alteração em área crítica que invalide a revisão anterior.
