# Use `npm run build` for build validation

## Context

We are building Node.js applications, libraries, and CLI tooling that may require compilation, bundling, code generation, or other preparation before runtime or publishing.

Different projects may build in different ways. A TypeScript library may run `tsc`, a web application may run a bundler, and a CLI may compile sources before packaging. Without a common command, CI pipelines and contributor workflows need project-specific knowledge to validate whether the project builds.

We want a default build validation workflow that:

- exposes one stable command for building the project
- keeps CI configuration independent from the underlying build tool
- makes local validation easy for contributors
- fails before tests or publishing when generated runtime artifacts cannot be produced
- works consistently across application, library, and CLI projects

## Decision

We will use `npm run build` as the default command for validating that an npm-based Node.js project can be built.

`npm run build` is a common convention in npm projects. Using that convention makes the build workflow predictable for contributors, CI systems, and external automation.

Projects that require a build step should define a `build` script in `package.json`.

Example:

```json
{
  "scripts": {
    "build": "tsc"
  }
}
```

CI pipelines should run the build command after dependencies have been installed with the project's clean dependency installation workflow.

For npm-based projects this usually means:

```sh
npm ci
npm run build
```

Example GitHub Actions workflow:

```yaml
name: Build

on:
  pull_request:
  push:
    branches:
      - main

jobs:
  build:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v6

      - uses: actions/setup-node@v6
        with:
          node-version: 24
          cache: npm

      - run: npm ci
      - run: npm run build
```

The `build` script should represent the minimum command needed to produce or validate the project's build output. More specialized checks such as tests, linting, formatting, packaging, or security scanning should use separate scripts unless they are truly part of producing the build artifact.

## Consequences

Positive:

- CI and local workflows have one predictable build command
- Projects can change build tools without changing CI job semantics
- Contributors can validate buildability without knowing internal tooling details
- Build failures are detected before publishing or deployment
- The convention aligns with common npm project practices

Negative:

- Projects must maintain a meaningful `build` script
- Very small packages with no build step may not need this command
- Teams must decide which checks belong in `build` and which belong in separate scripts
- Long build scripts can slow down basic validation if they include unrelated checks

## Alternatives Considered

- **Call the build tool directly in CI**. This works, but it couples CI to implementation details such as `tsc`, Vite, webpack, or another tool.

- **Use different build command names per project**. This gives teams flexibility, but it makes repository conventions and automation less predictable.

- **Run tests instead of a build command**. Tests may exercise compiled code, but they do not necessarily prove that the project can produce its build output.
