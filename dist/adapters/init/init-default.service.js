import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
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
export class DefaultInitService {
    listener;
    constructor(listener = {}) {
        this.listener = listener;
    }
    async init(input = {}) {
        const cwd = input.cwd ?? process.cwd();
        const requestedPackages = uniqueStrings(parseStringList(input.packages ?? []));
        const buildFileDirectoryPath = resolve(cwd, ".spex");
        const buildFilePath = resolve(buildFileDirectoryPath, "spex.yml");
        this.listener.onInitStarted?.(cwd);
        let createdBuildFile = false;
        let root = {};
        let packages = [];
        if (await pathExists(buildFilePath)) {
            this.listener.onBuildFileDetected?.(buildFilePath);
            const buildFileContent = await readFile(buildFilePath, "utf8");
            root = parseYamlObject(buildFileContent);
            packages = parseBuildFilePackages(buildFileContent);
        }
        else {
            createdBuildFile = true;
            await mkdir(buildFileDirectoryPath, { recursive: true });
            this.listener.onBuildFileCreated?.(buildFilePath);
            await writeFile(buildFilePath, "", "utf8");
        }
        const addedPackages = [];
        for (const packageId of requestedPackages) {
            if (packages.includes(packageId)) {
                continue;
            }
            packages.push(packageId);
            addedPackages.push(packageId);
            this.listener.onPackageAdded?.(packageId, buildFilePath);
        }
        if (addedPackages.length > 0) {
            root["packages"] = packages;
            await writeFile(buildFilePath, stringifyYaml(root), "utf8");
        }
        const result = {
            cwd,
            buildFilePath,
            createdBuildFile,
            addedPackages,
            packages,
        };
        this.listener.onInitFinished?.(result);
        return result;
    }
}
