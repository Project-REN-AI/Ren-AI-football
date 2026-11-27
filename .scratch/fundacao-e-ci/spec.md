---
domain: 1
title: "Fundação e CI"
milestone: M0
status: ready-for-agent
date: 2026-11-27
adrs:
  - docs/adr/0002-ci-em-quatro-camadas.md
  - docs/adr/0003-bun-como-gerenciador-e-toolchain-do-typescript.md
  - docs/adr/0004-comentarios-banidos-com-excecoes-fechadas.md
  - docs/adr/0005-issue-de-ci-aberta-por-bot.md
---

# Spec §1 — Fundação e CI

Cobre o §1 do `requisitos.md` e a parte do §3 que decide o que roda no PR e o que roda no cron. As decisões que alguém questionaria depois estão nos ADRs 0002 a 0005; esta spec não as repete por extenso, aponta para elas. Termos em negrito vêm do `GLOSSARY.md`.

## Problem Statement

O Scout ainda não tem código, e quase todo o código futuro será escrito por agentes que trabalham sem revisão humana linha a linha. Sem uma fundação de CI desde o primeiro commit, cada serviço chegaria com seu próprio jeito de formatar, testar e comentar, e a disciplina teria de ser imposta depois, quando é cara. Além disso:

- o mantenedor trabalha sozinho, numa máquina de 16 GB (C02), sem orçamento para runner pago (C01);
- o repositório é público, então todo workflow é superfície de ataque e todo texto de terceiro é entrada não confiável (C04);
- agentes pulam passos escritos em prosa e trapaceiam quando o único sinal é o próprio teste; o que não é verificado por ferramenta não é regra;
- PR lento faz o agente esperar e a fila travar; PR rápido demais deixa passar o que só a suíte completa pega;
- uma falha achada fora do PR precisa virar trabalho para o loop autônomo sem que alguém leia log.

## Solution

Uma fundação de monorepo e um CI em quatro camadas (ADR-0002), em que só as duas primeiras bloqueiam merge:

- **C1, gate curto no PR**: só os **Serviços Afetados**, sem Docker, em até ~5 min.
- **C2, merge queue na `develop`**: tudo da C1 sobre o merge do grupo, mais integração, arquitetura e build de imagem, em até 15 min.
- **C3, caça de hora em hora**: o que varia entre execuções (ordem, corrida, instabilidade, advisories novos).
- **C4, suíte noturna**: tudo, sem detecção de afetados, com varreduras completas e a checagem cruzada da lógica de pular.

C3 e C4 transformam falhas em issues abertas por um GitHub App próprio, que o loop autônomo consome (ADR-0005). Um único check obrigatório, `gate`, fecha a `develop`; a `main` exige a suíte da C4 no PR de release. O TypeScript usa a toolchain do Bun (ADR-0003); Java, Python e Go têm formatador, linter, typecheck e teste de arquitetura equivalentes. Comentários são proibidos salvo cinco exceções, verificadas no CI (ADR-0004). Um esqueleto de Docker Compose com profiles e orçamento de memória fecha a fundação local.

## User Stories

### Monorepo e ambiente local

1. Como mantenedor, quero cada serviço num diretório próprio sob `services/`, com seu build nativo (Maven, uv ou Go), para que a unidade de **Serviço Afetado** coincida com a unidade de deploy e de dono.
2. Como mantenedor, quero o front-end Next.js em `web/` e os scripts de CI em `scripts/`, os dois como workspaces do Bun, para que o TypeScript tenha um só lockfile.
3. Como mantenedor, quero a versão exata do Bun fixada no repositório e lida pelo CI, para que local e CI usem o mesmo binário e subir de versão seja um PR revisável.
4. Como mantenedor, quero `bun install --frozen-lockfile` em todo lugar, para que um `package.json` fora de sincronia com o `bun.lock` reprove em vez de mudar o lockfile em silêncio.
5. Como mantenedor, quero um esqueleto de Docker Compose com um profile por fluxo de trabalho, para subir só o que a tarefa do dia usa (C02).
6. Como mantenedor, quero que todo serviço do Compose declare `mem_limit` e que nenhum profile passe de 10 GB somados, para que sobrem ~6 GB para IDE, navegador e Docker.
7. Como mantenedor, quero que o CI reprove um serviço do Compose sem `mem_limit` ou um profile acima do orçamento, para que a restrição C02 não dependa de memória humana.
8. Como mantenedor, quero que o CI valide a sintaxe do Compose sem subir container, para que um erro de YAML não espere a primeira pessoa rodar `docker compose up`.

