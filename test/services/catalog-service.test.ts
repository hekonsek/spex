import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { parse as parseYaml } from "yaml";
import {
  CatalogService,
  catalogIndexFileName,
  catalogSpecificationFileName,
} from "../../src/services/catalog/catalog-service.js";

const execFileAsync = promisify(execFile);
const gitTestHost = "git.example.test";

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

async function createPackageRepository(
  repositoriesRootPath: string,
  namespace: string,
  name: string,
  files: Record<string, string>,
): Promise<string> {
  const namespacePath = resolve(repositoriesRootPath, namespace);
  const barePath = resolve(namespacePath, `${name}.git`);
  const workPath = await mkdtemp(resolve(tmpdir(), `spex-catalog-package-${namespace}-${name}-`));

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

  return `${gitTestHost}/${namespace}/${name}`;
}

test("should build catalog", { concurrency: false }, async () => {
  const catalogPath = await mkdtemp(resolve(tmpdir(), "spex-catalog-"));
  const homePath = await mkdtemp(resolve(tmpdir(), "spex-catalog-home-"));
  const repositoriesRootPath = await mkdtemp(resolve(tmpdir(), "spex-catalog-repositories-"));
  const previousHome = process.env.HOME;

  try {
    process.env.HOME = homePath;
    await configureGitHome(homePath, repositoriesRootPath);

    const packageId = await createPackageRepository(repositoriesRootPath, "acme", "catalog-package", {
      "README.md": "# Catalog Package\n",
    });

    await writeFile(
      resolve(catalogPath, catalogSpecificationFileName),
      `packages:\n  - ${packageId}\n`,
      "utf8",
    );

    const service = new CatalogService();

    const result = await service.build({ cwd: catalogPath });
    const indexContent = await readFile(resolve(catalogPath, catalogIndexFileName), "utf8");
    const index = parseYaml(indexContent) as { packages?: Array<{ id: string; name: string; updated: number }> };

    assert.equal(result.specificationFilePath, resolve(catalogPath, catalogSpecificationFileName));
    assert.equal(result.indexFilePath, resolve(catalogPath, catalogIndexFileName));
    assert.equal(result.packages.length, 1);
    assert.equal(result.packages[0]?.id, packageId);
    assert.equal(result.packages[0]?.name, "Catalog Package");
    assert.equal(typeof result.packages[0]?.updated, "number");
    assert.ok((result.packages[0]?.updated ?? 0) > 0);
    assert.deepEqual(index.packages, result.packages);
  } finally {
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }

    await rm(catalogPath, { recursive: true, force: true });
    await rm(homePath, { recursive: true, force: true });
    await rm(repositoriesRootPath, { recursive: true, force: true });
  }
});
