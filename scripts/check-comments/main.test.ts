// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const CLI = fileURLToPath(new URL("./main.ts", import.meta.url));
const SPDX = {
  ts: "// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0",
  java: "// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0",
  go: "// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0",
  py: "# SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0",
} as const;

type Extension = keyof typeof SPDX;

const repos: string[] = [];

afterEach(() => {
  for (const dir of repos.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function createRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "check-comments-"));
  repos.push(dir);
  git(dir, "init", "--quiet", "--initial-branch=develop");
  git(dir, "config", "user.email", "test@example.com");
  git(dir, "config", "user.name", "test");
  git(dir, "config", "commit.gpgsign", "false");
  writeFileSync(join(dir, "README.md"), "fixture\n");
  commit(dir);
  return dir;
}

function write(repo: string, path: string, lines: readonly string[]): void {
  const file = join(repo, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, lines.join("\n") + "\n");
}

function commit(repo: string): string {
  git(repo, "add", "--all");
  git(repo, "commit", "--quiet", "--allow-empty", "--message", "fixture");
  return git(repo, "rev-parse", "HEAD");
}

function checkComments(repo: string, ...args: string[]): { exitCode: number | null; output: string } {
  const result = spawnSync("bun", [CLI, ...args], { cwd: repo, encoding: "utf8" });
  return { exitCode: result.status, output: result.stdout + result.stderr };
}

function addedFile(language: Extension, body: readonly string[]): { repo: string; base: string } {
  const repo = createRepo();
  const base = git(repo, "rev-parse", "HEAD");
  write(repo, `src/sample.${language}`, [SPDX[language], ...body]);
  commit(repo);
  return { repo, base };
}

