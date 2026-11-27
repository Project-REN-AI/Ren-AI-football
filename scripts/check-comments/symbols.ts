// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import type { Language } from "./lexer";

export interface DocumentedSymbol {
  readonly exported: boolean;
  readonly lines: readonly number[];
}

export interface Docstring extends DocumentedSymbol {
  readonly line: number;
}

export interface SymbolTable {
  /** Returns the declaration starting right below the comment that ends on `line`, or undefined when there is none. */
  below(line: number): DocumentedSymbol | undefined;
  readonly docstrings: readonly Docstring[];
}

type ScopeKind = "class" | "interface" | "enum" | "namespace" | "block";

interface Scope {
  readonly kind: ScopeKind;
  readonly exported: boolean;
}

const BLOCK: Scope = { kind: "block", exported: false };
const ANNOTATION = /^\s*@(?!interface\b)[\w$.]+(\s*\((?:[^()]|\([^()]*\))*\))?/;
const MAX_DECLARATION_LINES = 20;

function range(first: number, last: number): number[] {
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
    if (stripped !== "" && !stripped.startsWith("@"))
      return { text: stripped, index, lines: range(index + 1, end + 1) };
  }
  return undefined;
}

function headOf(declaration: string): string {
  return declaration.split(/[(={;]/, 1)[0] ?? "";
}

function typeScriptExported(declaration: string, scope: Scope | undefined, exportList: ReadonlySet<string>): boolean {
  const head = headOf(declaration);
  if (scope === undefined) {
    const name = /\b(?:function\*?|class|interface|type|enum|namespace|module|const|let|var)\s+([\w$]+)/.exec(
      head,
    )?.[1];
    return /^export\b/.test(head) || (name !== undefined && exportList.has(name));
  }
  switch (scope.kind) {
    case "class":
      return scope.exported && !/\bprivate\b/.test(head) && !head.trimStart().startsWith("#");
    case "interface":
    case "enum":
      return scope.exported;
    case "namespace":
      return scope.exported && /^export\b/.test(head);
    case "block":
      return false;
  }
}

function typeScriptScope(head: string, parent: Scope | undefined, exportList: ReadonlySet<string>): Scope {
  const declaration =
    /((?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?(?:const\s+)?)\b(class|interface|enum|namespace|module)\b[^=]*$/.exec(
      head,
    );
  const typeAlias = /((?:export\s+)?(?:declare\s+)?)\btype\s+[\w$]+\s*(?:<.*>)?\s*=\s*$/.exec(head);
  const match = declaration ?? typeAlias;
  if (match === null) return BLOCK;
  const exported = typeScriptExported(head.slice(match.index), parent, exportList);
  const keyword = declaration?.[2];
  const kind: ScopeKind =
    keyword === "class"
      ? "class"
      : keyword === "enum"
        ? "enum"
        : keyword === "namespace" || keyword === "module"
          ? "namespace"
          : "interface";
  return { kind, exported };
}

function javaExported(declaration: string, scope: Scope | undefined): boolean {
  const head = headOf(declaration);
  if (scope === undefined) return /^(package|module|open\s+module)\b/.test(head) || /\bpublic\b/.test(head);
  switch (scope.kind) {
    case "interface":
      return scope.exported && !/\bprivate\b/.test(head);
    case "enum":
      return scope.exported && (/^[\p{Lu}_][\p{Lu}\d_]*\s*$/u.test(head) || /\b(public|protected)\b/.test(head));
    case "class":
      return scope.exported && /\b(public|protected)\b/.test(head);
    case "namespace":
    case "block":
      return false;
  }
}

function javaScope(head: string, parent: Scope | undefined): Scope {
  const match = /(@interface|\binterface|\bclass|\benum|\brecord)\s+[\w$]+/.exec(head);
  if (match === null) return BLOCK;
  const exported = javaExported(stripAnnotations(head), parent);
  const keyword = match[1] ?? "";
  const kind: ScopeKind = keyword.endsWith("interface") ? "interface" : keyword === "enum" ? "enum" : "class";
  return { kind, exported };
}

function scopesByLine(
  codeLines: readonly string[],
  open: (head: string, parent: Scope | undefined) => Scope,
): (Scope | undefined)[] {
  const stack: Scope[] = [];
  const scopes: (Scope | undefined)[] = [];
  let head = "";
  for (const code of codeLines) {
    scopes.push(stack.at(-1));
    for (const char of code) {
      if (char === "{") {
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

function braceTable(
  codeLines: readonly string[],
  open: (head: string, parent: Scope | undefined) => Scope,
  exported: (declaration: string, scope: Scope | undefined) => boolean,
): SymbolTable {
  const scopes = scopesByLine(codeLines, open);
  return {
    below(line) {
      const declaration = declarationBelow(codeLines, line);
      if (declaration === undefined) return undefined;
      return { exported: exported(declaration.text, scopes[declaration.index]), lines: declaration.lines };
    },
    docstrings: [],
  };
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

function isGoExported(name: string | undefined): boolean {
  return name !== undefined && /^\p{Lu}/u.test(name);
}

interface GoContainer {
  readonly start: number;
  readonly end: number;
  readonly exported: boolean | undefined;
}

function goContainers(codeLines: readonly string[]): GoContainer[] {
  const containers: GoContainer[] = [];
  codeLines.forEach((code, start) => {
    const group = /^(?:var|const|type)\s*\(\s*$/.test(code);
    const type = /^type\s+(\w+)(?:\[.*\])?\s+(?:struct|interface)\s*\{\s*$/.exec(code);
    if (!group && type === null) return;
    let end = start + 1;
    while (end < codeLines.length && !/^[)}]/.test(codeLines[end] ?? "")) end += 1;
    containers.push({ start, end, exported: type === null ? undefined : isGoExported(type[1]) });
  });
  return containers;
}

function goTable(codeLines: readonly string[]): SymbolTable {
  const containers = goContainers(codeLines);
  const member = (index: number): string | undefined => /^\t([\p{L}_][\p{L}\d_]*)/u.exec(codeLines[index] ?? "")?.[1];
  const exportedAt = (index: number): boolean | undefined => {
    const code = codeLines[index] ?? "";
    const container = containers.find(({ start, end }) => index > start && index < end);
    if (container !== undefined) {
      const name = member(index);
      return name === undefined ? undefined : (container.exported ?? true) && isGoExported(name);
    }
    if (/^package\b/.test(code)) return true;
    const method = /^func\s*\(([^)]*)\)\s*(\w+)/.exec(code);
    if (method !== null) {
      const receiver = /(\w+)\s*(?:\[[^\]]*\])?\s*$/.exec(method[1] ?? "")?.[1];
      return isGoExported(receiver) && isGoExported(method[2]);
    }
    const group = containers.find(({ start }) => start === index);
    if (group?.exported === undefined && group !== undefined) {
      return range(group.start + 1, group.end - 1).some((inner) => isGoExported(member(inner)));
    }
    const declaration = /^(?:func|type|var|const)\s+(\w+)/.exec(code);
    return declaration === null ? undefined : isGoExported(declaration[1]);
  };
  return {
    below(line) {
      const index = (codeLines[line - 1] ?? "").trim() === "" ? line : line - 1;
      const exported = exportedAt(index);
      return exported === undefined ? undefined : { exported, lines: [index + 1] };
    },
    docstrings: [],
  };
}

const PYTHON_STRING = /^[rRuUbBfF]{0,2}("""|'''|"|')/;
const PYTHON_DEFINITION = /^(\s*)(?:async\s+)?(def|class)\s+(\w+)/;

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

function pythonDocstrings(codeLines: readonly string[]): Docstring[] {
  interface Definition {
    readonly indent: number;
    readonly kind: string;
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
    const name = definition[3] ?? "";
    const current = {
      indent,
      kind: definition[2] ?? "",
      exported: parentExports && isPythonPublic(name),
      line: index + 1,
    };
    stack.push(current);
    if (depth === 0) awaitingBody = current;
    else header = current;
  });
  return docstrings;
}

/** Indexes the declarations of a lexed source so a doc comment can be matched to the symbol it documents. */
export function symbolTable(codeLines: readonly string[], language: Language): SymbolTable {
  switch (language) {
    case "typescript": {
      const exportList = typeScriptExportList(codeLines);
      return braceTable(
        codeLines,
        (head, parent) => typeScriptScope(head, parent, exportList),
        (declaration, scope) => typeScriptExported(declaration, scope, exportList),
      );
    }
    case "java":
      return braceTable(codeLines, javaScope, javaExported);
    case "go":
      return goTable(codeLines);
    case "python":
      return { below: () => undefined, docstrings: pythonDocstrings(codeLines) };
  }
}
