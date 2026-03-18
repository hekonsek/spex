# Use Service-Oriented Hexagonal Architecture

## Context

We are building different kinds of Node.js software, including CLI applications, web applications, libraries, and other services.

These projects need to keep business behavior reusable while still integrating with external systems such as:

- databases
- HTTP APIs
- message brokers
- file systems
- command-line interfaces

If business logic is mixed directly with transport and infrastructure code, the codebase becomes harder to test, reuse, and evolve. It also becomes harder to expose the same capability through different entrypoints such as CLI, REST, or Kafka consumers.

We want a default structure that:

- keeps business features independent from transports
- makes service contracts explicit
- supports using services either as libraries or through input adapters
- isolates dependencies on external systems behind output adapters
- stays consistent across application types

## Decision

We will use a service-oriented form of hexagonal architecture.

We divide `src` into two main areas:

- `src/services`
- `src/adapters/in`

Services are organized around business features, not around technical layers.

Example structure:

```text
📁 src/
  📁 adapters/
    📁 in/
      📁 cli/
        📄 cli.ts
      📁 rest/
        express.api.ts
      📁 kafka/
        📄 kafka.order-listener.ts
  📁 services/
    📁 payment/
      📄 payment.service.ts
      📁 adapters/
        📁 out/
          📄 postgresql.payment-repository.ts
          📄 stripe.payment-provider.ts
      📁 config/
```

`src/services` contains business features. Each service owns its behavior, its public contract, and any internal infrastructure integrations needed by that feature.

A service must be used from outside through its public service contract only. That contract is the service's input port.

This means a service can be consumed in two ways:

- directly by another service when the codebase is used as a library
- through an input adapter when the service is exposed through CLI, REST, Kafka, or another transport

`src/adapters/in` contains input adapters. Input adapters translate an external trigger into a call to a service contract. They handle transport-specific concerns such as request parsing, command arguments, message consumption, authentication context, and response mapping.

Output adapters are defined inside the owning service when that service depends on something outside the application boundary. These adapters externalize internal service dependencies such as:

- database access
- HTTP calls to third-party APIs
- publishing Kafka events
- filesystem access

This keeps the service focused on business behavior while allowing infrastructure implementations to change independently.

## Consequences

Positive:

- We rely on well-known and established architecture patterns
- Business logic is grouped by feature and remains reusable across transports
- The same service can be exposed through CLI, REST, Kafka, or direct library usage
- Service boundaries are clearer because consumption happens through explicit public contracts
- External dependencies are isolated behind output adapters owned by the service that needs them
- Testing becomes easier because services can be exercised through their contracts with infrastructure replaced

Negative:

- The structure introduces extra indirection compared with directly calling frameworks or infrastructure code
- Teams must be disciplined about keeping transport logic out of services
- Some infrastructure code is duplicated across input adapters when multiple transports expose the same service

## Alternatives Considered

- **Organize by technical layer only**. This separates controllers, services, and repositories globally, but it scatters a single business feature across the codebase and weakens feature ownership.

- **Use a shared top-level `ports` directory**. This can work, but it makes contracts feel detached from the services that own them. We prefer the service contract to be part of the service boundary.

- **Couple services directly to transports or infrastructure**. This may look simpler at first, but it reduces reuse, makes testing harder, and makes it harder to expose the same capability through multiple entrypoints.

- **Rely on UseCase objects for business workflow orchestration**. We prefer to keep project structure complexity in place. Using services as a single access point instead of dedicated Use Case classes seems to be a good choice when it comes to complexity balance. Use Cases feels like an overkill.