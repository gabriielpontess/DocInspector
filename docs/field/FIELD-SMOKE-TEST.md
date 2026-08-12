# Smoke test de campo — DocInspector v0.9.8

1. Publicar a versão no Netlify e fechar/reabrir o PWA.
2. Confirmar abertura das abas Início, Verificar, Documentos e Dados e backup.
3. Em Dados e backup, executar **Testar conexão**.
4. Abrir uma inspeção e confirmar filtros da lista.
5. Registrar uma cópia manual Conforme e outra Não conforme.
6. Digitar revisão/comentário sem salvar, aguardar pelo menos 35 segundos e confirmar que o texto continua na tela após sincronização automática.
7. Fotografar um PW conhecido e confirmar a revisão manualmente antes de salvar.
8. Fotografar um PW fora da lista e confirmar que nenhum outro PW é substituído automaticamente.
9. Ativar modo avião, registrar uma verificação, fechar/reabrir o PWA e confirmar persistência local.
10. Reconectar, sincronizar e confirmar o registro em um segundo aparelho.
11. Abrir uma evidência fotográfica no segundo aparelho.
12. Excluir uma cópia, sincronizar e confirmar que ela não reaparece.
13. Exportar PDF e XLSX e conferir os totais.
14. Gerar backup JSON.

Critério: não liberar a versão para a equipe se houver perda de rascunho, divergência nos contadores, duplicação de cópia, foto indisponível após sincronização ou erro de autenticação/Storage.
