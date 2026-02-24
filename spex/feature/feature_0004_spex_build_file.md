# Spex build file

Spex build file is a configuration file used to configure how Spex build process behaves. This file is located in `.spex/spex.yml` file in your project root.

If you intend to use your project as a Spex package and use it in different projects or packages, then Spex build file acts also as export manifest for your package.

## `packages` section

This section contains the list of identifiers of Spex packages that should be downloaded and used in the current project. 

Sample `spex.ym` could look like the following example:

```yml
packages:
  - https://github.com/hekonsek/foo # Full package ID
  - hekonsek/bar # Short package ID
```

## `export` section

Export section of configuration allows you to tune behavior of Spex when your package is imported into another project.

### `export.ignores` section

`export.ignores` specifies list of glob patterns (relative to `/spex` directory in your package) which should not be copied into the project. 

```yml
# spex.yml
export:
  ignores:
    - '**/*.pyc'
```