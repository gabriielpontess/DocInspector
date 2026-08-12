# Regras de desenvolvimento assistido por IA

Estas regras são obrigatórias para qualquer agente de IA que altere o DocInspector.

1. **Causa raiz antes do patch.** Não corrigir apenas o sintoma. Explicar a origem técnica e procurar o mesmo padrão em componentes/fluxos semelhantes.
2. **Preservar dados primeiro.** Em conflitos entre conveniência e integridade, escolher a opção que evita perda, duplicidade ou associação incorreta.
3. **Sem alteração silenciosa de escopo.** Não acrescentar, remover ou redesenhar funcionalidades sem solicitação ou justificativa técnica explícita aprovada.
4. **Schema Supabase é controlado.** Não alterar SQL/schema sem necessidade comprovada, migração documentada e plano de compatibilidade/rollback.
5. **Offline-first é requisito.** Toda mudança deve considerar ausência/intermitência de rede e comportamento do IndexedDB/PWA.
6. **Sincronização é crítica.** Mudanças em persistência, merge, evidências ou Supabase exigem testes de concorrência e reconciliação.
7. **OCR é assistivo.** Nunca transformar OCR em confirmação automática de identidade/revisão sem validação humana prevista no fluxo.
8. **Responsividade sistêmica.** Validar largura real do conteúdo, sidebar aberta/fechada, desktop, notebook, tablet e celular. Não usar correções isoladas que criem regressão em outro eixo/breakpoint.
9. **Estado assíncrono não pode sumir.** Operações longas não devem depender de referências DOM obsoletas nem apagar rascunhos/re-renderizar campos ativos.
10. **Teste de regressão obrigatório.** Defeitos corrigidos devem ganhar teste que represente a classe do problema, não apenas o caso visual específico.
11. **Sem credenciais privilegiadas.** Nunca commitar Secret Key, `service_role`, senha, token privado ou chave de API sensível. No navegador, somente valores públicos previstos pela arquitetura.
12. **PR pequeno e auditável.** Uma alteração por branch sempre que possível. Descrever risco, causa raiz, cobertura e como validar.
13. **Não declarar sucesso apenas porque compilou.** Exigir sintaxe + testes + revisão dos efeitos derivados + smoke test quando o comportamento depender de navegador/aparelho real.
14. **`main` não recebe commits diretos de desenvolvimento.** Use `develop`/`feature/*`/`fix/*` e Pull Request.
