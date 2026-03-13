export interface BuildServiceInput {
  cwd?: string;
}

export interface ImportedSpexPackage {
  packageId: string;
  sourceUrl: string;
  targetPath: string;
}

export interface RemovedSpexPackage {
  packageId: string;
  targetPath: string;
}

export interface BuildServiceResult {
  cwd: string;
  agentsFilePath: string;
  buildFilePath: string;
  importedPackages: ImportedSpexPackage[];
  removedPackages: RemovedSpexPackage[];
}

export interface BuildServiceListener {
  onBuildStarted?(cwd: string): void;
  onAgentsFileWritten?(path: string): void;
  onBuildFileDetected?(path: string): void;
  onBuildFileMissing?(path: string): void;
  onBuildPackagesResolved?(packageIds: string[]): void;
  onPackageImportStarted?(packageId: string, sourceUrl: string, targetPath: string): void;
  onPackageImported?(importedPackage: ImportedSpexPackage): void;
  onStalePackageRemovalStarted?(removedPackage: RemovedSpexPackage): void;
  onStalePackageRemoved?(removedPackage: RemovedSpexPackage): void;
  onBuildFinished?(result: BuildServiceResult): void;
}

export interface BuildService {
  build(input?: BuildServiceInput): Promise<BuildServiceResult>;
}
