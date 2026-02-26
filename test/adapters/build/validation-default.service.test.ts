import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { DefaultValidationService } from "../../../src/adapters/build/validation-default.service.js";

test("should pass validation", async () => {
  // Given
  const path = await mkdtemp(resolve(tmpdir(), "spex-validation-"));

  const spexPath = resolve(path, "spex");
  const adrPath = resolve(spexPath, "adr");

  await mkdir(adrPath, { recursive: true });
  await writeFile(resolve(adrPath, "adr_0001.md"), "# ADR 0001\n");

  const service = new DefaultValidationService();
  
  // When
  const result = await service.validate({ path });

  // Then
  assert.deepEqual(result, {
    spexPath,
    validatedTypes: [{ type: "adr", path: adrPath }],
  });
});