### Hooks locais

9. Como agente de código, quero que o pre-commit formate só os arquivos em stage com `bun fmt --staged`, para que o commit nunca leve diferença de formatação e o hook continue instantâneo.
10. Como agente de código, quero que o pre-push rode localmente as checagens da C1 sobre os **Serviços Afetados**, para receber a falha antes de gastar um ciclo de CI.
11. Como mantenedor, quero os hooks versionados e ativados por `core.hooksPath`, sem Husky nem lefthook, para que não haja ferramenta extra para instalar e fixar versão.
12. Como mantenedor, quero que o pre-push use a mesma detecção de afetados da C1, para que "passou no hook" e "passou no PR" signifiquem a mesma coisa.

### C1: gate curto no PR

13. Como agente de código, quero que o PR rode só sobre os **Serviços Afetados**, para receber o veredito em ~5 min (p95 ≤ 8 min).
14. Como agente de código, quero que qualquer mudança na raiz do monorepo (workflows, lockfile da raiz, config de ferramenta, `scripts/`) marque todos os serviços como afetados, para que mudança de infraestrutura nunca seja pulada.
15. Como mantenedor, quero que cada serviço declare num manifesto pequeno de que outros caminhos depende, para que mudar um contrato compartilhado afete quem o consome.
16. Como agente de código, quero formatação, lint e typecheck por linguagem na C1, para que erro estático nunca chegue à fila.
17. Como agente de código, quero testes unitários na C1 sem Docker e, no TypeScript, com Vitest `isolate: false`, para que o gate caiba no alvo de tempo.
18. Como mantenedor, quero que a C1 valide o título do PR em Conventional Commits, em inglês, para que o squash nunca grave na `develop` uma mensagem fora do padrão.
19. Como mantenedor, quero que a C1 rode `check-comments` só nas linhas adicionadas pelo PR, para julgar o que o PR trouxe e não dívida antiga.
20. Como mantenedor, quero que arquivo de código novo sem cabeçalho `SPDX-License-Identifier` reprove na C1, para que a licença não dependa de lembrar.
21. Como mantenedor, quero actionlint e zizmor na C1, para que workflow inválido ou inseguro não entre num repositório público.
22. Como mantenedor, quero gitleaks (pelo CLI) no diff, typos, knip, lychee só com links internos e osv-scanner só com vulnerabilidades novas na C1, para pegar higiene barata sem depender de site externo estar no ar.
23. Como mantenedor, quero o React Doctor na C1 em escopo `changed` contra a `develop`, reprovando por `error`, sem score, telemetria nem varredura de supply chain, para que o PR não dependa de rede externa.
24. Como mantenedor, quero que o React Doctor não repita as regras que o Oxlint já roda, para que um mesmo problema não apareça duas vezes.
25. Como contribuidor externo, quero que o CI rode no meu PR de fork sem acesso a segredos, para contribuir sem que meu código veja credenciais.

### O check `gate`

26. Como mantenedor, quero um único check obrigatório chamado `gate`, que dependa de todos os jobs, para que entrar um serviço novo ou renomear um job não exija mexer no ruleset.
27. Como mantenedor, quero que o `gate` conte como verde um job pulado por "não afetado" e como vermelho qualquer falha ou cancelamento, para que a fila não trave nem deixe passar falha.
28. Como mantenedor, quero que o `gate` seja emitido tanto no `pull_request` quanto no `merge_group`, para que a merge queue encontre o check que o ruleset exige.
29. Como mantenedor, quero o `gate` aceito pelo ruleset só se vier do GitHub Actions, para que ninguém forje um `gate` verde por outro caminho.

