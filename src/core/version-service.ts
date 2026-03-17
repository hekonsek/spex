import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface VersionServiceListener {
  onVersionResolved(version: string): void;
}

interface PackageJson {
  version?: unknown;
}

export class VersionService {
  constructor(private readonly listener: VersionServiceListener) {}

  async currentPackageVersion(): Promise<string> {
    const packageJsonPath = resolve(this.resolvePackageRootPath(), "package.json");
    const packageJsonContent = await readFile(packageJsonPath, "utf8");
    const packageJson = JSON.parse(packageJsonContent) as PackageJson;

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

  private resolvePackageRootPath(): string {
    const serviceFilePath = fileURLToPath(import.meta.url);
    const serviceDirectoryPath = dirname(serviceFilePath);
    return resolve(serviceDirectoryPath, "..", "..");
  }
  
}
