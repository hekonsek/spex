import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { parse as parseYaml } from "yaml";
import {
  CatalogService,
  catalogIndexCacheTtlMs,
  catalogIndexFileName,
  catalogIndexUrl,
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

function createCatalogIndexFetchResponse(content: string) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    async text(): Promise<string> {
      return content;
    },
  };
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

test("should emit package download events", { concurrency: false }, async () => {
  const catalogPath = await mkdtemp(resolve(tmpdir(), "spex-catalog-events-"));
  const homePath = await mkdtemp(resolve(tmpdir(), "spex-catalog-events-home-"));
  const repositoriesRootPath = await mkdtemp(resolve(tmpdir(), "spex-catalog-events-repositories-"));
  const previousHome = process.env.HOME;
  const startedDownloads: string[] = [];
  const completedDownloads: string[] = [];

  try {
    process.env.HOME = homePath;
    await configureGitHome(homePath, repositoriesRootPath);

    const firstPackageId = await createPackageRepository(repositoriesRootPath, "acme", "first-package", {
      "README.md": "# First Package\n",
    });
    const secondPackageId = await createPackageRepository(repositoriesRootPath, "acme", "second-package", {
      "README.md": "# Second Package\n",
    });

    await writeFile(
      resolve(catalogPath, catalogSpecificationFileName),
      `packages:\n  - ${firstPackageId}\n  - ${secondPackageId}\n`,
      "utf8",
    );

    const service = new CatalogService({
      onPackageDownload(packageId: string): void {
        startedDownloads.push(packageId);
      },
      onPackageDownloaded(packageId: string): void {
        completedDownloads.push(packageId);
      },
    });

    await service.build({ cwd: catalogPath });

    assert.deepEqual(startedDownloads, [firstPackageId, secondPackageId]);
    assert.deepEqual(completedDownloads, [firstPackageId, secondPackageId]);
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

test("catalog list downloads and caches default catalog index when cache is missing", async () => {
  const cachePath = await mkdtemp(resolve(tmpdir(), "spex-catalog-index-cache-"));
  const catalogIndexContent = `packages:
  - id: acme/node-cli
    name: Node CLI
    updated: 123
`;
  const requestedUrls: string[] = [];

  try {
    const service = new CatalogService({}, undefined, {
      catalogIndexCacheDirectoryPath: cachePath,
      fetch: async (url: string) => {
        requestedUrls.push(url);
        return createCatalogIndexFetchResponse(catalogIndexContent);
      },
    });

    const result = await service.list();

    assert.deepEqual(requestedUrls, [catalogIndexUrl]);
    assert.equal(result.cwd, cachePath);
    assert.equal(result.indexFilePath, resolve(cachePath, catalogIndexFileName));
    assert.deepEqual(result.packages, [{ id: "acme/node-cli", name: "Node CLI", updated: 123 }]);
    assert.equal(await readFile(resolve(cachePath, catalogIndexFileName), "utf8"), catalogIndexContent);
  } finally {
    await rm(cachePath, { recursive: true, force: true });
  }
});

test("catalog list returns stale cached index when background refresh fails", async () => {
  const cachePath = await mkdtemp(resolve(tmpdir(), "spex-catalog-index-stale-cache-"));
  const catalogIndexPath = resolve(cachePath, catalogIndexFileName);
  const catalogIndexContent = `packages:
  - id: acme/cached
    name: Cached
    updated: 456
`;
  let fetchCount = 0;

  try {
    await writeFile(catalogIndexPath, catalogIndexContent, "utf8");
    await utimes(catalogIndexPath, new Date(0), new Date(0));

    const service = new CatalogService({}, undefined, {
      catalogIndexCacheDirectoryPath: cachePath,
      now: () => catalogIndexCacheTtlMs + 1,
      fetch: async () => {
        fetchCount += 1;
        throw new Error("network unavailable");
      },
    });

    const result = await service.list();
    await new Promise((resolveBackgroundRefresh) => setImmediate(resolveBackgroundRefresh));

    assert.equal(fetchCount, 1);
    assert.deepEqual(result.packages, [{ id: "acme/cached", name: "Cached", updated: 456 }]);
  } finally {
    await rm(cachePath, { recursive: true, force: true });
  }
});

test("catalog list fails when default catalog index cannot be downloaded and cache is missing", async () => {
  const cachePath = await mkdtemp(resolve(tmpdir(), "spex-catalog-index-missing-cache-"));

  try {
    const service = new CatalogService({}, undefined, {
      catalogIndexCacheDirectoryPath: cachePath,
      fetch: async () => {
        throw new Error("network unavailable");
      },
    });

    await assert.rejects(
      () => service.list(),
      (error: unknown) =>
        error instanceof Error &&
        error.message ===
          `Unable to download catalog index from ${catalogIndexUrl}: network unavailable`,
    );
  } finally {
    await rm(cachePath, { recursive: true, force: true });
  }
});
