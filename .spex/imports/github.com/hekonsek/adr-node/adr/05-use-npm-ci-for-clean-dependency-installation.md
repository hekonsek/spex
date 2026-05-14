# Use `npm ci` for clean dependency installation

## Context

We are building Node.js applications, libraries, and CLI tooling that depend on npm packages.

Every project needs a basic workflow that validates whether dependencies can be installed from a clean checkout. This workflow should be reliable in CI and easy to run locally before publishing or merging changes.

Using `npm install` for this purpose can produce different dependency trees over time because it may update `package-lock.json`. That makes validation less reproducible and can hide problems that only appear when the project is installed exactly as committed.

We want a default dependency installation workflow that:

- installs dependencies from the committed lockfile
- fails when `package.json` and `package-lock.json` disagree
- avoids modifying dependency metadata during validation
- works consistently in CI and local clean-checkout checks
- provides a simple baseline before running build, test, lint, or packaging checks

## Decision

We will use `npm ci` as the default workflow for clean dependency installation in npm-based Node.js projects.

Every project that uses npm dependencies should commit `package-lock.json` and should be installable with:

```sh
npm ci
```

CI pipelines should use `npm ci` instead of `npm install` when preparing the project for validation.

Example GitHub Actions workflow:

```yaml
name: Install

on:
  pull_request:
  push:
    branches:
      - main

jobs:
  install:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v6

      - uses: actions/setup-node@v6
        with:
          node-version: 24
          cache: npm

      - run: npm ci
```

Additional checks such as build, tests, linting, formatting, type checking, packaging, or security scanning should be layered on top of this dependency installation step.

Developers should use `npm install` when intentionally changing dependencies and updating `package-lock.json`. They should use `npm ci` when verifying that the committed dependency graph can be restored cleanly.

## Consequences

Positive:

- CI installs dependencies from the exact committed lockfile
- Dependency drift is detected earlier
- Validation does not modify `package-lock.json`
- Clean-checkout failures are easier to reproduce locally
- Follow-up validation workflows start from a predictable dependency state

Negative:

- Projects must keep `package-lock.json` committed and up to date
- `npm ci` removes `node_modules`, which can be slower for local incremental work
- Dependency changes require an explicit `npm install` step before validation
- Projects using another package manager need an equivalent clean-install command instead

## Alternatives Considered

- **Use `npm install` in CI**. This installs dependencies, but it can update lockfile state and is less strict about validating that committed dependency metadata is consistent.

- **Rely on cached `node_modules` only**. This can speed up builds, but it does not prove that dependencies can be restored from the committed lockfile.

- **Use package-manager-specific alternatives such as `pnpm install --frozen-lockfile` or `yarn install --immutable`**. These are good equivalents for projects that standardize on pnpm or Yarn, but npm-based projects should use the built-in clean-install workflow.
