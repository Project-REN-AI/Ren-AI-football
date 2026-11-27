// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { describe, expect, it } from "vitest";
import { formatScoreboard } from "./scoreboard";

describe("formatScoreboard", () => {
  it("shows home goals before away goals", () => {
    expect(formatScoreboard({ home: 2, away: 1 })).toBe("2 x 1");
  });
});
