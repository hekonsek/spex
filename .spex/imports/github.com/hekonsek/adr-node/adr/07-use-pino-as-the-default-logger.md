# Use Pino as the Default Logger

## Context

We are building Node.js applications, services, libraries, and CLI tooling that need consistent logging.

Logging is a cross-cutting concern used for:

- operational diagnostics
- debugging failures
- tracing application flow
- structured observability in production environments

Node.js projects often choose between many logging libraries. If each project or module selects a different logger, logging style, output structure, and runtime behavior become inconsistent.

We want a default logger that is:

- fast enough for high-throughput services
- suitable for structured logging
- widely used and accepted in the Node.js community
- simple to use in applications, services, and libraries
- compatible with common production logging pipelines

## Decision

We will use Pino as the default logger for Node.js projects.

Pino should be the first choice for application, service, and library logging unless a project has a specific reason to use a different logger.

We choose Pino because it is highly performant, focused on structured JSON logging, and broadly accepted in the Node.js community.

## Consequences

Positive:

- Logging behavior is consistent across Node.js projects
- Pino provides very good runtime performance compared with many logging alternatives
- Structured JSON logs work well with production log aggregation systems
- Developers can rely on a familiar and widely adopted Node.js logging library
- Libraries and services can share a common logging contract across projects

Negative:

- Projects must align on Pino conventions instead of choosing logger libraries independently
- Human-readable local output may require additional configuration such as pretty printing
- Projects with existing logger integrations may need migration work

## Alternatives Considered

- **Use `console` directly**. This is simple, but it does not provide the same structured logging model, configuration options, production logging ergonomics, or application-wide logging level configuration.

- **Allow each project to choose its own logger**. This gives teams flexibility, but it creates inconsistent APIs, output formats, and operational behavior across projects.

- **Use Winston**. Winston is mature and flexible, with many transports and formatting options. We prefer Pino as the default because it has a stronger focus on high-performance structured logging and keeps the runtime logging path simpler.

- **Use Bunyan**. Bunyan also supports structured JSON logging and has influenced Node.js logging practices. We prefer Pino because it is more actively used as a modern default, has a stronger performance profile, and fits current Node.js service logging expectations better.