### C2: merge queue

30. Como mantenedor, quero que a `develop` só receba código pela merge queue, em grupos de 1 a 3 PRs, para que dois PRs verdes isoladamente não quebrem juntos.
31. Como mantenedor, quero que a C2 repita tudo da C1 sobre o resultado do merge do grupo, para pegar o conflito semântico entre PRs do mesmo grupo.
32. Como mantenedor, quero integração com Testcontainers, teste de arquitetura e build de imagem só a partir da C2, para que o PR fique rápido sem que essas falhas cheguem à `develop`.
33. Como mantenedor, quero a fila com espera de 2 min para formar grupo, até 2 grupos construídos em paralelo, ALLGREEN, timeout de 30 min e merge por squash, para que um PR solitário entre rápido e um grupo travado expire.
34. Como mantenedor, quero que a C2 nunca use `cancel-in-progress` no `merge_group`, para que a própria fila não cancele os seus jobs.

### Cache e velocidade

35. Como mantenedor, quero que o push na `develop` só grave cache (Bun, Maven, uv, Go e camadas de imagem), sem rodar teste, para que PRs e fila leiam um cache quente sem repetir a validação da C2.
36. Como mantenedor, quero chaves de cache derivadas dos lockfiles de cada ecossistema, para que um cache velho nunca seja usado depois de uma mudança de dependência.
37. Como mantenedor, quero clone blobless com histórico completo, para calcular a base do diff sem baixar todos os blobs.
38. Como mantenedor, quero uma matriz de jobs por serviço afetado × categoria (estática, teste), com as checagens baratas do monorepo num job só, para usar os 20 jobs simultâneos do plano grátis.
39. Como mantenedor, quero o paralelismo interno de cada ferramenta de teste ajustado a 4 workers, para casar com os 4 vCPU do runner grátis.

### C3: caça de hora em hora

40. Como mantenedor, quero uma execução de hora em hora que varie algo entre rodadas (ordem embaralhada, detector de corrida com repetição, osv-scanner completo), para achar o que execução determinística repetida nunca acharia.
41. Como mantenedor, quero que a C3 aceite seed de teste de propriedade e fuzz quando o §14 os trouxer, sem redesenho, para que a camada engrosse sem mudar de forma.
42. Como mantenedor, quero que a C3 nunca bloqueie merge, para que um achado aleatório não pare o trabalho de todos.

### C4: suíte noturna

43. Como mantenedor, quero toda noite a suíte inteira sem detecção de afetados e, no TypeScript, com `isolate: true`, para pegar vazamento de estado entre testes e o que a detecção pulou.
44. Como mantenedor, quero na C4 as varreduras completas (React Doctor em escopo `full`, gitleaks no histórico, lychee com links externos, `check-comments` no repositório inteiro), para que o que escapou por bypass ou por rede apareça.
45. Como mantenedor, quero que a C4 compare o que falhou com o que a detecção de afetados teria marcado como não afetado, e abra issue própria quando um serviço "não afetado" falhar, para que um bug na lógica de pular seja descoberto.
46. Como mantenedor, quero o horário do cron noturno fora da virada da hora, para reduzir atraso e descarte de execução agendada.

### Release

47. Como mantenedor, quero que o PR de release da `develop` para a `main` rode a suíte da C4 sobre o código exato da release, como check obrigatório da `main`, para não depender de lembrar de olhar o último noturno.

### Do achado à issue

