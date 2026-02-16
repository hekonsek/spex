# Spex specification model

Spex specification (or simply just Spex) is a collection of **items** of given **types** (like **instruction** or **ADR (Architecture Decision Record)**).

Items are usually markdown files, grouped by type, locted in `spex` directory in your project. It means that Spex specification in your project can look like the following:

```
📁 your_project
  📁 spex
    📁 adr
      📄 adr_0001_use_aws.md
      📄 adr_0002_use_lambda.md
    📁 instruction
      📄 instruction_0001_use_this_script_to_check_logs.md
```
