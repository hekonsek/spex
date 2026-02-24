import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { Minimatch } from "minimatch";
import { parse as parseYaml } from "yaml";
import { ensureCachedPackageRepositoryMirror } from "../git/package-cache.js";
import {
  type SupportedSpexType,
  type ValidateServiceResult,
  ValidateService,
} from "../validate/validate-service.js";

const execFileAsync = promisify(execFile);
const defaultPackageHost = "github.com";

const spexAgentsInstruction = `This project contains specifications of different types and instructions located in:
- \`spex/**/*.md\`
- \`.spex/imports/**/*.md\`

Depending of the instruction or specification type it will be located in a relevant subdirectory like \`adr\`, \`instruction\`, \`dataformat\`, \`feature\`, etc.

Please take these specifications under consideration when working with project.

When in doubt specifications in \`spex\` should take precedene over imported specifications in \`.spex/imports\`.
`;

interface ParsedPackageId {
  raw: string;
  host: string;
  namespace: string;
  name: string;
  cloneUrl: string;
}

export interface BuildServiceInput {
  cwd?: string;
}

export interface ImportedSpexPackage {
  packageId: string;
  sourceUrl: string;
  targetPath: string;
}

export interface BuildServiceResult {
  cwd: string;
  validationResult: ValidateServiceResult;
  agentsFilePath: string;
  buildFilePath: string;
  importedPackages: ImportedSpexPackage[];
}

export interface BuildServiceListener {
  onBuildStarted?(cwd: string): void;
  onValidationStarted?(cwd: string): void;
  onTypeDirectoryValidated?(type: SupportedSpexType, markdownFileCount: number): void;
  onValidationPassed?(result: ValidateServiceResult): void;
  onAgentsFileWritten?(path: string): void;
  onBuildFileDetected?(path: string): void;
  onBuildFileMissing?(path: string): void;
  onBuildPackagesResolved?(packageIds: string[]): void;
  onPackageImportStarted?(packageId: string, sourceUrl: string, targetPath: string): void;
  onPackageImported?(importedPackage: ImportedSpexPackage): void;
  onBuildFinished?(result: BuildServiceResult): void;
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

function parseBuildFileYaml(buildFileContent: string): Record<string, unknown> {
  const parsed = parseYaml(buildFileContent) as unknown;
  return asRecord(parsed) ?? {};
}

function parseBuildFilePackages(buildFileContent: string): string[] {
  const root = parseBuildFileYaml(buildFileContent);
  return parseStringList(root["packages"]);
}

function parseBuildFileExportIgnores(buildFileContent: string): string[] {
  const root = parseBuildFileYaml(buildFileContent);
  const exportSection = asRecord(root["export"]);
  return parseStringList(exportSection?.["ignores"]);
}

function normalizeGlobPath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\/+/, "").replace(/\/+$/, "");
}

