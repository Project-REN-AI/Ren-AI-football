---
status: accepted
date: 2026-11-27
---

# Serviços Afetados saem do diff e de um manifesto `service.json` por serviço

A C1 e a C2 rodam só sobre os **Serviços Afetados** ([ADR-0002](0002-ci-em-quatro-camadas.md)). O script `scripts/affected-services` calcula a lista a partir do diff entre a base e o alvo (a partir do merge base, `base...alvo`) e de um manifesto que cada serviço versiona.

- **Serviço** é um diretório `services/<nome>` ou o `web/`. Cada um tem um `service.json` na raiz dele, lido do commit alvo:

  ```json
  { "language": "java", "dependsOn": ["contracts/catalog"] }
  ```

  `language` é um de `typescript`, `java`, `python`, `go` e escolhe o caminho do serviço na matriz. `dependsOn` lista caminhos relativos à raiz do repositório (diretório ou arquivo) de que o serviço depende fora do próprio diretório.

- **Regra:** um arquivo alterado, adicionado, apagado ou renomeado (os dois lados contam) afeta o serviço que o contém e todo serviço que declara um caminho que o contém. Um arquivo que nenhum serviço contém nem declara é da raiz do monorepo e afeta todos, inclusive documentação: errar para o lado de rodar mais é barato, pular uma mudança de infraestrutura não é.
- **Serviço sem manifesto, ou com manifesto inválido, reprova o job** `affected services`, e com ele o `gate`. Serviço apagado por inteiro deixa de existir no alvo, então seus caminhos caem na raiz.
- **Matriz:** um job por Serviço Afetado × categoria (`static`, `test`). Sem serviço afetado, o job é pulado e conta como verde no `gate`. Uma linguagem sem passos no workflow reprova o job, para que o serviço-exemplo dela traga o próprio caminho.

## Considered Options

- **Filtro de caminhos do GitHub (`paths`, `dorny/paths-filter`).** Recusado: a lógica ficaria no YAML, sem teste próprio, e o pre-push não a reaproveitaria.
- **Inferir dependências do build (Maven, uv, Go modules).** Recusado: uma ferramenta por linguagem para cobrir o que um manifesto de uma linha declara.
- **Ignorar documentação na regra de raiz.** Recusado por ora: uma lista de exceções é mais um lugar onde a lógica de pular pode errar sem que a C4 perceba.

## Consequences

- Todo serviço novo nasce com `service.json`; esquecê-lo deixa o PR vermelho.
- Um PR só de documentação roda a matriz inteira.
- Cada linguagem nova acrescenta os próprios passos ao job `service` do `ci.yml` e ao pre-push (`scripts/pre-push`).
