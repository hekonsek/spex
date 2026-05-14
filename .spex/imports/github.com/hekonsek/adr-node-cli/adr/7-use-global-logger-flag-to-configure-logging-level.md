# Use global logger flag to configure logging level

## Context

CLI tools often need diagnostic logging for troubleshooting, support, and development.
At the same time, command output is frequently consumed by scripts, pipes, and CI jobs,
so logs must not appear unless the user explicitly asks for them.

Without a standard logging flag, commands tend to introduce inconsistent options such
as `--debug`, `--verbose`, or environment-variable-only controls. This makes behavior
harder to discover and harder to keep consistent across commands.

## Decision

We will provide a global CLI option named `--logger` to configure the logging level.
The default logging level is `silent`.

Examples:

```sh
my-cli version
my-cli version --logger=debug
my-cli deploy --logger=info
```

Supported levels should include at least:

- `silent`
- `fatal`
- `error`
- `warn`
- `info`
- `debug`
- `trace`

The flag controls diagnostic logging only. User-facing command output, JSON output,
progress indicators, and exit-code behavior remain separate CLI concerns.

When structured logs are emitted, they should be written to stderr so stdout can remain
reserved for command results and machine-readable output.

### Example

If Pino and Commander are used, the global option can be wired like this:

```ts
import { Command, Option } from "commander";
import pino, { type LevelWithSilent } from "pino";

const loggerLevels = [
  "silent",
  "fatal",
  "error",
  "warn",
  "info",
  "debug",
  "trace",
] as const;

const program = new Command()
  .name("my-cli")
  .addOption(
    new Option("--logger <level>", "set diagnostic logging level")
      .choices([...loggerLevels])
      .default("silent"),
  );

program.command("version").action(() => {
  const options = program.opts<{ logger: LevelWithSilent }>();
  const logger = pino({ level: options.logger }, pino.destination(2));

  logger.debug("reading package version");
  console.log("1.0.0");
});

program.parse();
```

## Consequences

Pros:
* ✅ Consistent logging configuration across commands.
* ✅ Quiet default behavior for scripts, CI, and machine-readable output.
* ✅ Easy troubleshooting path with `--logger=debug` or `--logger=trace`.
* ✅ Keeps diagnostic logs separate from command results.

Cons:
* ❌ Adds another global CLI option that must be documented and tested.
* ❌ Commands must avoid treating logs as user-facing output.
* ❌ Logging libraries must be configured carefully so logs do not pollute stdout.

## Alternatives considered

- **Use `--debug` or `--verbose` flags**. Common and simple, but less precise than
  explicit logger levels and harder to map consistently to structured logging libraries.
- **Use only environment variables**. Useful for automation, but less discoverable in
  CLI help and less convenient for one-off troubleshooting.
- **Enable info logs by default**. Helpful during development, but too noisy for normal
  CLI usage and unsafe for commands whose stdout is consumed by other tools.
