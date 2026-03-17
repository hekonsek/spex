import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
export async function readPackageVersion(cwd = process.cwd()) {
    const packageJsonPath = resolve(cwd, "package.json");
    const packageJsonContent = await readFile(packageJsonPath, "utf8");
    const packageJson = JSON.parse(packageJsonContent);
    if (typeof packageJson.version !== "string") {
        throw new Error("The package.json version field must be a string.");
    }
    return packageJson.version;
}
export class VersionService {
    listener;
    constructor(listener) {
        this.listener = listener;
    }
    run(input) {
        const version = input.version.trim();
        if (!version) {
            throw new Error("Missing version value.");
        }
        this.listener.onVersionResolved(version);
        return version;
    }
}
