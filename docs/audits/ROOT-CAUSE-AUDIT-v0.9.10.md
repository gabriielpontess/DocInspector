# Root Cause Audit — v0.9.11

## Sintoma
Ao tocar em “Preparar e testar aparelho”, o painel podia retornar para “Ainda não executado neste aparelho”.

## Causa raiz
O diagnóstico chama `syncNow()`. Ao concluir, `sky17:sync-complete` disparava `refreshAfterSync()`, que fazia `render()` completo da tela Dados e backup. Isso removia do DOM o painel e o botão usados pela rotina ainda em andamento. O diagnóstico continuava em memória, mas atualizava elementos já desconectados.

## Correção estrutural
- O diagnóstico passou a ser estado persistente da interface (`state.fieldReadiness`).
- Eventos de sincronização atualizam a tela Dados e backup in-place, sem reconstruí-la.
- Cada etapa do diagnóstico repinta o elemento atualmente conectado ao DOM.
- Eventos de instalação do PWA não re-renderizam a tela enquanto o diagnóstico está em andamento.
- O estado de carregamento do botão também é restaurado no elemento atualmente conectado.

## Classe de falha evitada
Operações assíncronas longas deixam de depender de referências DOM antigas, reduzindo o risco de perder progresso visual por re-renderizações externas.
