# spex build

Executing `spex build` prepares project to be ready to work with Spex.

In particular it:
- Runs validation of project structure (the same logic as `spex validate` command).
- For all item type subdirectories in `spex` directory, it adds item type configuration instruction to `AGENTS.md` file.
- Checks if `.spex/spex.yml` build file exists.
    - If yes then: 
        - For every package ID in build file, import that package into local project.
        - Add every imported package add `AGENTS.md` entry to
        - Build command should always try to download the most recent version even if the file already exists locally.
    - If no, then don't run package import and wiring logic.
- If `AGENTS.md` file already exists, it is overridden.

## Item type configuration entry format

