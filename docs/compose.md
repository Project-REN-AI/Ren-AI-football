# Docker Compose local

O [`compose.yaml`](../compose.yaml) da raiz sobe o ambiente local do Scout numa máquina de 16 GB (restrição C02 do [`requisitos.md`](../requisitos.md)). No M0 ele não tem serviços: só a convenção abaixo, que o CI verifica.

## Um profile por fluxo de trabalho

- Cada fluxo de trabalho (por exemplo, `ingest`, `live-match`, `assistant`) é um profile do Compose. Sobe-se só o fluxo do dia: `docker compose --profile <fluxo> up`.
- O serviço que todo fluxo usa fica sem `profiles` e sobe junto com qualquer profile. Ele conta no orçamento de todos.
- O serviço que só um fluxo usa declara `profiles: [<fluxo>]`. O que serve a mais de um fluxo lista cada um deles.
- O nome do profile é em inglês, em kebab-case.
- Um profile por vez. O orçamento é por profile; `--profile "*"` ou dois `--profile` juntos ficam fora dele.

## Orçamento de memória

- Todo serviço declara `mem_limit` (por exemplo, `512m`, `2g`). `0` conta como sem limite, como no Docker.
- Nenhum profile passa de 10 GB somando os seus serviços e os sem profile. Sobram ~6 GB para IDE, navegador e o próprio Docker.

## O que o CI verifica

- `docker compose config --quiet` valida a sintaxe sem subir container.
- `bun scripts/compose-budget/main.ts .` lê o que o próprio Compose resolve (`docker compose --profile "*" config`, com `compose.override.yaml`, interpolação e unidades), soma o `mem_limit` por profile e reprova serviço sem limite ou profile acima de 10 GB. O grupo `(no profile)` é o que `docker compose up` sobe sem `--profile`.
