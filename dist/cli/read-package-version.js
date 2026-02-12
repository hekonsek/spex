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
