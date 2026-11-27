# Ren AI Football

Plataforma de inteligência para futebol. Codinome do produto: **Scout**.

O Scout reproduz partidas reais em tempo real a partir dos eventos de cada lance, calcula a chance de gol de cada chute (xG) com um modelo próprio, descobre o estilo de jogo de cada jogador sem rótulo nenhum, encontra jogadores parecidos e responde perguntas sobre partidas, jogadores e regras citando a fonte.

É um projeto de estudo e de portfólio. Cada tecnologia entra para resolver um problema concreto do sistema, e cada escolha fica registrada num ADR.

## O que ele faz

- **Partida ao vivo:** uma partida histórica é reproduzida lance a lance, com campo 2D, placar, estatísticas e narração em texto gerada por IA.
- **Perfil de jogador:** estatísticas, mapa de calor e o estilo de jogo descoberto por clusterização.
- **Jogadores parecidos:** busca por semelhança de estilo, com filtros de idade, liga e posição.
- **Assistente:** perguntas sobre jogos, jogadores e regras da IFAB, respondidas com citação das fontes; relatórios de scouting gerados por um agente.
- **Alertas:** notificação de gol do time seguido e webhooks.

## Como é construído

Microsserviços em Java (Spring Boot), Python (FastAPI), Go e TypeScript (Next.js), comunicando por REST, gRPC e eventos no Kafka. Cada tipo de dado fica no banco que serve a ele: PostgreSQL, Cassandra, MongoDB, Redis, Qdrant, OpenSearch e armazenamento de objetos compatível com S3.

O escopo, os domínios e os marcos estão em [`requisitos.md`](./requisitos.md). A linguagem do domínio está em [`GLOSSARY.md`](./GLOSSARY.md). As decisões estão em [`docs/adr/`](./docs/adr/). O ambiente local, com um profile do Docker Compose por fluxo de trabalho, está em [`docs/compose.md`](./docs/compose.md).

## Hooks locais

Os hooks do git ficam versionados em [`.githooks/`](./.githooks/). Ative uma vez por clone, depois de `bun install`:

```sh
git config core.hooksPath .githooks
```

- **pre-commit:** `bun fmt --staged` formata só os arquivos em stage.
- **pre-push:** roda as checagens da C1 que só precisam do Bun, do uv, do JDK e do Go com golangci-lint: formatação, typecheck, lint e teste do workspace `scripts/` e de cada **Serviço Afetado** (os mesmos comandos do job `service` do `ci.yml` no PR), `check-comments` nas linhas adicionadas, a política de workflows e o orçamento do Compose. Os **Serviços Afetados** saem da mesma detecção do CI (`scripts/affected-services`), contra a `develop` do remoto do push. Os checks rodam na árvore de trabalho, então faça push com ela limpa.

Ficam só no CI as checagens que dependem de ferramenta externa ou do PR: gitleaks, typos, lychee, osv-scanner, govulncheck, `docker compose config`, actionlint, zizmor e o título do PR.

## Estado

Em fundação (marco M0). Ainda não há código executável.

## Dados

Os dados de partidas vêm do [StatsBomb Open Data](https://github.com/statsbomb/open-data), usado sob os termos de uso do StatsBomb, que exigem atribuição. Outras fontes serão listadas aqui à medida que entrarem.

## Licença

Licenciado sob a [PolyForm Noncommercial 1.0.0](./LICENSE.md). Uso pessoal, de estudo e de pesquisa é permitido; uso comercial exige uma licença à parte, a combinar com o autor.

Copyright (c) 2026 Gabriel Menezes.