describe("check-comments on lines added between two refs", () => {
  it("fails a narrating comment with its location and what to do instead", () => {
    const { repo, base } = addedFile("ts", ["// add one to the total", "export const next = (n: number) => n + 1;"]);

    const { exitCode, output } = checkComments(repo, "--base", base);

    expect(exitCode).toBe(1);
    expect(output).toContain("src/sample.ts:2:");
    expect(output).toMatch(/rename|extract|change the type/);
    expect(output).toContain("ADR");
  });

  const LINE_COMMENT: Record<Extension, string> = { ts: "//", java: "//", go: "//", py: "#" };
  const DECLARATION: Record<Extension, string> = {
    ts: "export const answer = 42;",
    java: "public final class Sample {}",
    go: "var Answer = 42",
    py: "ANSWER = 42",
  };
  const LANGUAGES = Object.keys(SPDX) as Extension[];

  it.each(LANGUAGES)("accepts each allowed comment in %s", (language) => {
    const mark = LINE_COMMENT[language];
    const repo = createRepo();
    write(repo, "docs/adr/0004-comentarios-banidos-com-excecoes-fechadas.md", ["# ADR"]);
    const base = commit(repo);
    write(repo, `src/sample.${language}`, [
      SPDX[language],
      `${mark} Retries twice because the provider drops the first call: https://example.com/provider/limits`,
      DECLARATION[language],
      `${mark} See docs/adr/0004-comentarios-banidos-com-excecoes-fechadas.md`,
      DECLARATION[language],
      `${mark} TODO(#42): cache the answer`,
      DECLARATION[language],
    ]);
    commit(repo);

    const { exitCode, output } = checkComments(repo, "--base", base);

    expect(output).toContain("check-comments: clean");
    expect(exitCode).toBe(0);
  });

  it.each(LANGUAGES)("fails a TODO without an issue in %s", (language) => {
    const { repo, base } = addedFile(language, [
      `${LINE_COMMENT[language]} TODO cache the answer`,
      DECLARATION[language],
    ]);

    const { exitCode, output } = checkComments(repo, "--base", base);

    expect(exitCode).toBe(1);
    expect(output).toContain(`src/sample.${language}:2:`);
    expect(output).toContain("TODO(#<issue>)");
  });

  it.each(LANGUAGES)("fails a narrating comment in %s", (language) => {
    const { repo, base } = addedFile(language, [DECLARATION[language], `${LINE_COMMENT[language]} the answer`]);

    const { exitCode, output } = checkComments(repo, "--base", base);

    expect(exitCode).toBe(1);
    expect(output).toContain(`src/sample.${language}:3:`);
  });

  it("fails an ADR pointer to an ADR that does not exist", () => {
    const { repo, base } = addedFile("ts", ["// See docs/adr/0099-missing.md", DECLARATION.ts]);

    const { exitCode, output } = checkComments(repo, "--base", base);

    expect(exitCode).toBe(1);
    expect(output).toContain("src/sample.ts:2:");
    expect(output).toContain("docs/adr/0099-missing.md");
  });

  it.each(LANGUAGES)("ignores a violation that was already there before the base in %s", (language) => {
    const narration = `${LINE_COMMENT[language]} old narration`;
    const { repo } = addedFile(language, [narration, DECLARATION[language]]);
    const base = git(repo, "rev-parse", "HEAD");
    write(repo, `src/sample.${language}`, [SPDX[language], narration, DECLARATION[language], DECLARATION[language]]);
    commit(repo);

    const { exitCode, output } = checkComments(repo, "--base", base);

    expect(output).toContain("check-comments: clean");
    expect(exitCode).toBe(0);
  });

  it("fails a TODO without an issue that follows an allowed TODO", () => {
    const { repo, base } = addedFile("ts", ["// TODO(#1): cache the answer", "// FIXME later", DECLARATION.ts]);

    const { exitCode, output } = checkComments(repo, "--base", base);

    expect(exitCode).toBe(1);
    expect(output).toContain("TODO(#<issue>)");
  });

  it("fails a narrating comment above a variable inside a Go function", () => {
    const { repo, base } = addedFile("go", [
      "package sample",
      "",
      "func Run() {",
      "\t// count the runs",
      "\tvar runs = 1",
      "\t_ = runs",
      "}",
    ]);

    const { exitCode, output } = checkComments(repo, "--base", base);

    expect(exitCode).toBe(1);
    expect(output).toContain("src/sample.go:5:");
  });

  it("fails an empty comment in Java", () => {
    const { repo, base } = addedFile("java", ["//", DECLARATION.java]);

    const { exitCode } = checkComments(repo, "--base", base);

    expect(exitCode).toBe(1);
  });

  it("fails an SPDX line outside the file header", () => {
    const { repo, base } = addedFile("ts", [
      DECLARATION.ts,
      "export const b = 1;",
      "export const c = 1;",
      "export const d = 1;",
      "export const e = 1;",
      "// SPDX-License-Identifier: MIT",
    ]);

    const { exitCode, output } = checkComments(repo, "--base", base);

    expect(exitCode).toBe(1);
    expect(output).toContain("src/sample.ts:7:");
  });

  it("does not mistake comment markers inside strings for comments", () => {
    const { repo, base } = addedFile("ts", [
      'export const url = "https://example.com/a//b";',
      "export const glob = '/* not a comment */';",
      "export const template = `${url} // still a string ${glob}`;",
      "export const pattern = /\\/\\/ not a comment/;",
    ]);

    const { exitCode, output } = checkComments(repo, "--base", base);

    expect(output).toContain("check-comments: clean");
    expect(exitCode).toBe(0);
  });

  const SUPPRESSION: Record<Extension, string> = {
    ts: "// @ts-expect-error",
    java: '@SuppressWarnings("unchecked")',
    go: "//nolint:errcheck",
    py: "# type: ignore[assignment]",
  };

  it.each(LANGUAGES)("fails a suppression without a link to an issue or ADR in %s", (language) => {
    const { repo, base } = addedFile(language, [`${DECLARATION[language]} ${SUPPRESSION[language]}`]);

    const { exitCode, output } = checkComments(repo, "--base", base);

    expect(exitCode).toBe(1);
    expect(output).toContain(`src/sample.${language}:2:`);
    expect(output).toContain("suppression");
  });

  it.each(LANGUAGES)("accepts a suppression with a link to an issue or ADR on the same line in %s", (language) => {
    const separator = language === "java" ? " // " : " -- ";
    const { repo, base } = addedFile(language, [
      `${DECLARATION[language]} ${SUPPRESSION[language]}${separator}#42`,
      `${DECLARATION[language]} ${SUPPRESSION[language]}${separator}docs/adr/0004-x.md`,
      `${DECLARATION[language]} ${SUPPRESSION[language]}${separator}https://github.com/o/r/issues/42`,
    ]);

    const { exitCode, output } = checkComments(repo, "--base", base);

    expect(output).toContain("check-comments: clean");
    expect(exitCode).toBe(0);
  });

  it.each(LANGUAGES)("fails an added %s file without an SPDX header", (language) => {
    const repo = createRepo();
    const base = git(repo, "rev-parse", "HEAD");
    write(repo, `src/sample.${language}`, [DECLARATION[language]]);
    commit(repo);

    const { exitCode, output } = checkComments(repo, "--base", base);

    expect(exitCode).toBe(1);
    expect(output).toContain(`src/sample.${language}:1:`);
    expect(output).toContain("SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0");
  });

  it("does not require the SPDX header on a file that only changed", () => {
    const repo = createRepo();
    write(repo, "src/sample.ts", [DECLARATION.ts]);
    const base = commit(repo);
    write(repo, "src/sample.ts", [DECLARATION.ts, "export const other = 1;"]);
    commit(repo);

    const { exitCode, output } = checkComments(repo, "--base", base);

    expect(output).toContain("check-comments: clean");
    expect(exitCode).toBe(0);
  });

  it("ignores files outside the four languages", () => {
    const repo = createRepo();
    const base = git(repo, "rev-parse", "HEAD");
    write(repo, "config.yml", ["# narration in yaml", "key: value"]);
    commit(repo);

    const { exitCode } = checkComments(repo, "--base", base);

    expect(exitCode).toBe(0);
  });

  it.each([
    ["ts", ["/** Adds one. */", "export function next(n: number): number {", "  return n + 1;", "}"]],
    ["java", ["/** Holds the answer. */", "@Deprecated", "public final class Sample {}"]],
    ["go", ["// Answer is the answer.", "var Answer = 42"]],
    ["py", ["def answer() -> int:", '    """Return the answer."""', "    return 42"]],
  ] as const)("accepts a doc comment in %s", (language, body) => {
    const { repo, base } = addedFile(language, body);

    const { exitCode, output } = checkComments(repo, "--base", base);

    expect(output).toContain("check-comments: clean");
    expect(exitCode).toBe(0);
  });
});

