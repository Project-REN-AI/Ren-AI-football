---
status: proposed
date: 2026-11-27
---

# Bun é o gerenciador de pacotes e a toolchain do TypeScript; o Next.js roda em Node

O TypeScript do Scout usa o Bun para instalar dependências (`bun install --frozen-lockfile`, `bun.lock` em texto, workspaces `web/` e `scripts/`), formatar (`bun fmt`), checar tipos (`bun check`, no lugar de `tsc --noEmit`) e rodar os scripts de CI em `.ts` sem build. O motivo é velocidade no CI e no hook local: um binário só cobre o que antes exigia npm, Prettier, `tsc` e `tsx`. Lint fica com o Oxlint, teste com o Vitest e o React Doctor completa a análise do front. **Em produção, o Next.js roda em Node LTS**, o runtime que ele suporta oficialmente.

- **Versão fixada.** `bun fmt` e `bun check` apareceram no Bun 1.4.3 e 1.4.4, semanas antes desta decisão. A versão exata do Bun fica em `packageManager` e é lida pelo `oven-sh/setup-bun` via `bun-version-file`. Ela só muda por PR, que passa pela C2.
- **Lint:** Oxlint direto, com regras type-aware. O `bun lint` embutido lê a mesma configuração, então trocar depois não exige reescrever regras.
- **React Doctor:** na C1, `--scope changed --base develop --blocking error --no-score --no-telemetry --no-supply-chain`. Na C4, `--scope full`. Com `customRulesOnly: true`, as regras portadas do Oxlint ficam só no Oxlint direto e não rodam em dobro. O React Doctor não tem limite de score; quem decide se falha é o `--blocking`.
- **Vitest:** `isolate: false` no PR (C1/C2), `isolate: true` na C4.
- **Cache:** o `setup-bun` guarda só o executável; `~/.bun/install/cache` vai no `actions/cache`, com a chave pelo hash do `bun.lock`.

## Considered Options

- **npm + Prettier + `tsc`.** É o caminho padrão e mais lento: três ferramentas onde cabe uma, e `npm ci` é a etapa mais cara de um job frio.
- **pnpm.** Instala rápido, mas não formata, não checa tipos e não roda `.ts` direto.
- **Esperar `bun fmt` e `bun check` amadurecerem (oxfmt e `tsc` por ora).** Recusado, com saída registrada: se um dos dois falhar, volta-se a `oxfmt` (cuja configuração o `bun fmt` já lê) ou a `tsc --noEmit` trocando uma linha do script.
- **`bun lint` no lugar do Oxlint.** Tinha semanas de vida; o Oxlint é o mesmo motor que o React Doctor usa.
- **Bun também como runtime do Next.js.** Recusado: tira o front da trilha suportada pelo Next.js em troca de nada que o Scout precise.
- **Gate por score do React Doctor.** Recusado: o score depende de uma API externa e não tem limite oficial.

## Consequences

- O Dependabot não abre PR de segurança para Bun, então as dependências são atualizadas pelo **Renovate** (app hospedado), que entende `bun.lock` e workspaces e cobre também Maven, uv, Go, Docker e Actions.
- Desenvolvimento e produção usam runtimes diferentes (Bun e Node). Todo teste que depende de runtime roda contra o build de produção na C2.
- Subir a versão do Bun é uma mudança que se revisa, não uma atualização automática qualquer.