48. Como loop autônomo, quero que uma falha de C3 ou C4 seja reexecutada até 3 vezes com a mesma seed antes de virar issue, para receber só **Falha Confirmada** como bug.
49. Como mantenedor, quero que uma falha que passou em alguma reexecução vire issue de **Teste Instável** em `needs-triage`, para decidir se o defeito está no teste ou no código.
50. Como mantenedor, quero que falha de infraestrutura (runner, rede, rate limit) não abra issue, para que o loop não persiga ruído.
51. Como loop autônomo, quero a **Falha Confirmada** em `ready-for-agent` com labels `ci-bot` e `bug`, para pegá-la direto como ticket.
52. Como mantenedor, quero que cada issue carregue a **Assinatura de Falha** num marcador invisível, e que uma nova ocorrência com issue aberta só ganhe comentário, para não receber dez issues da mesma falha.
53. Como mantenedor, quero que uma falha que volta depois de a issue ser fechada abra issue nova citando a antiga, para preservar o vínculo com o PR que tinha corrigido.
54. Como loop autônomo, quero corpo de issue em template fixo (assinatura, camada, SHA, link do run, seed, comando para reproduzir, saída truncada), para reproduzir sem abrir o log.
55. Como mantenedor, quero que o loop trate o corpo da issue como dado não confiável, para que texto plantado num log não vire instrução (C04).
56. Como mantenedor, quero as issues abertas por um GitHub App próprio (`scout-ci-bot`), com só `issues: write`, para que a issue possa disparar o loop por evento e o autor diga de onde ela veio.
57. Como mantenedor, quero a chave do App num environment restrito à `develop`, para que nenhum PR, de fork ou não, consiga usá-la.

### Comentários

58. Como agente de código, quero a regra de comentários no `CLAUDE.md` com as cinco exceções fechadas e a lista do que não escrever, para saber o que é permitido antes de escrever.
59. Como agente de código, quero que `check-comments` reprove com mensagem que diga o que fazer em vez de comentar (renomear, extrair, mudar o tipo, criar ADR ou issue), para corrigir a causa e não só calar o erro.
60. Como mantenedor, quero que `TODO` só passe no formato `TODO(#n)`, julgado só pelo `check-comments`, com as regras nativas que reprovam qualquer TODO desligadas, para que ferramentas não briguem entre si.
61. Como mantenedor, quero que supressão de lint ou de tipo sem link para issue ou ADR na mesma linha reprove, para que silenciar um erro deixe rastro.
62. Como mantenedor, quero doc comment aceito só logo acima de símbolo exportado, para que narração não se esconda em Javadoc de método privado.
63. Como mantenedor, quero que as regras nativas que não conflitam fiquem ligadas (ruff `ERA` e `PGH`, `nolintlint`, exigência de descrição em supressão), para que o linter de cada linguagem pegue o que já sabe pegar.

### Toolchain por linguagem

64. Como agente de código em TypeScript, quero `bun fmt`, `bun check` (exposto como script `typecheck`), Oxlint type-aware e Vitest, para ter formatação, tipos, lint e teste num ciclo curto.
65. Como mantenedor, quero o Next.js rodando em Node LTS em produção, para ficar no runtime que ele suporta oficialmente.
66. Como agente de código em Java, quero JDK 25 com Maven Wrapper, Spotless com google-java-format, Error Prone com NullAway, Checkstyle e PMD sem regras de formatação, e ArchUnit, para ter o equivalente da toolchain do TypeScript.
67. Como agente de código em Python, quero uv, Ruff (formatação e lint), mypy strict com o plugin do Pydantic, import-linter e pytest com xdist, para ter o mesmo.
68. Como agente de código em Go, quero golangci-lint v2 (lint e formatação), go-arch-lint e govulncheck, para ter o mesmo.
69. Como mantenedor, quero que o teste de arquitetura de cada linguagem garanta que `domain` não importa framework, banco, HTTP nem mensageria, para que a Clean Architecture seja verificada e não só desejada.

### Guardrails no GitHub

