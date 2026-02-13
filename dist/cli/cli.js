#!/usr/bin/env node
import chalk from "chalk";
import { Command } from "commander";
import ora from "ora";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BuildService } from "../core/build/build-service.js";
import { SpexValidationError, ValidateService, } from "../core/validate/validate-service.js";
import { VersionService, readPackageVersion } from "../core/version/version-service.js";
function isInteractive() {
    return Boolean(process.stdout.isTTY && process.stderr.isTTY && !process.env.CI);
}
function resolvePackageRootPath() {
    const cliFilePath = fileURLToPath(import.meta.url);
    const cliDirectoryPath = dirname(cliFilePath);
    return resolve(cliDirectoryPath, "..", "..");
}
const program = new Command();
program.name("spex");
program.description("AI-friendly project specifications");
program
    .command("version")
    .description("Print current project version")
    .action(async () => {
    const spinner = isInteractive() ? ora("Reading package version").start() : undefined;
    const service = new VersionService({
        onVersionResolved(version) {
            spinner?.succeed(chalk.green(`OK version ${version}`));
            if (!spinner) {
                console.log(chalk.green(`OK version ${version}`));
            }
        },
    });
    try {
        const version = await readPackageVersion(resolvePackageRootPath());
        service.run({ version });
    }
    catch (error) {
        spinner?.fail("Unable to read package version");
        const message = error instanceof Error ? error.message : String(error);
        console.error(chalk.red(`ERROR ${message}`));
        process.exitCode = 1;
    }
});
program
    .command("build")
    .description("Display build message")
    .action(() => {
    const service = new BuildService({
        onBuildStarted(message) {
            console.log(message);
        },
    });
    service.run();
});
program
    .command("validate")
    .description("Validate spex structure in current directory")
    .action(async () => {
    const spinner = isInteractive() ? ora("Validating spex structure").start() : undefined;
    const service = new ValidateService({
        onValidationStarted(cwd) {
            if (!spinner) {
                console.log(chalk.dim(`Checking ${cwd}`));
            }
        },
        onTypeDirectoryValidated(type, markdownFileCount) {
            if (spinner) {
                spinner.text = `Checked spex/${type}`;
                return;
            }
            console.log(chalk.dim(`Checked spex/${type}: ${markdownFileCount} markdown file(s)`));
        },
        onValidationPassed(result) {
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
    }
    catch (error) {
        spinner?.fail("Spex structure is invalid");
        if (error instanceof SpexValidationError) {
            for (const issue of error.issues) {
                console.error(chalk.red(`ERROR ${issue}`));
            }
        }
        else {
            const message = error instanceof Error ? error.message : String(error);
            console.error(chalk.red(`ERROR ${message}`));
        }
        process.exitCode = 1;
    }
});
await program.parseAsync(process.argv);
