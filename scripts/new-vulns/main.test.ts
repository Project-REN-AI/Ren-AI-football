// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const CLI = fileURLToPath(new URL("./main.ts", import.meta.url));

interface Finding {
  readonly ecosystem: string;
  readonly name: string;
  readonly version: string;
  readonly ids: readonly string[];
}

function osvReport(findings: readonly Finding[]): string {
  return JSON.stringify({
    results: [
      {
        source: { path: "/repo/bun.lock", type: "lockfile" },
        packages: findings.map(({ ecosystem, name, version, ids }) => ({
          package: { name, version, ecosystem },
          vulnerabilities: ids.map((id) => ({ id, summary: `${id} summary` })),
          groups: [{ ids, aliases: ids, max_severity: "7.5" }],
        })),
      },
    ],
    experimental_config: { licenses: { summary: false, allowlist: null } },
  });
}

function runNewVulns(
  base: string,
  head: string,
  options: readonly string[] = [],
): { exitCode: number | null; output: string } {
  const dir = mkdtempSync(join(tmpdir(), "new-vulns-"));
  const basePath = join(dir, "base.json");
  const headPath = join(dir, "head.json");
  writeFileSync(basePath, base);
  writeFileSync(headPath, head);
  const result = spawnSync("bun", [CLI, ...options, basePath, headPath], { encoding: "utf8" });
  rmSync(dir, { recursive: true });
  return { exitCode: result.status, output: result.stdout + result.stderr };
}

const LODASH_PROTOTYPE_POLLUTION: Finding = {
  ecosystem: "npm",
  name: "lodash",
  version: "4.17.20",
  ids: ["GHSA-35jh-r3h4-6jhm"],
};

describe("new vulnerabilities CLI", () => {
  it("is red and names a vulnerability the head introduced", () => {
    const { exitCode, output } = runNewVulns(osvReport([]), osvReport([LODASH_PROTOTYPE_POLLUTION]));

    expect(exitCode).toBe(1);
    expect(output).toContain("new vulnerabilities: 1");
    expect(output).toContain("npm/lodash@4.17.20: GHSA-35jh-r3h4-6jhm");
  });

  it("is green when the vulnerability was already in the base", () => {
    const { exitCode, output } = runNewVulns(
      osvReport([LODASH_PROTOTYPE_POLLUTION]),
      osvReport([LODASH_PROTOTYPE_POLLUTION]),
    );

    expect(exitCode).toBe(0);
    expect(output).toContain("new vulnerabilities: 0");
  });

  it("is green when a version bump keeps a vulnerability the base already had", () => {
    const { exitCode, output } = runNewVulns(
      osvReport([LODASH_PROTOTYPE_POLLUTION]),
      osvReport([{ ...LODASH_PROTOTYPE_POLLUTION, version: "4.17.21" }]),
    );

    expect(exitCode).toBe(0);
    expect(output).toContain("new vulnerabilities: 0");
  });

  it("is green when the head fixed every vulnerability", () => {
    const { exitCode, output } = runNewVulns(osvReport([LODASH_PROTOTYPE_POLLUTION]), osvReport([]));

    expect(exitCode).toBe(0);
    expect(output).toContain("new vulnerabilities: 0");
  });

  it("names only the vulnerability the head added next to an old one", () => {
    const { exitCode, output } = runNewVulns(
      osvReport([LODASH_PROTOTYPE_POLLUTION]),
      osvReport([
        { ...LODASH_PROTOTYPE_POLLUTION, ids: ["GHSA-35jh-r3h4-6jhm", "GHSA-p6mc-m468-83gw"] },
        { ecosystem: "Go", name: "golang.org/x/net", version: "0.1.0", ids: ["GO-2023-1571"] },
      ]),
    );

    expect(exitCode).toBe(1);
    expect(output).toContain("new vulnerabilities: 2");
    expect(output).toContain("npm/lodash@4.17.20: GHSA-p6mc-m468-83gw");
    expect(output).toContain("Go/golang.org/x/net@0.1.0: GO-2023-1571");
    expect(output).not.toContain("GHSA-35jh-r3h4-6jhm");
  });

  it("is green when neither side found a lockfile", () => {
    const { exitCode, output } = runNewVulns('{"results": []}', '{"results": []}');

    expect(exitCode).toBe(0);
    expect(output).toContain("new vulnerabilities: 0");
  });

  it("is red when a report is not an osv-scanner JSON report", () => {
    const { exitCode, output } = runNewVulns(osvReport([]), "Scanning dir .");

    expect(exitCode).toBe(1);
    expect(output).toContain("unreadable report");
  });

  it("is red and says which report has a malformed package", () => {
    const { exitCode, output } = runNewVulns(
      osvReport([]),
      '{"results": [{"packages": [{"package": {"name": "lodash"}}]}]}',
    );

    expect(exitCode).toBe(1);
    expect(output).toContain("head.json: package.ecosystem is not a string");
  });
});

