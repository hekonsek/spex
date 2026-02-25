import { BuildService as CoreBuildService } from "../../core/build/build-service.js";
import { ValidateService } from "../../core/validate/validate-service.js";
class BuildValidationServiceAdapter {
    listener;
    constructor(listener) {
        this.listener = listener;
    }
    async run(input = {}) {
        const validateService = new ValidateService({
            onValidationStarted: (cwd) => this.listener.onValidationStarted?.(cwd),
            onTypeDirectoryValidated: (type, markdownFileCount) => this.listener.onTypeDirectoryValidated?.(type, markdownFileCount),
            onValidationPassed: (result) => this.listener.onValidationPassed?.(result),
        });
        return validateService.run(input);
    }
}
export class BuildService {
    listener;
    coreBuildService;
    constructor(listener = {}) {
        this.listener = listener;
        const validationService = new BuildValidationServiceAdapter(listener);
        this.coreBuildService = new CoreBuildService(listener, validationService);
    }
    async build(input = {}) {
        return this.coreBuildService.build(input);
    }
}
