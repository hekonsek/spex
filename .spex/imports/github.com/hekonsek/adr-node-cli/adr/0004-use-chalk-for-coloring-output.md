# Use chalk for coloring output

## Context

CLI tools should provide output that is easy to scan quickly. Color helps distinguish
success, warnings, errors, and informational messages, especially during long-running
tasks.

Without a standard coloring approach, projects tend to:

- mix raw ANSI escape codes with plain text
- apply inconsistent styles between commands
- break output readability in non-TTY environments (CI logs, redirected output)
- make it harder to keep output accessible and maintainable

We need one default library for colorized CLI output that is simple, stable, and widely
used in Node.js ecosystems.

## Decision

We will use [`chalk`](https://github.com/chalk/chalk) as the default library for
coloring terminal output in Node-based CLI tools.

Rules:

- Color formatting is allowed only in CLI/presentation layer modules.
- Core/domain logic must return structured results or typed events without color/ANSI
  formatting.
- Color must enhance text, not replace meaning (for example, keep explicit labels like
  `ERROR`, `WARN`, `OK`).
- Output must remain readable when color is disabled (non-TTY, `NO_COLOR`, CI logs).

## Consequences

Pros:
* ✅ Consistent and readable output across commands.
* ✅ Better user experience for interactive CLI usage.
* ✅ Cleaner code than manual ANSI escape sequences.
* ✅ Centralized styling conventions (severity colors, emphasis, dimmed metadata).
* ✅ Easier maintenance and onboarding.

Cons:
* ❌ Adds dependency on a third-party package.
* ❌ Potential style overuse can reduce readability if not reviewed.
* ❌ Color behavior can vary between terminals and operating systems.

## Alternatives considered

- **Manual ANSI escape codes**. No dependency, but difficult to read/maintain and easy to
  misuse.
- **picocolors / colorette / kleur**. Smaller libraries with similar goals, but we choose
  Chalk for broad adoption and familiar API.
- **No color at all**. Simplest output, but lower scanability and poorer UX for human
  operators.
