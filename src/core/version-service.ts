import packageJson from "../../package.json" with { type: "json" };

export interface VersionServiceListener {
  onVersionResolved(version: string): void;
}

export class VersionService {
  constructor(private readonly listener: VersionServiceListener) {}

  async currentPackageVersion(): Promise<string> {
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
}
