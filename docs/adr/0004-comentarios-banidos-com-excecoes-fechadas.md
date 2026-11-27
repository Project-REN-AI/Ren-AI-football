---
status: accepted
date: 2026-11-27
---

# Comentário no código é proibido, salvo cinco exceções fechadas verificadas no CI

O código do Scout não leva comentário, exceto: cabeçalho SPDX; doc comment de contrato logo acima de símbolo exportado; restrição externa com link; ponteiro `See docs/adr/NNNN-<slug>.md`; e `TODO(#<issue>)` com issue aberta. Supressão de lint ou de tipo só com link para issue ou ADR na mesma linha. Comentário errado engana mais que comentário ausente, e o código do Scout é escrito majoritariamente por agentes, que comentam para narrar, justificar gambiarra ou registrar histórico. O "porquê" já tem casa nos ADRs, que o squash merge não apaga. A regra está no `CLAUDE.md`, mas quem a impõe é ferramenta, porque prosa é a camada mais fraca de controle.

- **`scripts/check-comments`** (TypeScript no Bun, as quatro linguagens): na C1 julga só as linhas adicionadas pelo PR; na C4 varre o repositório e abre issue se algo escapou. A mensagem de erro diz o que fazer em vez de comentar.
- **TODO é julgado só pelo `check-comments`**, que exige `TODO(#n)`. Por isso `godox` (Go), `no-warning-comments` (Oxlint) e `TodoComment` (Checkstyle) ficam desligados: reprovariam a exceção permitida.
- **Regras nativas que não conflitam ficam ligadas:** ruff `ERA` e `PGH`, `nolintlint`, e exigência de descrição em supressão onde o linter tiver.
- **Doc comment só acima de símbolo exportado.** Javadoc, docstring ou GoDoc sobre símbolo privado reprova.

## Considered Options

- **Comentar com moderação, à densidade do código ao redor.** Recusado: num repositório escrito por agentes não há densidade humana de referência, e a regra não é verificável.
- **Banir TODO de vez.** Recusado: `TODO(#n)` liga a pendência a uma issue rastreável e não apodrece calado.
- **Aceitar qualquer doc comment.** Recusado: abriria a porta para narração em Javadoc privado.
- **Só as regras nativas dos linters.** Recusado: cobrem pedaços diferentes em cada linguagem e conflitam com a exceção do TODO.

## Consequences

- Toda explicação que não cabe em nome, tipo ou teste vira ADR ou issue; o custo de explicar sobe de propósito.
- O conteúdo de um doc comment permitido não é verificado; narração dentro dele só a revisão pega.
- O `check-comments` é código crítico do CI e tem teste próprio.
