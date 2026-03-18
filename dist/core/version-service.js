import packageJson from "../../package.json" with { type: "json" };
export class VersionService {
    async currentPackageVersion() {
        return packageJson.version;
    }
}
