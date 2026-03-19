import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { BuildService, type BuildPackageMetadata } from "../build/build-service.js";

export const catalogSpecificationFileName = "spex-catalog.yml";
export const catalogIndexFileName = "spex-catalog-index.yml";

const spexDirectoryName = ".spex";
const spexBuildFileName = "spex.yml";

export interface CatalogBuildOptions {
  /**
   * The working directory to use for the catalog build process. If not provided, the current working directory of the process will be used.
   */
  cwd?: string
}

export interface CatalogBuildResult {
  specificationFilePath: string;
  indexFilePath: string;
  packages: CatalogIndexPackage[];
}

export interface CatalogDiscoverInput {
  projectCwd?: string;
  catalogIndexCwd?: string;
}

export type CatalogListSort = "id" | "name" | "updated";
export type CatalogListSortOrder = "asc" | "desc";

export interface CatalogListInput {
  cwd?: string;
  sort?: CatalogListSort;
  sortOrder?: CatalogListSortOrder;
}

export interface CatalogAddPackageInput {
  projectCwd?: string;
  catalogIndexCwd?: string;
  packageId: string;
}

export interface CatalogIndexPackage {
  id: string;
  name: string;
  updated: number;
}

export interface CatalogPackageEntry {
  id: string;
  name: string;
  updated: number;
}

export interface CatalogListResult {
  cwd: string;
  indexFilePath: string;
  packages: CatalogPackageEntry[];
}

export interface CatalogDiscoverResult {
  projectCwd: string;
  catalogIndexFilePath: string;
  buildFilePath: string;
  importedPackages: string[];
  catalogPackages: string[];
  availablePackages: string[];
  catalogPackageEntries: CatalogPackageEntry[];
  availablePackageEntries: CatalogPackageEntry[];
}

export interface CatalogServiceListener {
  onCatalogBuildStarted?(cwd: string): void;
  onCatalogSpecificationReading?(path: string): void;
  onCatalogSpecificationRead?(path: string, packageCount: number): void;
  onPackageDownload?(packageId: string): void;
  onPackageDownloaded?(packageId: string): void;
  onCatalogIndexWriting?(path: string): void;
  onCatalogIndexWritten?(path: string): void;
  onCatalogBuildFinished?(result: CatalogBuildResult): void;
  onBuildFileCreated?(path: string): void;
  onPackageAdded?(packageId: string, buildFilePath: string): void;
}

export class SpexCatalogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SpexCatalogError";
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

function parseCatalogSpecificationPackages(yamlContent: string): CatalogIndexPackage[] {
  const parsed = parseYaml(yamlContent) as unknown;
  const root = asRecord(parsed);

  if (!root) {
    throw new SpexCatalogError("Catalog specification must be a YAML object.");
  }

  const packagesValue = root["packages"];
  if (!Array.isArray(packagesValue)) {
    throw new SpexCatalogError("Catalog specification must contain a packages list.");
  }

  const packages: CatalogIndexPackage[] = [];
  for (const item of packagesValue) {
    if (typeof item !== "string") {
      throw new SpexCatalogError("Catalog packages list must contain only string values.");
    }

    const id = item.trim();
    if (!id) {
      throw new SpexCatalogError("Catalog packages list must not contain empty values.");
    }

    packages.push({ id, name: id, updated: 0 });
  }

  return packages;
}

function parseCatalogIndexPackages(content: string): CatalogPackageEntry[] {
  const root = parseYamlObject(content);
  const packagesValue = root["packages"];
  if (!Array.isArray(packagesValue)) {
    throw new SpexCatalogError("Catalog index must contain a packages list.");
  }

  const packages: CatalogPackageEntry[] = [];
  const seen = new Set<string>();
  for (const item of packagesValue) {
    if (typeof item === "string") {
      const id = item.trim();
      if (id) {
        if (seen.has(id)) {
          continue;
        }

        seen.add(id);
        packages.push({ id, name: id, updated: 0 });
      }

      continue;
    }

    const record = asRecord(item);
    if (!record) {
      throw new SpexCatalogError(
        "Catalog index packages list must contain string values or objects with id.",
      );
    }

    const idValue = record["id"];
    if (typeof idValue !== "string" || !idValue.trim()) {
      throw new SpexCatalogError("Catalog index package object must contain a non-empty id.");
    }

    const id = idValue.trim();
    if (seen.has(id)) {
      continue;
    }

    seen.add(id);
    const nameValue = record["name"];
    const name = typeof nameValue === "string" && nameValue.trim() ? nameValue.trim() : id;
    const updatedValue = record["updated"];
    const updated = typeof updatedValue === "number" && Number.isFinite(updatedValue) ? updatedValue : 0;
    packages.push({ id, name, updated });
  }

  return packages;
}

