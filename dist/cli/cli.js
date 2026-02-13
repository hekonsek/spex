#!/usr/bin/env node
import chalk from "chalk";
import { Command } from "commander";
import ora from "ora";
import { BuildService } from "../core/build/build-service.js";
import { VersionService, readPackageVersion } from "../core/version/version-service.js";
function isInteractive() {
    return Boolean(process.stdout.isTTY && process.stderr.isTTY && !process.env.CI);
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
        const version = await readPackageVersion();
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
await program.parseAsync(process.argv);
