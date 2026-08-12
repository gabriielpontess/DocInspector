# Auditoria tipográfica — DocInspector v0.9.8

Foi centralizada a tipografia do aplicativo em uma escala única baseada em rem e clamp.

- Família UI única com fallbacks nativos.
- Corpo base: 1rem, line-height 1.5.
- Títulos: escala responsiva e line-height reduzido.
- Labels/metadados: 0.875rem; overlines: 0.75rem.
- Inputs mantidos em pelo menos 1rem para legibilidade móvel.
- Tabelas padronizadas em 0.875rem com cabeçalhos de 0.75rem.
- Botões, navegação, badges e pills recebem alinhamento vertical consistente.
- Breakpoints móveis preservam hierarquia sem comprimir texto excessivamente.

A alteração é exclusivamente visual/tipográfica; domínio, IndexedDB, OCR, sincronização, exportação e schema Supabase não foram modificados.
