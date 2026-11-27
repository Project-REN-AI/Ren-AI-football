# Ren AI Football (Scout)

Plataforma de inteligência para futebol, projeto de estudo e portfólio. O codinome do produto é **Scout**. O que ele faz está no [`README.md`](README.md).

Hoje o repositório tem só a documentação que decide: [`requisitos.md`](requisitos.md) (escopo, os 17 domínios e os marcos M0–M3 no frontmatter), [`GLOSSARY.md`](GLOSSARY.md) (linguagem do domínio) e [`docs/adr/`](docs/adr/) (decisões). O código nasce dela.

## Idioma

**Código em inglês, prosa fora do código em português.** Identificador, comentário, pacote, tabela, coluna, rota, campo JSON e mensagem de commit em inglês; README, spec, ADR, issue e corpo de PR em português. O nome de código de um conceito de domínio não se inventa no arquivo que está sendo escrito: é a linha `_Código_` da entrada dele no [`GLOSSARY.md`](GLOSSARY.md).

## Fluxo de trabalho

Um ciclo por domínio, um domínio por sessão:

```
/grill-with-docs → /to-spec → /to-tickets → /implement
```

- O grilling interroga o domínio contra o `requisitos.md`, o glossário e os ADRs. É ali que as decisões nascem; as que merecem registro viram ADR ([ADR-0001](docs/adr/0001-registrar-decisoes-em-adrs.md)).
- A spec vai para `.scratch/<slug>/spec.md`. Specs anteriores entram como pressuposto, citadas pelo caminho.
- Os tickets são GitHub Issues em fatias verticais, com a milestone do domínio (`M0`–`M3`) lida do `domains:` do `requisitos.md`.

As skills desse fluxo não ficam neste repositório: vêm do repositório privado de skills do autor, carregado junto nas sessões.

## Branches

- `develop` é integração e branch padrão. Branch de trabalho nasce dela e volta por PR com **squash**, pela merge queue. Nada entra por push direto, documentação inclusive.
- `main` é release: atualizada só por PR de release, com merge commit, seguido de tag `v0.N.0`.
- O título do PR vira a mensagem do commit na `develop`: inglês, Conventional Commits.

## Arquitetura (alvo)

Microsserviços em Java/Spring Boot, Python/FastAPI, Go e TypeScript/Next.js, com Clean Architecture dentro de cada serviço: `domain` não importa framework, banco, HTTP nem mensageria. Banco por serviço. Detalhes e decisões entram por ADR à medida que cada domínio é grilhado.

## Segurança

Toda resposta de LLM é dado não confiável: validada antes de usar, nunca executada (restrição C04 do `requisitos.md`). Chave de API só em variável de ambiente ou cofre, nunca no código nem no front-end.

## Licença

PolyForm Noncommercial 1.0.0 ([`LICENSE.md`](LICENSE.md)). Arquivo de código novo leva `SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0` no cabeçalho.