function compareCatalogPackages(
  left: CatalogPackageEntry,
  right: CatalogPackageEntry,
  sort: CatalogListSort,
  sortOrder: CatalogListSortOrder,
): number {
  const direction = sortOrder === "desc" ? -1 : 1;
  let comparison = 0;

  if (sort === "updated") {
    comparison = left.updated - right.updated;
  } else if (sort === "name") {
    comparison = left.name.localeCompare(right.name);
  } else {
    comparison = left.id.localeCompare(right.id);
  }

  if (comparison !== 0) {
    return comparison * direction;
  }

  return left.id.localeCompare(right.id);
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

export class CatalogService {
  constructor(
    private readonly listener: CatalogServiceListener = {},
    private readonly buildService: BuildService = new BuildService(),
  ) {}

  async build(options: CatalogBuildOptions = {}): Promise<CatalogBuildResult> {
    const cwd = options.cwd ?? process.cwd();
    const specificationFilePath = resolve(cwd, catalogSpecificationFileName);
    const indexFilePath = resolve(cwd, catalogIndexFileName);

    this.listener.onCatalogBuildStarted?.(cwd);
    this.listener.onCatalogSpecificationReading?.(specificationFilePath);

    let specificationContent: string;
    try {
      specificationContent = await readFile(specificationFilePath, "utf8");
    } catch (error: unknown) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        throw new SpexCatalogError(`Missing catalog specification: ${specificationFilePath}`);
      }

      throw error;
    }

    const packages = parseCatalogSpecificationPackages(specificationContent);
    for (const catalogPackage of packages) {
      this.listener.onPackageDownload?.(catalogPackage.id);
      const metadata = await this.readRepositoryMetadata(catalogPackage.id, cwd);
      catalogPackage.name = metadata.name;
      catalogPackage.updated = metadata.updated;
      this.listener.onPackageDownloaded?.(catalogPackage.id);
    }
    this.listener.onCatalogSpecificationRead?.(specificationFilePath, packages.length);

    this.listener.onCatalogIndexWriting?.(indexFilePath);
    const indexYaml = stringifyYaml({ packages });
    await writeFile(indexFilePath, indexYaml, "utf8");
    this.listener.onCatalogIndexWritten?.(indexFilePath);

    const result: CatalogBuildResult = {
      specificationFilePath,
      indexFilePath,
      packages,
    };

    this.listener.onCatalogBuildFinished?.(result);
    return result;
  }

  async list(input: CatalogListInput = {}): Promise<CatalogListResult> {
    const cwd = input.cwd ?? process.cwd();
    const indexFilePath = resolve(cwd, catalogIndexFileName);
    const sort = input.sort ?? "id";
    const sortOrder = input.sortOrder ?? "asc";
    const content = await this.readCatalogIndexFile(indexFilePath);
    const packages = parseCatalogIndexPackages(content).sort((left, right) =>
      compareCatalogPackages(left, right, sort, sortOrder),
    );

    return {
      cwd,
      indexFilePath,
      packages,
    };
  }

  async discover(input: CatalogDiscoverInput = {}): Promise<CatalogDiscoverResult> {
    const projectCwd = input.projectCwd ?? process.cwd();
    const catalogIndexCwd = input.catalogIndexCwd ?? process.cwd();
    const catalogIndexFilePath = resolve(catalogIndexCwd, catalogIndexFileName);

    const buildFileState = await this.readOrCreateBuildFile(projectCwd);
    const catalogIndexContent = await this.readCatalogIndexFile(catalogIndexFilePath);
    const catalogPackageEntries = parseCatalogIndexPackages(catalogIndexContent);
    const catalogPackages = catalogPackageEntries.map((catalogPackage) => catalogPackage.id);
    const importedPackageSet = new Set(buildFileState.packages);
    const availablePackageEntries = catalogPackageEntries.filter(
      (catalogPackage) => !importedPackageSet.has(catalogPackage.id),
    );
    const availablePackages = availablePackageEntries.map((catalogPackage) => catalogPackage.id);

    return {
      projectCwd,
      catalogIndexFilePath,
      buildFilePath: buildFileState.path,
      importedPackages: buildFileState.packages,
      catalogPackages,
      availablePackages,
      catalogPackageEntries,
      availablePackageEntries,
    };
  }

  async addPackage(input: CatalogAddPackageInput): Promise<CatalogDiscoverResult> {
    const projectCwd = input.projectCwd ?? process.cwd();
    const catalogIndexCwd = input.catalogIndexCwd;
    const packageId = input.packageId.trim();
    if (!packageId) {
      throw new SpexCatalogError("Package ID must not be empty.");
    }

    const buildFileState = await this.readOrCreateBuildFile(projectCwd);
    if (!buildFileState.packages.includes(packageId)) {
      buildFileState.packages.push(packageId);
      buildFileState.root["packages"] = buildFileState.packages;
      const yaml = stringifyYaml(buildFileState.root);
      await writeFile(buildFileState.path, yaml, "utf8");
      this.listener.onPackageAdded?.(packageId, buildFileState.path);
    }

    return this.discover(catalogIndexCwd ? { projectCwd, catalogIndexCwd } : { projectCwd });
  }

  private async readCatalogIndexFile(catalogIndexFilePath: string): Promise<string> {
    try {
      return await readFile(catalogIndexFilePath, "utf8");
    } catch (error: unknown) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        throw new SpexCatalogError(`Missing catalog index: ${catalogIndexFilePath}`);
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

  private async readRepositoryMetadata(packageId: string, cwd: string): Promise<BuildPackageMetadata> {
    try {
      return await this.buildService.readPackageMetadata({ packageId, cwd });
    } catch (error: unknown) {
      if (error instanceof SpexCatalogError) {
        throw error;
      }

      const message = error instanceof Error ? error.message : String(error);
      throw new SpexCatalogError(message);
    }
  }
}
