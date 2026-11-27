// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { execFileSync } from "node:child_process";
import { languageOf } from "./lexer";
import { judgeLicenseHeader, judgeSource, type Repository } from "./rules";

const USAGE = "usage: check-comments --base <ref> [--head <ref>] | --all [--head <ref>]";

interface ChangedFile {
  readonly path: string;
  readonly added: boolean;
  readonly addedLines: ReadonlySet<number> | "all";
}

interface Finding {
  readonly path: string;
  readonly line: number;
  readonly message: string;
}

function git(...args: string[]): string {
  return execFileSync("git", ["-c", "core.quotepath=false", ...args], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
}

function changedFiles(base: string, head: string): ChangedFile[] {
  const diff = git(
    "diff",
    "--no-color",
    "--no-ext-diff",
    "--unified=0",
    "-M",
    "--diff-filter=AMR",
    `${base}...${head}`,
  );
  const files: ChangedFile[] = [];
  let added = false;
  let current: { path: string; added: boolean; addedLines: Set<number> } | undefined;
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      added = false;
      current = undefined;
    } else if (line.startsWith("new file mode")) {
      added = true;
    } else if (line.startsWith("+++ b/")) {
      current = { path: line.slice("+++ b/".length), added, addedLines: new Set() };
      files.push(current);
    } else if (line.startsWith("@@") && current !== undefined) {
      const match = /\+(\d+)(?:,(\d+))?/.exec(line);
      const start = Number(match?.[1]);
      const count = match?.[2] === undefined ? 1 : Number(match[2]);
      for (let offset = 0; offset < count; offset += 1) current.addedLines.add(start + offset);
    }
  }
  return files;
}

function parseArgs(argv: readonly string[]): { base: string | undefined; head: string } {
  let base: string | undefined;
  let head = "HEAD";
  let all = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--all") all = true;
    else if (arg === "--base" && argv[index + 1] !== undefined) base = argv[(index += 1)];
    else if (arg === "--head" && argv[index + 1] !== undefined) head = argv[(index += 1)] ?? head;
    else throw new Error(USAGE);
  }
  if (all === (base !== undefined)) throw new Error(USAGE);
  return { base, head };
}

function trackedPaths(head: string): string[] {
  return git("ls-tree", "-r", "-z", "--name-only", head)
    .split("\0")
    .filter((path) => path !== "");
}

function isAdded(file: ChangedFile, lines: readonly number[]): boolean {
  const { addedLines } = file;
  return addedLines === "all" || lines.some((line) => addedLines.has(line));
}

function check(files: readonly ChangedFile[], head: string, repository: Repository): Finding[] {
  const findings: Finding[] = [];
  for (const file of files) {
    const language = languageOf(file.path);
    if (language === undefined) continue;
    const source = git("show", `${head}:${file.path}`);
    const header = file.added ? judgeLicenseHeader(source, language) : undefined;
    const violations = [...(header === undefined ? [] : [header]), ...judgeSource(source, language, repository)];
    for (const { line, lines, message } of violations) {
      if (isAdded(file, lines)) findings.push({ path: file.path, line, message });
    }
  }
  return findings;
}

function main(): number {
  let findings: Finding[];
  try {
    const { base, head } = parseArgs(process.argv.slice(2));
    const paths = trackedPaths(head);
    const repository: Repository = { exists: (path) => paths.includes(path) };
    const files =
      base === undefined
        ? paths.map((path): ChangedFile => ({ path, added: true, addedLines: "all" }))
        : changedFiles(base, head);
    findings = check(files, head, repository);
  } catch (error) {
    console.log(`check-comments: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  for (const { path, line, message } of findings) console.log(`${path}:${line}: ${message}`);
  if (findings.length > 0) {
    console.log(`check-comments: ${findings.length} violation(s)`);
    return 1;
  }
  console.log("check-comments: clean");
  return 0;
}

process.exit(main());
