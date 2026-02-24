import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
export const catalogSpecificationFileName = "spex-catalog.yml";
export const catalogIndexFileName = "spex-catalog-index.yml";
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
        const url = item.trim();
        if (!url) {
            throw new SpexCatalogBuildError("Catalog packages list must not contain empty values.");
        }
        packages.push({ url });
    }
    return packages;
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
