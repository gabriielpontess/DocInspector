# Contribuindo com o DocInspector

## Branches

- `main`: baseline aprovada.
- `develop`: integração.
- `feature/<descricao>`: funcionalidade.
- `fix/<descricao>`: correção.

## Antes de abrir PR

1. Leia `AI-DEVELOPMENT-RULES.md`.
2. Identifique causa raiz e riscos derivados.
3. Execute `npm run check` e `npm test`.
4. Inclua teste de regressão quando corrigir defeito.
5. Confira que nenhum segredo/credencial foi incluído.
6. Descreva como validar em navegador/aparelho real quando aplicável.

## Critério de merge

Um PR só deve entrar em `main` depois de CI aprovado e revisão do diff. Mudanças críticas de IndexedDB, sincronização, Supabase, evidências, PWA, OCR ou exportação exigem smoke test correspondente.
