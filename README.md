# Spex: AI-friendly project specifications

Spex makes it easy to create, maintain and reuse AI-friendly project specifications. Use Spex to make your project is easier to understand for agentic AI tooling like Codex, Cloud Code or Copilot. 

## Spex specification model

Spex specification (or simply just Spex) consists of **items** of given **types** (like **instruction** or **ADR (Architecture Decision Record)**).

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

### Packaging

Collection of items intended to be reused is called **package**. Package is identified using **namespace** and **name**.

If package is distributed using GitHub (which is a default behavior for Spex) then package is a GitHubn repository with GitHub user name or organization name representing package namespace and repository name representing package name.

For example GitHub repository `https://github.com/myorg/adr-node` containing ADRs describing Golden Path for your organization for working with Node will have `myorg` namespace and `adr-node` name.
