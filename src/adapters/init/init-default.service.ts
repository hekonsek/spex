import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type {
  InitService,
  InitServiceInput,
  InitServiceListener,
  InitServiceResult,
} from "../../ports/init/init.service.js";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function parseStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }

    seen.add(value);
    result.push(value);
  }

  return result;
}

function parseYamlObject(content: string): Record<string, unknown> {
  const parsed = parseYaml(content) as unknown;
  return asRecord(parsed) ?? {};
}

function parseBuildFilePackages(content: string): string[] {
  const root = parseYamlObject(content);
  return uniqueStrings(parseStringList(root["packages"]));
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error: unknown) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

export class DefaultInitService implements InitService {
  constructor(private readonly listener: InitServiceListener = {}) {}

  async init(input: InitServiceInput = {}): Promise<InitServiceResult> {
    const cwd = input.cwd ?? process.cwd();
    const requestedPackages = uniqueStrings(parseStringList(input.packages ?? []));
    const buildFileDirectoryPath = resolve(cwd, ".spex");
    const buildFilePath = resolve(buildFileDirectoryPath, "spex.yml");

    this.listener.onInitStarted?.(cwd);

    let createdBuildFile = false;
    let root: Record<string, unknown> = {};
    let packages: string[] = [];

    if (await pathExists(buildFilePath)) {
      this.listener.onBuildFileDetected?.(buildFilePath);
      const buildFileContent = await readFile(buildFilePath, "utf8");
      root = parseYamlObject(buildFileContent);
      packages = parseBuildFilePackages(buildFileContent);
    } else {
      createdBuildFile = true;
      await mkdir(buildFileDirectoryPath, { recursive: true });
      this.listener.onBuildFileCreated?.(buildFilePath);
      await writeFile(buildFilePath, "", "utf8");
    }

    const addedPackages: string[] = [];
    for (const packageId of requestedPackages) {
      if (packages.includes(packageId)) {
        continue;
      }

      packages.push(packageId);
      addedPackages.push(packageId);
      this.listener.onPackageAdded?.(packageId, buildFilePath);
    }

    if (addedPackages.length > 0) {
      root["packages"] = packages;
      await writeFile(buildFilePath, stringifyYaml(root), "utf8");
    }

    const result: InitServiceResult = {
      cwd,
      buildFilePath,
      createdBuildFile,
      addedPackages,
      packages,
    };

    this.listener.onInitFinished?.(result);

    return result;
  }
}
