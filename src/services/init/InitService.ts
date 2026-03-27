import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { BuildService } from "../build/build-service.js";

export interface InitServiceOptions {
  cwd?: string;
  packages?: string[];
}

export interface InitServiceResult {
  cwd: string;
  buildFilePath: string;
  createdBuildFile: boolean;
  addedPackages: string[];
  packages: Set<string>;
}

export interface InitServiceListener {
  onInitStarted?(cwd: string): void;
  onBuildFileCreated?(path: string): void;
  onBuildFileDetected?(path: string): void;
  onPackageAdded?(packageId: string, buildFilePath: string): void;
  onInitFinished?(result: InitServiceResult): void;
}

function parseStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
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

export class InitService {
  constructor(
    private readonly listener: InitServiceListener = {},
    private readonly buildService: BuildService = new BuildService(),
  ) {}

  async init(input: InitServiceOptions = {}): Promise<InitServiceResult> {
    const cwd = input.cwd ?? process.cwd();
    const requestedPackages = uniqueStrings(parseStringList(input.packages ?? []));
    const buildFileDirectoryPath = resolve(cwd, ".spex");

    this.listener.onInitStarted?.(cwd);

    const buildConfigResult = await this.buildService.readBuildConfig({ cwd });
    const buildFilePath = buildConfigResult.buildFilePath;
    const config = buildConfigResult.config;
    const packages = new Set(config.packages);
    const createdBuildFile = !buildConfigResult.exists;

    if (buildConfigResult.exists) {
      this.listener.onBuildFileDetected?.(buildFilePath);
    } else {
      await mkdir(buildFileDirectoryPath, { recursive: true });
      this.listener.onBuildFileCreated?.(buildFilePath);
      await writeFile(buildFilePath, "", "utf8");
    }

    const addedPackages: string[] = [];
    for (const packageId of requestedPackages) {
      if (packages.has(packageId)) {
        continue;
      }

      packages.add(packageId);
      addedPackages.push(packageId);
      this.listener.onPackageAdded?.(packageId, buildFilePath);
    }

    if (addedPackages.length > 0) {
      config.packages = [...packages];
      await this.buildService.writeBuildConfig(config, { cwd });
    }

    const result: InitServiceResult = {
      cwd,
      buildFilePath,
      createdBuildFile,
      addedPackages,
      packages,
    };

    this.listener.onInitFinished?.(result);

    return result;
  }
}