interface GoFinding {
  readonly osv: string;
  readonly module: string;
  readonly version: string;
  readonly reach: "module" | "package" | "symbol";
}

function govulncheckStream(findings: readonly GoFinding[]): string {
  const messages: unknown[] = [
    { config: { protocol_version: "v1.0.0", scanner_name: "govulncheck", scan_level: "symbol" } },
    ...findings.map(({ osv, module, version, reach }) => {
      const frame = { module, version };
      const vulnerable =
        reach === "module"
          ? frame
          : reach === "package"
            ? { ...frame, package: module }
            : { ...frame, package: module, function: "Get", receiver: "Result" };
      const trace = reach === "symbol" ? [vulnerable, { module: "example.com/app", function: "main" }] : [vulnerable];
      return { finding: { osv, fixed_version: "v9.9.9", trace } };
    }),
  ];
  return messages.map((message) => JSON.stringify(message, undefined, 2)).join("\n");
}

const GJSON_CALLED: GoFinding = {
  osv: "GO-2021-0265",
  module: "github.com/tidwall/gjson",
  version: "v1.6.5",
  reach: "symbol",
};

describe("new vulnerabilities CLI on govulncheck reports", () => {
  const GOVULNCHECK = ["--format", "govulncheck"];

  it("is red and names a called vulnerability the head introduced", () => {
    const { exitCode, output } = runNewVulns("", govulncheckStream([GJSON_CALLED]), GOVULNCHECK);

    expect(exitCode).toBe(1);
    expect(output).toContain("new vulnerabilities: 1");
    expect(output).toContain("Go/github.com/tidwall/gjson@v1.6.5: GO-2021-0265");
  });

  it("is green when the vulnerable code is required or imported but never called", () => {
    const { exitCode, output } = runNewVulns(
      "",
      govulncheckStream([
        { ...GJSON_CALLED, reach: "module" },
        { ...GJSON_CALLED, reach: "package" },
      ]),
      GOVULNCHECK,
    );

    expect(exitCode).toBe(0);
    expect(output).toContain("new vulnerabilities: 0");
  });

  it("is green when a version bump keeps a called vulnerability the base already had", () => {
    const { exitCode, output } = runNewVulns(
      govulncheckStream([GJSON_CALLED]),
      govulncheckStream([{ ...GJSON_CALLED, version: "v1.6.6" }]),
      GOVULNCHECK,
    );

    expect(exitCode).toBe(0);
    expect(output).toContain("new vulnerabilities: 0 (1 already in the base)");
  });

  it("is red when a report is not a govulncheck JSON stream", () => {
    const { exitCode, output } = runNewVulns("", "Scanning your code", GOVULNCHECK);

    expect(exitCode).toBe(1);
    expect(output).toContain("unreadable report");
  });

  it("is red and says which finding has no trace", () => {
    const { exitCode, output } = runNewVulns("", '{"finding": {"osv": "GO-2021-0265", "trace": []}}', GOVULNCHECK);

    expect(exitCode).toBe(1);
    expect(output).toContain("head.json: finding GO-2021-0265 has no trace");
  });

  it("is red on a format it does not know", () => {
    const { exitCode, output } = runNewVulns("", "", ["--format", "sarif"]);

    expect(exitCode).toBe(1);
    expect(output).toContain("usage");
  });
});
