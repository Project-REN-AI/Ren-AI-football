// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { readFileSync } from "node:fs";

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

function readVulnerabilities(path: string): Vulnerability[] {
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

function fail(lines: readonly string[]): never {
  for (const line of lines) console.log(line);
  process.exit(1);
}

const [basePath, headPath] = process.argv.slice(2);
if (basePath === undefined || headPath === undefined)
  fail(["new vulnerabilities: usage: new-vulns <base-report.json> <head-report.json>"]);

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

console.log(`new vulnerabilities: 0 (${head.length} already in the base)`);
