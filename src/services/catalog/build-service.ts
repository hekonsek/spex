import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { ensureCachedPackageRepositoryMirror } from "../git/package-cache.js";

export const catalogSpecificationFileName = "spex-catalog.yml";
export const catalogIndexFileName = "spex-catalog-index.yml";
const defaultPackageHost = "github.com";
const execFileAsync = promisify(execFile);

export interface CatalogBuildServiceInput {
  cwd?: string;
}

export interface CatalogIndexPackage {
  id: string;
  name: string;
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

    const id = item.trim();
    if (!id) {
      throw new SpexCatalogBuildError("Catalog packages list must not contain empty values.");
    }

    packages.push({ id, name: id, updated: 0 });
  }

  return packages;
}

interface ParsedCatalogPackageIdentifier {
  host: string;
  namespace: string;
  name: string;
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

  if (!/^[A-Za-z0-9._-]+$/.test(host)) {
    throw new SpexCatalogBuildError(`Unsupported package host format: ${rawPackageId}`);
  }

  if (!/^[A-Za-z0-9._-]+$/.test(namespace)) {
    throw new SpexCatalogBuildError(`Unsupported package namespace format: ${rawPackageId}`);
  }

  if (!/^[A-Za-z0-9._-]+$/.test(name)) {
    throw new SpexCatalogBuildError(`Unsupported package name format: ${rawPackageId}`);
  }

  return {
    host,
    namespace,
    name,
    cloneUrl: `https://${host}/${namespace}/${name}.git`,
  };
}

function extractReadmeTitle(readmeContent: string): string | null {
  const normalized = readmeContent.replace(/^\uFEFF/, "");
  const match = normalized.match(/^\s*#\s+(.+?)(?:\s+#*)?\s*$/m);
  return match?.[1]?.trim() || null;
}

async function tryReadRepositoryName(cacheRepositoryPath: string): Promise<string | null> {
  const readmeCandidates = ["README.md", "readme.md", "Readme.md", "README.MD"];

  for (const readmePath of readmeCandidates) {
    try {
      const { stdout } = await execFileAsync("git", ["show", `HEAD:${readmePath}`], {
        cwd: cacheRepositoryPath,
        maxBuffer: 1024 * 1024,
      });

      const title = extractReadmeTitle(stdout);
      if (title) {
        return title;
      }
    } catch {
      // Spec requires fallback to package ID when README/name cannot be read.
    }
  }

  return null;
}

interface CatalogPackageMetadata {
  name: string;
  updated: number;
}

async function readRepositoryMetadata(packageId: string, cwd: string): Promise<CatalogPackageMetadata> {
  const parsedPackage = parseCatalogPackageIdentifier(packageId);

  try {
    const cacheRepositoryPath = await ensureCachedPackageRepositoryMirror(parsedPackage, cwd);

    const { stdout } = await execFileAsync("git", ["log", "--all", "-1", "--format=%ct"], {
      cwd: cacheRepositoryPath,
      maxBuffer: 1024 * 1024,
    });

    const updated = Number.parseInt(stdout.trim(), 10);
    if (!Number.isFinite(updated) || updated <= 0) {
      throw new SpexCatalogBuildError(`Failed to read last update time for ${packageId}`);
    }

    const name = (await tryReadRepositoryName(cacheRepositoryPath)) ?? packageId;
    return { name, updated };
  } catch (error: unknown) {
    if (error instanceof SpexCatalogBuildError) {
      throw error;
    }

    const typedError = error as NodeJS.ErrnoException & { stderr?: string; stdout?: string };
    const details = [typedError.stderr, typedError.stdout].filter(Boolean).join("\n").trim();
    const suffix = details ? ` ${details}` : "";
    throw new SpexCatalogBuildError(
      `Failed to fetch catalog package metadata for ${packageId}.${suffix}`.trim(),
    );
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
      const metadata = await readRepositoryMetadata(catalogPackage.id, cwd);
      catalogPackage.name = metadata.name;
      catalogPackage.updated = metadata.updated;
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
