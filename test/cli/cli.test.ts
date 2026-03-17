import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import test from "node:test";
import packageJson from "../../package.json" with { type: "json" };

const execFileAsync = promisify(execFile);
const currentDirectoryPath = dirname(fileURLToPath(import.meta.url));
const cliPath = resolve(currentDirectoryPath, "..", "..", "src", "cli", "cli.js");
const expectedAgentsInstruction = `This project contains specifications of different types and instructions located in the following directories:
- \`spex/**/*.md\`
- \`.spex/imports/**/*.md\`

Depending on the instruction or specification type it will be located in a relevant subdirectory like \`adr\`, \`instruction\`, \`dataformat\`, \`feature\`, etc.

Please take these specifications under consideration when working with this project.

When in doubt, specifications in \`spex\` should take precedence over imported specifications in \`.spex/imports\`.
`;

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test("spex version prints the current package version outside the working directory", async () => {
  const projectPath = await mkdtemp(resolve(tmpdir(), "spex-cli-version-"));

  try {
    const packageVersion = packageJson.version.trim();

    const { stdout } = await execFileAsync(process.execPath, [cliPath, "version"], {
      cwd: projectPath,
      env: { ...process.env, CI: "1" },
      maxBuffer: 10 * 1024 * 1024,
    });

    assert.equal(typeof packageVersion, "string");
    assert.match(stdout, new RegExp(`OK version ${escapeForRegExp(packageVersion)}`));
  } finally {
    await rm(projectPath, { recursive: true, force: true });
  }
});

test("spex build does not require a local spex directory", async () => {
  const projectPath = await mkdtemp(resolve(tmpdir(), "spex-cli-build-"));

  try {
    await execFileAsync(process.execPath, [cliPath, "build"], {
      cwd: projectPath,
      env: { ...process.env, CI: "1" },
      maxBuffer: 10 * 1024 * 1024,
    });

    const agentsContent = await readFile(resolve(projectPath, "AGENTS.md"), "utf8");
    assert.equal(agentsContent, expectedAgentsInstruction);
  } finally {
    await rm(projectPath, { recursive: true, force: true });
  }
});

test("spex init creates an empty build file", async () => {
  const projectPath = await mkdtemp(resolve(tmpdir(), "spex-cli-init-"));

  try {
    const { stdout } = await execFileAsync(process.execPath, [cliPath, "init"], {
      cwd: projectPath,
      env: { ...process.env, CI: "1" },
      maxBuffer: 10 * 1024 * 1024,
    });

    assert.match(stdout, /OK init completed \(config created, 0 package\(s\) added\)/);
    assert.equal(await readFile(resolve(projectPath, ".spex", "spex.yml"), "utf8"), "");
  } finally {
    await rm(projectPath, { recursive: true, force: true });
  }
});

test("spex init adds packages from repeated --package options without duplicates", async () => {
  const projectPath = await mkdtemp(resolve(tmpdir(), "spex-cli-init-packages-"));

  try {
    await execFileAsync(
      process.execPath,
      [cliPath, "init", "--package", "acme/alpha", "--package", "acme/beta", "--package", "acme/beta"],
      {
        cwd: projectPath,
        env: { ...process.env, CI: "1" },
        maxBuffer: 10 * 1024 * 1024,
      },
    );

    const buildFileContent = await readFile(resolve(projectPath, ".spex", "spex.yml"), "utf8");

    assert.match(buildFileContent, /^packages:\n  - acme\/alpha\n  - acme\/beta\n$/);
  } finally {
    await rm(projectPath, { recursive: true, force: true });
  }
});

test("spex validate export validates exportable Spex packages", async () => {
  const projectPath = await mkdtemp(resolve(tmpdir(), "spex-cli-validate-export-"));

  try {
    const adrPath = resolve(projectPath, "spex", "adr");
    await mkdir(adrPath, { recursive: true });
    await writeFile(resolve(adrPath, "adr_0001.md"), "# ADR 0001\n", "utf8");

    const { stdout } = await execFileAsync(process.execPath, [cliPath, "validate", "export"], {
      cwd: projectPath,
      env: { ...process.env, CI: "1" },
      maxBuffer: 10 * 1024 * 1024,
    });

    assert.match(stdout, /OK valid spex structure \(adr\)/);
  } finally {
    await rm(projectPath, { recursive: true, force: true });
  }
});
