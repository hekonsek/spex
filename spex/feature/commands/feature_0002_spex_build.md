# spex build

Executing `spex build` prepares project to be ready to work with Spex.

In particular it:
- Runs validation of project structure (the same logic as `spex validate` command).
- Adds `AGENTS.md` Spex instruction (If `AGENTS.md` file already exists, it is overridden).
- Checks if `.spex/spex.yml` build file exists.
    - If yes then: 
        - For every package ID in build file, import that package into local project.
        - Build command should always try to download the most recent version even if the file already exists locally.
    - If no, then don't run package import download logic.


## AGENTS.md Spex instruction

> This project contains specification pieces of different types located in:
> - `spex/**/*.md`
> - `.spex/imports/**/*.md`
> 
> Depending of the specification type it will be located in a relevant subdirectory like `adr`, `instruction`, `dataformat`, `feature`, etc.
>
> Please take these specifications under consideration when working with project.
>
> When in doubt specifications in `spex` should take precedene over imported specifications in `.spex/imports`. 