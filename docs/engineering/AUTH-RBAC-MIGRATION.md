# Migração de autenticação e perfis — DocInspector

## Objetivo

Introduzir identidade individual via Supabase Auth e autorização por perfil sem interromper o modo offline-first, a sincronização existente ou o uso de campo durante a transição.

## Perfis

- `ADMIN` — acesso total.
- `INSPECTOR` — acesso total.
- `SUPERVISOR` — visualização de documentos e comentários.
- `FOREMAN` — visualização de documentos e comentários.

A interface pode ocultar ações não autorizadas, mas isso não é a fronteira de segurança. Toda operação privilegiada deve ser validada novamente no Supabase.

## Rollout seguro

A migração é dividida em gates. `AUTH_CONFIG.enabled` permanece `false` até que o Gate D esteja validado.

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
- `authenticated` não pode executar as RPCs legadas `sky17_*` de sincronização;
- as políticas legadas do bucket de evidências permanecem temporariamente apenas para `anon`, preservando o app atual enquanto Auth continua desligado;
- os helpers legados `sky17_has_workspace_access` e `sky17_secret_hash` não são APIs executáveis por clientes Auth/anon.

A transição é intencionalmente dupla, mas sem bypass entre os mundos: o app atual continua no fluxo `anon + workspaceId + syncKey`; usuários autenticados ficam obrigatoriamente no caminho `docinspector_* + membership + role`.

Estado de dados antes/depois do Gate C: 13 inspeções, 3 tombstones e 1 evidência; nenhum registro operacional foi alterado pela migration.

Os advisors após o Gate C não apontam `SECURITY DEFINER` acessível por `authenticated`. Permanecem apenas avisos para RPCs legadas acessíveis por `anon`, necessários temporariamente para compatibilidade e previstos para remoção após o Gate D e homologação do corte.

### Gate D — ativação da interface

Próximos passos:
1. habilitar a tela de login em ambiente controlado;
2. carregar usuário, perfil e membership após autenticação;
3. trocar sync/evidências para as RPCs/políticas autenticadas;
4. filtrar navegação e ações por capacidade;
5. validar Supervisor/Encarregado sem escrita operacional;
6. validar Admin/Inspetor com escrita;
7. validar logout, expiração, offline e retorno online;
8. somente após homologação remover o caminho legado `anon + syncKey`.

### Gate E — gestão de usuários

Criação, convite, desativação e alteração de usuários nunca devem usar `service_role`/secret key no navegador. Essas operações exigirão componente server-side que autentique o chamador e confirme seu papel antes de usar credenciais elevadas.

## Compatibilidade e rollback

Enquanto `AUTH_CONFIG.enabled` for `false`, a versão de campo continua operando como antes. Depois dos Gates B/C, rollback funcional deve preservar as novas tabelas e migrations e simplesmente manter o app no caminho legado. Não apagar usuários, memberships, inspeções ou evidências como mecanismo de rollback.

## Estratégia de revisão independente

Claude não deve ser executado em commits intermediários. A revisão Anthropic será solicitada uma única vez quando os Gates A–D estiverem implementados, testes/CI estiverem verdes e o PR estiver estabilizado. Reexecutar somente diante de achado `BLOCKER`/`HIGH`, mudança substancial posterior ou alteração em área crítica que invalide a revisão anterior.
