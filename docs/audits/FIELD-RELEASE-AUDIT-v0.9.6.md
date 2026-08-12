# DocInspector v0.9.8 — Auditoria profunda para piloto de campo

## Princípio
Correção de causa raiz e prevenção de recorrência, priorizando integridade e previsibilidade.

## Medidas adotadas

1. **Concorrência de gravação** — antes de uma escrita local, o IndexedDB confere se a inspeção persistida ainda é a mesma versão que o operador abriu. Registros de campo podem ser conciliados com a versão mais recente sem perder cópias; exclusões também verificam concorrência.
2. **Backup verificável** — o formato v4 inclui SHA-256 do conjunto de inspeções. A restauração rejeita um backup v4 alterado ou corrompido.
3. **Fotos locais** — antes do backup, o sistema identifica evidências ainda não sincronizadas e exige decisão explícita do usuário.
4. **Diagnóstico pré-campo** — nova rotina em Dados e backup verifica IndexedDB, persistência de armazenamento, espaço disponível, Service Worker, cache das bibliotecas, inicialização do OCR, evidências e Supabase.
5. **PWA** — a preparação de dependências recebe confirmação do Service Worker, em vez de assumir que o cache funcionou.
6. **Segurança HTTP** — HSTS e Cross-Origin-Resource-Policy reforçados sem introduzir CSP arriscada antes de remover dependências externas.
7. **Compatibilidade** — Supabase continua no schema v6. Backups v1–v3 permanecem restauráveis.

## Limites conhecidos
- As bibliotecas principais ainda vêm de CDNs no primeiro carregamento; o diagnóstico pré-campo força e verifica o cache.
- O OCR permanece assistivo e exige confirmação humana.
- O piloto real com pelo menos dois aparelhos e alternância online/offline continua sendo o teste final necessário.
