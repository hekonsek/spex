import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { DefaultInitService } from "../../adapters/init/init-default.service.js";
import { CatalogService, SpexCatalogError, } from "./catalog-service.js";
const execFileAsync = promisify(execFile);
const defaultCodexExecutable = "codex";
const defaultCodexModel = "gpt-5.4-mini";
const defaultCodexConfig = 'model_reasoning_effort="low"';
const defaultMaxBuffer = 10 * 1024 * 1024;
const invalidOutputSnippetLength = 200;
function uniqueStrings(values) {
    const seen = new Set();
    const result = [];
    for (const value of values) {
        if (seen.has(value)) {
            continue;
        }
        seen.add(value);
        result.push(value);
    }
    return result;
}
function formatCatalogPackages(catalogPackages) {
    return catalogPackages.map((catalogPackage) => `- ${catalogPackage.id}: ${catalogPackage.name}`).join("\n");
}
function buildDiscoveryPrompt(catalogPackages, description) {
    const trimmedDescription = description?.trim();
    return [
        "Inspect the current directory to understand this project.",
        trimmedDescription ? `Additional project description: ${trimmedDescription}` : "",
        "Choose only the Spex catalog package ids that are relevant to this project.",
        "Use only package ids from the catalog below.",
        "Return only a JSON array of package ids.",
        "No prose, no code fences, no extra text.",
        "It is OK to return an empty list if nothing matches.",
        "",
        "Catalog packages:",
        formatCatalogPackages(catalogPackages),
    ]
        .filter(Boolean)
        .join("\n");
}
function formatInvalidOutputSnippet(output) {
    const normalizedOutput = output.trim().replace(/\s+/g, " ");
    return normalizedOutput.slice(0, invalidOutputSnippetLength);
}
function parseDiscoveredPackages(output, catalogPackages) {
    let parsed;
    try {
        parsed = JSON.parse(output.trim());
    }
    catch {
        const snippet = formatInvalidOutputSnippet(output);
        throw new SpexCatalogError(`AI discovery must return a JSON array of package ids. Received: ${snippet || "<empty output>"}`);
    }
    if (!Array.isArray(parsed)) {
        throw new SpexCatalogError("AI discovery must return a JSON array of package ids.");
    }
    const discoveredPackages = uniqueStrings(parsed.map((item) => {
        if (typeof item !== "string") {
            throw new SpexCatalogError("AI discovery JSON array must contain only string package ids.");
        }
        const packageId = item.trim();
        if (!packageId) {
            throw new SpexCatalogError("AI discovery JSON array must not contain empty package ids.");
        }
        return packageId;
    }));
    const catalogPackageSet = new Set(catalogPackages);
    const unknownPackages = discoveredPackages.filter((packageId) => !catalogPackageSet.has(packageId));
    if (unknownPackages.length > 0) {
        throw new SpexCatalogError(`AI discovery returned package ids missing from catalog: ${unknownPackages.join(", ")}`);
    }
    return discoveredPackages;
}
export class CatalogDiscoverAiService {
    listener;
    catalogService;
    createInitService;
    execFileRunner;
    codexExecutable;
    constructor(listener = {}, dependencies = {}) {
        this.listener = listener;
        this.catalogService = dependencies.catalogService ?? new CatalogService();
        this.createInitService =
            dependencies.createInitService ?? ((initListener) => new DefaultInitService(initListener));
        this.execFileRunner = dependencies.execFileRunner ?? execFileAsync;
        this.codexExecutable =
            dependencies.codexExecutable ?? process.env.SPEX_CODEX_EXECUTABLE ?? defaultCodexExecutable;
    }
    async discover(input = {}) {
        const projectCwd = input.projectCwd ?? process.cwd();
        const catalogIndexCwd = input.catalogIndexCwd ?? process.cwd();
        const dryRun = input.dryRun ?? false;
        this.listener.onAiDiscoveryStarted?.(projectCwd);
        const catalogResult = await this.catalogService.list({ cwd: catalogIndexCwd, sort: "id" });
        const catalogPackages = catalogResult.packages.map((catalogPackage) => catalogPackage.id);
        this.listener.onCatalogLoaded?.(catalogResult.packages);
        const prompt = buildDiscoveryPrompt(catalogResult.packages, input.description);
        const codexArgs = [
            "exec",
            "--skip-git-repo-check",
            "-m",
            defaultCodexModel,
            "-c",
            defaultCodexConfig,
            "--color",
            "never",
            prompt,
        ];
        this.listener.onCodexStarted?.(this.codexExecutable, codexArgs, projectCwd);
        let commandOutput;
        try {
            commandOutput = await this.execFileRunner(this.codexExecutable, codexArgs, {
                cwd: projectCwd,
                maxBuffer: defaultMaxBuffer,
            });
        }
        catch (error) {
            const nodeError = error;
            if (nodeError.code === "ENOENT") {
                throw new SpexCatalogError(`Codex executable not found: ${this.codexExecutable}`);
            }
            const stderr = nodeError.stderr?.trim();
            const message = stderr || (error instanceof Error ? error.message : String(error));
            throw new SpexCatalogError(`AI discovery failed: ${message}`);
        }
        const discoveredPackages = parseDiscoveredPackages(commandOutput.stdout, catalogPackages);
        this.listener.onPackagesDiscovered?.(discoveredPackages);
        let initResult;
        if (!dryRun) {
            const initService = this.createInitService({
                onBuildFileCreated: (path) => {
                    this.listener.onBuildFileCreated?.(path);
                },
                onPackageAdded: (packageId, buildFilePath) => {
                    this.listener.onPackageAdded?.(packageId, buildFilePath);
                },
            });
            initResult = await initService.init({
                cwd: projectCwd,
                packages: discoveredPackages,
            });
        }
        const result = {
            projectCwd,
            catalogIndexCwd,
            dryRun,
            buildFilePath: resolve(projectCwd, ".spex", "spex.yml"),
            catalogPackages,
            discoveredPackages,
            ...(initResult === undefined ? {} : { initResult }),
        };
        this.listener.onAiDiscoveryFinished?.(result);
        return result;
    }
}
