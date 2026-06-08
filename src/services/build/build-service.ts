import "reflect-metadata";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readdir, readFile, rm, rmdir, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { plainToInstance, Type } from "class-transformer";
import { Minimatch } from "minimatch";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

const execFileAsync = promisify(execFile);
const defaultPackageHost = "github.com";
const spexDirectoryName = ".spex";

export const spexAgentsInstruction = `This project contains specifications of different types and instructions located in the following directories:
- \`spex/**/*.md\`
- \`.spex/imports/**/*.md\`

Depending on the instruction or specification type it will be located in a relevant subdirectory like \`adr\`, \`instruction\`, \`dataformat\`, \`feature\`, \`terraform\`, etc.

Please take these specifications under consideration when working with this project.

When in doubt, specifications in \`spex\` should take precedence over imported specifications in \`.spex/imports\`.
`;

// Domain models

export class SpexBuildConfigExport {
  ignores!: string[];
}

export class SpexBuildConfig {
  export = new SpexBuildConfigExport();

  packages!: string[];
}

Type(() => SpexBuildConfigExport)(SpexBuildConfig.prototype, "export");

// Operations input/output models

export interface ReadSpexBuildConfigOptions {
  cwd?: string;
}

export interface ReadSpexBuildConfigResult {
  cwd: string;
  buildFilePath: string;
  exists: boolean;
  config: SpexBuildConfig;
}

export interface WriteSpexBuildConfigOptions {
  cwd?: string;
}

export interface BuildOptions {
  cwd?: string;
}

export interface BuildResult {
  agentsFilePath: string;
  buildFilePath: string;
  importedPackages: ImportedSpexPackage[];
  removedPackages: RemovedSpexPackage[];
}

export interface BuildServiceInitInput {
  cwd?: string;
  packages?: Set<string>;
}

export interface ImportedSpexPackage {
  packageId: string;
  sourceUrl: string;
  targetPath: string;
}

export interface RemovedSpexPackage {
  packageId: string;
  targetPath: string;
}

export interface BuildServiceInitResult {
  cwd: string;
  buildFilePath: string;
  createdBuildFile: boolean;
  addedPackages: string[];
  packages: Set<string>;
}

export interface BuildServiceListener {
  onInitStarted?(cwd: string): void;
  onBuildFileCreated?(path: string): void;
  onBuildStarted?(cwd: string): void;
  onAgentsFileWritten?(path: string): void;
  onBuildFileDetected?(path: string): void;
  onBuildFileMissing?(path: string): void;
  onPackageAdded?(packageId: string, buildFilePath: string): void;
  onBuildPackagesResolved?(packageIds: string[]): void;
  onPackageImportStarted?(packageId: string, sourceUrl: string, targetPath: string): void;
  onPackageImported?(importedPackage: ImportedSpexPackage): void;
  onStalePackageRemovalStarted?(removedPackage: RemovedSpexPackage): void;
  onStalePackageRemoved?(removedPackage: RemovedSpexPackage): void;
  onInitFinished?(result: BuildServiceInitResult): void;
  onBuildFinished?(result: BuildResult): void;
}

export interface BuildPackageMetadataInput {
  packageId: string;
  cwd?: string;
}

export interface BuildPackageMetadata {
  name: string;
  updated: number;
}

export interface CachedPackageRepository {
  host: string;
  namespace: string;
  name: string;
  cloneUrl: string;
}

interface ParsedPackageId extends CachedPackageRepository {
  raw: string;
}

interface ImportedPackageDirectory {
  packageId: string;
  targetPath: string;
}

interface CompiledIgnorePattern {
  matcher: Minimatch;
}

function isPathWithinOrEqual(parentPath: string, childPath: string): boolean {
  const relativePath = relative(parentPath, childPath);
  return relativePath === "" || (!relativePath.startsWith("..") && !relativePath.startsWith("../"));
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

function normalizeBuildConfig(config: SpexBuildConfig, root: Record<string, unknown> = {}): SpexBuildConfig {
  const exportSection = asRecord(root["export"]);

  config.export.ignores = Array.from(new Set<string>(parseStringList(exportSection?.["ignores"])));
  config.packages = Array.from(new Set<string>(parseStringList(root["packages"])));

  return config;
}

function stringifyBuildConfig(config: SpexBuildConfig): string {
  const packages = Array.from(new Set<string>(parseStringList(config.packages)));
  const ignores = Array.from(new Set<string>(parseStringList(config.export?.ignores)));
  const root: Record<string, unknown> = {};

  if (ignores.length > 0) {
    root["export"] = { ignores };
  }

  if (packages.length > 0) {
    root["packages"] = packages;
  }

  return Object.keys(root).length > 0 ? stringifyYaml(root) : "";
}

function normalizeGlobPath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\/+/, "").replace(/\/+$/, "");
}

