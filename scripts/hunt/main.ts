// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { randomInt } from "node:crypto";
import { runHunt } from "./cli";

const MAX_SEED = 2 ** 31 - 1;

const { exitCode, output } = await runHunt(process.argv.slice(2), {
  nextSeed: () => String(randomInt(1, MAX_SEED)),
});
console.log(output);
process.exit(exitCode);