describe("check-comments on doc comments", () => {
  it.each([
    [
      "ts",
      ["export class Sample {", "  /** Adds one. */", "  next(n: number): number {", "    return n + 1;", "  }", "}"],
    ],
    ["ts", ["export interface Sample {", "  /** The answer. */", "  readonly answer: number;", "}"]],
    ["ts", ["/** Adds one. */", "function next(n: number): number {", "  return n + 1;", "}", "export { next };"]],
    ["ts", ["/** Holds the answer. */", "@sealed", "export default class Sample {}"]],
    [
      "java",
      [
        "public final class Sample {",
        "  /** Adds one. */",
        "  public int next(int n) {",
        "    return n + 1;",
        "  }",
        "}",
      ],
    ],
    ["java", ["public interface Sample {", "  /** Adds one. */", "  int next(int n);", "}"]],
    [
      "java",
      ["public class Sample {", "  /** Hook for subclasses. */", "  @Override", "  protected void run() {}", "}"],
    ],
    [
      "go",
      [
        "package sample",
        "",
        "// Sample holds the answer.",
        "type Sample struct{}",
        "",
        "// Next adds one.",
        "func (s *Sample) Next(n int) int { return n + 1 }",
      ],
    ],
    ["go", ["package sample", "", "const (", "\t// Answer is the answer.", "\tAnswer = 42", ")"]],
    [
      "py",
      [
        "class Sample:",
        '    """Hold the answer."""',
        "",
        "    def next(self, n: int) -> int:",
        '        """Add one."""',
        "        return n + 1",
      ],
    ],
    [
      "py",
      [
        '"""Sample module."""',
        "",
        "def __getattr__(name: str) -> int:",
        '    """Resolve the answer."""',
        "    return 42",
      ],
    ],
  ] as const)("accepts a doc comment above an exported symbol in %s", (language, body) => {
    const { repo, base } = addedFile(language, body);

    const { exitCode, output } = checkComments(repo, "--base", base);

    expect(output).toContain("check-comments: clean");
    expect(exitCode).toBe(0);
  });

  it.each([
    ["ts", ["/** Adds one. */", "function next(n: number): number {", "  return n + 1;", "}"], 2],
    [
      "ts",
      [
        "export class Sample {",
        "  /** Adds one. */",
        "  private next(n: number): number {",
        "    return n + 1;",
        "  }",
        "}",
      ],
      3,
    ],
    ["ts", ["export function run(): void {", "  /** The counter. */", "  const runs = 1;", "  void runs;", "}"], 3],
    ["ts", ["/** Floating doc comment. */", "", "export const answer = 42;"], 2],
    [
      "java",
      [
        "public final class Sample {",
        "  /** Adds one. */",
        "  private int next(int n) {",
        "    return n + 1;",
        "  }",
        "}",
      ],
      3,
    ],
    ["java", ["/** Holds the answer. */", "final class Sample {}"], 2],
    [
      "java",
      ["final class Sample {", "  /** Adds one. */", "  public int next(int n) {", "    return n + 1;", "  }", "}"],
      3,
    ],
    ["go", ["package sample", "", "// next adds one.", "func next(n int) int { return n + 1 }"], 4],
    [
      "go",
      [
        "package sample",
        "",
        "type sample struct{}",
        "",
        "// Next adds one.",
        "func (s *sample) Next(n int) int { return n + 1 }",
      ],
      6,
    ],
    ["go", ["package sample", "", "const (", "\t// answer is the answer.", "\tanswer = 42", ")"], 5],
    ["py", ["def _next(n: int) -> int:", '    """Add one."""', "    return n + 1"], 3],
    ["py", ["def run() -> None:", "    def step() -> None:", '        """Take a step."""', "    step()"], 4],
    [
      "py",
      ["class _Sample:", "    def next(self, n: int) -> int:", '        """Add one."""', "        return n + 1"],
      4,
    ],
  ] as const)("fails a doc comment above a non-exported symbol in %s", (language, body, line) => {
    const { repo, base } = addedFile(language, body);

    const { exitCode, output } = checkComments(repo, "--base", base);

    expect(exitCode).toBe(1);
    expect(output).toContain(`src/sample.${language}:${line}:`);
    expect(output).toContain("exported");
  });
});

