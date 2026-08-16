---
"pg-advisory-lock": major
---

Replace the `pg` driver with `postgres.js`.
`createAdvisoryLock` now accepts a connection string, native postgres.js options, or an existing `postgres.Sql` instance.
