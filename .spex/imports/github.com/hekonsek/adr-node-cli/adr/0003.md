# CLI should listen to events from core logic via listeners

## Context

We are building a Node.js + TypeScript CLI application with the following requirements:

- Clear separation between:
  - **Core/business logic** (pure, reusable, testable)
  - **CLI layer** (argument parsing, stdout/stderr, UX, exit codes)
- The core must not:
  - print to stdout/stderr
  - detect TTY
  - depend on CLI/UI libraries
- The CLI may support:
  - progress updates
  - informational messages
  - warnings and errors
  - optional JSON / quiet / CI-safe output

The core needs a mechanism to communicate **what is happening** without deciding **how it is rendered**.

## Decision

Introduce a **Listener** port interface in the core module, then implement listener in CLI to react to events (for example to print output). 

- Core logic:
  - uses listener interface reference to generate events
  - returns structured results or throws typed errors
- CLI:
  - provides concrete given `Listener` callback implementation during core logic invocation
  - callback renders events to stdout/stderr (text, progress bars, JSON, etc.)
  - owns all printing and exit-code decisions

This follows Ports & Adapters (Hexagonal Architecture) principles.

### Example

```ts
// core/example.ts

export interface ExampleServiceListener {
  onGreeting(greeting: string): void;
}

export class ExampleService {
  constructor(private readonly listener: ExampleServiceListener) {}

  helloWorld(name: string): void {
    // Some core domain logic here
    const greeting = `Hello ${name}!`;

    // Emit event
    this.listener.onGreeting(greeting);
  }
}

```

Usage in CLI:

```ts
// cli/cli.ts
import { ExampleService } from "../core/example";

const service = new ExampleService({
  onGreeting(greeting: string): void {
    console.log(greeting);
  },
});
service.helloWorld("Henry");

```

## Consequences

Positive:

* Strong separation of concerns
* Core is reusable and side-effect free
* CLI UX can evolve independently
* Deterministic, testable behavior
* Easy support for `--json`, `--quiet`, CI mode

Negative / Trade-offs:

* Additional boilerplate (interfaces, adapters)
* Event contract must be versioned carefully
* Overuse of events can cause noisy output
* Event ordering must be considered for parallel execution

## Alternatives considered

**Core returns `{ result, messages[] }`**:
- Simple but no streaming progress
- Accumulates output in memory

**Async iterator / Observable of events**:
- Powerful for streaming workflows
- More complex lifecycle and API

**Logging framework inside core**:
- Familiar tooling
- Leaks transport/formatting concerns into core
