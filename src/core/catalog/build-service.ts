import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

export const catalogSpecificationFileName = "spex-catalog.yml";
export const catalogIndexFileName = "spex-catalog-index.yml";

export interface CatalogBuildServiceInput {
  cwd?: string;
}

export interface CatalogIndexPackage {
  url: string;
}

export interface CatalogBuildServiceResult {
  cwd: string;
  specificationFilePath: string;
  indexFilePath: string;
  packages: CatalogIndexPackage[];
}

export interface CatalogBuildServiceListener {
  onCatalogBuildStarted?(cwd: string): void;
  onCatalogSpecificationReading?(path: string): void;
  onCatalogSpecificationRead?(path: string, packageCount: number): void;
  onCatalogIndexWriting?(path: string): void;
  onCatalogIndexWritten?(path: string): void;
  onCatalogBuildFinished?(result: CatalogBuildServiceResult): void;
}

export class SpexCatalogBuildError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SpexCatalogBuildError";
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function parseCatalogPackages(yamlContent: string): CatalogIndexPackage[] {
  const parsed = parseYaml(yamlContent) as unknown;
  const root = asRecord(parsed);

  if (!root) {
    throw new SpexCatalogBuildError("Catalog specification must be a YAML object.");
  }

  const packagesValue = root["packages"];
  if (!Array.isArray(packagesValue)) {
    throw new SpexCatalogBuildError("Catalog specification must contain a packages list.");
  }

  const packages: CatalogIndexPackage[] = [];
  for (const item of packagesValue) {
    if (typeof item !== "string") {
      throw new SpexCatalogBuildError("Catalog packages list must contain only string values.");
    }

    const url = item.trim();
    if (!url) {
      throw new SpexCatalogBuildError("Catalog packages list must not contain empty values.");
    }

    packages.push({ url });
  }

  return packages;
}

export class CatalogBuildService {
  constructor(private readonly listener: CatalogBuildServiceListener = {}) {}

  async run(input: CatalogBuildServiceInput = {}): Promise<CatalogBuildServiceResult> {
    const cwd = input.cwd ?? process.cwd();
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
        throw new SpexCatalogBuildError(`Missing catalog specification: ${specificationFilePath}`);
      }

      throw error;
    }

    const packages = parseCatalogPackages(specificationContent);
    this.listener.onCatalogSpecificationRead?.(specificationFilePath, packages.length);

    this.listener.onCatalogIndexWriting?.(indexFilePath);
    const indexYaml = stringifyYaml({ packages });
    await writeFile(indexFilePath, indexYaml, "utf8");
    this.listener.onCatalogIndexWritten?.(indexFilePath);

    const result: CatalogBuildServiceResult = {
      cwd,
      specificationFilePath,
      indexFilePath,
      packages,
    };

    this.listener.onCatalogBuildFinished?.(result);
    return result;
  }
}
