---
"pg-advisory-lock": major
---

Generate advisory lock keys in PostgreSQL with `hashtextextended` and a deterministic collation.
Remove the public `createAdvisoryLockKey` function and its client-side DJB2 implementation.
