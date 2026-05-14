# Catalog index location

By default catalog is generated as a [file in this repository](../../spex-catalog-index.yml). Spex CLI then can read download the latest catalog index from the following GitHub URL - [https://github.com/hekonsek/spex/blob/main/spex-catalog-index.yml](https://github.com/hekonsek/spex/blob/main/spex-catalog-index.yml) .

Spex will most likely support overriding catalog index source in the future. But for now all catalog index reading operations (like `spex catalog list`) should assume this remote location.

## Catalog index caching

Spex should keep cache of downloaded index in `~/.cache/spex` directory. New version should be downloaded asynchronously in the background and only if downloaded version is older than 15 minutes. If there is no cached version, download it synchronously. Fallback to already downloaded version if download is impossible.