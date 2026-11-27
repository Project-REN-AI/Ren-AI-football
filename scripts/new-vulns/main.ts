// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

interface Vulnerability {
  readonly key: string;
  readonly description: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function arrayField(record: Record<string, unknown>, field: string, where: string): unknown[] {
  const value = record[field];
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error(`${where}.${field} is not an array`);
  return value;
}

function stringField(record: unknown, field: string, where: string): string {
  const value = isRecord(record) ? record[field] : undefined;
  if (typeof value !== "string") throw new Error(`${where}.${field} is not a string`);
  return value;
}

interface Package {
  readonly ecosystem: string;
  readonly name: string;
  readonly version: string;
}

function parsePackage(entry: Record<string, unknown>, where: string): Package {
  const info = entry["package"];
  return {
    ecosystem: stringField(info, "ecosystem", where),
    name: stringField(info, "name", where),
    version: stringField(info, "version", where),
  };
}

function readOsvScannerReport(path: string): Vulnerability[] {
  const report: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!isRecord(report)) throw new Error(`${path} is not an osv-scanner JSON report`);
  return arrayField(report, "results", path).flatMap((source) => {
    if (!isRecord(source)) throw new Error(`${path} has a result that is not an object`);
    return arrayField(source, "packages", path).flatMap((entry) => {
      if (!isRecord(entry)) throw new Error(`${path} has a package that is not an object`);
      const { ecosystem, name, version } = parsePackage(entry, `${path}: package`);
      return arrayField(entry, "vulnerabilities", `${path}: ${ecosystem}/${name}`).map((vulnerability) => {
        const id = stringField(vulnerability, "id", `${path}: ${ecosystem}/${name} vulnerability`);
        return { key: `${ecosystem}/${name}: ${id}`, description: `${ecosystem}/${name}@${version}: ${id}` };
      });
    });
  });
}

function jsonStream(text: string, path: string): unknown[] {
  const values: unknown[] = [];
  let depth = 0;
  let start = 0;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
    } else if (char === '"') inString = true;
    else if (char === "{") {
      if (depth === 0) start = index;
      depth++;
    } else if (char === "}") {
      depth--;
      if (depth === 0) values.push(JSON.parse(text.slice(start, index + 1)));
    } else if (depth === 0 && char !== undefined && char.trim() !== "") {
      throw new Error(`${path} is not a stream of JSON objects`);
    }
  }
  if (depth !== 0) throw new Error(`${path} ends in the middle of a JSON object`);
  return values;
}

function readGovulncheckReport(path: string): Vulnerability[] {
  return jsonStream(readFileSync(path, "utf8"), path).flatMap((message) => {
    const finding = isRecord(message) ? message["finding"] : undefined;
    if (!isRecord(finding)) return [];
    const osv = stringField(finding, "osv", `${path}: finding`);
    const [vulnerable] = arrayField(finding, "trace", `${path}: finding ${osv}`);
    if (!isRecord(vulnerable)) throw new Error(`${path}: finding ${osv} has no trace`);
    if (typeof vulnerable["function"] !== "string") return [];
    const module = stringField(vulnerable, "module", `${path}: finding ${osv} trace`);
    const version = typeof vulnerable["version"] === "string" ? vulnerable["version"] : "";
    return [{ key: `Go/${module}: ${osv}`, description: `Go/${module}@${version}: ${osv}` }];
  });
}

const READERS = { "osv-scanner": readOsvScannerReport, govulncheck: readGovulncheckReport } as const;

function isFormat(value: string): value is keyof typeof READERS {
  return value in READERS;
}

interface CommandLine {
  readonly format: keyof typeof READERS;
  readonly basePath: string;
  readonly headPath: string;
}

function parseCommandLine(): CommandLine | undefined {
  const { values, positionals } = parseArgs({
    options: { format: { type: "string", default: "osv-scanner" } },
    allowPositionals: true,
  });
  const [basePath, headPath, ...extra] = positionals;
  if (basePath === undefined || headPath === undefined || extra.length > 0 || !isFormat(values.format))
    return undefined;
  return { format: values.format, basePath, headPath };
}

function fail(lines: readonly string[]): never {
  for (const line of lines) console.log(line);
  process.exit(1);
}

const USAGE = "new vulnerabilities: usage: new-vulns [--format osv-scanner|govulncheck] <base-report> <head-report>";

let commandLine: CommandLine | undefined;
try {
  commandLine = parseCommandLine();
} catch {
  fail([USAGE]);
}
if (commandLine === undefined) fail([USAGE]);
const { format, basePath, headPath } = commandLine;
const readVulnerabilities = READERS[format];

let base: Vulnerability[];
let head: Vulnerability[];
try {
  base = readVulnerabilities(basePath);
  head = readVulnerabilities(headPath);
} catch (error) {
  fail([`new vulnerabilities: unreadable report: ${error instanceof Error ? error.message : String(error)}`]);
}

const known = new Set(base.map(({ key }) => key));
const introduced = [...new Set(head.filter(({ key }) => !known.has(key)).map(({ description }) => description))];

if (introduced.length > 0)
  fail([`new vulnerabilities: ${introduced.length}`, ...introduced.map((line) => `  ${line}`)]);

console.log(`new vulnerabilities: 0 (${new Set(head.map(({ key }) => key)).size} already in the base)`);
