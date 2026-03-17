import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export interface VersionServiceInput {
  version: string;
}

export interface VersionServiceListener {
  onVersionResolved(version: string): void;
}

interface PackageJson {
  version?: unknown;
}

export async function readPackageVersion(cwd: string = process.cwd()): Promise<string> {
  const packageJsonPath = resolve(cwd, "package.json");
  const packageJsonContent = await readFile(packageJsonPath, "utf8");
  const packageJson = JSON.parse(packageJsonContent) as PackageJson;

  if (typeof packageJson.version !== "string") {
    throw new Error("The package.json version field must be a string.");
  }

  return packageJson.version;
}

export class VersionService {
  constructor(private readonly listener: VersionServiceListener) {}

  run(input: VersionServiceInput): string {
    const version = input.version.trim();
    if (!version) {
      throw new Error("Missing version value.");
    }

    this.listener.onVersionResolved(version);
    return version;
  }
}