70. Como mantenedor, quero rulesets na `develop` e na `main` que proíbam push direto e force push e exijam PR, para que nada entre por fora do fluxo, documentação inclusive.
71. Como mantenedor, quero CODEOWNERS listando `.github/**`, lockfiles, testes de aceitação e `docs/adr/**` como meus, só informativo, para ver quem é dono sem travar a fila.
72. Como mantenedor, quero todo workflow com permissões read-only no topo e escrita só no job que precisa, para que um job comprometido tenha o mínimo de alcance.
73. Como mantenedor, quero toda action fixada por SHA, para que uma tag movida não troque o código que roda no meu CI.
74. Como mantenedor, quero proibidos os gatilhos `pull_request_target`, `issue_comment` e `workflow_run`, para que nenhum workflow aja a partir de texto de terceiro.
75. Como mantenedor, quero o Renovate (app hospedado) abrindo PRs de atualização de todos os ecossistemas, incluindo Bun, Docker e SHAs de actions, sem automerge, para ter atualização e alerta de segurança sem que nada entre sem mim.

### Portfólio

76. Como leitor do repositório público, quero ler nos ADRs por que o CI tem quatro camadas, por que Bun e por que não há comentários, para entender as escolhas sem conversa.

## Implementation Decisions

### Estrutura

- Monorepo com `services/<nome>` (um build nativo por serviço), `web/` (Next.js) e `scripts/` (CI em TypeScript). Workspaces do Bun: `web/` e `scripts/`.
- No M0 não há serviço de negócio. O §1 entrega a estrutura, a CI e um serviço-exemplo mínimo por linguagem (Java, Python, Go) e o `web/`, cada um com um teste unitário e um teste de arquitetura, para que cada caminho do CI tenha o que executar e falhar. Os exemplos são esqueletos de verificação, não domínio; somem ou viram serviços reais nos §4 em diante.
- Esqueleto de Docker Compose: um profile por fluxo de trabalho, todo serviço com `mem_limit`, teto de 10 GB por profile. No M0 o arquivo existe com a convenção e sem serviços de negócio.

### Scripts de CI (TypeScript no Bun)

Cada script é um módulo com uma entrada pública de linha de comando: recebe argumentos e lê o repositório git, escreve resultado legível (e JSON quando outro job consome) e sai com código 0 ou 1. Nenhum script fala com o GitHub diretamente, exceto pelo **IssueTracker**.

- **Serviços Afetados.** Entrada: ref base e ref alvo. Lê o diff e os manifestos de dependência dos serviços. Saída: lista de **Serviços Afetados**, ou "todos" quando a raiz mudou. Consumido pela matriz da C1/C2 e pelo pre-push.
- **Veredito do gate.** Entrada: resultados dos jobs de que o `gate` depende. Regra: falha ou cancelamento → vermelho; sucesso ou pulado por "não afetado" → verde. Saída: veredito e lista de culpados.
- **check-comments.** Modos: linhas adicionadas entre duas refs (C1) e repositório inteiro (C4). Julga as quatro linguagens: as cinco exceções do ADR-0004, `TODO(#n)`, supressão com link, doc comment só acima de símbolo exportado, e cabeçalho SPDX obrigatório em arquivo de código adicionado. Mensagem de erro prescritiva.
- **Título do PR.** Valida Conventional Commits (`type(scope)?: subject`).
- **Orçamento do Compose.** Soma `mem_limit` por profile; reprova serviço sem limite ou profile acima de 10 GB.
- **Relator de falhas.** Entrada: resultado de uma execução de C3/C4 (falhas com serviço, teste ou checagem, tipo e seed). Reexecuta cada falha até 3 vezes com a mesma seed (via comando de reprodução que cada linguagem expõe), classifica em **Falha Confirmada**, **Teste Instável** ou falha de infraestrutura, calcula a **Assinatura de Falha** e chama o **IssueTracker**.
- **IssueTracker** é a única porta para o GitHub: buscar issue aberta por assinatura, criar issue, comentar. A implementação real usa o token de instalação do App `scout-ci-bot`; os testes usam uma fake em memória.
- Checagem cruzada da C4: entrada é a lista de falhas e a lista de **Serviços Afetados** que a C2 teria calculado para os commits do dia; um serviço que falhou sem estar nela gera issue própria de bug da detecção.

### Workflows

