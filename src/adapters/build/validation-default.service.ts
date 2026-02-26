import { readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";
import type {
  SupportedSpexType,
  ValidateServiceResult,
  ValidatedType,
  ValidationService,
  ValidationServiceInput,
  ValidationServiceListener,
} from "../../ports/build/validation.service.js";

export type {
  SupportedSpexType,
  ValidateServiceResult,
  ValidatedType,
} from "../../ports/build/validation.service.js";

export const supportedSpexTypes = ["adr", "instruction", "dataformat", "feature"] as const;

export class SpexValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super("Spex structure validation failed.");
    this.name = "SpexValidationError";
  }
}

async function directoryExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch (error: unknown) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

export class DefaultValidationService implements ValidationService {
  constructor(private readonly listener: ValidationServiceListener = {}) {}

  async validate(input: ValidationServiceInput = {}): Promise<ValidateServiceResult> {
    const cwd = input.cwd ?? process.cwd();
    const spexPath = resolve(cwd, "spex");
    const issues: string[] = [];
    const validatedTypes: ValidatedType[] = [];

    this.listener.onValidationStarted?.(cwd);

    if (!(await directoryExists(spexPath))) {
      issues.push(`Missing spex directory: ${spexPath}`);
    }

    if (issues.length === 0) {
      const existingTypeDirectories: SupportedSpexType[] = [];

      for (const type of supportedSpexTypes) {
        const typePath = resolve(spexPath, type);
        if (await directoryExists(typePath)) {
          existingTypeDirectories.push(type);
        }
      }

      if (existingTypeDirectories.length === 0) {
        issues.push(
          "Missing supported type directory in spex. Expected at least one of: adr, instruction, dataformat, feature.",
        );
      }

      for (const type of existingTypeDirectories) {
        const typePath = resolve(spexPath, type);
        const entries = await readdir(typePath, { withFileTypes: true });
        const markdownFileCount = entries.filter(
          (entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".md"),
        ).length;

        this.listener.onTypeDirectoryValidated?.(type, markdownFileCount);

        if (entries.length === 0) {
          issues.push(`The spex/${type} directory must not be empty.`);
        }

        if (markdownFileCount === 0) {
          issues.push(`The spex/${type} directory must contain at least one .md file.`);
        }

        validatedTypes.push({
          type,
          path: typePath,
        });
      }
    }

    if (issues.length > 0) {
      throw new SpexValidationError(issues);
    }

    const result: ValidateServiceResult = {
      spexPath,
      validatedTypes,
    };

    this.listener.onValidationPassed?.(result);
    return result;
  }
}
