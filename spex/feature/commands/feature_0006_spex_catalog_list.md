# spex catalog list

Lists packages in catalog bundled with this project.

## Output

The output line should follow this pattern:

```
Package name (package_id | Human readable update time)
```

For example:

```
Syllaibus: Syllabus for AI (hekonsek/syllaibus | Updated 2 days ago)
```

Details brackets (including brackets) should be colored to gray.

## Options

- `--sort`: Specify sorting property. Can be `id`, `name` or `updated`. Defaults to `id`.
- `--sort-order`. Sorting order, can be `asc` or `desc`. Defaults to `asc`.