interface CompiledIgnorePattern {
  matcher: Minimatch;
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

async function readExportIgnorePatterns(buildFilePath: string): Promise<string[]> {
  if (!(await pathExists(buildFilePath))) {
    return [];
  }

  const buildFileContent = await readFile(buildFilePath, "utf8");
  return parseBuildFileExportIgnores(buildFileContent);
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

async function clonePackageToPath(
  cloneUrl: string,
  targetPath: string,
  cwd: string,
  sourceLabel = cloneUrl,
): Promise<void> {
  const temporaryBasePath = await mkdtemp(resolve(tmpdir(), "spex-import-"));
  const temporaryClonePath = resolve(temporaryBasePath, "repo");
  const clonedSpexPath = resolve(temporaryClonePath, "spex");
  const clonedBuildFilePath = resolve(temporaryClonePath, ".spex", "spex.yml");

  try {
    await execFileAsync("git", ["clone", "--depth", "1", cloneUrl, temporaryClonePath], {
      cwd,
      maxBuffer: 10 * 1024 * 1024,
    });

    if (!(await pathExists(clonedSpexPath))) {
      throw new Error(`Missing spex directory in downloaded package: ${cloneUrl}`);
    }

    const exportIgnorePatterns = await readExportIgnorePatterns(clonedBuildFilePath);

    await rm(targetPath, { recursive: true, force: true });
    await mkdir(dirname(targetPath), { recursive: true });
    await copyPackageSpexDirectory(clonedSpexPath, targetPath, exportIgnorePatterns);
  } catch (error: unknown) {
    const typedError = error as NodeJS.ErrnoException & { stderr?: string; stdout?: string };
    const details = [typedError.stderr, typedError.stdout].filter(Boolean).join("\n").trim();
    const suffix = details ? ` ${details}` : "";
    throw new Error(`Failed to import package from ${sourceLabel}.${suffix}`.trim());
  } finally {
    await rm(temporaryBasePath, { recursive: true, force: true });
  }
}

async function clonePackageToPathFromCache(
  parsedPackage: ParsedPackageId,
  targetPath: string,
  cwd: string,
): Promise<void> {
  const cacheRepositoryPath = await ensureCachedPackageRepositoryMirror(parsedPackage, cwd);
  await clonePackageToPath(cacheRepositoryPath, targetPath, cwd, parsedPackage.cloneUrl);
}

export class BuildService {
  constructor(private readonly listener: BuildServiceListener) {}

  async run(input: BuildServiceInput = {}): Promise<BuildServiceResult> {
    const cwd = input.cwd ?? process.cwd();
    const buildFilePath = resolve(cwd, ".spex", "spex.yml");
    const agentsFilePath = resolve(cwd, "AGENTS.md");
    const importedPackages: ImportedSpexPackage[] = [];

    this.listener.onBuildStarted?.(cwd);

    const validateService = new ValidateService({
      onValidationStarted: (validationCwd: string): void =>
        this.listener.onValidationStarted?.(validationCwd),
      onTypeDirectoryValidated: (type, markdownFileCount): void =>
        this.listener.onTypeDirectoryValidated?.(type, markdownFileCount),
      onValidationPassed: (result): void => this.listener.onValidationPassed?.(result),
    });
    const validationResult = await validateService.run({ cwd });

    await writeFile(agentsFilePath, spexAgentsInstruction, "utf8");
    this.listener.onAgentsFileWritten?.(agentsFilePath);

    if (!(await pathExists(buildFilePath))) {
      this.listener.onBuildFileMissing?.(buildFilePath);
      const result: BuildServiceResult = {
        cwd,
        validationResult,
        agentsFilePath,
        buildFilePath,
        importedPackages,
      };
      this.listener.onBuildFinished?.(result);
      return result;
    }

    this.listener.onBuildFileDetected?.(buildFilePath);
    const buildFileContent = await readFile(buildFilePath, "utf8");
    const packageIds = parseBuildFilePackages(buildFileContent);
    this.listener.onBuildPackagesResolved?.(packageIds);

    for (const rawPackageId of packageIds) {
      const parsedPackage = parsePackageId(rawPackageId);
      const targetPath = resolve(
        cwd,
        ".spex",
        "imports",
        parsedPackage.host,
        parsedPackage.namespace,
        parsedPackage.name,
      );

      this.listener.onPackageImportStarted?.(parsedPackage.raw, parsedPackage.cloneUrl, targetPath);
      await clonePackageToPathFromCache(parsedPackage, targetPath, cwd);

      const importedPackage: ImportedSpexPackage = {
        packageId: parsedPackage.raw,
        sourceUrl: parsedPackage.cloneUrl,
        targetPath,
      };

      importedPackages.push(importedPackage);
      this.listener.onPackageImported?.(importedPackage);
    }

    const result: BuildServiceResult = {
      cwd,
      validationResult,
      agentsFilePath,
      buildFilePath,
      importedPackages,
    };
    this.listener.onBuildFinished?.(result);
    return result;
  }
}
