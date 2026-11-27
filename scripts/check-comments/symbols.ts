// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import type { Language } from "./lexer";

interface DocumentedSymbol {
  readonly exported: boolean;
  readonly lines: readonly number[];
}

export interface Docstring extends DocumentedSymbol {
  readonly line: number;
}

/** Finds the declaration starting right below the comment that ends on `line`, or undefined when there is none. */
export type SymbolBelow = (line: number) => DocumentedSymbol | undefined;

interface Scope<Kind extends string> {
  readonly kind: Kind | "block";
  readonly exported: boolean;
}

type TypeScriptScope = Scope<"class" | "shape" | "namespace">;
type JavaScope = Scope<"class" | "interface" | "enum">;

const BLOCK = { kind: "block", exported: false } as const;
const ANNOTATION = /^\s*@(?!interface\b)[\w$.]+(\s*\((?:[^()]|\([^()]*\))*\))?/;
const MAX_DECLARATION_LINES = 20;
const TYPESCRIPT_KINDS: Readonly<Record<string, TypeScriptScope["kind"]>> = {
  class: "class",
  interface: "shape",
  enum: "shape",
  namespace: "namespace",
  module: "namespace",
};

/** Returns the line numbers from `first` to `last`, both included. */
export function lineRange(first: number, last: number): number[] {
  return Array.from({ length: last - first + 1 }, (_, offset) => first + offset);
}

function stripAnnotations(text: string): string {
  let rest = text;
  for (let match = ANNOTATION.exec(rest); match !== null; match = ANNOTATION.exec(rest)) {
    rest = rest.slice(match[0].length);
  }
  return rest.trim();
}

function declarationBelow(
  codeLines: readonly string[],
  line: number,
): { readonly text: string; readonly index: number; readonly lines: number[] } | undefined {
  let index = line - 1;
  if ((codeLines[index] ?? "").trim() === "") index += 1;
  if ((codeLines[index] ?? "").trim() === "") return undefined;
  let text = "";
  for (let end = index; end < Math.min(codeLines.length, index + MAX_DECLARATION_LINES); end += 1) {
    text += ` ${codeLines[end] ?? ""}`;
    const stripped = stripAnnotations(text);
    if (stripped !== "" && !stripped.startsWith("@")) {
      return { text: stripped, index, lines: lineRange(index + 1, end + 1) };
    }
  }
  return undefined;
}

