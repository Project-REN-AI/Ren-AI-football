---
# ============================================================
# Metadados para consumo por agentes (Claude Code).
# Chaves em inglês por convenção de parsing; valores em pt-BR.
# ============================================================

doc_id: ren-ai-football-requisitos
title: "Catálogo de Requisitos — Scout (Ren AI Football)"
doc_type: requirements_catalog
purpose: "Fonte de verdade sobre escopo, domínios e marcos. Insumo do grilling, das specs e dos tickets."
version: "0.2"
date: 2026-11-28
status: draft
language: pt-BR
owner: "Gabriel Menezes"

product:
  name: Scout
  repository: Project-REN-AI/Ren-AI-football
  category: "Plataforma de inteligência para futebol"
  goal: "Projeto de estudo e portfólio para desenvolvimento back-end, ML Engineering e AI Engineering"

constraints:
  - id: C01
    text: "Custo de operação próximo de zero: planos gratuitos (Groq, Colab/Kaggle, GitHub Actions em repositório público) e poucos dólares de crédito de API para avaliação."
  - id: C02
    text: "O ambiente de desenvolvimento roda num computador de 16 GB de RAM e 8 núcleos, um profile do Docker Compose por vez."
  - id: C03
    text: "Dados de partida vêm de fontes abertas (StatsBomb Open Data) e de APIs com plano gratuito, respeitando os termos de uso de cada uma."
  - id: C04
    text: "Toda resposta de LLM é dado não confiável: validada antes de usar, nunca executada."
  - id: C05
    text: "O Scout é vitrine de padrões de sistemas distribuídos: cada padrão do mapa em 'Padrões de resiliência e concorrência' tem ao menos um uso real num domínio, justificado pela necessidade do domínio e registrado em ADR."

scope:
  milestones:
    - { id: M0, name: "Fundação", due: null }
    - { id: M1, name: "Dados", due: null }
    - { id: M2, name: "Inteligência", due: null }
    - { id: M3, name: "Expansão", due: null }

# ------------------------------------------------------------
# Domínios. O marco de cada um é a milestone das issues dele.
# Cada domínio tem uma seção §n no corpo deste documento.
# ------------------------------------------------------------
domains:
  - { id: 1, name: "Fundação e CI", scope: mvp, milestone: M0 }
  - { id: 2, name: "Contrato de erro e observabilidade básica", scope: mvp, milestone: M0 }
  - { id: 3, name: "Convenções de teste", scope: mvp, milestone: M0 }
  - { id: 4, name: "Catálogo de futebol", scope: mvp, milestone: M1 }
  - { id: 5, name: "Ingestão de dados brutos", scope: mvp, milestone: M1 }
  - { id: 6, name: "Partida ao vivo", scope: mvp, milestone: M1 }
  - { id: 7, name: "Modelo de xG", scope: mvp, milestone: M2 }
  - { id: 8, name: "Estilos de jogo", scope: mvp, milestone: M2 }
  - { id: 9, name: "Busca e similaridade", scope: mvp, milestone: M2 }
  - { id: 10, name: "LLM e RAG", scope: mvp, milestone: M2 }
  - { id: 11, name: "Analytics e grafos", scope: mvp, milestone: M3 }
  - { id: 12, name: "Agente e integrações", scope: mvp, milestone: M3 }
  - { id: 13, name: "Segurança", scope: mvp, milestone: M3 }
  - { id: 14, name: "Observabilidade avançada e testes de resiliência", scope: mvp, milestone: M3 }
  - { id: 15, name: "Kubernetes e produção", scope: mvp, milestone: M3 }
  - { id: 16, name: "Verificação formal", scope: mvp, milestone: M3 }
  - { id: 17, name: "Bônus", scope: v2, milestone: v2 }

milestone_overrides: []
---

# Catálogo de Requisitos — Scout

O Scout é uma plataforma de inteligência para futebol. Ele reproduz partidas reais lance a lance, mede a qualidade de cada chute, descobre estilos de jogo, encontra jogadores parecidos e responde perguntas com fontes.

