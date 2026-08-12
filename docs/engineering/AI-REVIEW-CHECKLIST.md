# Checklist de revisão adversarial por IA — DocInspector

Use este checklist para uma segunda revisão independente antes de promover mudanças críticas.

## Escopo e regressão

- O PR altera somente o escopo declarado?
- Alguma funcionalidade existente foi removida ou modificada sem necessidade?
- A solução trata a causa raiz e não apenas o sintoma?
- Existem componentes semelhantes sujeitos à mesma falha?
- Há teste cobrindo o defeito corrigido e sua recorrência?

## Dados e sincronização

- Estados locais podem ser sobrescritos por respostas assíncronas antigas?
- Campos em edição permanecem estáveis durante sincronização/re-renderização?
- Conflitos entre dispositivos são reconciliados de forma determinística?
- Exclusões/tombstones podem ressuscitar dados antigos?
- Evidências fotográficas permanecem ligadas ao documento/inspeção correto?
- Falhas de rede deixam o sistema em estado recuperável?

## Supabase e segurança

- Nenhuma chave privilegiada foi incluída no cliente ou repositório?
- Mudanças de schema têm migração e compatibilidade avaliadas?
- RPCs validam workspace, secret, IDs e payloads?
- O cliente não depende de permissões diretas que deveriam estar bloqueadas por RLS?
- Upload/download de evidências respeitam isolamento entre workspaces?

## OCR e documentos

- OCR incerto pode alterar silenciosamente código PW/revisão para coincidir com outro documento?
- Correspondências aproximadas são apresentadas como sugestão, não confirmação automática?
- Documento fora da lista permanece distinguível de documento conhecido?
- Incremento de cópia só ocorre após confirmação das informações?

## PWA e assíncrono

- Service Worker preserva atualização e cache sem servir assets incompatíveis entre versões?
- Operações longas sobrevivem a re-renderizações?
- Botões não podem iniciar duas operações destrutivas em paralelo?
- Falhas e timeouts resultam em mensagem e estado consistente?

## Responsividade e UX

- Desktop, notebook, tablet e celular mantêm a mesma funcionalidade?
- Componentes que mudam `flex-direction` não convertem largura em altura via `flex-basis`?
- Não existe zoom acidental por toque duplo ou inputs com tipografia inadequada no mobile?
- Side bar aberta/fechada não rompe filtros, tabelas ou ações?
- Modais são utilizáveis em viewport pequeno e com teclado aberto?

## Exportação

- PDF não mistura orientação de página indevidamente?
- Quebra de página não corta conteúdo crítico?
- XLSX e PDF refletem exatamente o filtro/inspeção selecionados?
- O usuário entende claramente qual conjunto de dados será exportado?

## Gate final

Antes de recomendar merge:

1. executar `npm run check`;
2. revisar o diff completo;
3. registrar achados por severidade;
4. confirmar ausência de `BLOCKER`/`HIGH` sem resolução;
5. indicar explicitamente `APPROVE`, `APPROVE WITH NOTES` ou `REQUEST CHANGES`.
