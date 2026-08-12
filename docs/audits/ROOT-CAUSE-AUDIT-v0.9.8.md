# DocInspector v0.9.8 — Auditoria de causa raiz

## 1. Overflow ao expandir a sidebar
**Causa:** a toolbar de Documentos acumulava regras de versões anteriores e usava breakpoints baseados na largura total da viewport. A sidebar altera a largura útil do conteúdo sem necessariamente alterar a viewport.

**Correção:** remoção das regras duplicadas da toolbar e adoção de uma composição flexível única, com `flex-wrap`, bases flexíveis e `min-width: 0`. O mesmo princípio foi aplicado a cabeçalhos, cards de inspeção, ações, busca, paginação, títulos de seção e descrição + ação.

## 2. Evidências indicadas como somente locais
**Causas possíveis antes da correção:**
- o diagnóstico podia ler o estado enquanto outra sincronização ainda estava rodando;
- chamadas concorrentes de `syncNow()` não aguardavam a sincronização ativa;
- o teste do Storage comprovava apenas leitura/listagem, não upload;
- uma foto local ausente era ignorada silenciosamente;
- uma falha de upload interrompia o lote sem persistir diagnóstico detalhado.

**Correção:**
- sincronização single-flight, com uma Promise compartilhada e nova passagem se houver alterações durante o ciclo;
- diagnóstico aguarda a sincronização realmente terminar;
- teste do Storage faz upload e exclusão de um PNG mínimo no workspace;
- tentativas e último erro de upload ficam registrados na evidência local;
- evidências sem blob local são classificadas como erro de integridade, não como simples pendência;
- o sincronizador continua processando outras fotos mesmo se uma delas falhar e relata o lote ao final.

## 3. Nuvem e backup
O Supabase permanece como armazenamento operacional sincronizado automaticamente. IndexedDB continua necessário para trabalho offline. O backup JSON permanece como camada independente de recuperação/portabilidade; não é necessário gerar um backup manual após cada verificação quando a sincronização está saudável.

## Escopo preventivo revisado
- toolbar/filtros;
- topbar;
- cards de inspeção;
- barras de ações;
- busca;
- paginação;
- títulos de seção;
- linhas de descrição com botão;
- cards e grids já protegidos com `minmax(0,1fr)` / `min-width:0`;
- fluxo completo de evidência: captura → IndexedDB → upload → evidencePath → inspeção remota → download.
