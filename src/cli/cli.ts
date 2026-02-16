#!/usr/bin/env node
import chalk from "chalk";
import { Command } from "commander";
import ora, { type Ora } from "ora";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BuildService } from "../core/build/build-service.js";
import {
  SpexValidationError,
  type SupportedSpexType,
  ValidateService,
} from "../core/validate/validate-service.js";
import { VersionService, readPackageVersion } from "../core/version/version-service.js";

function isInteractive(): boolean {
  return Boolean(process.stdout.isTTY && process.stderr.isTTY && !process.env.CI);
}

function resolvePackageRootPath(): string {
  const cliFilePath = fileURLToPath(import.meta.url);
  const cliDirectoryPath = dirname(cliFilePath);
  return resolve(cliDirectoryPath, "..", "..");
}

function startInterruptibleSpinner(text: string): { spinner?: Ora; dispose: () => void } {
  if (!isInteractive()) {
    return { dispose: () => {} };
  }

  const spinner = ora({ text, discardStdin: false }).start();
  const onSigint = (): void => {
    spinner.stop();
    process.off("SIGINT", onSigint);
    process.exit(130);
  };

  process.on("SIGINT", onSigint);

  return {
    spinner,
    dispose: () => {
      process.off("SIGINT", onSigint);
    },
  };
}

const program = new Command();
program.name("spex");
program.description("AI-friendly project specifications");

program
  .command("version")
  .description("Print current project version")
  .action(async (): Promise<void> => {
    const { spinner, dispose } = startInterruptibleSpinner("Reading package version");

    const service = new VersionService({
      onVersionResolved(version: string): void {
        spinner?.succeed(chalk.green(`OK version ${version}`));
        if (!spinner) {
          console.log(chalk.green(`OK version ${version}`));
        }
      },
    });

    try {
      const version = await readPackageVersion(resolvePackageRootPath());
      service.run({ version });
    } catch (error: unknown) {
      spinner?.fail("Unable to read package version");
      const message = error instanceof Error ? error.message : String(error);
      console.error(chalk.red(`ERROR ${message}`));
      process.exitCode = 1;
    } finally {
      dispose();
    }
  });

program
  .command("build")
  .description("Prepare current project to work with Spex")
  .action(async (): Promise<void> => {
    const { spinner, dispose } = startInterruptibleSpinner("Preparing Spex project");

    const service = new BuildService({
      onBuildStarted(cwd: string): void {
        if (!spinner) {
          console.log(chalk.dim(`Building Spex project in ${cwd}`));
        }
      },
      onValidationStarted(): void {
        if (spinner) {
          spinner.text = "Validating spex structure";
        }
      },
      onTypeDirectoryValidated(type: SupportedSpexType, markdownFileCount: number): void {
        if (spinner) {
          spinner.text = `Validated spex/${type}`;
          return;
        }

        console.log(chalk.dim(`Validated spex/${type}: ${markdownFileCount} markdown file(s)`));
      },
      onValidationPassed(): void {
        if (spinner) {
          spinner.text = "Writing AGENTS.md";
        }
      },
      onAgentsFileWritten(path: string): void {
        if (spinner) {
          spinner.text = "Checking .spex/spex.yml";
          return;
        }

        console.log(chalk.dim(`Wrote ${path}`));
      },
      onBuildFileDetected(path: string): void {
        if (spinner) {
          spinner.text = "Reading .spex/spex.yml";
          return;
        }

        console.log(chalk.dim(`Found ${path}`));
      },
      onBuildFileMissing(path: string): void {
        if (!spinner) {
          console.log(chalk.dim(`No build file found at ${path}; skipping package imports.`));
        }
      },
      onBuildPackagesResolved(packageIds: string[]): void {
        if (!spinner) {
          console.log(chalk.dim(`Packages to import: ${packageIds.length}`));
        }
      },
      onPackageImportStarted(packageId: string, sourceUrl: string, targetPath: string): void {
        if (spinner) {
          spinner.text = `Importing ${packageId}`;
          return;
        }

        console.log(chalk.dim(`Importing ${packageId} from ${sourceUrl} to ${targetPath}`));
      },
      onPackageImported(importedPackage): void {
        if (!spinner) {
          console.log(chalk.green(`OK imported ${importedPackage.packageId}`));
        }
      },
      onBuildFinished(result): void {
        const summary = `OK build completed (${result.importedPackages.length} package(s) imported)`;
        spinner?.succeed(chalk.green(summary));
        if (!spinner) {
          console.log(chalk.green(summary));
        }
      },
    });

    try {
      await service.run({ cwd: process.cwd() });
    } catch (error: unknown) {
      spinner?.fail("Build failed");

      if (error instanceof SpexValidationError) {
        for (const issue of error.issues) {
          console.error(chalk.red(`ERROR ${issue}`));
        }
      } else {
        const message = error instanceof Error ? error.message : String(error);
        console.error(chalk.red(`ERROR ${message}`));
      }

      process.exitCode = 1;
    } finally {
      dispose();
    }
  });

program
  .command("validate")
  .description("Validate spex structure in current directory")
  .action(async (): Promise<void> => {
    const { spinner, dispose } = startInterruptibleSpinner("Validating spex structure");

    const service = new ValidateService({
      onValidationStarted(cwd: string): void {
        if (!spinner) {
          console.log(chalk.dim(`Checking ${cwd}`));
        }
      },
      onTypeDirectoryValidated(type: SupportedSpexType, markdownFileCount: number): void {
        if (spinner) {
          spinner.text = `Checked spex/${type}`;
          return;
        }

        console.log(chalk.dim(`Checked spex/${type}: ${markdownFileCount} markdown file(s)`));
      },
      onValidationPassed(result): void {
        const validatedTypeNames = result.validatedTypes.map(({ type }) => type).join(", ");
        const message = `OK valid spex structure (${validatedTypeNames})`;
        spinner?.succeed(chalk.green(message));
        if (!spinner) {
          console.log(chalk.green(message));
        }
      },
    });

    try {
      await service.run({ cwd: process.cwd() });
    } catch (error: unknown) {
      spinner?.fail("Spex structure is invalid");

      if (error instanceof SpexValidationError) {
        for (const issue of error.issues) {
          console.error(chalk.red(`ERROR ${issue}`));
        }
      } else {
        const message = error instanceof Error ? error.message : String(error);
        console.error(chalk.red(`ERROR ${message}`));
      }

      process.exitCode = 1;
    } finally {
      dispose();
    }
  });

await program.parseAsync(process.argv);
