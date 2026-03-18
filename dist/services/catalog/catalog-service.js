import { execFile } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { ensureCachedPackageRepositoryMirror } from "../git/package-cache.js";
export const catalogSpecificationFileName = "spex-catalog.yml";
export const catalogIndexFileName = "spex-catalog-index.yml";
const defaultPackageHost = "github.com";
const spexDirectoryName = ".spex";
const spexBuildFileName = "spex.yml";
const execFileAsync = promisify(execFile);
export class SpexCatalogError extends Error {
    constructor(message) {
        super(message);
        this.name = "SpexCatalogError";
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
function uniqueStrings(values) {
    const seen = new Set();
    const result = [];
    for (const value of values) {
        if (seen.has(value)) {
            continue;
        }
        seen.add(value);
        result.push(value);
    }
    return result;
}
function parseYamlObject(content) {
    const parsed = parseYaml(content);
    return asRecord(parsed) ?? {};
}
function parseBuildFilePackages(content) {
    const root = parseYamlObject(content);
    return uniqueStrings(parseStringList(root["packages"]));
}
function parseCatalogSpecificationPackages(yamlContent) {
    const parsed = parseYaml(yamlContent);
    const root = asRecord(parsed);
    if (!root) {
        throw new SpexCatalogError("Catalog specification must be a YAML object.");
    }
    const packagesValue = root["packages"];
    if (!Array.isArray(packagesValue)) {
        throw new SpexCatalogError("Catalog specification must contain a packages list.");
    }
    const packages = [];
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
function parseCatalogIndexPackages(content) {
    const root = parseYamlObject(content);
    const packagesValue = root["packages"];
    if (!Array.isArray(packagesValue)) {
        throw new SpexCatalogError("Catalog index must contain a packages list.");
    }
    const packages = [];
    const seen = new Set();
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
            throw new SpexCatalogError("Catalog index packages list must contain string values or objects with id.");
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
function compareCatalogPackages(left, right, sort, sortOrder) {
    const direction = sortOrder === "desc" ? -1 : 1;
    let comparison = 0;
    if (sort === "updated") {
        comparison = left.updated - right.updated;
    }
    else if (sort === "name") {
        comparison = left.name.localeCompare(right.name);
    }
    else {
        comparison = left.id.localeCompare(right.id);
    }
    if (comparison !== 0) {
        return comparison * direction;
    }
    return left.id.localeCompare(right.id);
}
function parseCatalogPackageIdentifier(rawPackageId) {
    const value = rawPackageId.trim();
    if (!value) {
        throw new SpexCatalogError("Catalog packages list must not contain empty values.");
    }
    let host;
    let namespace;
    let name;
    if (value.includes("://")) {
        let parsedUrl;
        try {
            parsedUrl = new URL(value);
        }
        catch {
            throw new SpexCatalogError(`Unsupported package URL format: ${rawPackageId}`);
        }
        const pathSegments = parsedUrl.pathname.split("/").filter(Boolean);
        const namespaceSegment = pathSegments[0];
        const nameSegment = pathSegments[1];
        if (!namespaceSegment || !nameSegment) {
            throw new SpexCatalogError(`Package URL must contain namespace and name: ${rawPackageId}`);
        }
        host = parsedUrl.hostname;
        namespace = namespaceSegment;
        name = nameSegment;
    }
    else {
        const pathSegments = value.split("/").filter(Boolean);
        if (pathSegments.length === 2) {
            const namespaceSegment = pathSegments[0];
            const nameSegment = pathSegments[1];
            if (!namespaceSegment || !nameSegment) {
                throw new SpexCatalogError(`Unsupported package identifier format: ${rawPackageId}`);
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
                throw new SpexCatalogError(`Unsupported package identifier format: ${rawPackageId}`);
            }
            host = hostSegment;
            namespace = namespaceSegment;
            name = nameSegment;
        }
        else {
            throw new SpexCatalogError(`Unsupported package identifier format: ${rawPackageId}`);
        }
    }
    name = name.replace(/\.git$/i, "");
    if (!/^[A-Za-z0-9._-]+$/.test(host)) {
        throw new SpexCatalogError(`Unsupported package host format: ${rawPackageId}`);
    }
    if (!/^[A-Za-z0-9._-]+$/.test(namespace)) {
        throw new SpexCatalogError(`Unsupported package namespace format: ${rawPackageId}`);
    }
    if (!/^[A-Za-z0-9._-]+$/.test(name)) {
        throw new SpexCatalogError(`Unsupported package name format: ${rawPackageId}`);
    }
    return {
        host,
        namespace,
        name,
        cloneUrl: `https://${host}/${namespace}/${name}.git`,
    };
}
function extractReadmeTitle(readmeContent) {
    const normalized = readmeContent.replace(/^\uFEFF/, "");
    const match = normalized.match(/^\s*#\s+(.+?)(?:\s+#*)?\s*$/m);
    return match?.[1]?.trim() || null;
}
async function tryReadRepositoryName(cacheRepositoryPath) {
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
        }
        catch {
            // Fallback to package ID when README/name cannot be read.
        }
    }
    return null;
}
async function readRepositoryMetadata(packageId, cwd) {
    const parsedPackage = parseCatalogPackageIdentifier(packageId);
    try {
        const cacheRepositoryPath = await ensureCachedPackageRepositoryMirror(parsedPackage, cwd);
        const { stdout } = await execFileAsync("git", ["log", "--all", "-1", "--format=%ct"], {
            cwd: cacheRepositoryPath,
            maxBuffer: 1024 * 1024,
        });
        const updated = Number.parseInt(stdout.trim(), 10);
        if (!Number.isFinite(updated) || updated <= 0) {
            throw new SpexCatalogError(`Failed to read last update time for ${packageId}`);
        }
        const name = (await tryReadRepositoryName(cacheRepositoryPath)) ?? packageId;
        return { name, updated };
    }
    catch (error) {
        if (error instanceof SpexCatalogError) {
            throw error;
        }
        const typedError = error;
        const details = [typedError.stderr, typedError.stdout].filter(Boolean).join("\n").trim();
        const suffix = details ? ` ${details}` : "";
        throw new SpexCatalogError(`Failed to fetch catalog package metadata for ${packageId}.${suffix}`.trim());
    }
}
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
export class CatalogService {
    listener;
    constructor(listener = {}) {
        this.listener = listener;
    }
    async build(input = {}) {
        const cwd = input.cwd ?? process.cwd();
        const specificationFilePath = resolve(cwd, catalogSpecificationFileName);
        const indexFilePath = resolve(cwd, catalogIndexFileName);
        this.listener.onCatalogBuildStarted?.(cwd);
        this.listener.onCatalogSpecificationReading?.(specificationFilePath);
        let specificationContent;
        try {
            specificationContent = await readFile(specificationFilePath, "utf8");
        }
        catch (error) {
            const code = error.code;
            if (code === "ENOENT") {
                throw new SpexCatalogError(`Missing catalog specification: ${specificationFilePath}`);
            }
            throw error;
        }
        const packages = parseCatalogSpecificationPackages(specificationContent);
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
        const result = {
            cwd,
            specificationFilePath,
            indexFilePath,
            packages,
        };
        this.listener.onCatalogBuildFinished?.(result);
        return result;
    }
    async list(input = {}) {
        const cwd = input.cwd ?? process.cwd();
        const indexFilePath = resolve(cwd, catalogIndexFileName);
        const sort = input.sort ?? "id";
        const sortOrder = input.sortOrder ?? "asc";
        const content = await this.readCatalogIndexFile(indexFilePath);
        const packages = parseCatalogIndexPackages(content).sort((left, right) => compareCatalogPackages(left, right, sort, sortOrder));
        return {
            cwd,
            indexFilePath,
            packages,
        };
    }
    async discover(input = {}) {
        const projectCwd = input.projectCwd ?? process.cwd();
        const catalogIndexCwd = input.catalogIndexCwd ?? process.cwd();
        const catalogIndexFilePath = resolve(catalogIndexCwd, catalogIndexFileName);
        const buildFileState = await this.readOrCreateBuildFile(projectCwd);
        const catalogIndexContent = await this.readCatalogIndexFile(catalogIndexFilePath);
        const catalogPackageEntries = parseCatalogIndexPackages(catalogIndexContent);
        const catalogPackages = catalogPackageEntries.map((catalogPackage) => catalogPackage.id);
        const importedPackageSet = new Set(buildFileState.packages);
        const availablePackageEntries = catalogPackageEntries.filter((catalogPackage) => !importedPackageSet.has(catalogPackage.id));
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
    async addPackage(input) {
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
    async readCatalogIndexFile(catalogIndexFilePath) {
        try {
            return await readFile(catalogIndexFilePath, "utf8");
        }
        catch (error) {
            const code = error.code;
            if (code === "ENOENT") {
                throw new SpexCatalogError(`Missing catalog index: ${catalogIndexFilePath}`);
            }
            throw error;
        }
    }
    async readOrCreateBuildFile(projectCwd) {
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
