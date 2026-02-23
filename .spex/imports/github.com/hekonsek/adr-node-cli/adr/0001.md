# Use Commander as library for Node-based command-line tools

## Context

We are building Node-based command-line tools and need a standard library for parsing arguments, defining commands/subcommands, and generating help output. The library should be mature, well-documented, and widely adopted in the Node ecosystem.

## Decision

We will use [commander.js](https://github.com/tj/commander.js) as the default CLI library for all new Node-based command-line tools in this project.

Commander is currently the most popular library for Node-based CLIs and offers a simple, declarative API for defining commands, options, and help text.

## Consequences

Pros:
* ✅ Consistent CLI style and behavior across all tools.
* ✅ Faster development thanks to Commander’s concise API and good documentation.
* ✅ Easier onboarding for new contributors familiar with Commander.

Cons:
* ❌ Tight coupling to Commander’s API; switching to another library later will require refactoring.
* ❌ We inherit Commander’s limitations and release cycle.

## Alternatives considered

- **yargs**. Powerful and mature, but the configuration style is more verbose and less intuitive. Much less popular than Commander.
- **oclif**. Very capable framework, but heavier-weight and better suited for large CLIs with plugins; overkill for our current needs. Much less popular than Commander.
- **util.parseArgs**. No support for subcommands and help docs messages. Only basic arguments/flags parsing. It is always better to start with Commander.js even for simple applications - Commander is super simple but scales as application gets more complicated. 
- **Custom argument parsing**. Maximum flexibility, but would require more effort to implement and maintain, with no clear benefit over a dedicated library.
