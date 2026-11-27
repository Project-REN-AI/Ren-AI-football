---
status: accepted
date: 2026-11-27
---

# O Dependabot atualiza as dependências, no lugar do Renovate

As dependências do Scout são atualizadas pelo **Dependabot**, configurado em `.github/dependabot.yml`. O motivo é não dar escrita no repositório a um app de terceiro: o Dependabot é da própria GitHub e já cobre todos os ecossistemas do monorepo. Isso substitui a escolha do Renovate registrada nas consequências do [ADR-0003](0003-bun-como-gerenciador-e-toolchain-do-typescript.md).

- **Ecossistemas:** `bun` (raiz, com os workspaces `web/` e `scripts/` e o `bun.lock`, cujos version updates estão em GA desde fevereiro de 2025), `maven`, `uv`, `gomod`, `docker` e `github-actions`, cada um com o diretório real do serviço.
- **Cadência:** semanal, um grupo por ecossistema (`patterns: ["*"]`) e no máximo 5 PRs abertos por ecossistema.
- **Cooldown:** uma versão nova só vira PR depois de 3 dias publicada (`cooldown.default-days: 3`), o que dá tempo para um pacote comprometido ser retirado. Security updates não esperam o cooldown.
- **Actions:** continuam fixadas por SHA com o comentário `# vX.Y.Z`, que o Dependabot atualiza junto.
- **Sem automerge:** o Dependabot não tem automerge, e nenhum workflow o acrescenta. Todo PR passa pela C2 e pela revisão.
- **Commits:** prefixo `chore(deps)`, que o `scripts/pr-title` aceita.

## Considered Options

- **Renovate (app hospedado).** Foi a escolha inicial, porque o Dependabot ainda não entendia `bun.lock`. Recusado agora: é um app de terceiro com escrita no repositório, e o motivo que o justificava deixou de existir.
- **Renovate autohospedado num workflow.** Recusado: mais um job agendado, com token próprio, para manter.
- **Sem atualização automática.** Recusado: sem PR semanal, a atualização depende de lembrar de fazê-la.

## Consequences

- A GitHub ainda não confirmou security updates automáticos para o Bun. Os alertas aparecem na aba Security, e a correção vem no PR semanal do grupo `bun` ou é feita à mão.
- O Dependabot não junta ecossistemas num PR: a versão do Bun em `packageManager` e a imagem `oven/bun` do `web/Dockerfile` podem chegar em PRs separados e precisam subir juntas, como o ADR-0003 exige.
- O zizmor recomenda cooldown de 7 dias. O `.github/zizmor.yml` baixa o limite dele para 3, o valor desta decisão.
- Cada serviço novo precisa de uma entrada em `.github/dependabot.yml` com o diretório dele.
