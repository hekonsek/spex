export interface ValidationService {
  validate(options?: ValidationOptions): Promise<ValidateServiceResult>;
}

export interface ValidationOptions {
  path?: string;
}

export interface ValidationServiceListener {
  onValidationStarted?(path: string): void;
  onTypeDirectoryValidated?(type: SupportedSpexType, markdownFileCount: number): void;
  onValidationPassed?(result: ValidateServiceResult): void;
}

export type SupportedSpexType = "adr" | "instruction" | "dataformat" | "feature";

export interface ValidatedType {
  type: SupportedSpexType;
  path: string;
}

export interface ValidateServiceResult {
  spexPath: string;
  validatedTypes: ValidatedType[];
}