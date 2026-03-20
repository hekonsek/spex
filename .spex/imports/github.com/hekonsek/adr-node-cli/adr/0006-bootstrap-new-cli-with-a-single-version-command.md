# Bootstrap new CLI with a single `version` command

## Context

When starting a new CLI project, it is tempting to scaffold many commands before the
project has stable requirements. This usually introduces noise, increases maintenance
cost, and leads to early design decisions that are hard to change.

We need a minimal, consistent bootstrap baseline that:

- proves the CLI entrypoint and command wiring work
- provides immediate user value
- avoids premature command surface expansion

## Decision

For newly bootstrapped CLI projects, we will initially add only one command:
`version`.

Behavior:

- `version` prints the current project version
- the version is read from `package.json` (`version` field)
- no additional business/domain commands are added at bootstrap stage

Additional commands are introduced only after concrete use-cases are defined.

## Consequences

Pros:
* ✅ Smaller initial codebase and faster project setup.
* ✅ Lower risk of adding placeholder commands that later need removal/refactoring.
* ✅ Immediate sanity check that the CLI binary, packaging, and release versioning are wired correctly.
* ✅ Clear and consistent bootstrap pattern across projects.

Cons:
* ❌ Very limited functionality in the first project iteration.
* ❌ Teams may need an extra step to add first domain command after bootstrap.
* ❌ Some scaffolding tools may expect a default command set and require adjustment.

## Alternatives considered

- **Scaffold multiple starter commands** (e.g. `init`, `help`, `status`). Faster demo surface, but encourages premature API design and unused code.
- **Expose only `--version` flag without `version` command**. Simpler in some frameworks, but less explicit than a dedicated command and less aligned with command-based CLI workflows.
