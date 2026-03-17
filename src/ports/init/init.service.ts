export interface InitServiceInput {
  cwd?: string;
  packages?: string[];
}

export interface InitServiceResult {
  cwd: string;
  buildFilePath: string;
  createdBuildFile: boolean;
  addedPackages: string[];
  packages: string[];
}

export interface InitServiceListener {
  onInitStarted?(cwd: string): void;
  onBuildFileCreated?(path: string): void;
  onBuildFileDetected?(path: string): void;
  onPackageAdded?(packageId: string, buildFilePath: string): void;
  onInitFinished?(result: InitServiceResult): void;
}

export interface InitService {
  init(input?: InitServiceInput): Promise<InitServiceResult>;
}
