import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import {
  SpexValidationError,
  ValidationService,
} from "../../../src/services/validation/validation-service.js";

test("should pass validation", async () => {
  // Given
  const path = await mkdtemp(resolve(tmpdir(), "spex-validation-"));

  const spexPath = resolve(path, "spex");
  const adrPath = resolve(spexPath, "adr");

  await mkdir(adrPath, { recursive: true });
  await writeFile(resolve(adrPath, "adr_0001.md"), "# ADR 0001\n");

  const service = new ValidationService();

  // When
  const result = await service.validate({ path });

  // Then
  assert.deepEqual(result, {
    spexPath,
    validatedTypes: [{ type: "adr", path: adrPath }],
  });
});

test("should pass validation for terraform specifications", async () => {
  // Given
  const path = await mkdtemp(resolve(tmpdir(), "spex-validation-terraform-"));

  const spexPath = resolve(path, "spex");
  const terraformPath = resolve(spexPath, "terraform");

  await mkdir(terraformPath, { recursive: true });
  await writeFile(resolve(terraformPath, "terraform_0001.md"), "# Terraform module\n");

  const service = new ValidationService();

  // When
  const result = await service.validate({ path });

  // Then
  assert.deepEqual(result, {
    spexPath,
    validatedTypes: [{ type: "terraform", path: terraformPath }],
  });
});

test("should include terraform in missing supported type directory error", async () => {
  // Given
  const path = await mkdtemp(resolve(tmpdir(), "spex-validation-empty-"));
  await mkdir(resolve(path, "spex"), { recursive: true });

  const service = new ValidationService();

  // When
  await assert.rejects(
    service.validate({ path }),
    (error: unknown): boolean => {
      assert.ok(error instanceof SpexValidationError);
      assert.deepEqual(error.issues, [
        "Missing supported type directory in spex. Expected at least one of: adr, instruction, dataformat, feature, terraform.",
      ]);
      return true;
    },
  );
});