describe("check-comments on the whole repository", () => {
  it("fails a violation however old it is, and the missing SPDX header", () => {
    const repo = createRepo();
    write(repo, "src/old.ts", [SPDX.ts, "// old narration", "export const answer = 42;"]);
    write(repo, "src/bare.py", ["ANSWER = 42"]);
    commit(repo);
    write(repo, "src/new.go", [SPDX.go, "package sample"]);
    commit(repo);

    const { exitCode, output } = checkComments(repo, "--all");

    expect(exitCode).toBe(1);
    expect(output).toContain("src/old.ts:2:");
    expect(output).toContain("src/bare.py:1:");
    expect(output).not.toContain("src/new.go");
  });

  it("passes a clean repository", () => {
    const repo = createRepo();
    write(repo, "src/clean.ts", [SPDX.ts, "export const answer = 42;"]);
    commit(repo);

    const { exitCode, output } = checkComments(repo, "--all");

    expect(output).toContain("check-comments: clean");
    expect(exitCode).toBe(0);
  });
});

describe("check-comments usage", () => {
  it("fails with an empty base ref", () => {
    const repo = createRepo();

    const { exitCode, output } = checkComments(repo, "--base", "");

    expect(exitCode).toBe(1);
    expect(output).toContain("usage:");
  });

  it("fails without a mode", () => {
    const repo = createRepo();

    const { exitCode, output } = checkComments(repo);

    expect(exitCode).toBe(1);
    expect(output).toContain("usage:");
  });
});
