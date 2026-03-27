import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { CatalogDiscoverAiService } from "../../src/services/catalog/catalog-discover-ai-service.js";
import { SpexCatalogError, type CatalogPackageEntry } from "../../src/services/catalog/catalog-service.js";

function catalogPackage(id: string, name: string): CatalogPackageEntry {
  return { id, name, updated: 0 };
}

test("discover-ai builds prompt, validates AI result, and initializes project", async () => {
  const projectPath = await mkdtemp(resolve(tmpdir(), "spex-discover-ai-service-"));
  const observedCommands: Array<{ file: string; args: string[]; cwd: string }> = [];

  try {
    const service = new CatalogDiscoverAiService(
      {},
      {
        catalogService: {
          async list() {
            return {
              cwd: "/catalog",
              indexFilePath: "/catalog/spex-catalog-index.yml",
              packages: [
                catalogPackage("acme/node-cli", "Node CLI"),
                catalogPackage("acme/kafka", "Kafka"),
              ],
            };
          },
        },
        execFileRunner: async (file, args, options) => {
          observedCommands.push({ file, args, cwd: options.cwd });
          return {
            stdout: '["acme/node-cli"]\n',
            stderr: "",
          };
        },
        codexExecutable: "/test/bin/codex",
      },
    );

    const result = await service.discover({
      projectCwd: projectPath,
      catalogIndexCwd: "/catalog",
      description: "Node CLI for browsing Kafka topics",
    });

    assert.equal(observedCommands.length, 1);
    assert.equal(observedCommands[0]?.file, "/test/bin/codex");
    assert.equal(observedCommands[0]?.cwd, projectPath);
    assert.deepEqual(observedCommands[0]?.args.slice(0, 8), [
      "exec",
      "--skip-git-repo-check",
      "-m",
      "gpt-5.4-mini",
      "-c",
      'model_reasoning_effort="low"',
      "--color",
      "never",
    ]);
    assert.match(observedCommands[0]?.args[8] ?? "", /Additional project description: Node CLI for browsing Kafka topics/);
    assert.match(observedCommands[0]?.args[8] ?? "", /- acme\/node-cli: Node CLI/);
    assert.match(observedCommands[0]?.args[8] ?? "", /- acme\/kafka: Kafka/);

    assert.deepEqual(result.discoveredPackages, ["acme/node-cli"]);
    assert.deepEqual(result.addedPackages, ["acme/node-cli"]);
    assert.equal(result.createdBuildFile, true);
    assert.equal(
      await readFile(resolve(projectPath, ".spex", "spex.yml"), "utf8"),
      "packages:\n  - acme/node-cli\n",
    );
  } finally {
    await rm(projectPath, { recursive: true, force: true });
  }
});

test("discover-ai rejects package ids missing from catalog", async () => {
  const projectPath = await mkdtemp(resolve(tmpdir(), "spex-discover-ai-invalid-"));

  try {
    const service = new CatalogDiscoverAiService(
      {},
      {
        catalogService: {
          async list() {
            return {
              cwd: "/catalog",
              indexFilePath: "/catalog/spex-catalog-index.yml",
              packages: [catalogPackage("acme/node-cli", "Node CLI")],
            };
          },
        },
        execFileRunner: async () => ({
          stdout: '["acme/missing"]\n',
          stderr: "",
        }),
      },
    );

    await assert.rejects(
      () => service.discover({ projectCwd: projectPath, catalogIndexCwd: "/catalog" }),
      (error: unknown) =>
        error instanceof SpexCatalogError &&
        error.message === "AI discovery returned package ids missing from catalog: acme/missing",
    );
  } finally {
    await rm(projectPath, { recursive: true, force: true });
  }
});
