# Spex build file

Spex build file is located in `.spex/spex.yml` file in project root. The file contains the list of identifiers of Spex packages that should be downloaded and used in the current project. 

Sample `spex.ym` could look like the following example:

```yml
packages:
  - https://github.com/hekonsek/foo # Full package ID
  - hekonsek/bar # Short package ID
```