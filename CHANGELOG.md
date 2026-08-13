# Changelog

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
