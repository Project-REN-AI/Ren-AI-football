// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { parseSync } from "oxc-parser";

export interface ForbiddenImport {
  readonly file: string;
  readonly specifier: string;
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { recursive: true, encoding: "utf8" }).filter(
    (path) => /\.[cm]?tsx?$/.test(path) && !/\.test\.[cm]?tsx?$/.test(path),
  );
}

function stringLiteral(node: unknown): string | null {
  if (typeof node !== "object" || node === null) return null;
  return "type" in node && node.type === "Literal" && "value" in node && typeof node.value === "string"
    ? node.value
    : null;
}

function commonJsSpecifier(node: object): string | null {
  if (!("type" in node)) return null;
  if (node.type === "CallExpression" && "callee" in node && "arguments" in node && Array.isArray(node.arguments)) {
    const callee = node.callee;
    const isRequire = typeof callee === "object" && callee !== null && "name" in callee && callee.name === "require";
    return isRequire ? stringLiteral(node.arguments[0]) : null;
  }
  if (node.type === "TSExternalModuleReference" && "expression" in node) return stringLiteral(node.expression);
  return null;
}

function commonJsSpecifiers(node: unknown): string[] {
  if (typeof node !== "object" || node === null) return [];
  if (Array.isArray(node)) return node.flatMap(commonJsSpecifiers);
  const own = commonJsSpecifier(node);
  return [...(own === null ? [] : [own]), ...Object.values(node).flatMap(commonJsSpecifiers)];
}

function importSpecifiers(file: string, source: string): string[] {
  const { module, program } = parseSync(file, source);
  const dynamic = module.dynamicImports.map(({ moduleRequest }) => {
    const expression = source.slice(moduleRequest.start, moduleRequest.end);
    return /^(["'`])[^"'`$]*\1$/.test(expression) ? expression.slice(1, -1) : expression;
  });
  return [
    ...module.staticImports.map((entry) => entry.moduleRequest.value),
    ...module.staticExports.flatMap((entry) => entry.entries.flatMap((item) => item.moduleRequest?.value ?? [])),
    ...dynamic,
    ...commonJsSpecifiers(program),
  ];
}

function staysInDomain(file: string, specifier: string): boolean {
  if (!specifier.startsWith("./") && !specifier.startsWith("../")) return false;
  const resolved = normalize(join(dirname(file), specifier));
  return resolved !== ".." && !resolved.startsWith("../");
}

/**
 * Lists every import in the non-test sources of `domainDirectory` that leaves the domain layer.
 * Paths in the result are relative to `domainDirectory`.
 */
export function findForbiddenDomainImports(domainDirectory: string): ForbiddenImport[] {
  return sourceFiles(domainDirectory).flatMap((file) =>
    importSpecifiers(file, readFileSync(join(domainDirectory, file), "utf8"))
      .filter((specifier) => !staysInDomain(file, specifier))
      .map((specifier) => ({ file, specifier })),
  );
}
