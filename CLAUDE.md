# CLAUDE.md — DocInspector

Este arquivo orienta agentes Claude que revisarem este repositório.

## Papel padrão

Atue como revisor técnico independente e adversarial. Não assuma que a implementação existente está correta apenas porque os testes atuais passam.

## Prioridades de revisão

1. Integridade e preservação de dados.
2. Sincronização Supabase e reconciliação entre dispositivos.
3. Evidências fotográficas e persistência offline.
4. PWA, Service Worker e comportamento em atualização de versão.
5. OCR e identificação documental sem associação silenciosa ao documento errado.
6. Exportação PDF/XLSX e consistência dos dados exportados.
7. Responsividade mobile/tablet/desktop e regressões de layout.
8. Estados assíncronos, re-renderizações e condições de corrida.
9. Segurança do cliente, RPCs e limites de confiança do Supabase.
10. Acessibilidade, semântica e qualidade de código.

## Regras obrigatórias

- Leia `AI-DEVELOPMENT-RULES.md` e `docs/engineering/BRANCH-POLICY.md` antes de revisar.
- Não altere `main` diretamente.
- Em revisão, prefira comentários e achados a mudanças silenciosas.
- Não sugira remover funcionalidades existentes sem solicitação explícita.
- Procure a causa raiz e outras ocorrências da mesma classe de defeito.
- Diferencie claramente: erro comprovado, risco provável, melhoria opcional e dúvida que exige teste.
- Não aprove uma mudança somente porque `npm run check` passou.
- Quando possível, proponha um teste de regressão para cada defeito confirmado.

## Formato esperado da revisão

Para cada achado relevante, informe:

- severidade: `BLOCKER`, `HIGH`, `MEDIUM` ou `LOW`;
- arquivo/trecho afetado;
- comportamento atual;
- risco em campo;
- causa raiz provável ou comprovada;
- correção recomendada;
- teste de regressão sugerido.

Ao final, conclua com uma das classificações:

- `APPROVE` — nenhuma falha bloqueante encontrada;
- `APPROVE WITH NOTES` — somente riscos não bloqueantes;
- `REQUEST CHANGES` — há falha que deve ser corrigida antes do merge.

## Limite de atuação

Quando usado como segundo revisor, não implemente novas funcionalidades fora do escopo do PR. O objetivo é desafiar a solução existente, encontrar regressões e aumentar a confiabilidade antes do merge.
