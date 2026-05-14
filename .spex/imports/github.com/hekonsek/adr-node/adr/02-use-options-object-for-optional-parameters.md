# Prefer using Options Object for Optional Parameters

## Context

We are building Node.js applications, libraries, and CLI tooling in TypeScript.

Many APIs need a small number of required inputs together with optional configuration such as:

- `cwd`
- `timeout`
- `signal`
- `verbose`
- `dryRun`

Using positional arguments for this kind of configuration makes call sites harder to read and harder to evolve over time. It also creates friction when adding new optional parameters, especially in shared libraries and public APIs.

We want a default API design pattern that is:

- readable at the call site
- easy to extend without breaking existing consumers
- natural for optional parameters
- idiomatic in modern Node.js and TypeScript codebases

## Decision

We will prefer to use positional arguments only for required, conceptually atomic inputs.

Optional configuration should be passed as a single trailing options object.

Preferred pattern:

```ts
function doSomething(input: string, options?: DoSomethingOptions) {}
```

Example:

```ts
runCommand("build", {
  cwd: "/tmp",
  verbose: true,
  timeout: 5000,
})
```

Avoid APIs that express optional configuration through multiple positional parameters.

Avoid:

```ts
function doSomething(
  input: string,
  cwd?: string,
  timeout?: number,
  signal?: AbortSignal,
) {}
```

For ports and application services, required business input should be modeled as a required argument or input object, while runtime configuration should be passed separately as an optional options object when needed.

## Consequences

Positive:

- Call sites are more self-documenting
- Adding new optional parameters usually does not require breaking API changes
- Optional parameters are easier to omit selectively
- TypeScript types remain easier to evolve and reuse
- The convention aligns with common Node.js and TypeScript API design

Negative:

- Small APIs with very few parameters may feel slightly more verbose
- Teams must distinguish between required business input and optional execution settings
- Poorly named options types can still produce unclear APIs

## Alternatives Considered

- **Use positional arguments for all parameters**. This is shorter for very small functions, but it becomes unclear and fragile as the number of optional parameters grows.

- **Use a single object for both required input and optional configuration**. This can work, but it often mixes business data with runtime settings and makes API intent less clear.

- **Allow each module to choose its own parameter style**. This gives flexibility, but it reduces consistency across projects and makes shared APIs less predictable.
