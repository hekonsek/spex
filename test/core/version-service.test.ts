import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSONPath } from "jsonpath-plus";
import test from "node:test";
import { VersionService } from "../../src/core/version-service.js";

test("VersionService reads version from the current package", async () => {
  // Given
  const packageVersion = JSONPath<string>({
    path: "$.version",
    json: JSON.parse(await readFile("package.json", "utf8")),
    wrap: false,
  })?.trim();

  const service = new VersionService({
    onVersionResolved(version: string): void {},
  });

  // When
  const version = await service.currentPackageVersion();

  // Then
  assert.equal(version, packageVersion);
});