Este documento diz **o quê** e **em que ordem**. O **como** nasce no grilling de cada domínio, vira spec em `.scratch/<slug>/spec.md` e, quando a decisão merece registro, ADR em [`docs/adr/`](./docs/adr/). A linguagem do domínio está em [`GLOSSARY.md`](./GLOSSARY.md).

## Marcos

| Marco | Tema | Domínios |
|---|---|---|
| **M0** | Fundação | §1, §2, §3 |
| **M1** | Dados | §4, §5, §6 |
| **M2** | Inteligência | §7, §8, §9, §10 |
| **M3** | Expansão | §11, §12, §13, §14, §15, §16 |
| **v2** | Bônus | §17 |

O critério de ordem é o mesmo em todo o projeto: **o que impõe disciplina sobre o código futuro vem antes do código que ele governa.** Lint, contrato de erro e convenção de teste são baratos num repositório vazio e caros depois.

Ao fim do M2 o Scout é apresentável como portfólio. O M3 aprofunda.

## Padrões de resiliência e concorrência

A restrição C05 pede que o Scout exercite estes padrões. Cada um tem casa num domínio, onde a necessidade é real; o grilling do domínio decide o desenho e registra a decisão em ADR.

| Padrão | Necessidade | Domínio |
|---|---|---|
| Consumidor idempotente | Kafka entrega *at-least-once*; o mesmo evento não pode contar duas vezes no placar | §6 |
| Outbox | Gravar no banco e publicar evento sem perder nem duplicar | §5, §9 |
| Retry com backoff exponencial e DLQ | API externa instável e evento malformado não podem travar a partição | §4, §6 |
| Circuit breaker | API de futebol e provedores de LLM fora do ar não podem derrubar o Scout | §4, §10 |
| Rate limit (token bucket em Redis + Lua) | Cota gratuita da API externa e dos provedores de LLM (C01) | §4, §10 |
| Lock pessimista distribuído (Redis + Lua) | A sincronização do catálogo não pode rodar duas vezes em paralelo | §4 |
| Lock pessimista no banco (`SELECT … FOR UPDATE SKIP LOCKED`) | Vários workers disputam os lotes de ingestão; cada lote é processado por um só | §5 |
| Lock otimista (versão no registro) | Dois analistas editam o mesmo relatório de observação | §12 |
| Cache-aside com invalidação por evento | Leitura do catálogo e da estatística de temporada é muito mais frequente que escrita | §4, §11 |
| Saga com compensação | O relatório atravessa vários serviços e não tem transação distribuída | §12 |

A ordem segue a do projeto: **idempotência antes de concorrência**. Primeiro a mesma mensagem duas vezes não causa dano (§5, §6); depois duas operações diferentes ao mesmo tempo não se atropelam (§4, §5, §12). Os testes de resiliência do §14 exercitam cada padrão sob falha injetada.

## §1 Fundação e CI

Monorepo, ambiente local que sobe com um comando, CI em todo PR e as regras de branch.

- Estrutura do monorepo e Docker Compose com profiles, para caber na restrição C02.
- CI no GitHub Actions; merge queue na `develop`; `main` só por PR de release.
- Formatadores e linters por linguagem, pre-commit, Dependabot.
- Convenção de idioma, de commits e de registro de decisões.

## §2 Contrato de erro e observabilidade básica

O formato único de erro entre serviços e o mínimo de logs, métricas e traces que todo serviço nasce tendo.

- Erros em Problem Details (RFC 9457), com código estável.
- Logs estruturados e correlação por trace desde o primeiro serviço.

## §3 Convenções de teste

O que conta como teste suficiente em cada linguagem, antes de existir código para testar.

- Unitário, integração com Testcontainers e teste de arquitetura.
- O que roda no PR e o que roda no cron.

## §4 Catálogo de futebol

Competições, temporadas, times, jogadores e partidas, sincronizados de uma API externa.

- Modelo relacional no PostgreSQL com migrações versionadas.
- Integração com a fonte externa atrás de uma camada anticorrupção.
- API REST documentada e as primeiras telas do front-end.
- Chamadas à fonte externa com rate limit (token bucket em Redis + Lua), retry com backoff exponencial e circuit breaker.
- Sincronização protegida por lock pessimista distribuído (Redis + Lua, com TTL e dono do lock), para nunca rodar em dobro.
- Leitura do catálogo por cache-aside no Redis, invalidado pelo evento de mudança.

