// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { findForbiddenDomainImports } from "./domain-imports";

function domainFixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "domain-imports-"));
  for (const [path, source] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), source);
  }
  return join(root, "domain");
}

describe("findForbiddenDomainImports", () => {
  it("rejects a framework import in domain", () => {
    const domain = domainFixture({ "domain/match.ts": 'import { NextResponse } from "next/server";\n' });

    expect(findForbiddenDomainImports(domain)).toEqual([{ file: "match.ts", specifier: "next/server" }]);
  });

  it("accepts imports that stay inside domain", () => {
    const domain = domainFixture({
      "domain/match.ts": 'import type { Scoreboard } from "./score/scoreboard";\nexport type { Scoreboard };\n',
      "domain/score/scoreboard.ts":
        'import { type Team } from "../team";\nexport interface Scoreboard { team: Team }\n',
      "domain/team.ts": "export interface Team { name: string }\n",
    });

    expect(findForbiddenDomainImports(domain)).toEqual([]);
  });

  it("rejects a relative import that leaves domain", () => {
    const domain = domainFixture({
      "domain/match.ts": 'import { db } from "../infrastructure/db";\n',
      "infrastructure/db.ts": "export const db = {};\n",
    });

    expect(findForbiddenDomainImports(domain)).toEqual([{ file: "match.ts", specifier: "../infrastructure/db" }]);
  });

  it("rejects re-exports and dynamic imports from outside domain", () => {
    const domain = domainFixture({
      "domain/match.ts": 'export { Pool } from "pg";\nexport const load = () => import("kafkajs");\n',
    });

    expect(findForbiddenDomainImports(domain)).toEqual([
      { file: "match.ts", specifier: "pg" },
      { file: "match.ts", specifier: "kafkajs" },
    ]);
  });

  it("rejects static database and CommonJS imports in any TypeScript module flavor", () => {
    const domain = domainFixture({
      "domain/match.ts": 'import { Pool } from "pg";\n',
      "domain/http.cts": 'const http = require("node:http");\nexport = http;\n',
      "domain/kafka.mts": 'import kafka = require("kafkajs");\nexport default kafka;\n',
    });

    expect(findForbiddenDomainImports(domain)).toEqual(
      expect.arrayContaining([
        { file: "match.ts", specifier: "pg" },
        { file: "http.cts", specifier: "node:http" },
        { file: "kafka.mts", specifier: "kafkajs" },
      ]),
    );
  });

  it("ignores test files in domain", () => {
    const domain = domainFixture({ "domain/match.test.ts": 'import { it } from "vitest";\n' });

    expect(findForbiddenDomainImports(domain)).toEqual([]);
  });

  it("finds nothing forbidden in the web domain layer", () => {
    const domain = fileURLToPath(new URL("../src/domain", import.meta.url));

    expect(findForbiddenDomainImports(domain)).toEqual([]);
  });
});
