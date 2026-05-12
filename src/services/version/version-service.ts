import packageJson from "../../../package.json" with { type: "json" };

export class VersionService {
  currentPackageVersion(): string {
    return packageJson.version
  }
}
