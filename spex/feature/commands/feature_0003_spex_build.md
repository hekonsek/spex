# spex build

Executing `spex build` prepares project to be ready to work with Spex.

In particular it:
- Adds `AGENTS.md` Spex instruction (If `AGENTS.md` file already exists, it is overridden).
- Checks if `.spex/spex.yml` build file exists.
    - If yes then: 
        - For every package ID in build file, import that package into local project.
        - Build command should always try to download the most recent version even if the file already exists locally.
        - If there is a downloaded package in local project that is not in `spex.yml` file anymore, it should be removed.
    - If no, then don't run package import download logic.


## AGENTS.md Spex instruction

```markdown
This project contains specifications of different types and instructions located in the following directories:
  - `spex/**/*.md`
  - `.spex/imports/**/*.md`

Depending on the instruction or specification type it will be located in a relevant subdirectory like `adr`, `instruction`, `dataformat`, `feature`, etc.

Please take these specifications under consideration when working with this project.

When in doubt, specifications in `spex` should take precedence over imported specifications in `.spex/imports`. 
```