function compileIgnorePatterns(patterns: string[]): CompiledIgnorePattern[] {
  return patterns
    .map((pattern) => pattern.trim())
    .filter(Boolean)
    .map((pattern) => ({
      matcher: new Minimatch(normalizeGlobPath(pattern), { dot: true }),
    }));
}

function matchesAnyIgnorePattern(
  relativePath: string,
  compiledIgnorePatterns: CompiledIgnorePattern[],
): boolean {
  const normalizedRelativePath = normalizeGlobPath(relativePath);
  if (!normalizedRelativePath) {
    return false;
  }

  return compiledIgnorePatterns.some((pattern) => pattern.matcher.match(normalizedRelativePath));
}

function matchesAnyIgnoreDirectoryPattern(
  relativePath: string,
  compiledIgnorePatterns: CompiledIgnorePattern[],
): boolean {
  const normalizedRelativePath = normalizeGlobPath(relativePath);
  if (!normalizedRelativePath) {
    return false;
  }

  return compiledIgnorePatterns.some(
    (pattern) =>
      pattern.matcher.match(normalizedRelativePath) || pattern.matcher.match(normalizedRelativePath, true),
  );
}

async function copyPackageSpexDirectory(
  sourcePath: string,
  targetPath: string,
  exportIgnorePatterns: string[],
): Promise<void> {
  const compiledIgnorePatterns = compileIgnorePatterns(exportIgnorePatterns);

  await cp(sourcePath, targetPath, {
    recursive: true,
    filter: async (sourceEntryPath: string): Promise<boolean> => {
      const relativeEntryPath = normalizeGlobPath(relative(sourcePath, sourceEntryPath));
      if (!relativeEntryPath) {
        return true;
      }

      const sourceEntryStat = await stat(sourceEntryPath);
      if (sourceEntryStat.isDirectory()) {
        return !matchesAnyIgnoreDirectoryPattern(relativeEntryPath, compiledIgnorePatterns);
      }

      return !matchesAnyIgnorePattern(relativeEntryPath, compiledIgnorePatterns);
    },
  });
}

function assertSafePathSegment(label: string, value: string): void {
  if (!/^[A-Za-z0-9._-]+$/.test(value)) {
    throw new Error(`Invalid ${label} in package identifier: ${value}`);
  }
}

function parsePackageId(rawPackageId: string): ParsedPackageId {
  const value = rawPackageId.trim().replace(/\/+$/, "");
  if (!value) {
    throw new Error("Package identifier must not be empty.");
  }

  let host = "";
  let namespace = "";
  let name = "";

  if (/^https?:\/\//i.test(value)) {
    const url = new URL(value);
    const pathSegments = url.pathname.split("/").filter(Boolean);

    if (pathSegments.length !== 2) {
      throw new Error(`Package URL must contain namespace and name: ${rawPackageId}`);
    }

    const namespaceSegment = pathSegments[0];
    const nameSegment = pathSegments[1];
    if (!namespaceSegment || !nameSegment) {
      throw new Error(`Package URL must contain namespace and name: ${rawPackageId}`);
    }

    host = url.hostname;
    namespace = namespaceSegment;
    name = nameSegment;
  } else {
    const pathSegments = value.split("/").filter(Boolean);
    if (pathSegments.length === 2) {
      const namespaceSegment = pathSegments[0];
      const nameSegment = pathSegments[1];
      if (!namespaceSegment || !nameSegment) {
        throw new Error(`Unsupported package identifier format: ${rawPackageId}`);
      }

      host = defaultPackageHost;
      namespace = namespaceSegment;
      name = nameSegment;
    } else if (pathSegments.length === 3) {
      const hostSegment = pathSegments[0];
      const namespaceSegment = pathSegments[1];
      const nameSegment = pathSegments[2];

      if (!hostSegment || !namespaceSegment || !nameSegment || !hostSegment.includes(".")) {
        throw new Error(`Unsupported package identifier format: ${rawPackageId}`);
      }

      host = hostSegment;
      namespace = namespaceSegment;
      name = nameSegment;
    } else {
      throw new Error(`Unsupported package identifier format: ${rawPackageId}`);
    }
  }

  name = name.replace(/\.git$/i, "");

  assertSafePathSegment("package host", host);
  assertSafePathSegment("package namespace", namespace);
  assertSafePathSegment("package name", name);

  return {
    raw: rawPackageId,
    host,
    namespace,
    name,
    cloneUrl: `https://${host}/${namespace}/${name}.git`,
  };
}

