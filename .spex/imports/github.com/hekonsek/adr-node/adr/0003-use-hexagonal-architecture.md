# Use Hexagonal Architecture

## Context

We are building different kinds of Node.js software, including CLI applications, web applications, libraries, and other services.

These projects often need to integrate with external systems such as:

- file systems
- databases
- HTTP APIs
- message brokers
- command-line interfaces

If business logic is mixed directly with these external concerns, the codebase becomes harder to test, reuse, and evolve. It also becomes harder to keep a consistent structure across projects of different kinds.

We want a default architecture that:

- separates business logic from infrastructure details
- makes dependencies explicit
- keeps projects consistent across application types
- supports testing core behavior without depending on external systems

## Decision

We will use hexagonal architecture as the default architectural style for all applications and libraries.

Each project should use these main source directories:

- `src/core`
- `src/ports`
- `src/adapters`

If the project includes a CLI entrypoint, it should also use:

- `src/cli`

Ports and adapters should be organized by functionality rather than by technical type alone.

Example structure:

```text
src/core/examplefunction1/examplefunction1.service.ts
src/ports/examplefunction1/someprovider.service.ts
src/adapters/examplefunction1/someprovider.service.ts
```

`src/core` contains business logic and application use case implementations.

`src/ports` contains interfaces and application-facing contracts that define what the core logic needs or exposes.

`src/adapters` contains implementations that connect those ports to concrete technologies such as the filesystem, HTTP, databases, queues, or external APIs.

`src/cli` contains CLI-specific entrypoints, argument parsing, and command wiring when a CLI is present.

## Consequences

Positive:

- Business logic is isolated from infrastructure concerns
- Core functionality is easier to test with mocks or in-memory adapters
- Projects share a consistent structure across CLI apps, web apps, libraries, and services
- Replacing infrastructure implementations becomes easier because dependencies flow through ports
- Functional areas stay easier to navigate because related core logic, ports, and adapters are grouped together

Negative:

- The structure introduces more files and indirection in smaller projects
- Teams must understand the difference between ports, adapters, and entrypoints
- Some implementations may feel verbose compared with directly calling infrastructure code

## Alternatives Considered

- **Organize by technical layer only**. This can work, but it often scatters a single feature across unrelated folders and makes feature-level navigation harder.

- **Organize by framework conventions only**. This is simpler at first, but it tends to couple application logic to framework and infrastructure details.

- **Allow each project to choose its own structure**. This gives flexibility, but it reduces consistency across repositories and makes onboarding, reuse, and maintenance harder.
