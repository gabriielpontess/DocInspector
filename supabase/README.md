# Supabase — DocInspector

**Schema atual: v6 (DocInspector v0.6.4).**

## Instalação ou atualização

1. Abra o projeto no Supabase.
2. Acesse **SQL Editor → New query**.
3. Abra `SUPABASE-SETUP.sql` desta pasta.
4. Copie e execute o arquivo por inteiro.
5. Não apague as tabelas existentes para atualizar uma instalação já em uso.
6. No DocInspector, abra **Dados e backup → Sincronização Supabase** e use **Testar conexão**.

O script é migratório/idempotente para a estrutura prevista pelo projeto e preserva os dados das versões anteriores.

## Segurança

Use no navegador somente a **Project URL** e a **Publishable Key**. Nunca exponha Secret Key, `service_role`, senha do banco ou outras credenciais privilegiadas.

As tabelas usam RLS e não concedem CRUD direto ao cliente. As operações do PWA passam por RPCs com validação do workspace e do segredo compartilhado. O bucket `docinspector-evidence` é privado e as políticas de Storage aplicam o mesmo contexto do workspace.

Os nomes SQL `sky17_*` são mantidos deliberadamente por compatibilidade histórica. O nome público do produto é DocInspector.

## Schema v6

O schema v6 mantém tabelas, workspaces, inspeções, tombstones e Storage do schema v5 e reforça `sky17_upsert_inspection()` com validação do payload JSON, limite de tamanho e limite de documentos por inspeção.

Consulte `MIGRATIONS.md` para o histórico completo.

### v0.7.0

A v0.7.0 não altera o schema. Se `sky17_schema_version()` já retorna `6`, não execute uma migração adicional apenas por causa desta atualização do PWA.

### v0.7.1
A v0.7.1 não altera o schema Supabase. O renomeio da lista é armazenado no payload JSON já sincronizado. Se `sky17_schema_version()` retorna `6`, nenhuma migração adicional é necessária.

### v0.7.2

A v0.7.2 não altera o schema Supabase. Se `sky17_schema_version()` retorna `6`, nenhuma migração adicional é necessária.


### v0.9.3

Sem alteração no Supabase. A atualização é exclusivamente de exportação/PWA.