## §5 Ingestão de dados brutos

Os eventos de partida do StatsBomb Open Data guardados como vieram, versionados e exploráveis.

- Arquivo bruto em armazenamento de objetos; documento bruto e metadados no MongoDB.
- Ingestão idempotente e validação de schema.
- Lotes de ingestão numa fila em tabela, disputados por vários workers com `SELECT … FOR UPDATE SKIP LOCKED`.
- Publicação do "lote ingerido" por outbox.
- Ligação entre o jogador da fonte e o jogador do catálogo.

## §6 Partida ao vivo

Uma partida histórica reproduzida em tempo real, do evento até a tela.

- Replay dos eventos no ritmo real para o Kafka, particionado por partida.
- Eventos gravados na Cassandra; placar derivado dos eventos, com rebobinar.
- Consumo idempotente (chave de idempotência gravada na mesma transação do efeito) e tópico de mensagens mortas.
- Tópicos de retry com backoff antes da DLQ, e reprocessamento da DLQ por comando.
- Entrega ao navegador por WebSocket.

## §7 Modelo de xG

A probabilidade de cada chute virar gol, calculada por modelo próprio e servida em produção.

- Baseline e modelo de gradient boosting, avaliados por calibração.
- Rastreamento de experimentos e registro de modelos.
- Serviço de inferência; o modelo em produção vem do registro.

## §8 Estilos de jogo

Perfis de jogador descobertos por clusterização, sem rótulo prévio.

- Features por 90 minutos, redução de dimensionalidade e clusterização.
- Avaliação dos grupos e nome de cada perfil.

## §9 Busca e similaridade

Busca textual de jogadores e "jogadores parecidos com X".

- Vetor de estilo por jogador e busca por semelhança com filtros.
- Busca textual com autocomplete; busca híbrida.
- Sincronização por eventos (outbox e CDC), sem código de cópia manual.

## §10 LLM e RAG

Narração da partida e um assistente que responde com fontes.

- Interface única de LLM, com rate limit (token bucket em Redis + Lua) e cadeia de fallback entre provedores (restrição C01).
- Circuit breaker por provedor: provedor aberto sai da cadeia até se recuperar.
- Narração a partir dos eventos, com streaming.
- RAG sobre regras, relatórios e notícias, com citação verificável.
- Conjunto de avaliação versionado e métricas de qualidade, custo e latência.
- Defesa contra prompt injection (restrição C04).

## §11 Analytics e grafos

Estatística de temporada, momentum ao vivo e redes de passe e de transferência.

- Estatística de temporada servida por cache-aside, invalidada quando uma partida nova é consolidada.

## §12 Agente e integrações

Um agente com ferramentas, exposto também por MCP, e as integrações de saída: workflow de relatório, e-mail, webhooks e notificações.

- Relatório de observação editável por analistas, com lock otimista: edição sobre versão antiga é rejeitada com conflito (Problem Details do §2).
- Workflow de relatório como saga com compensação: gerar com LLM, anexar xG e estilo, publicar e notificar; falha num passo desfaz os anteriores.

## §13 Segurança

Autenticação e autorização, gateway, gestão de segredos e a verificação contínua de segurança no CI.

## §14 Observabilidade avançada e testes de resiliência

SLOs, alertas, testes de carga, caos, mutação e propriedade.

- Testes de caos que provam cada padrão do mapa de resiliência: provedor fora do ar abre o circuito, worker morto libera o lock pelo TTL, mensagem duplicada não muda o placar.

## §15 Kubernetes e produção

O Scout inteiro num cluster, com deploy por GitOps e uma versão pública.

## §16 Verificação formal

Especificações TLA+ dos protocolos onde a ordem dos eventos decide a correção: o consumidor idempotente do §6 e a saga do §12. A spec do consumidor acompanha o §6; a da saga entra no grilling do §12, antes da implementação.

## §17 Bônus

Visão computacional, lakehouse, previsão de resultado e fine-tuning. Fora do MVP.