export function getPackagesCacheDirectory(): string {
  return resolve(homedir(), ".cache", "spex", "packages");
}

export function getCachedPackageRepositoryMirrorPath(repository: CachedPackageRepository): string {
  return resolve(
    getPackagesCacheDirectory(),
    repository.host,
    repository.namespace,
    `${repository.name}.git`,
  );
}

export async function ensureCachedPackageRepositoryMirror(
  repository: CachedPackageRepository,
  cwd: string,
): Promise<string> {
  const cacheRepositoryPath = getCachedPackageRepositoryMirrorPath(repository);

  await mkdir(dirname(cacheRepositoryPath), { recursive: true });

  if (!(await pathExists(cacheRepositoryPath))) {
    await execFileAsync("git", ["clone", "--mirror", "--quiet", repository.cloneUrl, cacheRepositoryPath], {
      cwd,
      maxBuffer: 10 * 1024 * 1024,
    });
    return cacheRepositoryPath;
  }

  await execFileAsync("git", ["remote", "set-url", "origin", repository.cloneUrl], {
    cwd: cacheRepositoryPath,
    maxBuffer: 1024 * 1024,
  });
  await execFileAsync("git", ["fetch", "--quiet", "--prune", "origin"], {
    cwd: cacheRepositoryPath,
    maxBuffer: 10 * 1024 * 1024,
  });

  return cacheRepositoryPath;
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
      // Fallback to package ID when README/name cannot be read.
    }
  }

  return null;
}

async function listImportedPackageDirectories(importsRootPath: string): Promise<ImportedPackageDirectory[]> {
  if (!(await pathExists(importsRootPath))) {
    return [];
  }

  const importedPackages: ImportedPackageDirectory[] = [];
  const hostEntries = await readdir(importsRootPath, { withFileTypes: true });

  for (const hostEntry of hostEntries) {
    if (!hostEntry.isDirectory()) {
      continue;
    }

    const hostPath = resolve(importsRootPath, hostEntry.name);
    const namespaceEntries = await readdir(hostPath, { withFileTypes: true });

    for (const namespaceEntry of namespaceEntries) {
      if (!namespaceEntry.isDirectory()) {
        continue;
      }

      const namespacePath = resolve(hostPath, namespaceEntry.name);
      const packageEntries = await readdir(namespacePath, { withFileTypes: true });

      for (const packageEntry of packageEntries) {
        if (!packageEntry.isDirectory()) {
          continue;
        }

        importedPackages.push({
          packageId: `${hostEntry.name}/${namespaceEntry.name}/${packageEntry.name}`,
          targetPath: resolve(namespacePath, packageEntry.name),
        });
      }
    }
  }

  return importedPackages;
}

async function removeEmptyDirectoryChain(path: string, stopPath: string): Promise<void> {
  let currentPath = path;
  const normalizedStopPath = resolve(stopPath);

  while (isPathWithinOrEqual(normalizedStopPath, currentPath)) {
    try {
      await rmdir(currentPath);
    } catch (error: unknown) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "ENOTEMPTY") {
        return;
      }

      throw error;
    }

    if (currentPath === normalizedStopPath) {
      return;
    }

    currentPath = dirname(currentPath);
  }
}

async function findStaleImportedPackages(
  importsRootPath: string,
  expectedTargetPaths: ReadonlySet<string>,
): Promise<RemovedSpexPackage[]> {
  const importedDirectories = await listImportedPackageDirectories(importsRootPath);
  return importedDirectories.filter(({ targetPath }) => !expectedTargetPaths.has(targetPath));
}

async function removeImportedPackage(
  importsRootPath: string,
  removedPackage: RemovedSpexPackage,
): Promise<void> {
  await rm(removedPackage.targetPath, { recursive: true, force: true });
  await removeEmptyDirectoryChain(dirname(removedPackage.targetPath), importsRootPath);
}

export class BuildService {
  constructor(private readonly listener: BuildServiceListener = {}) {}

