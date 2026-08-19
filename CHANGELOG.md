# Changelog

## v0.10.0 — Autenticação, RBAC, sincronização segura e ciclo de documentos

- Adicionado Supabase Auth com login, sessão persistente e recuperação de senha scanner-safe.
- Adicionados perfis ADMIN, INSPECTOR, SUPERVISOR e FOREMAN com permissões explícitas e gestão administrativa de usuários.
- A sincronização principal passou a operar em modo autenticado com isolamento por workspace, revalidação de membership, quarentena ao trocar vínculo e proteção contra envio acidental de registros locais pertencentes a outro contexto.
- Evidências fotográficas permanecem em bucket privado e continuam no fluxo offline-first, incluindo reconciliação e sincronização de evidências vinculadas a documentos arquivados.
- Corrigido o processamento de exclusões pendentes para preservar o progresso do lote após falha parcial e manter na fila somente os itens realmente não concluídos.
- Adicionado gerenciamento seguro de documentos com edição controlada de Código PW, descrição, status e revisão esperada, exclusão lógica por tombstone, auditoria local e preservação de cópias, comentários, histórico e evidências.
- Atualizações de planilha passam a respeitar alterações manuais e tombstones, impedindo a ressurreição silenciosa de documentos removidos.
- Reforçada a inicialização do PWA para que Service Worker e aquecimento de cache não bloqueiem o boot da interface em WebKit/Safari móvel.
- Mantidos atualização segura de listas, recuperação de rascunhos, diagnóstico pré-campo, backup verificável e comportamento offline-first.
- Mantidos os refinamentos de PDF, Cópias de campo opcionais, busca de verificação global/por lista e navegação Anterior/Próximo em detalhes de documentos.
- Pipeline de qualidade ampliado com CI determinístico, Playwright Chromium + WebKit e runner Windows self-hosted confiável para E2E de PRs internos.
- O plano de desativação definitiva do legado anônimo permanece separado e não é aplicado neste release antes do cutover autenticado de produção.

## v0.9.12 — Relatório, verificação por lista e navegação documental

- Corrigida a paginação do PDF para manter linhas normais inteiras entre páginas; somente linhas maiores que a própria área útil usam continuação controlada.
- A seção “Cópias de campo” deixou de fazer parte do PDF principal por padrão e passou a ser uma opção separada de exportação, iniciando desmarcada.
- Adicionado filtro de busca na área Verificar para alternar entre catálogo global e uma lista de inspeção específica, sem alterar o comportamento homologado da câmera/OCR.
- Adicionados controles Anterior e Próximo em Documentos → Mais detalhes, respeitando os limites da lista selecionada.
- Refinados os modais de exportação e configuração de sincronização para reduzir rolagem desnecessária e preservar o acabamento arredondado das janelas.
- Incluído `js/export-pdf-options-ui.js` no APP_SHELL do PWA e avançada a identidade técnica do cache para `0.9.27`, garantindo disponibilidade offline da nova opção de exportação.
- Mantidas intactas as regras de dados, histórico, evidências, sincronização e identificação OCR já homologadas no release anterior.

## v0.9.11 — Field readiness e estabilização para uso em campo

- Atualização segura de listas preservando registros e histórico já coletados.
- Recuperação de rascunhos interrompidos e reforço de integridade local.
- Melhorias de sincronização e saúde de evidências fotográficas.
- Diagnóstico pré-campo para PWA, armazenamento, OCR e sincronização.
- Nova interface responsiva validada em desktop e mobile.
- Ações da inspeção no mobile reestruturadas como Action Sheet fora do card clicável.
- Adicionado gate E2E Playwright em Chromium e WebKit com perfil Mobile Safari/iPhone.
- Validado em iPhone físico como PWA instalado, incluindo fechamento e reabertura.
- Validada sincronização bidirecional entre iPhone e notebook com inspeções, documentos e revisões consistentes.
- Revisão adversarial final concluída sem achados BLOCKER, HIGH ou MEDIUM pendentes.
- Versão do produto mantida em `0.9.11`; cache interno do Service Worker em `0.9.26`.

## v0.9.10 — Estado assíncrono do diagnóstico pré-campo

- Corrigido o re-render da tela Dados e backup durante sincronização, que fazia o resultado do diagnóstico desaparecer.
- O diagnóstico passou a residir no estado da aplicação e sobreviver a atualizações legítimas da interface.
- Status de sincronização em Dados e backup passou a ser atualizado in-place.
- Eventos do PWA deixam de reconstruir a tela durante diagnóstico em andamento.

## v0.9.9 — Reconciliação de evidências fotográficas

- Quando o Blob local está ausente, o sistema consulta primeiro o Supabase Storage pelo identificador imutável da cópia.
- Se o arquivo remoto existir, `evidencePath` é reconstruído automaticamente.
- Evidência só é marcada como indisponível quando a consulta ao Storage termina com sucesso e confirma que o arquivo também não existe na nuvem.
- Registros históricos são preservados mesmo quando a fotografia original não existe mais.

## v0.9.8 — Auditoria de causa raiz para piloto

- Reforço de concorrência de sincronização e diagnóstico de Storage.
- Teste do Storage passa a comprovar listagem, upload e exclusão.
- Evidências passam a registrar tentativas e erros de upload.
- Revisão preventiva de overflow e composição responsiva.

## v0.9.6 — Field readiness

- Proteção de rascunhos durante sincronização automática.
- Exclusão de cópia/evidência consolidada em transação IndexedDB.
- Controle de concorrência de gravação e backup verificável por SHA-256.
- Diagnóstico pré-campo e preparação explícita de dependências offline.

## v0.9.3

- Botão Voltar nas áreas internas.
- Modal de exportação simplificado.
- Resultados de exportação iniciam desmarcados.
