# Retirada do subsistema de PDF confidencial

## Estado

O subsistema de arquivos PDF confidenciais foi retirado do runtime do DocInspector. O aplicativo não carrega mais upload, visualizador, PDF.js, armazenamento cifrado, cofre offline, envelopes de chave, rotação E2EE ou vínculo de PDF a documentos.

A exportação do **relatório de inspeção para PDF** permanece. Ela usa jsPDF e é uma capacidade independente do subsistema retirado.

## Dados legados

As migrações históricas do Supabase permanecem no repositório como trilha de migração já aplicada. O banco de produção também mantém, por enquanto, os registros e objetos cifrados criados antes da retirada. O aplicativo não depende deles nem fornece interface para acessá-los.

A exclusão física de bucket, objetos, tabelas, funções e chaves legadas é uma operação irreversível e deve ser executada somente em uma etapa de expurgo explicitamente aprovada, depois de confirmar que não há necessidade de recuperação desses dados.

## Garantias de regressão

A suíte automatizada verifica que:

- não existem módulos `confidential-*` nem o shim de upload retirado;
- `pdfjs-dist` e o processo de vendor do PDF.js não fazem parte do build;
- Service Worker, autenticação, administração de usuários, lixeira e gestão de documentos não referenciam o subsistema retirado;
- a exportação normal do relatório em PDF continua disponível.