- Um workflow para `pull_request` + `merge_group` (C1 e C2 com o mesmo job `gate`; os jobs só da C2 condicionados ao evento), um para `push` na `develop` (só cache), um para a C3 (`schedule` de hora em hora, minuto fora da virada), um para a C4 (`schedule` noturno, minuto fora da virada) e o mesmo conjunto da C4 disparado pelo PR de release para a `main`.
- `concurrency` com `cancel-in-progress` só no `pull_request`, nunca no `merge_group`.
- `permissions` read-only no topo; actions por SHA; sem `pull_request_target`, `issue_comment` e `workflow_run`.
- Checkout com histórico completo e filtro blobless.
- Matriz por **Serviço Afetado** × categoria; checagens de monorepo (fmt, higiene, comentários, título, Compose) num job só.
- Cache: Bun (cache de instalação, não só o binário), Maven, uv, Go e camadas de imagem; chave pelo hash do lockfile; gravado no push da `develop`.

### Ferramentas por camada

| Ferramenta | C1 | C2 | C3 | C4 |
|---|---|---|---|---|
| Formatação, lint, typecheck (todas as linguagens) | afetados | afetados | — | tudo |
| Unitário | afetados (Vitest `isolate:false`) | afetados | embaralhado, repetido, `-race` | tudo (Vitest `isolate:true`) |
| Integração (Testcontainers), arquitetura, build de imagem | — | afetados | — | tudo |
| React Doctor | `--scope changed` | `--scope changed` | — | `--scope full` |
| check-comments | linhas adicionadas | linhas adicionadas | — | repositório |
| actionlint, zizmor, typos, knip, título do PR, Compose | sim | sim | — | sim |
| gitleaks (CLI) | diff | diff | — | histórico |
| lychee | só internos | só internos | — | externos, com cache |
| osv-scanner, govulncheck | só novas | só novas | completo | completo |

### Configuração de ferramentas

- React Doctor: `customRulesOnly: true`, `--blocking error`, `--no-score --no-telemetry --no-supply-chain`.
- Oxlint type-aware; `no-warning-comments` desligada.
- golangci-lint: `godox` desligado, `nolintlint` ligado, formatadores gofumpt e goimports.
- Checkstyle: configuração do Google sem os módulos de espaço, indentação e tamanho de linha e sem `TodoComment`. PMD com ruleset curto (bestpractices + errorprone) sem sobrepor Error Prone.
- Ruff: `ERA` e `PGH` ligados.
- Teste de arquitetura: ArchUnit, import-linter (contrato de camadas) e go-arch-lint, todos com a regra "`domain` não importa framework, banco, HTTP nem mensageria".

### GitHub

- Ruleset `develop`: PR obrigatório, sem push direto nem force push, merge queue (1–3, 2 min, concorrência 2, ALLGREEN, 30 min, squash), check `gate` exigido com origem GitHub Actions.
- Ruleset `main`: PR obrigatório, sem push direto nem force push, check da suíte C4 exigido com origem GitHub Actions; merge commit.
- CODEOWNERS informativo, sem `require_code_owner_review` e sem trava de caminho.
- GitHub App `scout-ci-bot`: permissão `issues: write`, instalado só neste repositório; chave privada no environment `ci-bot` restrito à `develop`.
- Labels novas: `ci-bot`, `bug`, `flaky`.
- Renovate como app hospedado, agrupado por ecossistema, semanal, sem automerge; Bun fixado só por PR.

### Board do projeto