function headOf(declaration: string): string {
  return declaration.split(/[(={;]/, 1)[0] ?? "";
}

function opensTypeArguments(head: string): boolean {
  const opened = head.split("<").length - 1;
  const closed = head.replaceAll("=>", "").split(">").length - 1;
  return opened > closed && !head.includes("(");
}

function scopesByLine<S extends Scope<string>>(
  codeLines: readonly string[],
  open: (head: string, parent: S | undefined) => S,
): (S | undefined)[] {
  const stack: S[] = [];
  const scopes: (S | undefined)[] = [];
  let head = "";
  let headBraces = 0;
  for (const code of codeLines) {
    scopes.push(stack.at(-1));
    for (const char of code) {
      if (char === "{" && (headBraces > 0 || opensTypeArguments(head))) {
        headBraces += 1;
        head += char;
      } else if (char === "}" && headBraces > 0) {
        headBraces -= 1;
        head += char;
      } else if (char === "{") {
        stack.push(open(head.trim(), stack.at(-1)));
        head = "";
      } else if (char === "}") {
        stack.pop();
        head = "";
      } else if (char === ";") {
        head = "";
      } else {
        head += char;
      }
    }
    head += " ";
  }
  return scopes;
}

function braceSymbols<S extends Scope<string>>(
  codeLines: readonly string[],
  open: (head: string, parent: S | undefined) => S,
  exported: (declaration: string, scope: S | undefined) => boolean,
): SymbolBelow {
  const scopes = scopesByLine(codeLines, open);
  return (line) => {
    const declaration = declarationBelow(codeLines, line);
    if (declaration === undefined) return undefined;
    return { exported: exported(declaration.text, scopes[declaration.index]), lines: declaration.lines };
  };
}

function typeScriptExported(
  declaration: string,
  scope: TypeScriptScope | undefined,
  exportList: ReadonlySet<string>,
): boolean {
  const head = headOf(declaration);
  if (scope === undefined) {
    const name = /\b(?:function\*?|class|interface|type|enum|namespace|module|const|let|var)\s+([\w$]+)/.exec(
      head,
    )?.[1];
    return /^(export|module\.exports|exports)\b/.test(head) || (name !== undefined && exportList.has(name));
  }
  switch (scope.kind) {
    case "class":
      return scope.exported && !/\bprivate\b/.test(head) && !head.trimStart().startsWith("#");
    case "shape":
      return scope.exported;
    case "namespace":
      return scope.exported && /^export\b/.test(head);
    case "block":
      return false;
  }
}

function typeScriptScope(
  head: string,
  parent: TypeScriptScope | undefined,
  exportList: ReadonlySet<string>,
): TypeScriptScope {
  const declaration =
    /((?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?(?:const\s+)?)\b(class|interface|enum|namespace|module)\b[^=]*$/.exec(
      head,
    );
  const kind = TYPESCRIPT_KINDS[declaration?.[2] ?? ""];
  if (declaration !== null && kind !== undefined) {
    return { kind, exported: typeScriptExported(head.slice(declaration.index), parent, exportList) };
  }
  const shape =
    /((?:export\s+)?(?:declare\s+)?)\btype\s+[\w$]+\s*(?:<.*>)?\s*=\s*$/.exec(head) ??
    /((?:export\s+)?)\b(?:const|let|var)\s+[\w$]+\s*(?::[^=]*)?=\s*$/.exec(head) ??
    /^(?:module\.exports|exports\.[\w$]+)\s*=\s*$/.exec(head);
  if (shape !== null)
    return { kind: "shape", exported: typeScriptExported(head.slice(shape.index), parent, exportList) };
  if (parent?.kind === "shape" && /[\w$]\??\s*:\s*$/.test(head)) return { kind: "shape", exported: parent.exported };
  return BLOCK;
}

function typeScriptExportList(codeLines: readonly string[]): Set<string> {
  const code = codeLines.join("\n");
  const names = new Set<string>();
  for (const [, list] of code.matchAll(/\bexport\s*\{([^}]*)\}/g)) {
    for (const specifier of (list ?? "").split(",")) {
      const name = /^\s*([\w$]+)/.exec(specifier)?.[1];
      if (name !== undefined) names.add(name);
    }
  }
  for (const [, name] of code.matchAll(/\bexport\s+default\s+([\w$]+)\s*;?\s*$/gm)) {
    if (name !== undefined) names.add(name);
  }
  return names;
}

function javaExported(declaration: string, scope: JavaScope | undefined): boolean {
  const head = headOf(declaration);
  if (scope === undefined) return /^(package|module|open\s+module)\b/.test(head) || /\bpublic\b/.test(head);
  switch (scope.kind) {
    case "interface":
      return scope.exported && !/\bprivate\b/.test(head);
    case "enum":
      return scope.exported && (/^[\p{Lu}_][\p{Lu}\d_]*\s*$/u.test(head) || /\b(public|protected)\b/.test(head));
    case "class":
      return scope.exported && /\b(public|protected)\b/.test(head);
    case "block":
      return false;
  }
}

function javaScope(head: string, parent: JavaScope | undefined): JavaScope {
  const match = /(@interface|\binterface|\bclass|\benum|\brecord)\s+[\w$]+/.exec(head);
  if (match === null) return BLOCK;
  const exported = javaExported(stripAnnotations(head), parent);
  const keyword = match[1] ?? "";
  const kind = keyword.endsWith("interface") ? "interface" : keyword === "enum" ? "enum" : "class";
  return { kind, exported };
}

function isGoExported(name: string | undefined): boolean {
  return name !== undefined && /^\p{Lu}/u.test(name);
}

interface GoContainer {
  readonly start: number;
  readonly end: number;
  readonly indent: string;
  readonly exported: boolean | undefined;
}

function goContainers(codeLines: readonly string[]): GoContainer[] {
  const containers: GoContainer[] = [];
  codeLines.forEach((code, start) => {
    const group = /^(?:var|const|type)\s*\(\s*$/.test(code);
    const type = /^(\t*)(?:type\s+)?(\w+)(?:\[.*\])?\s+(?:struct|interface)\s*\{\s*$/.exec(code);
    if (!group && type === null) return;
    const indent = type?.[1] ?? "";
    let end = start + 1;
    while (end < codeLines.length && !new RegExp(`^${indent}[)}]`).test(codeLines[end] ?? "")) end += 1;
    const enclosing = containers.findLast((container) => start > container.start && start < container.end);
    const exported = type === null ? undefined : (enclosing?.exported ?? true) && isGoExported(type[2]);
    containers.push({ start, end, indent, exported });
  });
  return containers;
}

function goSymbols(codeLines: readonly string[]): SymbolBelow {
  const containers = goContainers(codeLines);
  const memberOf = (container: GoContainer, index: number): string | undefined =>
    new RegExp(`^${container.indent}\\t([\\p{L}_][\\p{L}\\d_]*)`, "u").exec(codeLines[index] ?? "")?.[1];
  const groupExported = (group: GoContainer): boolean =>
    lineRange(group.start + 1, group.end - 1).some((index) => isGoExported(memberOf(group, index)));
  const methodExported = (receiver: string, name: string | undefined): boolean =>
    isGoExported(/(\w+)\s*(?:\[[^\]]*\])?\s*$/.exec(receiver)?.[1]) && isGoExported(name);
  const exportedAt = (index: number): boolean | undefined => {
    const enclosing = containers.findLast(({ start, end }) => index > start && index < end);
    if (enclosing !== undefined) {
      const name = memberOf(enclosing, index);
      return name === undefined ? undefined : (enclosing.exported ?? true) && isGoExported(name);
    }
    const code = codeLines[index] ?? "";
    if (/^package\b/.test(code)) return true;
    const method = /^func\s*\(([^)]*)\)\s*(\w+)/.exec(code);
    if (method !== null) return methodExported(method[1] ?? "", method[2]);
    const group = containers.find(({ start, exported }) => start === index && exported === undefined);
    if (group !== undefined) return groupExported(group);
    const declaration = /^(?:func|type|var|const)\s+(\w+)/.exec(code);
    return declaration === null ? undefined : isGoExported(declaration[1]);
  };
  return (line) => {
    const index = (codeLines[line - 1] ?? "").trim() === "" ? line : line - 1;
    const exported = exportedAt(index);
    return exported === undefined ? undefined : { exported, lines: [index + 1] };
  };
}

/** Indexes the declarations of a lexed TypeScript, Java or Go source so a doc comment can be matched to the symbol it documents. */
export function symbolBelow(codeLines: readonly string[], language: Exclude<Language, "python">): SymbolBelow {
  switch (language) {
    case "typescript": {
      const exportList = typeScriptExportList(codeLines);
      return braceSymbols<TypeScriptScope>(
        codeLines,
        (head, parent) => typeScriptScope(head, parent, exportList),
        (declaration, scope) => typeScriptExported(declaration, scope, exportList),
      );
    }
    case "java":
      return braceSymbols(codeLines, javaScope, javaExported);
    case "go":
      return goSymbols(codeLines);
  }
}

const PYTHON_STRING = /^[rRuUbBfF]{0,2}("""|'''|"|')/;
const PYTHON_DEFINITION = /^(\s*)(?:async\s+)?(def|class)\s+(\w+)/;
const PYTHON_INLINE_DOCSTRING = /(?:\)|\bclass\s+\w+)\s*(?:->[^:]*)?:\s*[rRuUbBfF]{0,2}["']/;

function isPythonPublic(name: string): boolean {
  return !name.startsWith("_") || (name.startsWith("__") && name.endsWith("__"));
}

function parenDelta(code: string): number {
  let delta = 0;
  for (const char of code) {
    if ("([{".includes(char)) delta += 1;
    else if (")]}".includes(char)) delta -= 1;
  }
  return delta;
}

/** Lists the docstrings of the functions and classes in a lexed Python source, with whether each one is exported. */
export function pythonDocstrings(codeLines: readonly string[]): Docstring[] {
  interface Definition {
    readonly indent: number;
    readonly kind: "def" | "class";
    readonly exported: boolean;
    readonly line: number;
  }
  const docstrings: Docstring[] = [];
  const stack: Definition[] = [];
  let depth = 0;
  let header: Definition | undefined;
  let awaitingBody: Definition | undefined;
  codeLines.forEach((code, index) => {
    const continuing = depth > 0;
    depth += parenDelta(code);
    if (continuing) {
      if (header !== undefined && depth === 0) [awaitingBody, header] = [header, undefined];
      return;
    }
    const trimmed = code.trim();
    if (trimmed === "") return;
    const indent = code.length - code.trimStart().length;
    if (awaitingBody !== undefined && indent > awaitingBody.indent && PYTHON_STRING.test(trimmed)) {
      docstrings.push({ line: index + 1, exported: awaitingBody.exported, lines: [awaitingBody.line, index + 1] });
    }
    awaitingBody = undefined;
    while ((stack.at(-1)?.indent ?? -1) >= indent) stack.pop();
    const definition = PYTHON_DEFINITION.exec(code);
    if (definition === null) return;
    const parent = stack.at(-1);
    const parentExports = parent === undefined || (parent.kind === "class" && parent.exported);
    const current: Definition = {
      indent,
      kind: definition[2] === "class" ? "class" : "def",
      exported: parentExports && isPythonPublic(definition[3] ?? ""),
      line: index + 1,
    };
    stack.push(current);
    if (depth > 0) header = current;
    else if (PYTHON_INLINE_DOCSTRING.test(code)) {
      docstrings.push({ line: index + 1, exported: current.exported, lines: [index + 1] });
    } else awaitingBody = current;
  });
  return docstrings;
}
