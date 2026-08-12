# Política de branches e releases — DocInspector

## Objetivo

Este documento define o fluxo obrigatório de mudanças do DocInspector. O objetivo é preservar a versão de campo, impedir alterações diretas não revisadas e tornar cada mudança rastreável e reversível.

## Branches permanentes

### `main`

Fonte da versão aprovada para uso e publicação.

Regras:

- nunca desenvolver diretamente em `main`;
- nenhuma IA deve escrever diretamente em `main`;
- alterações entram apenas por Pull Request;
- o CI `DocInspector CI / quality` deve estar aprovado antes do merge;
- toda mudança funcional deve ter teste de regressão correspondente quando tecnicamente aplicável;
- mudanças de schema Supabase exigem documentação de migração e validação de compatibilidade;
- releases devem ser criadas a partir de um commit aprovado de `main`.

### `develop`

Branch de integração da próxima versão.

Regras:

- recebe PRs vindos de `feature/*`, `fix/*`, `chore/*` e `docs/*`;
- deve permanecer verde no CI;
- não deve conter experimentos descartáveis ou código incompleto sem isolamento explícito;
- promoção para `main` acontece por PR de release.

## Branches temporárias

Use uma branch por alteração:

- `feature/<nome>` — nova funcionalidade;
- `fix/<nome>` — correção de defeito;
- `chore/<nome>` — infraestrutura, CI, organização ou manutenção;
- `docs/<nome>` — documentação sem mudança funcional;
- `release/<versao>` — estabilização final antes de `main`, quando necessário.

## Fluxo obrigatório

1. Partir de `develop` atualizado.
2. Criar branch específica.
3. Investigar causa raiz antes de alterar código.
4. Procurar falhas da mesma classe em componentes semelhantes.
5. Implementar a solução estrutural.
6. Criar/atualizar testes.
7. Executar `npm run check`.
8. Abrir PR para `develop`.
9. Fazer revisão técnica independente.
10. Corrigir achados relevantes.
11. Só então realizar merge.

Para release:

1. Garantir `develop` verde.
2. Abrir PR `develop` → `main` ou `release/*` → `main`.
3. Reexecutar CI e smoke test de campo aplicável.
4. Revisar changelog e versão.
5. Fazer merge sem force-push.

## Proibições

- `push --force` em `main` ou `develop`;
- commits diretos em `main`;
- merge com CI falhando;
- remover testes para fazer uma mudança passar;
- alterar Supabase silenciosamente;
- corrigir apenas o sintoma conhecido sem investigar ocorrências equivalentes;
- marcar uma versão como estável somente porque compila.

## Critério de rollback

Se uma regressão relevante for descoberta após merge em `main`, o padrão é reverter o commit/PR causador ou preparar um `fix/*` pequeno e testado. Não editar a produção manualmente fora do Git sem registrar a alteração no repositório.
