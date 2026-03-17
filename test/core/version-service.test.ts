import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { VersionService } from "../../src/core/version-service.js";

test("VersionService reads version from the current package", async () => {
  // Given
  const currentDirectoryPath = dirname(fileURLToPath(import.meta.url));
  const packageJsonPath = resolve(currentDirectoryPath, "..", "..", "package.json");
  const packageJsonContent = await readFile(packageJsonPath, "utf8");
  const { version: packageVersionValue } = JSON.parse(packageJsonContent) as { version: string };
  const packageVersion = packageVersionValue.trim();

  const service = new VersionService({
    onVersionResolved(version: string): void {},
  });

  // When
  const version = await service.run();

  // Then
  assert.equal(version, packageVersion);
});
