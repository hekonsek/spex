# spex validate

Executing `spex validate` command should validate that current directory is a valid Spex project.

In particular the following is checked:
- Current directory should contain `spex` subdirectory.
- `spex` directory should contain at least one subdirectory representing valid item type (`adr`, `instruction`, etc).
- Item type subdirectories should contain at least one markdown file.