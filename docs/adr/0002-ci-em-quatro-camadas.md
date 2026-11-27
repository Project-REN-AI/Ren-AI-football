---
status: accepted
date: 2026-11-27
---

# O CI roda em quatro camadas, e só as duas primeiras bloqueiam merge

O CI do Scout é dividido pelo que cada execução consegue descobrir, não por linguagem. O gate curto no PR (C1) e a merge queue da `develop` (C2) bloqueiam o merge. A caça de hora em hora (C3) e a suíte noturna completa (C4) nunca bloqueiam: quando acham uma falha, abrem issue. Assim o PR fica rápido para o agente que espera por ele, e o que é caro ou aleatório roda fora do caminho do merge, sem deixar de ser verificado.

| Camada | Gatilho | Escopo | O que roda | Alvo | Bloqueia |
|---|---|---|---|---|---|
| C1 gate curto | `pull_request` | serviços afetados | formatação, lint, typecheck, checagem de comentários, higiene no diff, unitário rápido; sem Docker | p50 ≤ 5 min, p95 ≤ 8 min | sim |
| C2 merge queue | `merge_group` | serviços afetados, sobre o merge do grupo com a `develop` | tudo da C1, mais integração com Testcontainers, teste de arquitetura e build de imagem | ≤ 15 min | sim |
| C3 caça | `schedule`, de hora em hora | tudo | o que varia entre execuções: ordem embaralhada, detector de corrida, repetição para achar teste instável, advisories novos de dependência | ≤ 20 min | não; abre issue |
| C4 noturna | `schedule`, uma vez por noite | tudo, sem detecção de afetados | a suíte inteira, isolamento máximo, varreduras completas e a checagem cruzada da lógica de pular | ≤ 60 min | não; abre issue |

Regras que decorrem disso:

- **Um só check obrigatório, `gate`.** É um job que depende de todos os outros, conta job pulado por "não afetado" como verde, e é emitido tanto no `pull_request` quanto no `merge_group`. O GitHub exige que o check obrigatório apareça nos dois eventos; um nome só evita mexer no ruleset quando um serviço entra.
- **A C2 contém a C1.** O verde do PR foi obtido sobre uma base velha; repetir lint e tipos sobre o merge pega o conflito semântico entre dois PRs do mesmo grupo.
- **Merge queue:** grupo de 1 a 3 PRs, espera de 2 min para formar grupo, até 2 grupos construídos em paralelo, ALLGREEN, timeout de check de 30 min, squash.
- **O push na `develop` só grava cache.** O commit que chega é o que a C2 já validou. É também o único evento que escreve cache no escopo da branch padrão, que PRs e a fila conseguem ler.
- **O PR de release para a `main` roda a suíte da C4** como check obrigatório, sobre o código exato que vai para a `main`.
- **A lógica de pular é testada duas vezes:** por testes unitários, e na C4, que abre issue própria quando falha um serviço que a detecção teria marcado como não afetado.

## Considered Options

- **Listar cada job como check obrigatório no ruleset.** Recusado: a lista quebra a cada serviço novo ou job renomeado, e um job pulado fica pendente e trava a fila.
- **C2 rodando só o que a C1 não rodou.** Mais rápido, mas deixa passar o conflito entre PRs do mesmo grupo, que é o motivo de existir merge queue.
- **Testcontainers já na C1.** Recusado: tira o PR do alvo de 5 min, e a fila pega a falha de integração antes do merge do mesmo jeito.
- **C3 como repetição da C2 de hora em hora.** Recusado: código determinístico rodado de novo não acha nada novo; a C3 só vale pelo que varia.
- **Liberar a release olhando o último noturno.** Recusado: o ruleset não consegue verificar isso, e entre o noturno e o PR de release podem ter entrado commits.

## Consequences

- Uma falha que só a C3 ou a C4 pegam chega à `develop` e vira issue, não bloqueio. O loop autônomo corrige pela issue.
- Release custa até uma hora de espera.
- O workflow do `gate` e a detecção de afetados passam a ser código crítico, com teste próprio.
- O cron depende da `develop` continuar sendo a branch padrão: o `schedule` só roda nela, e o GitHub desliga workflows agendados de repositório público após 60 dias sem atividade.
- Todo `schedule` lista minutos literais de 1 a 59, nunca o minuto 0, `*`, `*/n` ou faixa: na virada da hora o GitHub atrasa e descarta execuções agendadas. O `workflow-policy` reprova o que fugir disso.
