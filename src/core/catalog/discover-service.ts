import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { catalogIndexFileName } from "./build-service.js";

const spexDirectoryName = ".spex";
const spexBuildFileName = "spex.yml";

export interface CatalogDiscoverServiceInput {
  projectCwd?: string;
  catalogIndexCwd?: string;
}

export interface CatalogDiscoverAddPackageInput {
  projectCwd?: string;
  catalogIndexCwd?: string;
  packageUrl: string;
}

export interface CatalogDiscoverServiceResult {
  projectCwd: string;
  catalogIndexFilePath: string;
  buildFilePath: string;
  importedPackages: string[];
  catalogPackages: string[];
  availablePackages: string[];
}

export interface CatalogDiscoverServiceListener {
  onBuildFileCreated?(path: string): void;
  onPackageAdded?(packageUrl: string, buildFilePath: string): void;
}

export class SpexCatalogDiscoverError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SpexCatalogDiscoverError";
  }
}

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

function parseCatalogIndexPackages(content: string): string[] {
  const root = parseYamlObject(content);
  const packagesValue = root["packages"];
  if (!Array.isArray(packagesValue)) {
    throw new SpexCatalogDiscoverError("Catalog index must contain a packages list.");
  }

  const packages: string[] = [];
  for (const item of packagesValue) {
    if (typeof item === "string") {
      const url = item.trim();
      if (url) {
        packages.push(url);
      }

      continue;
    }

    const record = asRecord(item);
    if (!record) {
      throw new SpexCatalogDiscoverError(
        "Catalog index packages list must contain string values or objects with url.",
      );
    }

    const urlValue = record["url"];
    if (typeof urlValue !== "string" || !urlValue.trim()) {
      throw new SpexCatalogDiscoverError("Catalog index package object must contain a non-empty url.");
    }

    packages.push(urlValue.trim());
  }

  return uniqueStrings(packages);
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

interface ProjectBuildFileState {
  path: string;
  root: Record<string, unknown>;
  packages: string[];
}

export class CatalogDiscoverService {
  constructor(private readonly listener: CatalogDiscoverServiceListener = {}) {}

  async run(input: CatalogDiscoverServiceInput = {}): Promise<CatalogDiscoverServiceResult> {
    const projectCwd = input.projectCwd ?? process.cwd();
    const catalogIndexCwd = input.catalogIndexCwd ?? process.cwd();
    const catalogIndexFilePath = resolve(catalogIndexCwd, catalogIndexFileName);

    const buildFileState = await this.readOrCreateBuildFile(projectCwd);
    const catalogIndexContent = await this.readCatalogIndexFile(catalogIndexFilePath);
    const catalogPackages = parseCatalogIndexPackages(catalogIndexContent);
    const importedPackageSet = new Set(buildFileState.packages);
    const availablePackages = catalogPackages.filter((packageUrl) => !importedPackageSet.has(packageUrl));

    return {
      projectCwd,
      catalogIndexFilePath,
      buildFilePath: buildFileState.path,
      importedPackages: buildFileState.packages,
      catalogPackages,
      availablePackages,
    };
  }

  async addPackage(input: CatalogDiscoverAddPackageInput): Promise<CatalogDiscoverServiceResult> {
    const projectCwd = input.projectCwd ?? process.cwd();
    const catalogIndexCwd = input.catalogIndexCwd;
    const packageUrl = input.packageUrl.trim();
    if (!packageUrl) {
      throw new SpexCatalogDiscoverError("Package URL must not be empty.");
    }

    const buildFileState = await this.readOrCreateBuildFile(projectCwd);
    if (!buildFileState.packages.includes(packageUrl)) {
      buildFileState.packages.push(packageUrl);
      buildFileState.root["packages"] = buildFileState.packages;
      const yaml = stringifyYaml(buildFileState.root);
      await writeFile(buildFileState.path, yaml, "utf8");
      this.listener.onPackageAdded?.(packageUrl, buildFileState.path);
    }

    return this.run(catalogIndexCwd ? { projectCwd, catalogIndexCwd } : { projectCwd });
  }

  private async readCatalogIndexFile(catalogIndexFilePath: string): Promise<string> {
    try {
      return await readFile(catalogIndexFilePath, "utf8");
    } catch (error: unknown) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        throw new SpexCatalogDiscoverError(`Missing catalog index: ${catalogIndexFilePath}`);
      }

      throw error;
    }
  }

  private async readOrCreateBuildFile(projectCwd: string): Promise<ProjectBuildFileState> {
    const buildFileDirectoryPath = resolve(projectCwd, spexDirectoryName);
    const buildFilePath = resolve(buildFileDirectoryPath, spexBuildFileName);

    if (!(await pathExists(buildFilePath))) {
      await mkdir(buildFileDirectoryPath, { recursive: true });
      await writeFile(buildFilePath, stringifyYaml({ packages: [] }), "utf8");
      this.listener.onBuildFileCreated?.(buildFilePath);
    }

    const buildFileContent = await readFile(buildFilePath, "utf8");
    const root = parseYamlObject(buildFileContent);
    const packages = parseBuildFilePackages(buildFileContent);

    return {
      path: buildFilePath,
      root,
      packages,
    };
  }
}
