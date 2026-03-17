# spex init

`spex init` command creates new Spex project in current directory.

## Behavior

At minimum `spex init` creates empty `.spex/spex.yml` file.

Command can be invoked many times and will gracefully skip steps that are not needed (like creating Spex config file if it already exist).

## Options

- `--package PACKAGE_URL`. Adds given package import to `packages` section of Spex config. Can be provided multiple times for multiple packages.