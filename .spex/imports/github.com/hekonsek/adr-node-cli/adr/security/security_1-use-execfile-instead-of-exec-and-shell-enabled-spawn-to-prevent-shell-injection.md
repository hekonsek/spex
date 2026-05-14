# ADR: Use execFile Instead of exec (and shell-enabled spawn) to Prevent Shell Injection

## Context

Our Node.js CLI application occasionally needs to invoke external programs (e.g., `git`, `docker`, `kubectl`, `terraform`, or internal binaries). This introduces a high-risk boundary: **untrusted input** from CLI arguments, environment variables, config files, or upstream automation may influence the executed command.

In Node.js, there are multiple ways to execute OS commands:

- `child_process.exec(commandString)` (shell)
- `child_process.spawn(command, args)` (no shell by default, but can enable shell)
- `child_process.execFile(file, args)` (no shell)

Shell-based execution (`exec`, or `spawn(..., { shell: true })`, or `spawn("sh", ["-c", "..."])`) is vulnerable to **shell injection** if untrusted input is interpolated into the command string. This is particularly dangerous for CLIs because they often run with elevated developer/CI permissions and can access sensitive files, credentials, and networks.

We want a default approach that is safe, consistent, and cross-platform.

## Decision

We will **use `child_process.execFile()` as the default mechanism** for invoking external programs from our CLI.

We will avoid using `child_process.exec()` in production code.

We will also avoid using `spawn()` with a shell (`{ shell: true }`) or any pattern that reintroduces shell parsing (e.g., `spawn("sh", ["-c", "..."])`, `spawn("cmd.exe", ["/c", "..."])`) unless an explicit exception is approved and documented.

Rationale behind using `execFile`:

- `execFile` does **not invoke a shell** by default, so shell metacharacters (`;`, `&&`, `|`, `$()`, backticks) are not interpreted.
- Arguments are passed as an array, avoiding unsafe string interpolation.
- Cross-platform behavior is more predictable than shell quoting/escaping.
- Centralizing command execution behind a safe default reduces review burden and prevents recurring vulnerabilities.

## Consequences

**Positive**:
- Strong mitigation against shell injection vulnerabilities.
- More predictable behavior across OSes (Linux/macOS/Windows).
- Encourages better separation of “command + args” and reduces accidental interpolation.
- Easier auditing: grep for `exec(` becomes a strong signal.

**Negative / Trade-offs**:
- Some shell features (pipes, redirects, globbing, command chaining) are not available directly.
  - We must implement these via Node APIs, explicit multiple process calls, or well-reviewed exceptions.
- `execFile` buffers stdout/stderr by default (like `exec`). For very large output, we may need `spawn` streaming.
- Requires more explicit handling for environment, cwd, and error reporting.

## Alternatives Considered

1. **Use `exec()` with escaping/sanitization**
   - Rejected: shell escaping is error-prone, varies by shell and platform, and easy to bypass.
2. **Use `spawn()` everywhere**
   - Not chosen as default: while safe without shell, it’s easier to accidentally enable `shell: true`, and the API encourages streaming patterns that may complicate simple use cases. We still allow `spawn` for streaming when needed.
3. **Use a third-party wrapper (e.g., execa)**
   - Possible future enhancement: wrappers can improve ergonomics (promises, better error objects). Still must enforce “no shell” and argument arrays. Not required for the ADR’s core goal.
