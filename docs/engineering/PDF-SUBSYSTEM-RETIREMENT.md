# Retirada do subsistema de PDF confidencial

## Estado

O subsistema de arquivos PDF confidenciais foi retirado do runtime do DocInspector. O aplicativo não carrega mais upload, visualizador, PDF.js, armazenamento cifrado, cofre offline, envelopes de chave, rotação E2EE ou vínculo de PDF a documentos.

A exportação do **relatório de inspeção para PDF** permanece. Ela usa jsPDF e é uma capacidade independente do subsistema retirado.

## Expurgo de banco

A etapa de expurgo foi aprovada depois da retirada do runtime. A migração `20260903161831_remove_confidential_pdf_database_subsystem.sql` elimina a superfície de banco específica do recurso retirado: políticas de acesso ao bucket, RPCs de criptografia/rotação, o guard E2EE de desativação de membros, tabelas de PDFs confidenciais, envelopes, backups e chaves.

As migrações históricas anteriores permanecem no repositório como trilha de migração já aplicada; elas não são reescritas nem apagadas.

## Storage

Os bytes dos objetos do bucket `docinspector-confidential-pdfs` precisam ser excluídos pela **Storage API** antes de o bucket ser removido. O Supabase orienta explicitamente a não excluir `storage.objects` por SQL, pois isso remove apenas metadados e deixa arquivos órfãos no provedor de armazenamento.

Por isso, a migração de banco não executa `DELETE` em `storage.objects` nem remove o bucket por SQL. Ela remove as políticas de cliente para impedir novo uso do recurso; o esvaziamento e a exclusão física do bucket são uma etapa operacional separada, via Storage API com credencial administrativa.

## Garantias de regressão

A suíte automatizada verifica que:

- não existem módulos `confidential-*` nem o shim de upload retirado;
- `pdfjs-dist` e o processo de vendor do PDF.js não fazem parte do build;
- Service Worker, autenticação, administração de usuários, lixeira e gestão de documentos não referenciam o subsistema retirado;
- a migração de expurgo remove a superfície de banco específica do recurso sem manipular `storage.objects` por SQL;
- a exportação normal do relatório em PDF continua disponível.
