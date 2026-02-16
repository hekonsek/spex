# Packaging

Spex specification intended to be reused is called **package**. Package is identified using **namespace** and **name**.

If package is distributed using GitHub (which is a default behavior for Spex) then package is a GitHub repository with GitHub user name or organization name representing package namespace and repository name representing package name.

For example GitHub repository `https://github.com/myorg/adr-node` containing ADRs describing Golden Path for your organization for working with Node will have `myorg` namespace and `adr-node` name.

## Package identifier

Spex packages can be identified using full GitHub URL (for example `github.com/myorg/adr-node`) or using shorter version with namespace and name only (for example `myorg/adr-node`). The latter identifier format assumes that package is hosted at GitHub.

## Package import

When package is imported into a project, it is copied into a local `.spex` directory in the project, into `imports` subdirectory. `.spex/imports` directory then contains name of the package host (for example github.com for GitHub) and finally the package contents itself (copy of the downloaded repository contents).

For example the following package repository...

```
📁 adr-node
  📁 .git
  📁 some_unrelevant_directory
  📁 spex
    📁 adr
      📄 adr_0001_use_aws.md
      📄 adr_0002_use_lambda.md
    📁 instruction
      📄 instruction_0001_use_this_script_to_check_logs.md
  📄 some_unrelevant_file.txt
```

Should be imported into a following structure:

```
📁 your_project
  📁 .spex
    📁 imports/github.com/myorg/adr-node
      📁 adr
        📄 adr_0001_use_aws.md
        📄 adr_0002_use_lambda.md
      📁 instruction
        📄 instruction_0001_use_this_script_to_check_logs.md
```

Please note how only contents of `spex` directory in package repository is imported into `.spex/imports` in local project. 