  async readSpexBuildConfig(input: ReadSpexBuildConfigOptions = {}): Promise<ReadSpexBuildConfigResult> {
    const cwd = input.cwd ?? process.cwd();
    const buildFilePath = this.resolveBuildFilePath(cwd);

    if (!(await pathExists(buildFilePath))) {
      const config = plainToInstance(SpexBuildConfig, {});

      return {
        cwd,
        buildFilePath,
        exists: false,
        config: normalizeBuildConfig(config),
      };
    }

    const buildFileContent = await readFile(buildFilePath, "utf8");
    const raw = parseYaml(buildFileContent);
    const config = plainToInstance(SpexBuildConfig, raw);

    return {
      cwd,
      buildFilePath,
      exists: true,
      config: normalizeBuildConfig(config, raw),
    };
  }

  async writeSpexBuildConfig(config: SpexBuildConfig, input: WriteSpexBuildConfigOptions = {}): Promise<string> {
    const cwd = input.cwd ?? process.cwd();
    const buildFilePath = this.resolveBuildFilePath(cwd);
    const buildFileDirectoryPath = dirname(buildFilePath);

    await mkdir(buildFileDirectoryPath, { recursive: true });
    await writeFile(buildFilePath, stringifyBuildConfig(config), "utf8");

    return buildFilePath;
  }

  async init(input: BuildServiceInitInput = {}): Promise<BuildServiceInitResult> {
    const cwd = input.cwd ?? process.cwd();
    const buildFileDirectoryPath = resolve(cwd, spexDirectoryName);

    this.listener.onInitStarted?.(cwd);

    const buildConfigResult = await this.readSpexBuildConfig({ cwd });
    const buildFilePath = buildConfigResult.buildFilePath;
    const config = buildConfigResult.config;
    const packages = new Set(config.packages);
    const createdBuildFile = !buildConfigResult.exists;

    if (buildConfigResult.exists) {
      this.listener.onBuildFileDetected?.(buildFilePath);
    } else {
      await mkdir(buildFileDirectoryPath, { recursive: true });
      this.listener.onBuildFileCreated?.(buildFilePath);
      await writeFile(buildFilePath, "", "utf8");
    }

    const addedPackages: string[] = [];
    for (const packageId of input.packages ?? []) {
      if (packages.has(packageId)) {
        continue;
      }

      packages.add(packageId);
      addedPackages.push(packageId);
      this.listener.onPackageAdded?.(packageId, buildFilePath);
    }

    if (addedPackages.length > 0) {
      config.packages = [...packages];
      await this.writeSpexBuildConfig(config, { cwd });
    }

    const result: BuildServiceInitResult = {
      cwd,
      buildFilePath,
      createdBuildFile,
      addedPackages,
      packages,
    };

    this.listener.onInitFinished?.(result);

    return result;
  }

  async build(options: BuildOptions = {}): Promise<BuildResult> {
    const cwd = options.cwd ?? process.cwd();
    const agentsFilePath = resolve(cwd, "AGENTS.md");
    const importsRootPath = resolve(cwd, spexDirectoryName, "imports");
    const importedPackages: ImportedSpexPackage[] = [];
    const removedPackages: RemovedSpexPackage[] = [];

    this.listener.onBuildStarted?.(cwd);

    await writeFile(agentsFilePath, spexAgentsInstruction, "utf8");
    this.listener.onAgentsFileWritten?.(agentsFilePath);

    const buildConfigResult = await this.readSpexBuildConfig({ cwd });
    const buildFilePath = buildConfigResult.buildFilePath;

    if (!buildConfigResult.exists) {
      this.listener.onBuildFileMissing?.(buildFilePath);
      const result: BuildResult = {
        agentsFilePath,
        buildFilePath,
        importedPackages,
        removedPackages,
      };
      this.listener.onBuildFinished?.(result);
      return result;
    }

    this.listener.onBuildFileDetected?.(buildFilePath);
    const packageIds = buildConfigResult.config.packages;
    this.listener.onBuildPackagesResolved?.(packageIds);
    const expectedTargetPaths = new Set<string>();

    for (const rawPackageId of packageIds) {
      const parsedPackage = parsePackageId(rawPackageId);
      const targetPath = resolve(
        cwd,
        spexDirectoryName,
        "imports",
        parsedPackage.host,
        parsedPackage.namespace,
        parsedPackage.name,
      );
      expectedTargetPaths.add(targetPath);

      this.listener.onPackageImportStarted?.(parsedPackage.raw, parsedPackage.cloneUrl, targetPath);
      const cacheRepositoryPath = await ensureCachedPackageRepositoryMirror(parsedPackage, cwd);
      await this.clonePackageToPath(cacheRepositoryPath, targetPath, cwd, parsedPackage.cloneUrl);

      const importedPackage: ImportedSpexPackage = {
        packageId: parsedPackage.raw,
        sourceUrl: parsedPackage.cloneUrl,
        targetPath,
      };

      importedPackages.push(importedPackage);
      this.listener.onPackageImported?.(importedPackage);
    }

    const stalePackages = await findStaleImportedPackages(importsRootPath, expectedTargetPaths);
    for (const stalePackage of stalePackages) {
      this.listener.onStalePackageRemovalStarted?.(stalePackage);
      await removeImportedPackage(importsRootPath, stalePackage);
      removedPackages.push(stalePackage);
      this.listener.onStalePackageRemoved?.(stalePackage);
    }

    const result: BuildResult = {
      agentsFilePath,
      buildFilePath,
      importedPackages,
      removedPackages,
    };
    this.listener.onBuildFinished?.(result);
    return result;
  }

