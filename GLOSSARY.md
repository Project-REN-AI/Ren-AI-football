# Scout

Linguagem ubíqua do produto. Todo artefato — código, evento, tela, spec, ADR — usa estes termos e evita os marcados como evitados.

Não é especificação. Escopo e marcos ficam em [`requisitos.md`](./requisitos.md); decisões ficam em [`docs/adr/`](./docs/adr/).

**Cada entrada tem dois nomes.** O termo em negrito é como o conceito se chama em prosa, em português. A linha `_Código_` é como ele se chama no código, em inglês. O nome de código de um conceito não se inventa no arquivo que está sendo escrito: ele vem daqui. **Entrada nova sem linha `_Código_` está incompleta.**

## Futebol

**Competição**:
Torneio organizado com regulamento próprio: uma liga, uma copa ou um torneio de seleções.
_Código_: `Competition`
_Avoid_: Campeonato (ambíguo entre a competição e uma edição dela)

**Temporada**:
Uma edição de uma Competição, delimitada no tempo.
_Código_: `Season`
_Avoid_: Ano, edição

**Time**:
Equipe que disputa partidas numa Temporada.
_Código_: `Team`
_Avoid_: Clube (nem todo time é clube; seleções também jogam), equipe

**Jogador**:
Atleta que atua por um ou mais Times ao longo do tempo.
_Código_: `Player`
_Avoid_: Atleta

**Partida**:
Um jogo entre dois Times, numa data, dentro de uma Temporada.
_Código_: `Match`
_Avoid_: Jogo (ambíguo com "jogada"), confronto

## Eventos e replay

**Evento de Partida**:
Uma ação registrada durante a Partida — passe, chute, drible, desarme, falta —, com minuto, posição no campo, jogador e resultado. É a unidade de dado do Scout: tudo o mais é derivado de Eventos.
_Código_: `MatchEvent`
_Avoid_: Lance (em prosa de produto o Lance é a sequência; o Evento é o átomo), ação

**Replay**:
A reprodução de uma Partida já disputada, publicando os Eventos de Partida no ritmo em que aconteceram, ou numa velocidade escolhida.
_Código_: `Replay`, `ReplaySpeed`
_Avoid_: Simulação (o Replay não inventa nada; reproduz o que aconteceu)

**Placar**:
O resultado corrente de uma Partida, derivado dos Eventos de Partida até um instante. Nunca é gravado como fonte; é sempre uma projeção.
_Código_: `Scoreboard`
_Avoid_: Resultado (resultado é o placar final)

**Chute**:
Evento de Partida em que um Jogador finaliza em direção ao gol.
_Código_: `Shot`
_Avoid_: Finalização, arremate

## Inteligência

**xG (Gols Esperados)**:
A probabilidade, de 0 a 1, de um Chute virar gol, estimada por modelo a partir das circunstâncias do Chute.
_Código_: `ExpectedGoals`, `xg` — `xg` só como nome de campo
_Avoid_: Chance de gol (em prosa técnica; na tela, "chance de gol" é a tradução para o torcedor)

**Estilo de Jogo**:
Perfil de atuação de um Jogador descoberto por clusterização das estatísticas dele, sem rótulo prévio. Ganha um nome legível depois de descoberto, como "volante construtor".
_Código_: `PlayingStyle`
_Avoid_: Posição (posição é onde o Jogador atua; estilo é como)

**Similaridade de Estilo**:
A proximidade entre os Estilos de Jogo de dois Jogadores, medida entre os vetores de estilo deles.
_Código_: `StyleSimilarity`, `StyleVector`
_Avoid_: Parecença, match

**Narração**:
Texto gerado por LLM que descreve os Eventos de Partida em linguagem de transmissão esportiva. É texto, não áudio.
_Código_: `Commentary`
_Avoid_: Locução (sugere áudio), relato

**Relatório de Scouting**:
Documento que avalia um ou mais Jogadores para um objetivo de contratação, com estatísticas, Estilo de Jogo e análise.
_Código_: `ScoutingReport`
_Avoid_: Ficha, dossiê

## Dados

**Fonte de Dados**:
Origem externa de dados de futebol — StatsBomb Open Data, uma API de resultados, um site de notícias. Cada Fonte tem termos de uso próprios.
_Código_: `DataProvider`
_Avoid_: Provedor (sozinho, colide com provedor de LLM), feed

**Dado Bruto**:
O conteúdo de uma Fonte de Dados guardado exatamente como chegou, antes de qualquer normalização.
_Código_: `RawRecord`
_Avoid_: Dump

## Engenharia

**Serviço Afetado**:
Serviço cujo diretório ou dependência declarada mudou num conjunto de commits. Uma mudança fora de qualquer serviço, na raiz do monorepo, torna todos os serviços afetados.
_Código_: `AffectedService`
_Avoid_: Serviço alterado, serviço impactado

**Falha Confirmada**:
Falha encontrada pela caça de hora em hora ou pela suíte noturna que se repetiu em todas as reexecuções com a mesma seed. É o que vira issue pronta para o loop autônomo.
_Código_: `ConfirmedFailure`
_Avoid_: Bug do CI, quebra, build vermelho

**Teste Instável**:
Teste que falhou e depois passou ao ser reexecutado com a mesma seed. Não é **Falha Confirmada**: precisa de triagem para decidir se o defeito está no teste ou no código.
_Código_: `FlakyTest`
_Avoid_: Teste quebrado, teste aleatório

**Assinatura de Falha**:
Identidade estável de uma **Falha Confirmada** ou de um **Teste Instável**: o serviço, o teste ou a checagem, e o tipo da falha. Duas ocorrências com a mesma assinatura são a mesma falha. Um **Serviço Pulado** tem assinatura própria, só do serviço.
_Código_: `FailureSignature`
_Avoid_: Hash do erro, fingerprint

**Serviço Pulado**:
Serviço com **Falha Confirmada** nova na suíte noturna que nenhum commit desde a noite anterior tornou **Serviço Afetado**: a C2 o pulou, e a falha aponta bug na detecção.
_Código_: `SkippedService`
_Avoid_: Serviço esquecido, falso negativo
