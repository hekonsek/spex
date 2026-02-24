# spex catalog discover

This command simplifies importing Spex packages into current project.

## Discovery logic

- Command checks if `.spex/spex.yml` file exists. If no, empty Spex config file is created.
- Command loads imported packages from Spex config (if any).
- Command loads packages from Catalog Index bundled in this project.
- Command displays human-friendly list of packages available in catalog minus these already imported. Each package has order number associated with it.
- Command waits for user input:
    - If number is selected then given package is added to imports list in current project. Then list is displayed again.
    - If enter is pressed without selecting number, then command exits. 