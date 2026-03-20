# Use Ora as progress indicator

## Context

Many CLI commands include network calls, file I/O, or other long-running operations.
Without progress feedback, users cannot tell whether the command is still running,
stuck, or failed.

Raw log lines can provide status, but they are often noisy and reduce readability during
interactive use. We need a standard way to show concise in-place progress for humans
while preserving machine-readable output modes.

## Decision

We will use [`ora`](https://github.com/sindresorhus/ora) as the default progress
indicator (spinner/status line) for interactive CLI execution.

Rules:

- Ora usage is limited to CLI/presentation layer modules.
- Core/domain logic must emit typed events or structured results, not spinner calls.
- Spinner output must be disabled for non-interactive contexts (`!isTTY`, CI,
  `--json`, `--quiet`).
- Commands must still provide clear final status messages when spinner is disabled.

## Consequences

Pros:
* ✅ Better perceived responsiveness for long-running commands.
* ✅ Cleaner terminal UX than repeated status log lines.
* ✅ Consistent progress behavior across commands.
* ✅ Easy mapping from domain events to CLI feedback.

Cons:
* ❌ Adds a third-party runtime dependency.
* ❌ Spinner behavior can differ across terminals/platforms.
* ❌ Requires careful fallback handling for CI/log capture/non-TTY modes.

## Alternatives considered

- **No progress indicator**. Simplest implementation, but weak UX for slow commands.
- **Manual carriage-return updates (`\\r`)**. No dependency, but error-prone and less
  consistent.
- **Other spinner/progress libraries** (for example `cli-spinners`, `listr2`). Viable,
  but Ora offers a minimal API and broad adoption for standard single-task spinner use.
