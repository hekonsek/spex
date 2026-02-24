# Catalog

Catalog is a collection of links to packages. It is intended to be used a marketplace of reusable packages that can be picked and used in a Spex project.

## Catalog specification

Catalog specification is a YML file named `spex-catalog.yml` with the following syntax:

```yml
packages:
  - https://github.com/hekonsek/foo # Full package ID
  - hekonsek/bar # Short package ID
```

## Catalog index

Catalog index is an output YML file named `spex-catalog-index.yml` generated from catalog specification. Index contains list of packages enriched by metadata fetched during index build process. Index makes it easier for tooling to understand contents of catalog.

For now catalog index format is not much different from catalog specification, but it will be extended with extra fields over time:

```yml
packages:
    - url: hekonsek/bar
```