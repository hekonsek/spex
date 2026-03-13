import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { catalogIndexFileName } from "./build-service.js";
const spexDirectoryName = ".spex";
const spexBuildFileName = "spex.yml";
export class SpexCatalogDiscoverError extends Error {
    constructor(message) {
        super(message);
        this.name = "SpexCatalogDiscoverError";
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
function parseCatalogIndexPackages(content) {
    const root = parseYamlObject(content);
    const packagesValue = root["packages"];
    if (!Array.isArray(packagesValue)) {
        throw new SpexCatalogDiscoverError("Catalog index must contain a packages list.");
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
                packages.push({ id, name: id });
            }
            continue;
        }
        const record = asRecord(item);
        if (!record) {
            throw new SpexCatalogDiscoverError("Catalog index packages list must contain string values or objects with id.");
        }
        const idValue = record["id"];
        if (typeof idValue !== "string" || !idValue.trim()) {
            throw new SpexCatalogDiscoverError("Catalog index package object must contain a non-empty id.");
        }
        const id = idValue.trim();
        if (seen.has(id)) {
            continue;
        }
        seen.add(id);
        const nameValue = record["name"];
        const name = typeof nameValue === "string" && nameValue.trim() ? nameValue.trim() : id;
        packages.push({ id, name });
    }
    return packages;
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
export class CatalogDiscoverService {
    listener;
    constructor(listener = {}) {
        this.listener = listener;
    }
    async run(input = {}) {
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
            throw new SpexCatalogDiscoverError("Package ID must not be empty.");
        }
        const buildFileState = await this.readOrCreateBuildFile(projectCwd);
        if (!buildFileState.packages.includes(packageId)) {
            buildFileState.packages.push(packageId);
            buildFileState.root["packages"] = buildFileState.packages;
            const yaml = stringifyYaml(buildFileState.root);
            await writeFile(buildFileState.path, yaml, "utf8");
            this.listener.onPackageAdded?.(packageId, buildFileState.path);
        }
        return this.run(catalogIndexCwd ? { projectCwd, catalogIndexCwd } : { projectCwd });
    }
    async readCatalogIndexFile(catalogIndexFilePath) {
        try {
            return await readFile(catalogIndexFilePath, "utf8");
        }
        catch (error) {
            const code = error.code;
            if (code === "ENOENT") {
                throw new SpexCatalogDiscoverError(`Missing catalog index: ${catalogIndexFilePath}`);
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
