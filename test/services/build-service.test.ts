import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { BuildService, spexAgentsInstruction } from "../../src/services/build/build-service.js";

const execFileAsync = promisify(execFile);
const gitTestHost = "git.example.test";
const expectedAgentsInstruction = spexAgentsInstruction;

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

async function writeProjectFixture(path: string, packageIds?: string[]): Promise<void> {
  await mkdir(resolve(path, "spex", "adr"), { recursive: true });
  await writeFile(resolve(path, "spex", "adr", "adr_0001.md"), "# ADR 0001\n", "utf8");

  if (!packageIds) {
    return;
  }

  await mkdir(resolve(path, ".spex"), { recursive: true });
  await writeFile(
    resolve(path, ".spex", "spex.yml"),
    `packages:\n${packageIds.map((packageId) => `  - ${packageId}`).join("\n")}\n`,
    "utf8",
  );
}

async function configureGitHome(homePath: string, repositoriesRootPath: string): Promise<void> {
  await mkdir(homePath, { recursive: true });
  await writeFile(
    resolve(homePath, ".gitconfig"),
    `[user]
  name = Spex Test
  email = spex@example.test
[init]
  defaultBranch = main
[protocol "file"]
  allow = always
[url "file://${repositoriesRootPath.replaceAll("\\", "/")}/"]
  insteadOf = https://${gitTestHost}/
`,
    "utf8",
  );
}

async function runGit(args: string[], cwd: string): Promise<void> {
  await execFileAsync("git", args, {
    cwd,
    maxBuffer: 10 * 1024 * 1024,
  });
}

interface PackageRepository {
  packageId: string;
  barePath: string;
  workPath: string;
}

async function createPackageRepository(
  repositoriesRootPath: string,
  namespace: string,
  name: string,
  files: Record<string, string>,
): Promise<PackageRepository> {
  const namespacePath = resolve(repositoriesRootPath, namespace);
  const barePath = resolve(namespacePath, `${name}.git`);
  const workPath = await mkdtemp(resolve(tmpdir(), `spex-package-${namespace}-${name}-`));

  await mkdir(namespacePath, { recursive: true });
  await runGit(["init", "--bare", barePath], repositoriesRootPath);
  await runGit(["clone", barePath, workPath], repositoriesRootPath);

  for (const [relativePath, content] of Object.entries(files)) {
    const filePath = resolve(workPath, relativePath);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, content, "utf8");
  }

  await runGit(["add", "."], workPath);
  await runGit(["commit", "-m", "Initial package commit"], workPath);
  await runGit(["push", "origin", "HEAD:main"], workPath);
  await runGit(["symbolic-ref", "HEAD", "refs/heads/main"], barePath);

  return {
    packageId: `${gitTestHost}/${namespace}/${name}`,
    barePath,
    workPath,
  };
}

async function updatePackageRepository(
  repository: PackageRepository,
  files: Record<string, string>,
): Promise<void> {
  for (const [relativePath, content] of Object.entries(files)) {
    const filePath = resolve(repository.workPath, relativePath);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, content, "utf8");
  }

  await runGit(["add", "."], repository.workPath);
  await runGit(["commit", "-m", "Update package contents"], repository.workPath);
  await runGit(["push", "origin", "HEAD:main"], repository.workPath);
}

test("build writes AGENTS.md and skips import cleanup when build file is missing", { concurrency: false }, async () => {
  const projectPath = await mkdtemp(resolve(tmpdir(), "spex-build-no-build-file-"));

  try {
    await writeProjectFixture(projectPath);
    await writeFile(resolve(projectPath, "AGENTS.md"), "obsolete\n", "utf8");
    await mkdir(resolve(projectPath, ".spex", "imports", "github.com", "acme", "pkg"), { recursive: true });
    await writeFile(
      resolve(projectPath, ".spex", "imports", "github.com", "acme", "pkg", "adr_0001.md"),
      "# Imported ADR\n",
      "utf8",
    );

    const service = new BuildService();

    const result = await service.build({ cwd: projectPath });
    const agentsContent = await readFile(resolve(projectPath, "AGENTS.md"), "utf8");

    assert.equal(agentsContent, expectedAgentsInstruction);
    assert.equal(result.importedPackages.length, 0);
    assert.equal(result.removedPackages.length, 0);
    assert.equal(
      await pathExists(resolve(projectPath, ".spex", "imports", "github.com", "acme", "pkg")),
      true,
    );
  } finally {
    await rm(projectPath, { recursive: true, force: true });
  }
});

test("build does not validate the local spex directory before writing AGENTS.md", async () => {
  const projectPath = await mkdtemp(resolve(tmpdir(), "spex-build-without-spex-"));

  try {
    const service = new BuildService();

    const result = await service.build({ cwd: projectPath });
    const agentsContent = await readFile(resolve(projectPath, "AGENTS.md"), "utf8");

    assert.equal(agentsContent, expectedAgentsInstruction);
    assert.equal(result.importedPackages.length, 0);
    assert.equal(result.removedPackages.length, 0);
  } finally {
    await rm(projectPath, { recursive: true, force: true });
  }
});

test("build refreshes imported packages and removes stale package directories", { concurrency: false }, async () => {
  const projectPath = await mkdtemp(resolve(tmpdir(), "spex-build-project-"));
  const homePath = await mkdtemp(resolve(tmpdir(), "spex-build-home-"));
  const repositoriesRootPath = await mkdtemp(resolve(tmpdir(), "spex-build-repositories-"));
  const previousHome = process.env.HOME;

  try {
    process.env.HOME = homePath;
    await configureGitHome(homePath, repositoriesRootPath);

    const packageOne = await createPackageRepository(repositoriesRootPath, "acme", "pkg-one", {
      "spex/adr/adr_0001.md": "# Package One v1\n",
    });
    const packageTwo = await createPackageRepository(repositoriesRootPath, "acme", "pkg-two", {
      "spex/instruction/instruction_0001.md": "# Package Two v1\n",
    });

    await writeProjectFixture(projectPath, [packageOne.packageId, packageTwo.packageId]);

    const service = new BuildService();
    const firstBuild = await service.build({ cwd: projectPath });

    assert.equal(firstBuild.importedPackages.length, 2);
    assert.equal(firstBuild.removedPackages.length, 0);
    assert.equal(
      await readFile(
        resolve(projectPath, ".spex", "imports", gitTestHost, "acme", "pkg-one", "adr", "adr_0001.md"),
        "utf8",
      ),
      "# Package One v1\n",
    );

    await updatePackageRepository(packageOne, {
      "spex/adr/adr_0001.md": "# Package One v2\n",
    });
    await writeProjectFixture(projectPath, [packageOne.packageId]);

    const secondBuild = await service.build({ cwd: projectPath });

    assert.equal(secondBuild.importedPackages.length, 1);
    assert.deepEqual(secondBuild.removedPackages, [
      {
        packageId: `${gitTestHost}/acme/pkg-two`,
        targetPath: resolve(projectPath, ".spex", "imports", gitTestHost, "acme", "pkg-two"),
      },
    ]);
    assert.equal(
      await readFile(
        resolve(projectPath, ".spex", "imports", gitTestHost, "acme", "pkg-one", "adr", "adr_0001.md"),
        "utf8",
      ),
      "# Package One v2\n",
    );
    assert.equal(
      await pathExists(resolve(projectPath, ".spex", "imports", gitTestHost, "acme", "pkg-two")),
      false,
    );
  } finally {
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }

    await rm(projectPath, { recursive: true, force: true });
    await rm(homePath, { recursive: true, force: true });
    await rm(repositoriesRootPath, { recursive: true, force: true });
  }
});
