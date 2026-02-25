import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { Minimatch } from "minimatch";
import { parse as parseYaml } from "yaml";
import { ensureCachedPackageRepositoryMirror } from "../git/package-cache.js";
const execFileAsync = promisify(execFile);
const defaultPackageHost = "github.com";
const spexAgentsInstruction = `This project contains specifications of different types and instructions located in:
- \`spex/**/*.md\`
- \`.spex/imports/**/*.md\`

Depending of the instruction or specification type it will be located in a relevant subdirectory like \`adr\`, \`instruction\`, \`dataformat\`, \`feature\`, etc.

Please take these specifications under consideration when working with project.

When in doubt specifications in \`spex\` should take precedene over imported specifications in \`.spex/imports\`.
`;
async function pathExists(path) {
    try {
        await stat(path);
        return true;
    }
    catch (error) {
        const code = error.code;
        if (code === "ENOENT") {
            return false;
        }
        throw error;
    }
}
function asRecord(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return null;
    }
    return value;
}
function parseStringList(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    return value
        .filter((item) => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean);
}
function parseBuildFileYaml(buildFileContent) {
    const parsed = parseYaml(buildFileContent);
    return asRecord(parsed) ?? {};
}
function parseBuildFilePackages(buildFileContent) {
    const root = parseBuildFileYaml(buildFileContent);
    return parseStringList(root["packages"]);
}
function parseBuildFileExportIgnores(buildFileContent) {
    const root = parseBuildFileYaml(buildFileContent);
    const exportSection = asRecord(root["export"]);
    return parseStringList(exportSection?.["ignores"]);
}
function normalizeGlobPath(path) {
    return path.replaceAll("\\", "/").replace(/^\/+/, "").replace(/\/+$/, "");
}
function compileIgnorePatterns(patterns) {
    return patterns
        .map((pattern) => pattern.trim())
        .filter(Boolean)
        .map((pattern) => ({
        matcher: new Minimatch(normalizeGlobPath(pattern), { dot: true }),
    }));
}
function matchesAnyIgnorePattern(relativePath, compiledIgnorePatterns) {
    const normalizedRelativePath = normalizeGlobPath(relativePath);
    if (!normalizedRelativePath) {
        return false;
    }
    return compiledIgnorePatterns.some((pattern) => pattern.matcher.match(normalizedRelativePath));
}
function matchesAnyIgnoreDirectoryPattern(relativePath, compiledIgnorePatterns) {
    const normalizedRelativePath = normalizeGlobPath(relativePath);
    if (!normalizedRelativePath) {
        return false;
    }
    return compiledIgnorePatterns.some((pattern) => pattern.matcher.match(normalizedRelativePath) || pattern.matcher.match(normalizedRelativePath, true));
}
async function readExportIgnorePatterns(buildFilePath) {
    if (!(await pathExists(buildFilePath))) {
        return [];
    }
    const buildFileContent = await readFile(buildFilePath, "utf8");
    return parseBuildFileExportIgnores(buildFileContent);
}
async function copyPackageSpexDirectory(sourcePath, targetPath, exportIgnorePatterns) {
    const compiledIgnorePatterns = compileIgnorePatterns(exportIgnorePatterns);
    await cp(sourcePath, targetPath, {
        recursive: true,
        filter: async (sourceEntryPath) => {
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
function assertSafePathSegment(label, value) {
    if (!/^[A-Za-z0-9._-]+$/.test(value)) {
        throw new Error(`Invalid ${label} in package identifier: ${value}`);
    }
}
function parsePackageId(rawPackageId) {
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
    }
    else {
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
        }
        else if (pathSegments.length === 3) {
            const hostSegment = pathSegments[0];
            const namespaceSegment = pathSegments[1];
            const nameSegment = pathSegments[2];
            if (!hostSegment || !namespaceSegment || !nameSegment || !hostSegment.includes(".")) {
                throw new Error(`Unsupported package identifier format: ${rawPackageId}`);
            }
            host = hostSegment;
            namespace = namespaceSegment;
            name = nameSegment;
        }
        else {
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
async function clonePackageToPath(cloneUrl, targetPath, cwd, sourceLabel = cloneUrl) {
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
    }
    catch (error) {
        const typedError = error;
        const details = [typedError.stderr, typedError.stdout].filter(Boolean).join("\n").trim();
        const suffix = details ? ` ${details}` : "";
        throw new Error(`Failed to import package from ${sourceLabel}.${suffix}`.trim());
    }
    finally {
        await rm(temporaryBasePath, { recursive: true, force: true });
    }
}
async function clonePackageToPathFromCache(parsedPackage, targetPath, cwd) {
    const cacheRepositoryPath = await ensureCachedPackageRepositoryMirror(parsedPackage, cwd);
    await clonePackageToPath(cacheRepositoryPath, targetPath, cwd, parsedPackage.cloneUrl);
}
export class BuildService {
    listener;
    validationService;
    constructor(listener, validationService) {
        this.listener = listener;
        this.validationService = validationService;
    }
    async run(input = {}) {
        const cwd = input.cwd ?? process.cwd();
        const buildFilePath = resolve(cwd, ".spex", "spex.yml");
        const agentsFilePath = resolve(cwd, "AGENTS.md");
        const importedPackages = [];
        this.listener.onBuildStarted?.(cwd);
        await this.validationService.run({ cwd });
        await writeFile(agentsFilePath, spexAgentsInstruction, "utf8");
        this.listener.onAgentsFileWritten?.(agentsFilePath);
        if (!(await pathExists(buildFilePath))) {
            this.listener.onBuildFileMissing?.(buildFilePath);
            const result = {
                cwd,
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
            const targetPath = resolve(cwd, ".spex", "imports", parsedPackage.host, parsedPackage.namespace, parsedPackage.name);
            this.listener.onPackageImportStarted?.(parsedPackage.raw, parsedPackage.cloneUrl, targetPath);
            await clonePackageToPathFromCache(parsedPackage, targetPath, cwd);
            const importedPackage = {
                packageId: parsedPackage.raw,
                sourceUrl: parsedPackage.cloneUrl,
                targetPath,
            };
            importedPackages.push(importedPackage);
            this.listener.onPackageImported?.(importedPackage);
        }
        const result = {
            cwd,
            agentsFilePath,
            buildFilePath,
            importedPackages,
        };
        this.listener.onBuildFinished?.(result);
        return result;
    }
}
