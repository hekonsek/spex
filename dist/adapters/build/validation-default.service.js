import { readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";
export const supportedSpexTypes = ["adr", "instruction", "dataformat", "feature"];
export class SpexValidationError extends Error {
    issues;
    constructor(issues) {
        super("Spex structure validation failed.");
        this.issues = issues;
        this.name = "SpexValidationError";
    }
}
async function directoryExists(path) {
    try {
        return (await stat(path)).isDirectory();
    }
    catch (error) {
        const code = error.code;
        if (code === "ENOENT") {
            return false;
        }
        throw error;
    }
}
export class DefaultValidationService {
    listener;
    constructor(listener = {}) {
        this.listener = listener;
    }
    async validate(input = {}) {
        const cwd = input.cwd ?? process.cwd();
        const spexPath = resolve(cwd, "spex");
        const issues = [];
        const validatedTypes = [];
        this.listener.onValidationStarted?.(cwd);
        if (!(await directoryExists(spexPath))) {
            issues.push(`Missing spex directory: ${spexPath}`);
        }
        if (issues.length === 0) {
            const existingTypeDirectories = [];
            for (const type of supportedSpexTypes) {
                const typePath = resolve(spexPath, type);
                if (await directoryExists(typePath)) {
                    existingTypeDirectories.push(type);
                }
            }
            if (existingTypeDirectories.length === 0) {
                issues.push("Missing supported type directory in spex. Expected at least one of: adr, instruction, dataformat, feature.");
            }
            for (const type of existingTypeDirectories) {
                const typePath = resolve(spexPath, type);
                const entries = await readdir(typePath, { withFileTypes: true });
                const markdownFileCount = entries.filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".md")).length;
                this.listener.onTypeDirectoryValidated?.(type, markdownFileCount);
                if (entries.length === 0) {
                    issues.push(`The spex/${type} directory must not be empty.`);
                }
                if (markdownFileCount === 0) {
                    issues.push(`The spex/${type} directory must contain at least one .md file.`);
                }
                validatedTypes.push({
                    type,
                    path: typePath,
                });
            }
        }
        if (issues.length > 0) {
            throw new SpexValidationError(issues);
        }
        const result = {
            spexPath,
            validatedTypes,
        };
        this.listener.onValidationPassed?.(result);
        return result;
    }
}
