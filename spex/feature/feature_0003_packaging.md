# Packaging

Spex specification intended to be reused is called **package**. Package is identified using **namespace** and **name**.

If package is distributed using GitHub (which is a default behavior for Spex) then package is a GitHub repository with GitHub user name or organization name representing package namespace and repository name representing package name.

For example GitHub repository `https://github.com/myorg/adr-node` containing ADRs describing Golden Path for your organization for working with Node will have `myorg` namespace and `adr-node` name.

## Package identifier

Spex packages can be identified using full GitHub URL (for example `github.com/myorg/adr-node`) or using shorter version with namespace and name only (for example `myorg/adr-node`). The latter identifier format assumes that package is hosted at GitHub.