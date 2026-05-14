# Let Errors Flow Unless Catching Adds Value

## Context

We are building Node.js applications, libraries, and CLI tooling in TypeScript.

Many codebases catch errors too early and wrap them without adding meaningful information. This often leads to:

- duplicated or noisy error messages
- lost stack trace clarity
- repeated logging of the same failure
- application code that is harder to read and maintain

At the same time, some error handling is necessary. Architectural boundaries may need to:

- translate infrastructure failures into application-level or domain-level errors
- add missing operational context
- perform cleanup
- return an expected result instead of failing
- map failures to CLI exit codes, HTTP responses, or other transport-specific outputs

We want a default rule that keeps error handling intentional and avoids unnecessary wrapping.

## Decision

We will let errors propagate by default.

We will not catch or wrap an error unless doing so adds clear value.

Catching an error is justified when the code:

- adds meaningful context that the caller would not otherwise have
- translates a low-level error at an architectural boundary
- performs cleanup or compensation
- retries or changes control flow
- converts the failure into an explicit result
- handles final logging and mapping at an entrypoint such as CLI or HTTP

We will avoid catch blocks that only rethrow the same error or replace it with a less useful one.

Avoid:

```ts
try {
  await repository.save(user)
} catch (error) {
  throw new Error("Failed to save user")
}
```

Prefer:

```ts
await repository.save(user)
```

When translation or added context is needed, preserve the original cause.

Example:

```ts
try {
  await httpClient.send(request)
} catch (error) {
  throw new NotificationDeliveryError("Failed to deliver notification", {
    cause: error,
  })
}
```

## Consequences

Positive:

- Error handling remains focused and intentional
- Original failure information is preserved more often
- Stack traces stay easier to follow
- Duplicate logging and wrapper noise are reduced
- Architectural boundaries become clearer because translation happens in specific places

Negative:

- Teams must judge whether a catch block adds enough value
- Some low-level errors may surface unchanged until explicit boundary handling is added
- Inconsistent use of contextual wrapping can still occur without review discipline

## Alternatives Considered

- **Catch and wrap most errors defensively**. This may look explicit, but it usually adds noise, obscures the original failure, and encourages repeated handling across layers.

- **Never catch errors at all**. This keeps the code simple, but it ignores valid use cases such as cleanup, transport mapping, retries, and boundary-specific translation.

- **Log errors in every layer**. This can make debugging harder because the same failure appears multiple times with little additional value.
