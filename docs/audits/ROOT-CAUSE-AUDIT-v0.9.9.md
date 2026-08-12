# Root Cause Audit — DocInspector v0.9.11

## Evidências órfãs

A v0.9.8 tornou visível uma inconsistência que antes ficava silenciosa: algumas cópias possuíam `evidenceId`, mas o Blob correspondente já não existia no IndexedDB. Isso pode ocorrer com registros históricos criados antes do fluxo atual de persistência, limpeza/evicção do armazenamento do navegador, restauração de dados sem os blobs ou interrupção entre upload remoto e persistência de `evidencePath`.

A ausência do Blob local não prova que a foto não esteja no Supabase. Por isso, a v0.9.11 passa a reconciliar a referência pelo caminho determinístico da cópia no Storage. Se o arquivo remoto existir, o vínculo é reconstruído. Se a consulta ao Storage falhar, nada é descartado. Somente quando o Storage responde corretamente e confirma a ausência é que o registro passa a ser marcado como evidência histórica indisponível.

Essa condição deixa de bloquear toda a sincronização, pois repetir uploads de um arquivo que não existe é uma operação impossível. O registro documental permanece preservado e a perda da fotografia fica explicitamente registrada.
