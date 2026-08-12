# DocInspector v0.9.8 — Auditoria para uso em campo

## Escopo
Revisão integral da base v0.9.3 sem adição de funcionalidades de negócio. O foco foi confiabilidade operacional, integridade local/remota, comportamento offline, PWA, OCR, exportações, HTML/CSS/JavaScript e regressões.

## Correções de confiabilidade
- Rascunhos de revisão, comentário e marcações não são mais reconstruídos por uma sincronização automática enquanto o operador está preenchendo a verificação.
- Exclusão de cópia, tombstone da evidência remota e remoção do blob local passam a ocorrer em uma única transação IndexedDB.
- Edição de metadados não altera o objeto em memória antes da gravação ser confirmada.
- Operações já persistidas não são tratadas como falhas apenas porque uma releitura imediatamente posterior falhou.
- Teste da conexão configurada passa a validar schema, segredo do workspace e acesso ao bucket de evidências.
- Geração do ID do dispositivo possui fallback criptográfico quando randomUUID não estiver disponível.
- Atualizações futuras do Service Worker deixam de forçar ativação/reload no meio do trabalho de campo; a nova versão assume após fechamento/reabertura do app.
- Aquecimento das bibliotecas externas do PWA ocorre em paralelo, reduzindo tempo de instalação do cache.
- Duplicações internas sem efeito funcional em sync.js foram removidas.

## Validações executadas
- Sintaxe de todos os JavaScripts.
- Suíte automatizada de domínio, busca, catálogo, navegação, sincronização, OCR, XLSX e PDF.
- Parser de HTML e CSS.
- Manifest e referências do Service Worker.
- Igualdade dos dois arquivos SUPABASE-SETUP.sql e confirmação do schema v6.
- Integridade do ZIP final.

## Limite da auditoria
A auditoria automatizada não substitui o smoke test em um iPhone/Android e no projeto Supabase real. Antes de liberar para várias pessoas, execute o roteiro FIELD-SMOKE-TEST.md em pelo menos dois aparelhos conectados ao mesmo workspace.
