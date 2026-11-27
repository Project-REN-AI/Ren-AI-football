// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const repository = fileURLToPath(new URL("../..", import.meta.url));
const fixtures: string[] = [];

afterEach(() => {
  for (const fixture of fixtures.splice(0)) rmSync(fixture, { recursive: true, force: true });
});

const rootManifest: { scripts: Record<string, string>; devDependencies: Record<string, string> } = JSON.parse(
  readFileSync(join(repository, "package.json"), "utf8"),
);

function rootScript(name: string): string {
  const script = rootManifest.scripts[name];
  if (script === undefined) throw new Error(`package.json has no "${name}" script`);
  return script;
}

function bunWorkspaces(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "knip-"));
  fixtures.push(root);
  const tree: Record<string, string> = {
    "package.json": JSON.stringify({
      name: "fixture",
      private: true,
      workspaces: ["app"],
      scripts: { knip: rootScript("knip") },
      devDependencies: { knip: rootManifest.devDependencies["knip"] },
    }),
    "app/package.json": JSON.stringify({ name: "app", private: true, type: "module" }),
    "app/src/index.ts": 'import { kickoff } from "./match";\n\nconsole.log(kickoff);\n',
    "app/src/match.ts": "export const kickoff = 0;\n",
    ...files,
  };
  for (const [path, source] of Object.entries(tree)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), source);
  }
  copyFileSync(join(repository, "knip.json"), join(root, "knip.json"));
  symlinkSync(join(repository, "node_modules"), join(root, "node_modules"));
  return root;
}

function knip(root: string): { status: number | null; output: string } {
  const run = spawnSync("bun", ["run", "knip"], { cwd: root, encoding: "utf8" });
  return { status: run.status, output: run.stdout + run.stderr };
}

describe("knip script", () => {
  it("passes Bun workspaces with no dead code", () => {
    expect(knip(bunWorkspaces({})).status).toBe(0);
  }, 60_000);

  it("fails on a file no workspace imports", () => {
    const result = knip(bunWorkspaces({ "app/src/orphan.ts": "export const orphan = 1;\n" }));

    expect(result.status).not.toBe(0);
    expect(result.output).toContain("app/src/orphan.ts");
  }, 60_000);

  it("fails on an export nothing uses", () => {
    const result = knip(
      bunWorkspaces({ "app/src/match.ts": "export const kickoff = 0;\nexport const fullTime = 90;\n" }),
    );

    expect(result.status).not.toBe(0);
    expect(result.output).toContain("fullTime");
  }, 60_000);

  it("accepts an exported type used only by its own module's exports", () => {
    const result = knip(
      bunWorkspaces({
        "app/src/match.ts":
          "export interface Side {\n  name: string;\n}\nexport interface Fixture extends Side {\n  away: Side;\n}\nexport const kickoff = 0;\n",
        "app/src/index.ts":
          'import { kickoff, type Fixture } from "./match";\n\nconst fixture: Fixture = { name: "a", away: { name: "b" } };\nconsole.log(kickoff, fixture);\n',
      }),
    );

    expect(result.status).toBe(0);
  }, 60_000);
});
