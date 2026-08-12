## Objetivo

Descreva a alteração e o problema que ela resolve. Informe explicitamente o que ficou fora do escopo.

## Causa raiz

Explique a causa técnica. Para correções, indique onde o mesmo padrão foi procurado e quais ocorrências semelhantes foram avaliadas.

## Solução estrutural

Explique por que a solução trata a causa raiz e quais alternativas foram descartadas.

## Riscos e efeitos derivados

- Dados/IndexedDB:
- Sincronização/Supabase:
- Evidências:
- Offline/PWA:
- Responsividade/UI:
- OCR/documentos:
- PDF/XLSX:
- Segurança:

## Validação

- [ ] `npm run check` aprovado
- [ ] Teste de regressão incluído/atualizado quando aplicável
- [ ] Nenhuma credencial privilegiada adicionada
- [ ] Nenhum schema Supabase alterado sem migração/documentação
- [ ] Desktop/notebook validado quando aplicável
- [ ] Tablet/mobile validado quando aplicável
- [ ] Sidebar aberta/recolhida validada quando aplicável
- [ ] Online/offline validado quando aplicável
- [ ] Fluxos assíncronos/re-renderização avaliados quando aplicável
- [ ] Smoke test real descrito quando necessário

## Segunda revisão independente

Para alterações críticas, registre uma revisão seguindo `docs/engineering/AI-REVIEW-CHECKLIST.md`.

Resultado do revisor independente:

- [ ] `APPROVE`
- [ ] `APPROVE WITH NOTES`
- [ ] `REQUEST CHANGES`
- [ ] Não aplicável — justificar abaixo

Achados `BLOCKER`/`HIGH` pendentes:

> Nenhum / descreva aqui.

## Rollback

Explique como retornar à versão anterior se houver regressão e quais dados podem exigir reconciliação.

## Declaração de merge

- [ ] O PR não depende apenas de “compila/passou no CI” como prova de segurança.
- [ ] A causa raiz foi tratada.
- [ ] Não há regressão conhecida bloqueante.
- [ ] O escopo do PR está compreendido e revisado.
