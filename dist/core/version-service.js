import packageJson from "../../package.json" with { type: "json" };
export class VersionService {
    async currentPackageVersion() {
        if (typeof packageJson.version !== "string") {
            throw new Error("The package.json version field must be a string.");
        }
        const version = packageJson.version.trim();
        if (!version) {
            throw new Error("Missing version value.");
        }
        return version;
    }
}
