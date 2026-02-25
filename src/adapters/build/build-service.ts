import { BuildService as CoreBuildService } from "../../core/build/build-service.js";
import { ValidateService } from "../../core/validate/validate-service.js";
import type {
  BuildService as BuildServicePort,
  BuildServiceInput,
  BuildServiceListener,
  BuildServiceResult,
} from "../../ports/build/build.service.js";
import type {
  ValidateServiceResult,
  ValidationServiceListener,
  ValidationService as ValidationServicePort,
  ValidationServiceInput,
} from "../../ports/build/validation.service.js";

class BuildValidationServiceAdapter implements ValidationServicePort {
  constructor(private readonly listener: ValidationServiceListener) {}

  async run(input: ValidationServiceInput = {}): Promise<ValidateServiceResult> {
    const validateService = new ValidateService({
      onValidationStarted: (cwd: string): void => this.listener.onValidationStarted?.(cwd),
      onTypeDirectoryValidated: (type, markdownFileCount): void =>
        this.listener.onTypeDirectoryValidated?.(type, markdownFileCount),
      onValidationPassed: (result): void => this.listener.onValidationPassed?.(result),
    });

    return validateService.run(input);
  }
}

export class BuildService implements BuildServicePort {
  private readonly coreBuildService: CoreBuildService;

  constructor(
    private readonly listener: BuildServiceListener & ValidationServiceListener = {},
  ) {
    const validationService = new BuildValidationServiceAdapter(listener);
    this.coreBuildService = new CoreBuildService(listener, validationService);
  }

  async build(input: BuildServiceInput = {}): Promise<BuildServiceResult> {
    return this.coreBuildService.build(input);
  }
}
