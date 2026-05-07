import { spawn } from "node:child_process";
import { resolve } from "node:path";
import type pino from "pino";
import { InitService, type InitServiceListener, type InitServiceResult } from "../init/InitService.js";
import {
  CatalogService,
  SpexCatalogError,
  type CatalogListResult,
  type CatalogPackageEntry,
} from "./catalog-service.js";

const defaultCodexExecutable = "codex";
const defaultCodexModel = "gpt-5.4-mini";
const defaultCodexConfig = 'model_reasoning_effort="low"';
const defaultMaxBuffer = 10 * 1024 * 1024;
const defaultCodexTimeoutMs = 5 * 60 * 1000;
const invalidOutputSnippetLength = 200;

export interface CatalogDiscoverAiInput {
  projectCwd?: string;
  catalogIndexCwd?: string;
  description?: string;
  dryRun?: boolean;
}

export interface CatalogDiscoverAiResult {
  projectCwd: string;
  catalogIndexCwd: string;
  dryRun: boolean;
  buildFilePath: string;
  catalogPackages: string[];
  discoveredPackages: string[];
  initResult?: InitServiceResult;
}

export interface CatalogDiscoverAiServiceListener {
  onAiDiscoveryStarted?(projectCwd: string): void;
  onCatalogLoaded?(catalogPackages: CatalogPackageEntry[]): void;
  onCodexStarted?(command: string, args: string[], cwd: string): void;
  onPackagesDiscovered?(packageIds: string[]): void;
  onBuildFileCreated?(path: string): void;
  onPackageAdded?(packageId: string, buildFilePath: string): void;
  onAiDiscoveryFinished?(result: CatalogDiscoverAiResult): void;
}

interface ExecFileResult {
  stdout: string;
  stderr: string;
}

type ExecFileRunner = (
  file: string,
  args: string[],
  options: { cwd: string; maxBuffer: number; timeoutMs: number },
) => Promise<ExecFileResult>;

interface CatalogDiscoverAiServiceDependencies {
  catalogService?: Pick<CatalogService, "list">;
  createInitService?: (listener: InitServiceListener) => InitService;
  execFileRunner?: ExecFileRunner;
  codexExecutable?: string;
  codexTimeoutMs?: number;
  logger?: pino.Logger;
}

interface CommandExecutionError extends Error {
  code?: number | string | null | undefined;
  signal?: NodeJS.Signals | null | undefined;
  stderr?: string | undefined;
  stdout?: string | undefined;
  killed?: boolean | undefined;
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }

    seen.add(value);
    result.push(value);
  }

  return result;
}

function formatCatalogPackages(catalogPackages: CatalogPackageEntry[]): string {
  return catalogPackages.map((catalogPackage) => `- ${catalogPackage.id}: ${catalogPackage.name}`).join("\n");
}

function buildDiscoveryPrompt(catalogPackages: CatalogPackageEntry[], description?: string): string {
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

function formatInvalidOutputSnippet(output: string): string {
  const normalizedOutput = output.trim().replace(/\s+/g, " ");
  return normalizedOutput.slice(0, invalidOutputSnippetLength);
}

function parseDiscoveredPackages(output: string, catalogPackages: string[]): string[] {
  let parsed: unknown;

  try {
    parsed = JSON.parse(output.trim());
  } catch {
    const snippet = formatInvalidOutputSnippet(output);
    throw new SpexCatalogError(
      `AI discovery must return a JSON array of package ids. Received: ${snippet || "<empty output>"}`,
    );
  }

  if (!Array.isArray(parsed)) {
    throw new SpexCatalogError("AI discovery must return a JSON array of package ids.");
  }

  const discoveredPackages = uniqueStrings(
    parsed.map((item) => {
      if (typeof item !== "string") {
        throw new SpexCatalogError("AI discovery JSON array must contain only string package ids.");
      }

      const packageId = item.trim();
      if (!packageId) {
        throw new SpexCatalogError("AI discovery JSON array must not contain empty package ids.");
      }

      return packageId;
    }),
  );

  const catalogPackageSet = new Set(catalogPackages);
  const unknownPackages = discoveredPackages.filter((packageId) => !catalogPackageSet.has(packageId));
  if (unknownPackages.length > 0) {
    throw new SpexCatalogError(
      `AI discovery returned package ids missing from catalog: ${unknownPackages.join(", ")}`,
    );
  }

  return discoveredPackages;
}

function createCommandExecutionError(
  message: string,
  details: Omit<CommandExecutionError, "name" | "message"> = {},
): CommandExecutionError {
  const error = new Error(message) as CommandExecutionError;
  Object.assign(error, details);
  return error;
}

function resolveCodexTimeoutMs(value: number | undefined): number {
  const timeoutMs = value ?? defaultCodexTimeoutMs;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new SpexCatalogError("Codex timeout must be a positive integer number of milliseconds.");
  }

  return timeoutMs;
}

