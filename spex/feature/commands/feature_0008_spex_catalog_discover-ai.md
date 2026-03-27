# spex catalog discover-ai

This command simplifies initialization of Spex project by using AI-based discovery of possible imports from catalog. AI discovery process relies mainly on the contents of the project (where AI is used to understand what is the nature of the project and which packages from catalog are relevent for it and should be imported).

## Options

- `--description`: Optional description of the project. It will be used as an addition to project contents. For example: "This project is a Node CLI project that is used to analyze contents of Kafka queues" could return the following imports: `hekonsek/scriptz`, `hekonsek/adr-node`, `hekonsek/adr-node-cli` and `hekonsek/adr-kafka`.

## Discovery logic

Initially run similar Codex command to discover list of packages from Spex catalog that could be useful for current project:

```bash
codex exec --skip-git-repo-check -m gpt-5.4-mini -c 'model_reasoning_effort="low"' --color never 'Run spex catalog list, inspect the current directory to understand the project, choose the catalog packages that are relevant to this project, and return only a JSON array of package names. No prose, no code fences, no extra text. It is OK to return empty list if nothing matches.'
```

If `--description` is present then include it in the Codex prompt as well. In such case resulting list of packages should be mix of directory contents and provided description analysis.

## Initialization logic

After generating list of packages, initialize project using that list (just like `spex init --package foo/bar --package foo/baz`).