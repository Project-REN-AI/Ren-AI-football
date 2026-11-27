// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { formatScoreboard } from "../domain/scoreboard";

export default function HomePage() {
  return (
    <main>
      <h1>Scout</h1>
      <p>{formatScoreboard({ home: 0, away: 0 })}</p>
    </main>
  );
}
