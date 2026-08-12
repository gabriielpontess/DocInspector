# DocInspector

PWA offline-first para verificação documental de engenharia, com IndexedDB, sincronização Supabase, OCR fotográfico assistido, evidências, importação XLSX e exportação PDF/XLSX.

## Baseline atual

**v0.9.11 FIELD PILOT** é a baseline inicial deste repositório. Ela foi importada somente após auditoria local de sintaxe, testes, SQL, referências de assets e procura por credenciais privilegiadas.

O schema do Supabase permanece na **versão 6**. Não execute `SUPABASE-SETUP.sql` novamente em um projeto que já esteja no schema v6.

## Modelo de desenvolvimento

- `main`: versão aprovada e recuperável.
- `develop`: integração da próxima versão.
- `feature/*`: funcionalidades novas.
- `fix/*`: correções.
- Mudanças entram em `main` somente por Pull Request revisado.
- Toda correção de defeito deve investigar causa raiz e procurar ocorrências semelhantes.
- Toda alteração relevante deve incluir ou atualizar teste de regressão.

Leia `AI-DEVELOPMENT-RULES.md` e `CONTRIBUTING.md` antes de modificar o projeto.

## Validação local

Requer Node.js 20 ou superior.

```bash
npm test
npm run check
```

O projeto não possui dependências npm de runtime; o navegador carrega as bibliotecas externas já previstas pela aplicação/PWA.

## Estrutura

- `js/`: aplicação e módulos de domínio, persistência, sincronização, OCR e exportação.
- `tests/`: testes automatizados de regressão.
- `supabase/`: documentação e setup do schema v6.
- `docs/audits/`: auditorias históricas e análises de causa raiz.
- `docs/field/`: documentos de readiness, smoke test e baseline.
- `.github/`: CI e templates de colaboração.

## Antes de usar em campo

Execute o diagnóstico **Preparar e testar aparelho** em cada dispositivo e siga `docs/field/FIELD-SMOKE-TEST.md` em pelo menos dois aparelhos conectados ao mesmo workspace do Supabase.
