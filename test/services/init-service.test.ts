import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { parse as parseYaml } from "yaml";
import { InitService } from "../../src/services/init/InitService.js";

test("init should create an empty .spex/spex.yml file when config is missing", async () => {
  // Given
  const projectPath = await mkdtemp(resolve(tmpdir(), "spex-init-empty-"));
  const service = new InitService();

  // When
  const result = await service.init({ cwd: projectPath });

  // Then
  assert.equal(result.createdBuildFile, true);
  assert.equal(await readFile(resolve(projectPath, ".spex", "spex.yml"), "utf8"), "");
});

test("init should append missing packages without duplicating existing ones", async () => {
  // Given
  const projectPath = await mkdtemp(resolve(tmpdir(), "spex-init-packages-"));
  const buildFilePath = resolve(projectPath, ".spex", "spex.yml");

  await mkdir(resolve(projectPath, ".spex"), { recursive: true });
  await writeFile(
    buildFilePath,
    "export:\n  ignores:\n    - '**/*.pyc'\npackages:\n  - acme/alpha\n",
    "utf8",
  );

  const service = new InitService();

  // When
  const result = await service.init({
    cwd: projectPath,
    packages: new Set(["acme/alpha", "acme/beta", "acme/beta"]),
  });
  const buildFileContent = await readFile(buildFilePath, "utf8");
  const root = parseYaml(buildFileContent) as { export?: { ignores?: string[] }; packages?: string[] };

  // Then
  assert.equal(result.createdBuildFile, false);
  assert.deepEqual(result.addedPackages, ["acme/beta"]);
  assert.deepEqual(root.packages, ["acme/alpha", "acme/beta"]);
  assert.deepEqual(root.export?.ignores, ["**/*.pyc"]);
});
