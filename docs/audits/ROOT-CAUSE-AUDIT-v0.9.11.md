# Root Cause Audit — v0.9.11

## Sintoma
No celular, o card “Adicionar uma nova inspeção” passou a ocupar uma altura muito maior que seu conteúdo.

## Causa raiz
Regras de resiliência criadas anteriormente usavam `flex: 1 1 Npx` para representar uma largura desejada no desktop. Alguns desses mesmos containers mudam para `flex-direction: column` no mobile. Em um flex container vertical, `flex-basis` passa a atuar no eixo vertical, transformando 520px de largura pretendida em aproximadamente 520px de altura.

## Componentes com a mesma classe de risco
- chamada “Nova inspeção”;
- resumo do card da inspeção;
- caixa de pesquisa;
- bloco descrição + ação;
- região principal do cabeçalho.

## Solução estrutural
Os `flex-basis` em pixels foram removidos desses blocos de conteúdo. A largura desejada agora é expressa por `min-width: min(Npx, 100%)`, enquanto `flex-basis` permanece automático. Nos breakpoints em que o layout vira coluna, existe um reset explícito de eixo (`flex-basis:auto`, `min-width:0`, `width:100%`).

Assim, uma decisão de largura do desktop não pode mais virar altura no celular.

## Prevenção de recorrência
Foi adicionado teste automático que rejeita `flex-basis` em pixels nos componentes que mudam de eixo no mobile.
