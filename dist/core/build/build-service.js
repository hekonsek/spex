import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { ValidateService, } from "../validate/validate-service.js";
const execFileAsync = promisify(execFile);
const defaultPackageHost = "github.com";
const spexAgentsInstruction = `This project contains specification pieces of different types located in:
- \`spex/**/*.md\`
- \`.spex/imports/**/*.md\`

Depending of the specification type it will be located in a relevant subdirectory like \`adr\`, \`instruction\`, \`dataformat\`, \`feature\`, etc.

Please take these specifications under consideration when working with project.

When in doubt specifications in \`spex\` should take precedene over imported specifications in \`.spex/imports\`.
`;
async function pathExists(path) {
    try {
        await stat(path);
        return true;
    }
    catch (error) {
        const code = error.code;
        if (code === "ENOENT") {
            return false;
        }
        throw error;
    }
}
function stripInlineComment(value) {
    let inSingleQuote = false;
    let inDoubleQuote = false;
    for (let index = 0; index < value.length; index += 1) {
        const character = value[index];
        if (character === "'" && !inDoubleQuote) {
            inSingleQuote = !inSingleQuote;
            continue;
        }
        if (character === '"' && !inSingleQuote) {
            inDoubleQuote = !inDoubleQuote;
            continue;
        }
        if (character === "#" && !inSingleQuote && !inDoubleQuote) {
            const previousCharacter = index > 0 ? value[index - 1] : "";
            if (!previousCharacter || /\s/.test(previousCharacter)) {
                return value.slice(0, index).trimEnd();
            }
        }
    }
    return value.trimEnd();
}
function unquote(value) {
    if (value.length < 2) {
        return value;
    }
    const startsWithDoubleQuote = value.startsWith('"') && value.endsWith('"');
    const startsWithSingleQuote = value.startsWith("'") && value.endsWith("'");
    if (startsWithDoubleQuote || startsWithSingleQuote) {
        return value.slice(1, -1);
    }
    return value;
}
function parseBuildFilePackages(buildFileContent) {
    const lines = buildFileContent.split(/\r?\n/);
    const packageIds = [];
    let isPackagesSection = false;
    for (const line of lines) {
        const trimmedLine = line.trim();
        if (!trimmedLine || trimmedLine.startsWith("#")) {
            continue;
        }
        if (!isPackagesSection) {
            if (trimmedLine.startsWith("packages:")) {
                isPackagesSection = true;
            }
            continue;
        }
        const leftTrimmedLine = line.trimStart();
        if (!leftTrimmedLine.startsWith("-")) {
            const isTopLevelYamlKey = line.length === leftTrimmedLine.length && /^[A-Za-z0-9_-]+:/.test(leftTrimmedLine);
            if (isTopLevelYamlKey) {
                break;
            }
            continue;
        }
        const rawValue = leftTrimmedLine.slice(1).trim();
        const packageId = unquote(stripInlineComment(rawValue).trim());
        if (packageId) {
            packageIds.push(packageId);
        }
    }
    return packageIds;
}
function assertSafePathSegment(label, value) {
    if (!/^[A-Za-z0-9._-]+$/.test(value)) {
        throw new Error(`Invalid ${label} in package identifier: ${value}`);
    }
}
function parsePackageId(rawPackageId) {
    const value = rawPackageId.trim().replace(/\/+$/, "");
    if (!value) {
        throw new Error("Package identifier must not be empty.");
    }
    let host = "";
    let namespace = "";
    let name = "";
    if (/^https?:\/\//i.test(value)) {
        const url = new URL(value);
        const pathSegments = url.pathname.split("/").filter(Boolean);
        if (pathSegments.length !== 2) {
            throw new Error(`Package URL must contain namespace and name: ${rawPackageId}`);
        }
        const namespaceSegment = pathSegments[0];
        const nameSegment = pathSegments[1];
        if (!namespaceSegment || !nameSegment) {
            throw new Error(`Package URL must contain namespace and name: ${rawPackageId}`);
        }
        host = url.hostname;
        namespace = namespaceSegment;
        name = nameSegment;
    }
    else {
        const pathSegments = value.split("/").filter(Boolean);
        if (pathSegments.length === 2) {
            const namespaceSegment = pathSegments[0];
            const nameSegment = pathSegments[1];
            if (!namespaceSegment || !nameSegment) {
                throw new Error(`Unsupported package identifier format: ${rawPackageId}`);
            }
            host = defaultPackageHost;
            namespace = namespaceSegment;
            name = nameSegment;
        }
        else if (pathSegments.length === 3) {
            const hostSegment = pathSegments[0];
            const namespaceSegment = pathSegments[1];
            const nameSegment = pathSegments[2];
            if (!hostSegment || !namespaceSegment || !nameSegment || !hostSegment.includes(".")) {
                throw new Error(`Unsupported package identifier format: ${rawPackageId}`);
            }
            host = hostSegment;
            namespace = namespaceSegment;
            name = nameSegment;
        }
        else {
            throw new Error(`Unsupported package identifier format: ${rawPackageId}`);
        }
    }
    name = name.replace(/\.git$/i, "");
    assertSafePathSegment("package host", host);
    assertSafePathSegment("package namespace", namespace);
    assertSafePathSegment("package name", name);
    return {
        raw: rawPackageId,
        host,
        namespace,
        name,
        cloneUrl: `https://${host}/${namespace}/${name}.git`,
    };
}
async function clonePackageToPath(cloneUrl, targetPath, cwd) {
    const temporaryBasePath = await mkdtemp(resolve(tmpdir(), "spex-import-"));
    const temporaryClonePath = resolve(temporaryBasePath, "repo");
    try {
        await execFileAsync("git", ["clone", "--depth", "1", cloneUrl, temporaryClonePath], {
            cwd,
            maxBuffer: 10 * 1024 * 1024,
        });
        await rm(resolve(temporaryClonePath, ".git"), { recursive: true, force: true });
        await rm(targetPath, { recursive: true, force: true });
        await mkdir(dirname(targetPath), { recursive: true });
        await cp(temporaryClonePath, targetPath, { recursive: true });
    }
    catch (error) {
        const typedError = error;
        const details = [typedError.stderr, typedError.stdout].filter(Boolean).join("\n").trim();
        const suffix = details ? ` ${details}` : "";
        throw new Error(`Failed to import package from ${cloneUrl}.${suffix}`.trim());
    }
    finally {
        await rm(temporaryBasePath, { recursive: true, force: true });
    }
}
export class BuildService {
    listener;
    constructor(listener) {
        this.listener = listener;
    }
    async run(input = {}) {
        const cwd = input.cwd ?? process.cwd();
        const buildFilePath = resolve(cwd, ".spex", "spex.yml");
        const agentsFilePath = resolve(cwd, "AGENTS.md");
        const importedPackages = [];
        this.listener.onBuildStarted?.(cwd);
        const validateService = new ValidateService({
            onValidationStarted: (validationCwd) => this.listener.onValidationStarted?.(validationCwd),
            onTypeDirectoryValidated: (type, markdownFileCount) => this.listener.onTypeDirectoryValidated?.(type, markdownFileCount),
            onValidationPassed: (result) => this.listener.onValidationPassed?.(result),
        });
        const validationResult = await validateService.run({ cwd });
        await writeFile(agentsFilePath, spexAgentsInstruction, "utf8");
        this.listener.onAgentsFileWritten?.(agentsFilePath);
        if (!(await pathExists(buildFilePath))) {
            this.listener.onBuildFileMissing?.(buildFilePath);
            const result = {
                cwd,
                validationResult,
                agentsFilePath,
                buildFilePath,
                importedPackages,
            };
            this.listener.onBuildFinished?.(result);
            return result;
        }
        this.listener.onBuildFileDetected?.(buildFilePath);
        const buildFileContent = await readFile(buildFilePath, "utf8");
        const packageIds = parseBuildFilePackages(buildFileContent);
        this.listener.onBuildPackagesResolved?.(packageIds);
        for (const rawPackageId of packageIds) {
            const parsedPackage = parsePackageId(rawPackageId);
            const targetPath = resolve(cwd, ".spex", "imports", parsedPackage.host, parsedPackage.namespace, parsedPackage.name);
            this.listener.onPackageImportStarted?.(parsedPackage.raw, parsedPackage.cloneUrl, targetPath);
            await clonePackageToPath(parsedPackage.cloneUrl, targetPath, cwd);
            const importedPackage = {
                packageId: parsedPackage.raw,
                sourceUrl: parsedPackage.cloneUrl,
                targetPath,
            };
            importedPackages.push(importedPackage);
            this.listener.onPackageImported?.(importedPackage);
        }
        const result = {
            cwd,
            validationResult,
            agentsFilePath,
            buildFilePath,
            importedPackages,
        };
        this.listener.onBuildFinished?.(result);
        return result;
    }
}