  async readPackageMetadata(input: BuildPackageMetadataInput): Promise<BuildPackageMetadata> {
    const cwd = input.cwd ?? process.cwd();
    const parsedPackage = parsePackageId(input.packageId);

    try {
      const cacheRepositoryPath = await ensureCachedPackageRepositoryMirror(parsedPackage, cwd);

      const { stdout } = await execFileAsync("git", ["log", "--all", "-1", "--format=%ct"], {
        cwd: cacheRepositoryPath,
        maxBuffer: 1024 * 1024,
      });

      const updated = Number.parseInt(stdout.trim(), 10);
      if (!Number.isFinite(updated) || updated <= 0) {
        throw new Error(`Failed to read last update time for ${parsedPackage.raw}`);
      }

      const name = (await tryReadRepositoryName(cacheRepositoryPath)) ?? parsedPackage.raw;
      return { name, updated };
    } catch (error: unknown) {
      const typedError = error as NodeJS.ErrnoException & { stderr?: string; stdout?: string };
      const details = [typedError.stderr, typedError.stdout].filter(Boolean).join("\n").trim();
      const suffix = details ? ` ${details}` : "";
      throw new Error(`Failed to fetch package metadata for ${parsedPackage.raw}.${suffix}`.trim());
    }
  }

  // Helpers

  private resolveBuildFilePath(cwd: string): string {
    return resolve(cwd, spexDirectoryName, "spex.yml");
  }

  private async clonePackageToPath(
    cloneUrl: string,
    targetPath: string,
    cwd: string,
    sourceLabel = cloneUrl,
  ): Promise<void> {
    const temporaryBasePath = await mkdtemp(resolve(tmpdir(), "spex-import-"));
    const temporaryClonePath = resolve(temporaryBasePath, "repo");
    const clonedSpexPath = resolve(temporaryClonePath, "spex");
    const clonedSpexBuildConfig = await this.readSpexBuildConfig({ cwd: temporaryClonePath });

    try {
      await execFileAsync("git", ["clone", "--depth", "1", cloneUrl, temporaryClonePath], {
        cwd,
        maxBuffer: 10 * 1024 * 1024,
      });

      if (!(await pathExists(clonedSpexPath))) {
        throw new Error(`Missing spex directory in downloaded package: ${sourceLabel}`);
      }

      await rm(targetPath, { recursive: true, force: true });
      await mkdir(dirname(targetPath), { recursive: true });
      await copyPackageSpexDirectory(clonedSpexPath, targetPath, clonedSpexBuildConfig.config.export.ignores);
    } catch (error: unknown) {
      const typedError = error as NodeJS.ErrnoException & { stderr?: string; stdout?: string };
      const commandOutputDetails = [typedError.stderr, typedError.stdout].filter(Boolean).join("\n").trim();
      const errorMessage = error instanceof Error ? error.message.trim() : "";
      const details = commandOutputDetails || errorMessage;
      const suffix = details ? ` ${details}` : "";
      throw new Error(`Failed to import package from ${sourceLabel}.${suffix}`.trim());
    } finally {
      await rm(temporaryBasePath, { recursive: true, force: true });
    }
  }
}
