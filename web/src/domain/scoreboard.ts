// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

export interface Scoreboard {
  readonly home: number;
  readonly away: number;
}

export function formatScoreboard(scoreboard: Scoreboard): string {
  return `${scoreboard.home} x ${scoreboard.away}`;
}
