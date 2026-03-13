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
export class SpexCatalogBuildError extends Error {
    constructor(message) {
        super(message);
        this.name = "SpexCatalogBuildError";
    }
}
function asRecord(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return null;
    }
    return value;
}
function parseCatalogPackages(yamlContent) {
    const parsed = parseYaml(yamlContent);
    const root = asRecord(parsed);
    if (!root) {
        throw new SpexCatalogBuildError("Catalog specification must be a YAML object.");
    }
    const packagesValue = root["packages"];
    if (!Array.isArray(packagesValue)) {
        throw new SpexCatalogBuildError("Catalog specification must contain a packages list.");
    }
    const packages = [];
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
function parseCatalogPackageIdentifier(rawPackageId) {
    const value = rawPackageId.trim();
    if (!value) {
        throw new SpexCatalogBuildError("Catalog packages list must not contain empty values.");
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
    }
    else {
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
        }
        else if (pathSegments.length === 3) {
            const hostSegment = pathSegments[0];
            const namespaceSegment = pathSegments[1];
            const nameSegment = pathSegments[2];
            if (!hostSegment || !namespaceSegment || !nameSegment || !hostSegment.includes(".")) {
                throw new SpexCatalogBuildError(`Unsupported package identifier format: ${rawPackageId}`);
            }
            host = hostSegment;
            namespace = namespaceSegment;
            name = nameSegment;
        }
        else {
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
            // Spec requires fallback to package ID when README/name cannot be read.
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
            throw new SpexCatalogBuildError(`Failed to read last update time for ${packageId}`);
        }
        const name = (await tryReadRepositoryName(cacheRepositoryPath)) ?? packageId;
        return { name, updated };
    }
    catch (error) {
        if (error instanceof SpexCatalogBuildError) {
            throw error;
        }
        const typedError = error;
        const details = [typedError.stderr, typedError.stdout].filter(Boolean).join("\n").trim();
        const suffix = details ? ` ${details}` : "";
        throw new SpexCatalogBuildError(`Failed to fetch catalog package metadata for ${packageId}.${suffix}`.trim());
    }
}
export class CatalogBuildService {
    listener;
    constructor(listener = {}) {
        this.listener = listener;
    }
    async run(input = {}) {
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
        const result = {
            cwd,
            specificationFilePath,
            indexFilePath,
            packages,
        };
        this.listener.onCatalogBuildFinished?.(result);
        return result;
    }
}
