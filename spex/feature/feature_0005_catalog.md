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

Catalog Index format is as follows:

```yml
packages:
    - id: hekonsek/bar
    - name: Human-friendly name
    - updated: 1771945683 
```

`url`: ID of the package (in package URL format).

`name`: Human-friendly name of the project. Read from `#` section of package `README.md` file. Defaults to ID if name cannot be read from README. 

`updated`: Epoch indicating last Git repository update