// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

export type Language = "typescript" | "java" | "go" | "python";

export interface Comment {
  readonly line: number;
  readonly endLine: number;
  readonly text: string;
  readonly block: boolean;
  readonly doc: boolean;
  readonly ownLine: boolean;
}

export interface LexedSource {
  readonly comments: readonly Comment[];
  readonly codeLines: readonly string[];
}

const EXTENSIONS: ReadonlyMap<string, Language> = new Map([
  ["ts", "typescript"],
  ["tsx", "typescript"],
  ["mts", "typescript"],
  ["cts", "typescript"],
  ["js", "typescript"],
  ["jsx", "typescript"],
  ["mjs", "typescript"],
  ["cjs", "typescript"],
  ["java", "java"],
  ["go", "go"],
  ["py", "python"],
]);

const REGEX_PRECEDING_KEYWORDS = new Set([
  "return",
  "typeof",
  "case",
  "do",
  "else",
  "in",
  "of",
  "new",
  "delete",
  "void",
  "throw",
  "yield",
  "await",
]);

export function languageOf(path: string): Language | undefined {
  const extension = path.slice(path.lastIndexOf(".") + 1);
  return path.includes(".") ? EXTENSIONS.get(extension) : undefined;
}

class Scanner {
  readonly comments: Comment[] = [];
  private readonly code: string[] = [""];
  private position = 0;
  private line = 1;

  constructor(private readonly source: string) {}

  get done(): boolean {
    return this.position >= this.source.length;
  }

  peek(offset = 0): string {
    return this.source[this.position + offset] ?? "";
  }

  startsWith(token: string): boolean {
    return this.source.startsWith(token, this.position);
  }

  advance(asCode: boolean): string {
    const char = this.source[this.position] ?? "";
    this.position += 1;
    if (char === "\n") {
      this.line += 1;
      this.code.push("");
    } else {
      this.code[this.code.length - 1] += asCode ? char : " ";
    }
    return char;
  }

  lastCodeToken(): string {
    for (let index = this.code.length - 1; index >= 0; index -= 1) {
      const trimmed = (this.code[index] ?? "").trimEnd();
      if (trimmed !== "") return /[\w$]+$/.exec(trimmed)?.[0] ?? trimmed.slice(-1);
    }
    return "";
  }

  lineComment(prefix: string): void {
    const ownLine = (this.code[this.code.length - 1] ?? "").trim() === "";
    const line = this.line;
    for (const _ of prefix) this.advance(false);
    let text = "";
    while (!this.done && this.peek() !== "\n") text += this.advance(false);
    this.comments.push({ line, endLine: line, text: text.trim(), block: false, doc: false, ownLine });
  }

  blockComment(): void {
    const ownLine = (this.code[this.code.length - 1] ?? "").trim() === "";
    const line = this.line;
    const doc = this.startsWith("/**") && !this.startsWith("/**/");
    this.advance(false);
    this.advance(false);
    let raw = "";
    while (!this.done && !this.startsWith("*/")) raw += this.advance(false);
    if (!this.done) {
      this.advance(false);
      this.advance(false);
    }
    const text = raw
      .replace(/^\*/, "")
      .split("\n")
      .map((part) => part.trim().replace(/^\*\s?/, ""))
      .join("\n")
      .trim();
    this.comments.push({ line, endLine: this.line, text, block: true, doc, ownLine });
  }

  quoted(quote: string, escapes: boolean, multiline: boolean): void {
    for (const _ of quote) this.advance(true);
    while (!this.done) {
      if (escapes && this.peek() === "\\") {
        this.advance(false);
        if (!this.done) this.advance(false);
      } else if (this.startsWith(quote)) {
        for (const _ of quote) this.advance(true);
        return;
      } else if (!multiline && this.peek() === "\n") {
        return;
      } else {
        this.advance(false);
      }
    }
  }

  result(): LexedSource {
    return { comments: this.comments, codeLines: this.code };
  }
}

function lexTypeScript(scanner: Scanner): void {
  const interpolations: number[] = [];
  let depth = 0;
  const templateBody = (): void => {
    while (!scanner.done) {
      if (scanner.peek() === "\\") {
        scanner.advance(false);
        if (!scanner.done) scanner.advance(false);
      } else if (scanner.peek() === "`") {
        scanner.advance(true);
        return;
      } else if (scanner.startsWith("${")) {
        scanner.advance(true);
        scanner.advance(true);
        interpolations.push(depth);
        depth += 1;
        return;
      } else {
        scanner.advance(false);
      }
    }
  };
  while (!scanner.done) {
    const char = scanner.peek();
    if (scanner.startsWith("//")) scanner.lineComment("//");
    else if (scanner.startsWith("/*")) scanner.blockComment();
    else if (char === '"' || char === "'") scanner.quoted(char, true, false);
    else if (char === "/" && startsRegex(scanner.lastCodeToken())) regexLiteral(scanner);
    else {
      scanner.advance(true);
      if (char === "`") templateBody();
      else if (char === "{") depth += 1;
      else if (char === "}") {
        depth -= 1;
        if (interpolations.at(-1) === depth) {
          interpolations.pop();
          templateBody();
        }
      }
    }
  }
}

function startsRegex(previous: string): boolean {
  if (previous === "") return true;
  if (/^[\w$]+$/.test(previous)) return REGEX_PRECEDING_KEYWORDS.has(previous);
  return !/[)\]}]/.test(previous);
}

function regexLiteral(scanner: Scanner): void {
  scanner.advance(true);
  let inClass = false;
  while (!scanner.done && scanner.peek() !== "\n") {
    const char = scanner.peek();
    if (char === "\\") {
      scanner.advance(false);
      if (!scanner.done) scanner.advance(false);
      continue;
    }
    if (char === "[") inClass = true;
    else if (char === "]") inClass = false;
    else if (char === "/" && !inClass) {
      scanner.advance(true);
      return;
    }
    scanner.advance(false);
  }
}

function lexJava(scanner: Scanner): void {
  while (!scanner.done) {
    const char = scanner.peek();
    if (scanner.startsWith("//")) scanner.lineComment("//");
    else if (scanner.startsWith("/*")) scanner.blockComment();
    else if (scanner.startsWith('"""')) scanner.quoted('"""', true, true);
    else if (char === '"' || char === "'") scanner.quoted(char, true, false);
    else scanner.advance(true);
  }
}

function lexGo(scanner: Scanner): void {
  while (!scanner.done) {
    const char = scanner.peek();
    if (scanner.startsWith("//")) scanner.lineComment("//");
    else if (scanner.startsWith("/*")) scanner.blockComment();
    else if (char === "`") scanner.quoted("`", false, true);
    else if (char === '"' || char === "'") scanner.quoted(char, true, false);
    else scanner.advance(true);
  }
}

function lexPython(scanner: Scanner): void {
  while (!scanner.done) {
    const char = scanner.peek();
    if (char === "#") scanner.lineComment("#");
    else if (scanner.startsWith('"""') || scanner.startsWith("'''")) {
      scanner.quoted(scanner.peek().repeat(3), true, true);
    } else if (char === '"' || char === "'") scanner.quoted(char, true, false);
    else scanner.advance(true);
  }
}

const LEXERS: Record<Language, (scanner: Scanner) => void> = {
  typescript: lexTypeScript,
  java: lexJava,
  go: lexGo,
  python: lexPython,
};

export function lex(source: string, language: Language): LexedSource {
  const scanner = new Scanner(source);
  LEXERS[language](scanner);
  return scanner.result();
}
