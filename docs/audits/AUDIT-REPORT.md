# DocInspector v0.9.8 — Auditoria de liberação para campo

## Resultado
A base v0.9.3 foi revisada integralmente. Não foram adicionadas funções de negócio; a v0.9.8 concentra correções de confiabilidade, consistência e operação offline/sincronizada.

## Achados críticos/altos corrigidos

### 1. Rascunho de verificação podia ser perdido durante sync automático — ALTO
A atualização visual pós-sync reconstruía a área do documento selecionado. Revisão, comentário ou marcações ainda não salvos podiam desaparecer. A v0.9.8 detecta edição ativa/rascunho e não reconstrói esse formulário durante a sincronização.

### 2. Exclusão de cópia e evidência não era atômica — ALTO
Documento, blob local e fila de exclusão remota eram atualizados em operações separadas. Agora são persistidos em uma única transação IndexedDB.

### 3. Falha de releitura pós-gravação podia parecer falha de gravação — MÉDIO
Alguns fluxos salvavam corretamente e em seguida dependiam de uma nova leitura do IndexedDB. Se essa releitura falhasse, o operador podia receber erro apesar de a alteração já estar persistida. As releituras pós-commit agora são best-effort e não revertem uma gravação confirmada.

### 4. Edição de metadados alterava o objeto em memória antes do commit — MÉDIO
Nome, sistema, responsável e local eram modificados antes da confirmação do IndexedDB. Agora o app grava uma cópia atualizada e só substitui o estado após o commit.

### 5. Testar conexão validava somente URL/chave/schema — MÉDIO
O teste do aparelho já configurado agora valida também o segredo do workspace e o acesso ao bucket privado de evidências.

### 6. Atualização do PWA podia recarregar a aplicação durante uso — ALTO
O ciclo anterior forçava skipWaiting/controllerchange. A partir desta versão, atualizações futuras aguardam fechamento/reabertura do app, reduzindo risco de interrupção durante uma inspeção.

## Correções menores
- Removida duplicação de `publishableKey` na criação do workspace.
- Removida condição duplicada na fila de exclusões remotas.
- Adicionado fallback criptográfico de UUID para o identificador do dispositivo.
- Aquecimento das bibliotecas externas do Service Worker passou a ser paralelo.
- Comentários do SQL atualizados para deixar explícita a compatibilidade do schema v6.

## Verificações sem alteração necessária
- Regras Conforme / Não conforme / Não encontrado / Pendente.
- Isolamento de listas de inspeção.
- Busca global e seleção explícita de PW ambíguo.
- OCR sem autocorreção baseada na lista.
- Exportação PDF/XLSX.
- Backup/restauração.
- Responsividade e safe areas.
- Estrutura RLS/RPC do Supabase schema v6.

## Status
Nenhum erro de sintaxe, parser, referência PWA ou teste automatizado permaneceu na auditoria final. A validação contra o Supabase real e dispositivos físicos deve seguir o roteiro `FIELD-SMOKE-TEST.md` antes de liberar para vários operadores.