- Board Kanban da organização com as colunas Backlog, Ready, In progress, In review e Done, mantido pelo workflow `board-sync` (ADR-0005): fechada → Done; PR aberto que a fecha → In review; atribuída → In progress; label pronta e sem bloqueador aberto → Ready; o resto → Backlog.
- Roda em eventos de issue e por cron de 15 min, com o token do `scout-ci-bot`; precisa da variável com o número do projeto.
- Entrou antes do workspace `scripts/` (#2), com testes em `bun:test`; o #2 o traz para o workspace e para o Vitest.

### Documentação

- Seção "Comentários no código" no `CLAUDE.md` (já escrita).
- Seção "Engenharia" no `GLOSSARY.md` (já escrita).
- ADRs 0002 a 0005 passam de `proposed` a `accepted` no merge desta spec.
- A linha do §1 do `requisitos.md` diz Renovate (já corrigida).

### Passos manuais (fora do alcance de um agente)

Criar e instalar o GitHub App e guardar a chave no environment; instalar o app do Renovate; criar os rulesets. Cada um vira ticket `ready-for-human`, com wizard quando o passo for longo.

## Testing Decisions

- **Um bom teste aqui** exercita a entrada pública de cada script, a mesma que o workflow chama, com um repositório git de fixture criado num diretório temporário, e afirma sobre a saída e o código de saída. Não testa funções internas nem o formato do YAML.
- **Fronteiras de teste:** (1) a CLI de cada script, com Vitest; (2) a porta **IssueTracker**, com uma fake em memória que registra issues e comentários. Nenhum teste chama o GitHub de verdade.
- **Módulos testados e cenários mínimos:**
  - Serviços Afetados: mudança dentro de um serviço; mudança numa dependência declarada; mudança na raiz → todos; renomear e apagar arquivo; diff vazio.
  - Veredito do gate: tudo verde; um pulado; uma falha; um cancelado; nenhum job.
  - check-comments: cada exceção aceita e cada caso proibido, nas quatro linguagens; doc comment acima de símbolo exportado e de símbolo privado; arquivo de código novo sem SPDX; modo "linhas adicionadas" ignora violação antiga.
  - Título do PR: válidos e inválidos.
  - Orçamento do Compose: dentro do teto, acima do teto, serviço sem limite.
  - Relator de falhas: falha em todas as reexecuções → **Falha Confirmada** e issue nova; passa em uma → **Teste Instável**; infraestrutura → nada; mesma **Assinatura de Falha** com issue aberta → comentário; issue fechada → issue nova citando a antiga.
  - Checagem cruzada: serviço falhou sem estar entre os afetados → issue de bug da detecção.
- **Workflows** são verificados por actionlint e zizmor, na C1; não há execução local de workflow (`act`).
- **Os serviços-exemplo** provam cada caminho do CI: um teste unitário e um de arquitetura por linguagem, e um teste de integração com Testcontainers que só roda na C2.
- **Prior art:** nenhum; o repositório não tem código. Estes testes viram a referência para o §3.

## Out of Scope

- O sloth, os hooks do Claude Code e as mudanças nas skills `tdd`, `implement` e `fila` (grill no repositório de skills). Daqui sai só a interface: label `ci-bot`, autor `scout-ci-bot[bot]` e formato da issue.
- Runner pago (Blacksmith e similares), revisor de outro modelo, telemetria e evals.
- Teste de propriedade, fuzz e mutação (§14); a C3 nasce pronta para recebê-los.
- Trava de caminhos protegidos para PRs de agente (recusada; volta no grill do sloth).
- Contrato de erro e observabilidade (§2) e a convenção de teste por linguagem além do que o CI exige (§3).
- Serviços de negócio e o conteúdo dos profiles do Compose.

## Further Notes

- Versões de referência em 2026-11-27: Bun 1.4.5, Oxlint 1.95, Vitest 5.1, React Doctor 0.9.23, JDK 25, Spring Boot 4.2, uv 0.13, Ruff 0.17, mypy 2.4, Go 1.27, golangci-lint 2.15.
- `bun fmt` e `bun check` existem desde o Bun 1.4.3–1.4.4. A saída, se falharem, está no ADR-0003: oxfmt e `tsc --noEmit`.
- O script de typecheck não pode se chamar `check`: `bun check` entraria em loop.
- O GitHub desliga workflows agendados de repositório público após 60 dias sem atividade, e o `schedule` só roda na branch padrão; a `develop` precisa continuar sendo a padrão.
- O Dependabot não abre PR de segurança para Bun; por isso o Renovate.
- A gitleaks-action v2 exige licença em repositório de organização; por isso o CLI.
