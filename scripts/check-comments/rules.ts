// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { lex, type Comment, type Language } from "./lexer";

export interface Violation {
  readonly line: number;
  readonly lines: readonly number[];
  readonly message: string;
}

export interface Repository {
  exists(path: string): boolean;
}

interface CommentGroup {
  readonly line: number;
  readonly endLine: number;
  readonly lines: readonly number[];
  readonly text: string;
  readonly doc: boolean;
  readonly ownLine: boolean;
}

const LICENSE = "SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0";
const LICENSE_HEADER_LINES = 5;
const NARRATION =
  "comment not allowed: rename, extract or change the type so the code says it; " +
  "put the why in an ADR (docs/adr/) or an issue. " +
  "Allowed: SPDX header, doc comment on an exported symbol, external constraint with a link, " +
  "`See docs/adr/NNNN-<slug>.md`, `TODO(#<issue>)`";
const TODO_WITHOUT_ISSUE = "TODO without an issue: open an issue and write `TODO(#<issue>): ...`, or do it now";

const SUPPRESSION_WITHOUT_LINK =
  "suppression without a link: fix the cause, or put a link to an issue (#<issue>) or ADR (docs/adr/NNNN-<slug>.md) on the same line";
const SUPPRESSION_COMMENT =
  /@ts-(ignore|expect-error|nocheck)|\b(eslint|oxlint)-(disable|enable)|biome-ignore|prettier-ignore|\b(istanbul|c8|v8) ignore|^nolint\b|\blint:ignore\b|#nosec\b|\bnoqa\b|\btype:\s*ignore\b|\b(pyright|pylint|mypy|ruff|isort|fmt):\s*\w|\bpragma:\s*no\s*cover|NOPMD|CHECKSTYLE.(OFF|ON)|NOSONAR/i;
const SUPPRESSION_CODE = /@Suppress\w*Warnings\b/;
const ISSUE_OR_ADR_LINK = /(^|[\s([,;])#\d+\b|https?:\/\/\S+\/issues\/\d+|docs\/adr\/\d{4}-[a-z0-9-]+\.md/;
const SPDX = /^SPDX-License-Identifier:/;
const TODO_WITH_ISSUE = /^TODO\(#\d+\)/;
const TODO_MARKER = /\b(TODO|FIXME|XXX|HACK)\b/;
const ADR_POINTER = /^See (docs\/adr\/\d{4}-[a-z0-9-]+\.md)\.?$/;
const LINK = /https?:\/\/\S+/;
const DIRECTIVES: Partial<Record<Language, RegExp>> = {
  typescript: /^\/ <reference |^\/ <amd-/,
  go: /^go:\w+|^line \S|^\+build |^export \w/,
  python: /^!|^-\*- coding|^(vim?|ex): .*coding[:=]/,
};
const GO_DECLARATION = /^(package|func|type|var|const)\b/;

function isDirective(text: string, language: Language): boolean {
  return DIRECTIVES[language]?.test(text) ?? false;
}

function isStandalone(comment: Comment, language: Language): boolean {
  return comment.block || SPDX.test(comment.text) || isDirective(comment.text, language);
}

function hasTodoWithoutIssue(text: string): boolean {
  return text.split("\n").some((line) => TODO_MARKER.test(line) && !TODO_WITH_ISSUE.test(line));
}

function linesOf({ line, endLine }: Comment): number[] {
  return Array.from({ length: endLine - line + 1 }, (_, offset) => line + offset);
}

function group(comments: readonly Comment[], language: Language): CommentGroup[] {
  const groups: CommentGroup[] = [];
  let pending: Comment[] = [];
  const flush = (): void => {
    const first = pending[0];
    const last = pending.at(-1);
    if (first !== undefined && last !== undefined) {
      groups.push({
        line: first.line,
        endLine: last.endLine,
        lines: pending.flatMap(linesOf),
        text: pending.map(({ text }) => text).join("\n"),
        doc: pending.some(({ doc }) => doc),
        ownLine: first.ownLine,
      });
    }
    pending = [];
  };
  for (const comment of comments) {
    const previous = pending.at(-1);
    const joins = previous !== undefined && previous.endLine + 1 === comment.line && comment.ownLine;
    if (!joins || isStandalone(comment, language)) flush();
    pending.push(comment);
    if (isStandalone(comment, language) || !comment.ownLine) flush();
  }
  flush();
  return groups;
}

function isGoDoc(commentGroup: CommentGroup, codeLines: readonly string[]): boolean {
  const next = codeLines[commentGroup.endLine] ?? "";
  return commentGroup.ownLine && GO_DECLARATION.test(next);
}

function judgeGroup(
  commentGroup: CommentGroup,
  language: Language,
  codeLines: readonly string[],
  repository: Repository,
): string | undefined {
  const { text } = commentGroup;
  if (isDirective(text, language)) return undefined;
  if (SPDX.test(text) && commentGroup.line <= LICENSE_HEADER_LINES) return undefined;
  if (hasTodoWithoutIssue(text)) return TODO_WITHOUT_ISSUE;
  if (TODO_WITH_ISSUE.test(text)) return undefined;
  const pointer = ADR_POINTER.exec(text);
  if (pointer?.[1] !== undefined) {
    return repository.exists(pointer[1])
      ? undefined
      : `ADR pointer to ${pointer[1]}, which does not exist: create the ADR or fix the path`;
  }
  if (LINK.test(text)) return undefined;
  if (commentGroup.doc || (language === "go" && isGoDoc(commentGroup, codeLines))) return undefined;
  return NARRATION;
}

function judgeSuppressions(
  comments: readonly Comment[],
  codeLines: readonly string[],
): {
  readonly violations: Violation[];
  readonly suppressionLines: ReadonlySet<number>;
} {
  const commentsByLine = new Map<number, string[]>();
  for (const { line, text } of comments) commentsByLine.set(line, [...(commentsByLine.get(line) ?? []), text]);
  const suppressionLines = new Set<number>();
  codeLines.forEach((code, index) => {
    const line = index + 1;
    const texts = commentsByLine.get(line) ?? [];
    if (SUPPRESSION_CODE.test(code) || texts.some((text) => SUPPRESSION_COMMENT.test(text))) suppressionLines.add(line);
  });
  const violations = [...suppressionLines]
    .filter((line) => !(commentsByLine.get(line) ?? []).some((text) => ISSUE_OR_ADR_LINK.test(text)))
    .map((line) => ({ line, lines: [line], message: SUPPRESSION_WITHOUT_LINK }));
  return { violations, suppressionLines };
}

export function judgeLicenseHeader(source: string, language: Language): Violation | undefined {
  if (source.trim() === "") return undefined;
  const header = source.split("\n").slice(0, LICENSE_HEADER_LINES);
  if (header.some((line) => line.includes("SPDX-License-Identifier:"))) return undefined;
  const mark = language === "python" ? "#" : "//";
  return { line: 1, lines: [1], message: `code file without license header: start it with \`${mark} ${LICENSE}\`` };
}

export function judgeSource(source: string, language: Language, repository: Repository): Violation[] {
  const { comments, codeLines } = lex(source, language);
  const { violations, suppressionLines } = judgeSuppressions(comments, codeLines);
  const judged = comments.filter(({ line }) => !suppressionLines.has(line));
  for (const commentGroup of group(judged, language)) {
    const message = judgeGroup(commentGroup, language, codeLines, repository);
    if (message !== undefined) violations.push({ line: commentGroup.line, lines: commentGroup.lines, message });
  }
  return violations;
}
