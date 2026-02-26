#!/usr/bin/env node
import chalk from "chalk";
import { Command } from "commander";
import ora from "ora";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { DefaultBuildService } from "../adapters/build/build-default.service.js";
import { DefaultValidationService, SpexValidationError, } from "../adapters/build/validation-default.service.js";
import { CatalogBuildService, SpexCatalogBuildError, } from "../core/catalog/build-service.js";
import { CatalogDiscoverService, SpexCatalogDiscoverError, } from "../core/catalog/discover-service.js";
import { VersionService, readPackageVersion } from "../core/version/version-service.js";
function isInteractive() {
    return Boolean(process.stdout.isTTY && process.stderr.isTTY && !process.env.CI);
}
function resolvePackageRootPath() {
    const cliFilePath = fileURLToPath(import.meta.url);
    const cliDirectoryPath = dirname(cliFilePath);
    return resolve(cliDirectoryPath, "..", "..");
}
function startInterruptibleSpinner(text) {
    if (!isInteractive()) {
        return { dispose: () => { } };
    }
    const spinner = ora({ text, discardStdin: false }).start();
    const onSigint = () => {
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
    .action(async () => {
    const { spinner, dispose } = startInterruptibleSpinner("Reading package version");
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
    finally {
        dispose();
    }
});
program
    .command("build")
    .description("Prepare current project to work with Spex")
    .action(async () => {
    const { spinner, dispose } = startInterruptibleSpinner("Preparing Spex project");
    const service = new DefaultBuildService({
        onBuildStarted(cwd) {
            if (!spinner) {
                console.log(chalk.dim(`Building Spex project in ${cwd}`));
            }
        },
        onValidationStarted() {
            if (spinner) {
                spinner.text = "Validating spex structure";
            }
        },
        onTypeDirectoryValidated(type, markdownFileCount) {
            if (spinner) {
                spinner.text = `Validated spex/${type}`;
                return;
            }
            console.log(chalk.dim(`Validated spex/${type}: ${markdownFileCount} markdown file(s)`));
        },
        onAgentsFileWritten(path) {
            if (spinner) {
                spinner.text = "Checking .spex/spex.yml";
                return;
            }
            console.log(chalk.dim(`Wrote ${path}`));
        },
        onBuildFileDetected(path) {
            if (spinner) {
                spinner.text = "Reading .spex/spex.yml";
                return;
            }
            console.log(chalk.dim(`Found ${path}`));
        },
        onBuildFileMissing(path) {
            if (!spinner) {
                console.log(chalk.dim(`No build file found at ${path}; skipping package imports.`));
            }
        },
        onBuildPackagesResolved(packageIds) {
            if (!spinner) {
                console.log(chalk.dim(`Packages to import: ${packageIds.length}`));
            }
        },
        onPackageImportStarted(packageId, sourceUrl, targetPath) {
            if (spinner) {
                spinner.text = `Importing ${packageId}`;
                return;
            }
            console.log(chalk.dim(`Importing ${packageId} from ${sourceUrl} to ${targetPath}`));
        },
        onPackageImported(importedPackage) {
            if (!spinner) {
                console.log(chalk.green(`OK imported ${importedPackage.packageId}`));
            }
        },
        onBuildFinished(result) {
            const summary = `OK build completed (${result.importedPackages.length} package(s) imported)`;
            spinner?.succeed(chalk.green(summary));
            if (!spinner) {
                console.log(chalk.green(summary));
            }
        },
    });
    try {
        await service.build({ cwd: process.cwd() });
    }
    catch (error) {
        spinner?.fail("Build failed");
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
    finally {
        dispose();
    }
});
program
    .command("validate")
    .description("Validate spex structure in current directory")
    .action(async () => {
    const { spinner, dispose } = startInterruptibleSpinner("Validating spex structure");
    const service = new DefaultValidationService({
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
    });
    try {
        const result = await service.validate({ path: process.cwd() });
        const validatedTypeNames = result.validatedTypes.map(({ type }) => type).join(", ");
        const message = `OK valid spex structure (${validatedTypeNames})`;
        spinner?.succeed(chalk.green(message));
        if (!spinner) {
            console.log(chalk.green(message));
        }
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
    finally {
        dispose();
    }
});
const catalogProgram = program.command("catalog").description("Work with Spex catalogs");
catalogProgram
    .command("build")
    .description("Build catalog index from spex-catalog.yml")
    .action(async () => {
    const { spinner, dispose } = startInterruptibleSpinner("Building catalog index");
    const service = new CatalogBuildService({
        onCatalogBuildStarted(cwd) {
            if (!spinner) {
                console.log(chalk.dim(`Building catalog index in ${cwd}`));
            }
        },
        onCatalogSpecificationReading(path) {
            if (spinner) {
                spinner.text = "Reading spex-catalog.yml";
                return;
            }
            console.log(chalk.dim(`Reading ${path}`));
        },
        onCatalogSpecificationRead(path, packageCount) {
            if (!spinner) {
                console.log(chalk.dim(`Loaded ${packageCount} package(s) from ${path}`));
            }
        },
        onCatalogIndexWriting(path) {
            if (spinner) {
                spinner.text = "Writing spex-catalog-index.yml";
                return;
            }
            console.log(chalk.dim(`Writing ${path}`));
        },
        onCatalogIndexWritten(path) {
            if (!spinner) {
                console.log(chalk.dim(`Wrote ${path}`));
            }
        },
        onCatalogBuildFinished(result) {
            const message = `OK catalog index built (${result.packages.length} package(s))`;
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
        spinner?.fail("Catalog build failed");
        if (error instanceof SpexCatalogBuildError) {
            console.error(chalk.red(`ERROR ${error.message}`));
        }
        else {
            const message = error instanceof Error ? error.message : String(error);
            console.error(chalk.red(`ERROR ${message}`));
        }
        process.exitCode = 1;
    }
    finally {
        dispose();
    }
});
catalogProgram
    .command("discover")
    .description("Discover and add catalog packages to .spex/spex.yml")
    .action(async () => {
    const service = new CatalogDiscoverService({
        onBuildFileCreated(path) {
            console.log(chalk.dim(`Created ${path}`));
        },
        onPackageAdded(packageId, buildFilePath) {
            console.log(chalk.green(`OK added ${packageId} to ${buildFilePath}`));
        },
    });
    try {
        let state = await service.run({
            projectCwd: process.cwd(),
            catalogIndexCwd: resolvePackageRootPath(),
        });
        const readline = createInterface({
            input: process.stdin,
            output: process.stdout,
        });
        try {
            while (true) {
                if (state.availablePackages.length === 0) {
                    console.log(chalk.green("OK no catalog packages left to import"));
                    break;
                }
                console.log(chalk.dim(`Catalog: ${state.catalogIndexFilePath}`));
                console.log(chalk.dim(`Config: ${state.buildFilePath}`));
                for (const [index, catalogPackage] of state.availablePackageEntries.entries()) {
                    console.log(`${chalk.cyan(`${index + 1}.`)} ${catalogPackage.name} ${chalk.gray(`(${catalogPackage.id})`)}`);
                }
                const answer = (await readline.question("Select package number (Enter to finish): ")).trim();
                if (!answer) {
                    break;
                }
                if (!/^\d+$/.test(answer)) {
                    console.error(chalk.red("ERROR Invalid selection, enter a package number."));
                    continue;
                }
                const selectedIndex = Number.parseInt(answer, 10) - 1;
                const selectedPackage = state.availablePackageEntries[selectedIndex];
                if (!selectedPackage) {
                    console.error(chalk.red("ERROR Selection is out of range."));
                    continue;
                }
                state = await service.addPackage({
                    projectCwd: process.cwd(),
                    catalogIndexCwd: resolvePackageRootPath(),
                    packageId: selectedPackage.id,
                });
            }
        }
        finally {
            readline.close();
        }
    }
    catch (error) {
        if (error instanceof SpexCatalogDiscoverError) {
            console.error(chalk.red(`ERROR ${error.message}`));
        }
        else {
            const message = error instanceof Error ? error.message : String(error);
            console.error(chalk.red(`ERROR ${message}`));
        }
        process.exitCode = 1;
    }
});
await program.parseAsync(process.argv);
