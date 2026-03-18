import packageJson from "../../package.json" with { type: "json" };

export class VersionService {
  async currentPackageVersion(): Promise<string> {
    return packageJson.version
  }
}
