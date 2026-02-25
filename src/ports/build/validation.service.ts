export type SupportedSpexType = "adr" | "instruction" | "dataformat" | "feature";

export interface ValidatedType {
  type: SupportedSpexType;
  path: string;
}

export interface ValidateServiceResult {
  spexPath: string;
  validatedTypes: ValidatedType[];
}

export interface ValidationServiceInput {
  cwd?: string;
}

export interface ValidationServiceListener {
  onValidationStarted?(cwd: string): void;
  onTypeDirectoryValidated?(type: SupportedSpexType, markdownFileCount: number): void;
  onValidationPassed?(result: ValidateServiceResult): void;
}

export interface ValidationService {
  run(input?: ValidationServiceInput): Promise<ValidateServiceResult>;
}
