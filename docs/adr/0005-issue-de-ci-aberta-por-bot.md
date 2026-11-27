---
status: accepted
date: 2026-11-27
---

# A caça e a suíte noturna abrem issue por um GitHub App próprio, e essa issue é a entrada do loop autônomo

Quando a C3 ou a C4 (ver [ADR-0002](0002-ci-em-quatro-camadas.md)) acham uma falha, a correção não começa por uma pessoa lendo log: começa por uma issue com formato fixo, aberta por um GitHub App do projeto (`scout-ci-bot[bot]`), que o loop autônomo pega como qualquer outro ticket. O App é necessário porque issue criada com o `GITHUB_TOKEN` não dispara workflow, e porque um autor próprio separa o bot de CI de qualquer outra automação.

- **Falha Confirmada:** o teste ou a checagem que falhou é reexecutado com a mesma seed, até 3 vezes. Falhou em todas: Falha Confirmada, label `ci-bot` + `bug`, estado `ready-for-agent`. Passou em alguma: Teste Instável, label `ci-bot` + `flaky`, estado `needs-triage`. Falha de infraestrutura (runner, rede, rate limit) não abre issue.
- **Deduplicação pela Assinatura de Falha**, gravada num marcador HTML no corpo. Já existe issue aberta com a assinatura: o bot só comenta a nova ocorrência. A issue foi fechada e a falha voltou: abre uma nova, citando a antiga.
- **Formato:** título `ci: <serviço> <checagem> falhou`; seções fixas com assinatura, camada, SHA, link do run, seed, comando de reprodução e saída truncada em bloco de código. Milestone vazia.
- **O corpo é dado não confiável** (restrição C04): o log pode conter texto controlado por terceiros, e quem consome a issue não segue instrução de dentro dele.
- **Permissão mínima:** o App tem `issues: write` neste repositório e `organization projects: write` para mover os cards do board (ver abaixo); nada além disso. A chave privada vive num environment `ci-bot` restrito à `develop`, e nenhum workflow é disparado por comentário (`issue_comment`), `pull_request_target` ou `workflow_run`.

## O mesmo App move os cards do board

O board Kanban do projeto (Backlog, Ready, In progress, In review, Done) é mantido por um workflow que recalcula o Status de cada issue a partir do estado dela: fechada → Done; com PR aberto que a fecha → In review; atribuída → In progress; com label `ready-for-agent` ou `ready-for-human` e sem bloqueador aberto → Ready; o resto → Backlog. O `/implement` se atribui a issue no primeiro passo, então ela vai para In progress sem que a skill precise falar com o board, o que ela nem conseguiria em sessão na nuvem, onde a API de Projects é bloqueada.

O workflow roda em eventos de issue e a cada 15 minutos. O cron existe porque um evento de PR não pode usar o environment `ci-bot`, restrito à `develop`; a passagem para In review chega pelo cron. O `GITHUB_TOKEN` não alcança projetos de organização, por isso o App ganhou a permissão de projetos, em vez de um segundo App só para isso.

## Considered Options

- **`GITHUB_TOKEN`.** Recusado: a issue não dispara nada, e o autor `github-actions[bot]` não distingue o bot de CI.
- **PAT de uma conta-máquina.** Recusado: token de longa duração com escopo amplo, num repositório público.
- **Abrir issue na primeira falha.** Recusado: o loop perseguiria Testes Instáveis como se fossem bugs.
- **Um segundo App só para o board.** Recusado: mais uma chave para guardar e rotacionar, para um ganho de privilégio mínimo pequeno.
- **A skill `/implement` mover o card.** Recusado: em sessão na nuvem a API de Projects é bloqueada, e o board dependeria de quem roda a skill.
- **Confirmar pela execução seguinte do cron.** Recusado: atrasa uma hora ou um dia e perde falhas de seed aleatória.

## Consequences

- O loop autônomo depende do label `ci-bot`, do formato do corpo e do autor do App; mudar qualquer um dos três é mudança de interface com as skills que o consomem.
- Criar e instalar o App é passo manual da fundação.
- O board é derivado: mover um card à mão vale só até o próximo sync, que o devolve à coluna que o estado da issue indica.
