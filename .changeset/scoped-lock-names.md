---
"pg-advisory-lock": major
---

Rename the factory and public types to `createAdvisoryLockManager`, `AdvisoryLockManager`, `AdvisoryLockKeyspace`, and `AdvisoryMutex`; create mutex instances through `createMutex()` rather than a public constructor.
Add composable `namespace` keyspaces that fold string namespaces into the PostgreSQL hash seed in call order.
