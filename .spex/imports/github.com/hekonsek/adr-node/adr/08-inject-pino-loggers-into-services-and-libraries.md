# Inject Pino Loggers Into Services and Libraries

## Context

We are building Node.js applications where business services and shared libraries may be used from different entrypoints, such as:

- CLI commands
- REST endpoints
- message consumers
- scheduled jobs
- direct library calls

These services and libraries often need logging, but they should not own application-level logger configuration. Logger configuration depends on the runtime context, environment variables, log destination, formatting needs, request context, and transport-specific metadata.

If services create their own logger instances internally, the codebase becomes harder to configure, test, and compose. It also becomes harder for input adapters to attach contextual fields such as command names, request IDs, user IDs, tenant IDs, or job IDs.

We want logger usage that:

- keeps logger configuration at the application boundary
- makes service and library dependencies explicit
- supports root loggers and child loggers
- works naturally with dependency injection
- keeps services reusable across different input adapters

## Decision

Libraries and services will receive a Pino logger instance through constructor injection.

Application entrypoints and input adapters are responsible for creating or selecting the logger instance and passing it to services through dependency injection.

Examples of application entrypoints and input adapters include:

- CLI command handlers
- REST endpoint handlers
- message consumers
- scheduled job runners
- application bootstrap code

Preferred service pattern:

```ts
import type { Logger } from "pino"

export class PaymentService {
  constructor(private readonly logger: Logger) {}
}
```

Preferred application or input adapter pattern:

```ts
import pino from "pino"
import { PaymentService } from "./services/payment/payment.service"

const logger = pino()
const paymentService = new PaymentService(logger)
```

Input adapters may pass either a root logger or a child logger depending on the context.

Use a root logger when the service does not need adapter-specific fields:

```ts
const paymentService = new PaymentService(logger)
```

Use a child logger when the adapter has useful contextual fields:

```ts
const paymentService = new PaymentService(
  logger.child({
    adapter: "rest",
    requestId,
  }),
)
```

Services and libraries may also create their own child loggers from the injected logger when they need stable service-specific context:

```ts
export class PaymentService {
  private readonly logger: Logger

  constructor(logger: Logger) {
    this.logger = logger.child({ service: "payment" })
  }
}
```

Services and libraries should not create a new root Pino instance internally as their default behavior.

## Consequences

Positive:

- Logger configuration stays at the application boundary
- Services and libraries remain reusable across CLI, REST, worker, and library contexts
- Tests can inject fake, silent, or test-configured loggers
- Input adapters can attach request-specific or transport-specific fields
- Service logs can still include stable service context through child loggers

Negative:

- Constructors require an additional dependency
- Application bootstrap code must wire logger instances explicitly
- Teams must decide whether to pass root loggers, adapter child loggers, or service child loggers for each use case

## Alternatives Considered

- **Create Pino instances inside services and libraries**. This is convenient locally, but it hides configuration, makes tests noisier, and prevents input adapters from controlling contextual logging.

- **Use a global logger singleton**. This reduces constructor parameters, but it makes dependencies implicit and makes tests, composition, and per-entrypoint logging context harder.

- **Pass logger configuration instead of logger instances**. This lets services create loggers from configuration, but it still pushes application-level concerns into reusable service code.

- **Use method-level logger parameters**. This can work for narrow operations, but it spreads logging dependencies across call sites and is less convenient than constructor injection for services that log throughout their behavior.
