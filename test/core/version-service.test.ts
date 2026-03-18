import assert from "node:assert/strict";
import packageJson from "../../package.json" with { type: "json" };
import test from "node:test";
import { VersionService } from "../../src/core/version-service.js";

test("VersionService reads version from the current package", async () => {
  // Given
  const packageVersion = packageJson.version
  const service = new VersionService()

  // When
  const version = await service.currentPackageVersion()

  // Then
  assert.equal(version, packageVersion)
})