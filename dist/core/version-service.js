import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
export class VersionService {
    listener;
    constructor(listener) {
        this.listener = listener;
    }
    async currentPackageVersion() {
        const packageJsonPath = resolve(this.resolvePackageRootPath(), "package.json");
        const packageJsonContent = await readFile(packageJsonPath, "utf8");
        const packageJson = JSON.parse(packageJsonContent);
        if (typeof packageJson.version !== "string") {
            throw new Error("The package.json version field must be a string.");
        }
        const version = packageJson.version.trim();
        if (!version) {
            throw new Error("Missing version value.");
        }
        this.listener.onVersionResolved(version);
        return version;
    }
    resolvePackageRootPath() {
        const serviceFilePath = fileURLToPath(import.meta.url);
        const serviceDirectoryPath = dirname(serviceFilePath);
        return resolve(serviceDirectoryPath, "..", "..");
    }
}
