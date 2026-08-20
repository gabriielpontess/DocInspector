# Migrações Supabase — DocInspector

## Solicitação de acesso — feature em homologação

- Migração: `20260819230500_add_workspace_access_requests.sql`.
- Adiciona `docinspector_workspace_access_codes` e `docinspector_access_requests` sem alterar payloads, inspeções, evidências ou tombstones existentes.
- Mantém as novas tabelas sem grants diretos para `anon`/`authenticated`; leitura e escrita ocorrem apenas pelas Edge Functions previstas.
- Todo workspace existente recebe um código no backfill e workspaces criados depois da migração recebem código por trigger interno.
- Pedidos usam os estados `PENDING`, `PROCESSING`, `APPROVED` e `REJECTED`. `PROCESSING` é um claim transitório com token e TTL para impedir dois ADMINs de executar provisionamento simultaneamente e permitir recuperação após falha parcial.
- O índice parcial garante no máximo um pedido ativo (`PENDING`/`PROCESSING`) por e-mail e workspace.
- `supabase/config.toml` deixa somente `docinspector-access-request` sem verificação JWT no gateway; a função pública continua validando origem, código do workspace e controles antiabuso. `docinspector-user-admin` permanece com JWT obrigatório e valida membership ADMIN no servidor.

### Compatibilidade e rollback

A migração é aditiva e não modifica o fluxo legado `anon`, que continua sob o bloqueio de cutover já definido pelo projeto. Antes de qualquer ativação com dados reais, o rollback técnico pode remover o trigger, a função interna de seed e as duas tabelas novas. Depois que pedidos reais existirem, não eliminar as tabelas para fazer rollback: desabilite/reverta o endpoint público e preserve `docinspector_access_requests` como trilha de auditoria até uma migração explícita de retenção.

## Schema 6 — DocInspector v0.6.4

- Mantém as tabelas, workspaces, inspeções, tombstones e bucket do schema 5.
- `sky17_schema_version()` passa a retornar `6`.
- `sky17_upsert_inspection()` valida se o payload é objeto JSON, exige `documents` como array, limita o payload a 12 MB e limita a 50.000 documentos por inspeção.
- Não remove nem recria dados existentes.
- Execute novamente `supabase/SUPABASE-SETUP.sql` por inteiro no mesmo projeto Supabase.

## Schema 5 — DocInspector v0.6.1

- Mantém todas as tabelas e dados do schema 4.
- Cria o bucket privado `docinspector-evidence` para fotografias.
- Adiciona políticas RLS para Storage vinculadas ao mesmo workspace/chave de sincronização.
- A aplicação passa a enviar e baixar evidências por Supabase Storage.
- Execute novamente `SUPABASE-SETUP.sql`; não é necessário apagar tabelas nem recriar o espaço.

## Schema 4 — DocInspector v0.5.3

Esta migração corrige um conflito real de sincronização entre espaços.

- `sky17_inspections` deixa de usar `id` como chave primária global.
- A chave passa a ser composta por `(workspace_id, id)`.
- A mesma inspeção pode existir em espaços diferentes sem colisão.
- Os registros existentes são preservados.
- `sky17_schema_version()` passa a retornar `4`.

### Como atualizar do schema 3

1. Abra o **SQL Editor** do mesmo projeto Supabase já utilizado pelo DocInspector.
2. Execute novamente, por inteiro, `supabase/SUPABASE-SETUP.sql` da versão v0.5.3.
3. Não apague as tabelas existentes.
4. Depois publique a v0.5.3 e use **Testar conexão** no aplicativo.

## Schema 3 — DocInspector v0.5.2

- `sky17_workspaces`: espaços de sincronização e hash da chave privada.
- `sky17_inspections`: payload das inspeções sincronizadas.
- `sky17_deletions`: tombstones usados para propagar exclusões entre dispositivos.
- RLS habilitado nas tabelas expostas.
- CRUD direto por `anon`/`authenticated` revogado.
- Operações do PWA realizadas por RPCs `SECURITY DEFINER` com validação de `workspace_id` + segredo.

### Compatibilidade

Os prefixos internos `sky17_*` continuam preservados intencionalmente para não quebrar bancos e códigos de conexão existentes. Não renomeie essas tabelas ou funções manualmente.

## v0.6.0
Nenhuma alteração de schema SQL é necessária. As cópias de campo são armazenadas dentro do payload JSONB da inspeção. O merge do cliente foi atualizado para conciliar cópias por identificador.

## DocInspector v0.7.0

Nenhuma migração de banco necessária. O schema permanece v6. A mudança de catálogo/verificação global é exclusivamente de aplicação; os registros continuam armazenados por `workspace_id` e `inspection id` como nas versões anteriores.

## DocInspector v0.7.1
Sem migração SQL. A versão adiciona apenas um atributo de apresentação (`name`) no JSON da inspeção, compatível com o schema v6.

## DocInspector v0.7.2

Não altera o schema Supabase. As alterações de Sistema, Responsável, Local e Nome da lista são gravadas no payload JSON de cada inspeção já sincronizado pelo schema v6.


## DocInspector v0.9.3

Sem alteração de schema. Permanece v6.
