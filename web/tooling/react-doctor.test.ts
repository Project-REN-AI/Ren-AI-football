// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const web = fileURLToPath(new URL("..", import.meta.url));
const fixtures: string[] = [];

afterEach(() => {
  for (const fixture of fixtures.splice(0)) rmSync(fixture, { recursive: true, force: true });
});

function webScript(name: string): string {
  const manifest: { scripts: Record<string, string> } = JSON.parse(readFileSync(join(web, "package.json"), "utf8"));
  const script = manifest.scripts[name];
  if (script === undefined) throw new Error(`web/package.json has no "${name}" script`);
  return script;
}

function writeFiles(root: string, files: Record<string, string>): void {
  for (const [path, source] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), source);
  }
}

function commitAll(root: string, message: string): void {
  const identity = ["-c", "user.name=test", "-c", "user.email=test@example.com"];
  execFileSync("git", ["add", "--all"], { cwd: root });
  execFileSync("git", [...identity, "commit", "--quiet", "--message", message], { cwd: root });
}

interface FeatureBranchOptions {
  readonly withConfig?: boolean;
}

function featureBranch(
  onDevelop: Record<string, string>,
  onFeature: Record<string, string>,
  { withConfig = true }: FeatureBranchOptions = {},
): string {
  const root = mkdtempSync(join(tmpdir(), "react-doctor-"));
  fixtures.push(root);
  writeFiles(root, {
    "package.json": JSON.stringify({
      name: "fixture",
      private: true,
      scripts: { doctor: webScript("doctor") },
      dependencies: { react: "19.3.1", "react-dom": "19.3.1" },
    }),
    "src/home.tsx": "export function Home() {\n  return <p>Scout</p>;\n}\n",
    ...onDevelop,
  });
  if (withConfig) copyFileSync(join(web, "doctor.config.json"), join(root, "doctor.config.json"));
  execFileSync("git", ["init", "--quiet", "--initial-branch", "develop"], { cwd: root });
  commitAll(root, "develop");
  execFileSync("git", ["switch", "--quiet", "--create", "feature"], { cwd: root });
  writeFiles(root, onFeature);
  commitAll(root, "feature");
  return root;
}

function doctor(root: string, ...args: string[]): { status: number | null; output: string } {
  const path = [join(web, "node_modules", ".bin"), process.env["PATH"] ?? ""].join(delimiter);
  const run = spawnSync("bun", ["run", "doctor", ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, PATH: path },
  });
  return { status: run.status, output: run.stdout + run.stderr };
}

const leakyEffect = `import { useEffect } from "react";

export function Clock() {
  useEffect(() => {
    window.addEventListener("resize", () => undefined);
  }, []);
  return <p>clock</p>;
}
`;

const missingKey = "export function List() {\n  return <ul>{[1, 2].map((n) => <li>{n}</li>)}</ul>;\n}\n";

describe("web doctor script", () => {
  it("fails on a React Doctor error introduced by the branch", () => {
    const root = featureBranch({}, { "src/clock.tsx": leakyEffect });

    const result = doctor(root);

    expect(result.status).not.toBe(0);
    expect(result.output).toContain("react-doctor/effect-needs-cleanup");
  }, 60_000);

  it("passes a branch that introduces no React Doctor issue", () => {
    const root = featureBranch({}, { "src/badge.tsx": "export function Badge() {\n  return <span>new</span>;\n}\n" });

    expect(doctor(root).status).toBe(0);
  }, 60_000);

  it("leaves rules ported from Oxlint to Oxlint", () => {
    const withConfig = featureBranch({}, { "src/list.tsx": missingKey });
    const withoutConfig = featureBranch({}, { "src/list.tsx": missingKey }, { withConfig: false });

    expect(doctor(withConfig).status).toBe(0);
    expect(doctor(withoutConfig).output).toContain("react-doctor/jsx-key");
  }, 60_000);

  it("takes the base commit CI passes when there is no local develop branch", () => {
    const root = featureBranch({}, { "src/clock.tsx": leakyEffect });
    const base = execFileSync("git", ["rev-parse", "develop"], { cwd: root, encoding: "utf8" }).trim();
    execFileSync("git", ["branch", "--quiet", "--delete", "--force", "develop"], { cwd: root });

    const result = doctor(root, "--base", base);

    expect(result.status).not.toBe(0);
    expect(result.output).toContain("react-doctor/effect-needs-cleanup");
  }, 60_000);

  it("ignores issues that already exist on develop", () => {
    const root = featureBranch(
      { "src/clock.tsx": leakyEffect },
      { "src/badge.tsx": "export function Badge() {\n  return <span>new</span>;\n}\n" },
    );

    expect(doctor(root).status).toBe(0);
  }, 60_000);
});
