// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

const COMMIT_TYPES = [
  "build",
  "chore",
  "ci",
  "docs",
  "feat",
  "fix",
  "perf",
  "refactor",
  "revert",
  "style",
  "test",
] as const;

const TITLE_PATTERN = /^(?<type>[A-Za-z]+)(?:\((?<scope>[a-z0-9]+(?:-[a-z0-9]+)*)\))?!?: (?<subject>\S(?:.*\S)?)$/;

function problemsOf(title: string): string[] {
  const match = TITLE_PATTERN.exec(title);
  if (match?.groups === undefined) return ["expected type(scope)?: subject, e.g. feat(scripts): add pr title check"];

  const { type = "", subject = "" } = match.groups;
  const problems: string[] = [];
  if (!COMMIT_TYPES.some((known) => known === type)) {
    problems.push(`unknown type ${type}; use one of ${COMMIT_TYPES.join(", ")}`);
  }
  if (subject.endsWith(".")) problems.push("subject must not end with a period");
  return problems;
}

function reject(lines: readonly string[]): never {
  console.log("pr title: invalid");
  for (const line of lines) console.log(`  ${line}`);
  process.exit(1);
}

const title = process.argv[2];
if (title === undefined) reject(["usage: pr-title '<pull request title>'"]);

const problems = problemsOf(title);
if (problems.length > 0) reject([JSON.stringify(title), ...problems]);

console.log(`pr title: ok (${JSON.stringify(title)})`);
