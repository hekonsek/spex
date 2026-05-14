# Packages caching

When cloning packages GitHub repositories (for example for `spex build` or `spex catalog build` commands) use local cache directory (`~/.cache/spex/packages`) to store downloaded packages. Instead of downloading whole repository next time, just fetch delta of missing updates.