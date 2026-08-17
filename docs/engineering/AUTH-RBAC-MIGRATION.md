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

### Gate A — fundação no cliente

- modelo central de papéis e capacidades;
- cliente Supabase Auth separado do cliente legado de sincronização;
- sessão persistente com auto-refresh;
- login por e-mail e senha;
- logout somente da sessão atual;
- testes de regressão do mapa de permissões.

Nenhuma RPC existente é alterada neste gate.

### Gate B — schema de identidade

Adicionar, por migration versionada, estruturas equivalentes a:

- perfil de usuário (`user_id`, nome de exibição, ativo);
- associação usuário/workspace (`workspace_id`, `user_id`, `role`, ativo);
- índices nos campos usados por autorização;
- RLS e grants mínimos para `authenticated`;
- função/RPC read-only que retorne somente os workspaces e perfis aos quais `auth.uid()` pertence.

Papéis de autorização não devem ser derivados de `raw_user_meta_data`.

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

Enquanto `AUTH_CONFIG.enabled` for `false`, a versão de campo continua operando como antes. Se uma regressão for encontrada durante a migração, a branch pode ser descartada sem alteração de dados de produção.

Depois da ativação, rollback exige preservar as tabelas de identidade e reverter apenas o enforcement no cliente/RPC; nenhuma migration deve apagar usuários ou inspeções como parte do rollback.

## Estratégia de revisão independente

Claude não deve ser executado em commits intermediários. A revisão Anthropic será solicitada uma única vez quando os gates A–D estiverem implementados, testes/CI estiverem verdes e o PR estiver estabilizado. Reexecutar somente diante de achado `BLOCKER`/`HIGH`, mudança substancial posterior ou alteração em área crítica que invalide a revisão anterior.
