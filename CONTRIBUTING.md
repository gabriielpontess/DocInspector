# Contribuindo com o DocInspector

## Fonte da verdade

O repositório GitHub é a fonte oficial do DocInspector. ZIPs são apenas artefatos de release/backup e não substituem o histórico Git.

## Branches

- `main`: versão aprovada para uso/publicação.
- `develop`: integração da próxima versão.
- `feature/<descricao>`: nova funcionalidade.
- `fix/<descricao>`: correção.
- `chore/<descricao>`: manutenção, CI, governança e infraestrutura.
- `docs/<descricao>`: documentação.

Leia também `docs/engineering/BRANCH-POLICY.md`.

## Regras de alteração

1. Nunca desenvolver diretamente em `main`.
2. Partir de `develop` para uma branch específica.
3. Ler `AI-DEVELOPMENT-RULES.md` antes de alterar código.
4. Identificar causa raiz e procurar a mesma classe de falha em componentes semelhantes.
5. Não remover nem acrescentar funcionalidade fora do escopo autorizado.
6. Incluir teste de regressão para defeitos corrigidos quando tecnicamente aplicável.
7. Executar `npm run check` antes do PR.
8. Conferir que nenhuma credencial privilegiada foi incluída.
9. Documentar alterações de Supabase e compatibilidade de schema.
10. Descrever validação em navegador/aparelho real quando aplicável.

## Pull Requests

PRs de trabalho normal apontam para `develop`.

Um PR deve informar:

- problema/objetivo;
- causa raiz;
- solução adotada;
- riscos derivados;
- testes executados;
- impacto em dados, sincronização, PWA, OCR, exportação e responsividade;
- estratégia de rollback.

Mudanças críticas devem receber uma segunda revisão independente usando `docs/engineering/AI-REVIEW-CHECKLIST.md`.

## Promoção para `main`

A promoção de `develop` para `main` ocorre somente por Pull Request de release. Antes do merge:

- CI verde;
- diff revisado;
- ausência de achados `BLOCKER` ou `HIGH` pendentes;
- smoke test correspondente para mudanças críticas;
- changelog/versão revisados;
- rollback conhecido.

## Critério de merge

Nenhum PR deve ser aprovado apenas porque compila ou porque o CI atual passou. O critério é ausência de regressão conhecida, causa raiz tratada, testes adequados e revisão do impacto sistêmico.
