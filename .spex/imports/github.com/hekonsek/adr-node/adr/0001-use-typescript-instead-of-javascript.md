# Use TypeScript Instead of JavaScript

## Context

We are building Node.js applications that will evolve over time and be maintained by multiple developers.

Plain JavaScript provides flexibility, but it also makes it easier to introduce problems such as:

- no strong typing
- invalid function arguments
- inconsistent object shapes
- missed refactoring issues
- weaker editor and tooling support in larger codebases

For backend services and shared application code, we want stronger correctness guarantees, clearer contracts, and safer long-term maintenance.

## Decision

We will use TypeScript as the default language for Node.js applications.

JavaScript will not be the primary implementation language for new application code. TypeScript source files will be compiled to JavaScript for runtime execution in Node.js.

## Consequences

Positive:

- Better type safety and earlier error detection during development
- Safer refactoring in growing codebases
- Improved IDE support, autocomplete, and navigation
- Clearer interfaces between modules
- Easier onboarding for contributors because data structures and APIs are explicit

Negative:

- Additional build and configuration setup is required
- Developers must maintain type definitions and TypeScript configuration
- Some libraries may require extra work for typings or interop

## Alternatives Considered

- **Use plain JavaScript**. This keeps the development setup simpler, but it does not provide the same level of type safety, refactoring support, or explicit contracts between modules.

**Use JavaScript with JSDoc types**. This improves editor support and documentation, but it is less strict and less consistent than using TypeScript as the primary language.

**Allow both TypeScript and JavaScript equally**: This gives teams flexibility, but it increases inconsistency across projects and makes maintenance, tooling, and onboarding less predictable.
