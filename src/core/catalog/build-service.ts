import { execFile } from "node:child_process";
import { readFile, rm, writeFile, mkdtemp } from "node:fs/promises";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

export const catalogSpecificationFileName = "spex-catalog.yml";
export const catalogIndexFileName = "spex-catalog-index.yml";
const defaultPackageHost = "github.com";
const execFileAsync = promisify(execFile);

export interface CatalogBuildServiceInput {
  cwd?: string;
}

export interface CatalogIndexPackage {
  url: string;
  updated: number;
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

    packages.push({ url, updated: 0 });
  }

  return packages;
}

interface ParsedCatalogPackageIdentifier {
  cloneUrl: string;
}

function parseCatalogPackageIdentifier(rawPackageId: string): ParsedCatalogPackageIdentifier {
  const value = rawPackageId.trim();

  if (!value) {
    throw new SpexCatalogBuildError("Catalog packages list must not contain empty values.");
  }

  let host: string;
  let namespace: string;
  let name: string;

  if (value.includes("://")) {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(value);
    } catch {
      throw new SpexCatalogBuildError(`Unsupported package URL format: ${rawPackageId}`);
    }

    const pathSegments = parsedUrl.pathname.split("/").filter(Boolean);
    const namespaceSegment = pathSegments[0];
    const nameSegment = pathSegments[1];
    if (!namespaceSegment || !nameSegment) {
      throw new SpexCatalogBuildError(`Package URL must contain namespace and name: ${rawPackageId}`);
    }

    host = parsedUrl.hostname;
    namespace = namespaceSegment;
    name = nameSegment;
  } else {
    const pathSegments = value.split("/").filter(Boolean);

    if (pathSegments.length === 2) {
      const namespaceSegment = pathSegments[0];
      const nameSegment = pathSegments[1];
      if (!namespaceSegment || !nameSegment) {
        throw new SpexCatalogBuildError(`Unsupported package identifier format: ${rawPackageId}`);
      }

      host = defaultPackageHost;
      namespace = namespaceSegment;
      name = nameSegment;
    } else if (pathSegments.length === 3) {
      const hostSegment = pathSegments[0];
      const namespaceSegment = pathSegments[1];
      const nameSegment = pathSegments[2];

      if (!hostSegment || !namespaceSegment || !nameSegment || !hostSegment.includes(".")) {
        throw new SpexCatalogBuildError(`Unsupported package identifier format: ${rawPackageId}`);
      }

      host = hostSegment;
      namespace = namespaceSegment;
      name = nameSegment;
    } else {
      throw new SpexCatalogBuildError(`Unsupported package identifier format: ${rawPackageId}`);
    }
  }

  name = name.replace(/\.git$/i, "");

  return {
    cloneUrl: `https://${host}/${namespace}/${name}.git`,
  };
}

async function readRepositoryUpdatedEpochSeconds(packageUrl: string, cwd: string): Promise<number> {
  const { cloneUrl } = parseCatalogPackageIdentifier(packageUrl);
  const temporaryBasePath = await mkdtemp(resolve(tmpdir(), "spex-catalog-build-"));
  const temporaryClonePath = resolve(temporaryBasePath, "repo");

  try {
    await execFileAsync(
      "git",
      ["clone", "--depth", "1", "--filter=blob:none", "--quiet", cloneUrl, temporaryClonePath],
      {
        cwd,
        maxBuffer: 10 * 1024 * 1024,
      },
    );

    const { stdout } = await execFileAsync("git", ["log", "-1", "--format=%ct"], {
      cwd: temporaryClonePath,
      maxBuffer: 1024 * 1024,
    });

    const updated = Number.parseInt(stdout.trim(), 10);
    if (!Number.isFinite(updated) || updated <= 0) {
      throw new SpexCatalogBuildError(`Failed to read last update time for ${packageUrl}`);
    }

    return updated;
  } catch (error: unknown) {
    if (error instanceof SpexCatalogBuildError) {
      throw error;
    }

    const typedError = error as NodeJS.ErrnoException & { stderr?: string; stdout?: string };
    const details = [typedError.stderr, typedError.stdout].filter(Boolean).join("\n").trim();
    const suffix = details ? ` ${details}` : "";
    throw new SpexCatalogBuildError(
      `Failed to fetch catalog package metadata for ${packageUrl}.${suffix}`.trim(),
    );
  } finally {
    await rm(temporaryBasePath, { recursive: true, force: true });
  }
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
    for (const catalogPackage of packages) {
      catalogPackage.updated = await readRepositoryUpdatedEpochSeconds(catalogPackage.url, cwd);
    }
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
