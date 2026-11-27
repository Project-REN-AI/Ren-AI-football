---
status: accepted
date: 2026-11-27
---

# Registrar decisões em ADRs

Toda decisão que muda a forma do sistema, ou que alguém provavelmente questionaria depois, é registrada como um ADR (Architecture Decision Record) em `docs/adr/`. O código mostra **o que** foi feito; o ADR guarda **por que**, e o que foi recusado no caminho.

O Scout usa muitas tecnologias, e cada uma precisa ter um motivo concreto no sistema. Sem registro, a resposta a "por que Cassandra aqui?" se perde no histórico de uma conversa, e a próxima sessão — de uma pessoa ou de um agente — redecide o que já estava decidido.

## Forma

- Um arquivo por decisão: `NNNN-titulo-em-kebab-case.md`, numerado em sequência.
- Frontmatter com `status` (`proposed`, `accepted`, `superseded`) e `date`.
- O título é a decisão, não o tema: "Cassandra guarda os Eventos de Partida", não "Banco de eventos".
- O corpo diz a decisão e o motivo no primeiro parágrafo. Depois, `## Considered Options` com o que foi recusado e por quê, e `## Consequences` com o custo assumido.
- Prosa em português; termos de domínio vêm do [`GLOSSARY.md`](../../GLOSSARY.md).

## Quando escrever

O ADR nasce no grilling do domínio (`/grill-with-docs`), quando a decisão aparece, e entra no PR da spec ou do primeiro ticket que depende dela. Escolha que qualquer pessoa faria do mesmo jeito não precisa de ADR.

## Quando mudar

ADR aceito não é reescrito. Uma mudança de rumo vira **emenda** datada no fim do próprio ADR, quando a decisão continua de pé e só um detalhe mudou, ou um **ADR novo** que marca o antigo como `superseded`, quando a decisão foi trocada.

## Considered Options

Registrar decisões só nas specs (`.scratch/<slug>/spec.md`) foi a alternativa. Foi recusada porque a spec descreve um domínio num momento, e a decisão atravessa domínios e sobrevive a eles: a escolha do banco de eventos vale para o §6, o §11 e o §16 ao mesmo tempo.

## Consequences

Cada decisão relevante custa um arquivo curto a mais no PR. Em troca, o repositório público explica as próprias escolhas, o que também é o que se espera de um portfólio.