function runCommand(
  file: string,
  args: string[],
  options: { cwd: string; maxBuffer: number; timeoutMs: number },
): Promise<ExecFileResult> {
  return new Promise((resolveCommand, rejectCommand) => {
    const child = spawn(file, args, {
      cwd: options.cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutLength = 0;
    let stderrLength = 0;
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      child.kill("SIGTERM");
      rejectCommand(
        createCommandExecutionError(`Command timed out after ${options.timeoutMs}ms`, {
          code: "ETIMEDOUT",
          killed: true,
          signal: "SIGTERM",
          stdout: Buffer.concat(stdoutChunks).toString("utf8"),
          stderr: Buffer.concat(stderrChunks).toString("utf8"),
        }),
      );
    }, options.timeoutMs);

    const rejectOnce = (error: CommandExecutionError): void => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      child.kill("SIGTERM");
      rejectCommand(error);
    };

    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutLength += chunk.length;
      if (stdoutLength > options.maxBuffer) {
        rejectOnce(
          createCommandExecutionError("stdout maxBuffer exceeded", {
            code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
          }),
        );
        return;
      }

      stdoutChunks.push(chunk);
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      stderrLength += chunk.length;
      if (stderrLength > options.maxBuffer) {
        rejectOnce(
          createCommandExecutionError("stderr maxBuffer exceeded", {
            code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
          }),
        );
        return;
      }

      stderrChunks.push(chunk);
    });

    child.on("error", (error: NodeJS.ErrnoException) => {
      rejectOnce(error);
    });

    child.on("close", (code, signal) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);

      const stdout = Buffer.concat(stdoutChunks).toString("utf8");
      const stderr = Buffer.concat(stderrChunks).toString("utf8");
      if (code === 0) {
        resolveCommand({ stdout, stderr });
        return;
      }

      rejectCommand(
        createCommandExecutionError(`Command failed with exit code ${code ?? signal ?? "unknown"}`, {
          code,
          signal,
          stdout,
          stderr,
        }),
      );
    });
  });
}

export class CatalogDiscoverAiService {
  private readonly catalogService: Pick<CatalogService, "list">;
  private readonly createInitService: (listener: InitServiceListener) => InitService;
  private readonly execFileRunner: ExecFileRunner;
  private readonly codexExecutable: string;
  private readonly codexTimeoutMs: number;
  private readonly logger: pino.Logger | undefined;

  constructor(
    private readonly listener: CatalogDiscoverAiServiceListener = {},
    dependencies: CatalogDiscoverAiServiceDependencies = {},
  ) {
    this.catalogService = dependencies.catalogService ?? new CatalogService();
    this.createInitService =
      dependencies.createInitService ?? ((initListener) => new InitService(initListener));
    this.execFileRunner = dependencies.execFileRunner ?? runCommand;
    this.codexExecutable =
      dependencies.codexExecutable ?? process.env.SPEX_CODEX_EXECUTABLE ?? defaultCodexExecutable;
    this.codexTimeoutMs = resolveCodexTimeoutMs(dependencies.codexTimeoutMs);
    this.logger = dependencies.logger;
  }

  async discover(input: CatalogDiscoverAiInput = {}): Promise<CatalogDiscoverAiResult> {
    const projectCwd = input.projectCwd ?? process.cwd();
    const catalogIndexCwd = input.catalogIndexCwd ?? process.cwd();
    const dryRun = input.dryRun ?? false;

    this.listener.onAiDiscoveryStarted?.(projectCwd);

    const catalogResult: CatalogListResult = await this.catalogService.list({ cwd: catalogIndexCwd, sort: "id" });
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

    this.logger?.debug(
      { command: this.codexExecutable, args: codexArgs, cwd: projectCwd },
      "Executing Codex command",
    );
    this.listener.onCodexStarted?.(this.codexExecutable, codexArgs, projectCwd);

    let commandOutput: ExecFileResult;
    try {
      commandOutput = await this.execFileRunner(this.codexExecutable, codexArgs, {
        cwd: projectCwd,
        maxBuffer: defaultMaxBuffer,
        timeoutMs: this.codexTimeoutMs,
      });
    } catch (error: unknown) {
      const nodeError = error as NodeJS.ErrnoException & { stderr?: string };
      if (nodeError.code === "ENOENT") {
        throw new SpexCatalogError(`Codex executable not found: ${this.codexExecutable}`);
      }

      if (nodeError.code === "ETIMEDOUT") {
        throw new SpexCatalogError(`AI discovery timed out after ${this.codexTimeoutMs}ms`);
      }

      const stderr = nodeError.stderr?.trim();
      const message = stderr || (error instanceof Error ? error.message : String(error));
      throw new SpexCatalogError(`AI discovery failed: ${message}`);
    }

    const discoveredPackages = parseDiscoveredPackages(commandOutput.stdout, catalogPackages);
    this.listener.onPackagesDiscovered?.(discoveredPackages);

    let initResult: InitServiceResult | undefined;
    if (!dryRun) {
      const initService = this.createInitService({
        onBuildFileCreated: (path: string): void => {
          this.listener.onBuildFileCreated?.(path);
        },
        onPackageAdded: (packageId: string, buildFilePath: string): void => {
          this.listener.onPackageAdded?.(packageId, buildFilePath);
        },
      });
      initResult = await initService.init({
        cwd: projectCwd,
        packages: new Set(discoveredPackages),
      });
    }

    const result: CatalogDiscoverAiResult = {
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
