// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { spawnSync } from "node:child_process";

const MANIFEST = "service.json";
const LANGUAGES = ["typescript", "java", "python", "go"] as const;

type Language = (typeof LANGUAGES)[number];

interface Service {
  readonly name: string;
  readonly path: string;
  readonly language: Language;
  readonly dependsOn: readonly string[];
}

type AffectedService = Omit<Service, "dependsOn">;

interface AffectedServices {
  readonly all: boolean;
  readonly services: readonly AffectedService[];
}

function tryGit(args: readonly string[]): string | null {
  const result = spawnSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return result.status === 0 ? result.stdout : null;
}

function git(args: readonly string[]): string {
  const output = tryGit(args);
  if (output === null) throw new Error(`git ${args.join(" ")} failed`);
  return output;
}

function parseJson(path: string, text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function nulSeparated(output: string): string[] {
  return output.split("\0").filter((entry) => entry !== "");
}

function changedPaths(base: string, target: string): string[] {
  return nulSeparated(git(["diff", "--name-only", "--no-renames", "-z", `${base}...${target}`, "--"]));
}

function serviceDirectories(target: string): string[] {
  const entries = nulSeparated(git(["ls-tree", "-d", "-z", "--name-only", target, "--", "services/", "web"]));
  return entries.filter((entry) => entry === "web" || /^services\/[^/]+$/.test(entry));
}

function isLanguage(value: unknown): value is Language {
  return LANGUAGES.some((language) => language === value);
}

function normalizeDependency(path: string, dependency: unknown): string {
  if (typeof dependency !== "string") throw new Error(`${path}: dependsOn entries must be strings`);
  const normalized = dependency.replace(/\/+$/, "");
  if (normalized === "" || normalized.startsWith("/") || normalized.split("/").includes("..")) {
    throw new Error(`${path}: dependsOn entry ${JSON.stringify(dependency)} must be a path relative to the repo root`);
  }
  return normalized;
}

function readService(target: string, directory: string): Service {
  const path = `${directory}/${MANIFEST}`;
  const shown = tryGit(["show", `${target}:${path}`]);
  if (shown === null) throw new Error(`${directory} has no ${MANIFEST}; every service declares one`);
  const manifest = parseJson(path, shown);
  if (typeof manifest !== "object" || manifest === null || Array.isArray(manifest)) {
    throw new Error(`${path} must be a JSON object`);
  }
  const language = "language" in manifest ? manifest.language : undefined;
  if (!isLanguage(language)) throw new Error(`${path}: language must be one of ${LANGUAGES.join(", ")}`);
  const dependsOn = "dependsOn" in manifest ? manifest.dependsOn : [];
  if (!Array.isArray(dependsOn)) throw new Error(`${path}: dependsOn must be an array of paths`);
  return {
    name: directory === "web" ? "web" : directory.slice("services/".length),
    path: directory,
    language,
    dependsOn: dependsOn.map((dependency: unknown) => normalizeDependency(path, dependency)),
  };
}

function isWithin(file: string, prefix: string): boolean {
  return file === prefix || file.startsWith(`${prefix}/`);
}

function touches(service: Service, file: string): boolean {
  return isWithin(file, service.path) || service.dependsOn.some((dependency) => isWithin(file, dependency));
}

function servicesAt(target: string): Service[] {
  return serviceDirectories(target).map((directory) => readService(target, directory));
}

function verdict(all: boolean, affected: readonly Service[]): AffectedServices {
  return {
    all,
    services: affected
      .map(({ name, path, language }) => ({ name, path, language }))
      .toSorted((left, right) => left.name.localeCompare(right.name)),
  };
}

function affectedServices(base: string, target: string): AffectedServices {
  const services = servicesAt(target);
  const files = changedPaths(base, target);
  const all = files.some((file) => !services.some((service) => touches(service, file)));
  return verdict(all, all ? services : services.filter((service) => files.some((file) => touches(service, file))));
}

function describe({ all, services }: AffectedServices): string {
  if (services.length === 0) return "affected services: none";
  const names = services.map(({ name }) => name).join(", ");
  return all ? `affected services: all, the monorepo root changed (${names})` : `affected services: ${names}`;
}

const USAGE =
  "usage: affected-services [--json] <base-ref> <target-ref> | affected-services [--json] --all <target-ref>";

const args = process.argv.slice(2);
const json = args.includes("--json");
const everyService = args.includes("--all");
const refs = args.filter((arg) => arg !== "--json" && arg !== "--all");

try {
  if (refs.length !== (everyService ? 1 : 2)) throw new Error(USAGE);
  const [first = "", second = ""] = refs;
  const affected = everyService ? verdict(true, servicesAt(first)) : affectedServices(first, second);
  if (json) console.log(JSON.stringify(affected));
  else
    console.log(
      everyService ? `services: ${affected.services.map(({ name }) => name).join(", ")}` : describe(affected),
    );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
