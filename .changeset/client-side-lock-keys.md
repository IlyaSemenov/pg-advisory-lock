---
"pg-advisory-lock": major
---

Derive advisory lock keys in Node.js from SHA-256 of the lock name and namespace chain, expose the derivation as `deriveAdvisoryLockKey()`, and accept a signed 64-bit `bigint` as a raw key in root manager lock operations.
Keys differ from 2.x, so 2.x and 3.x instances do not coordinate on the same lock names.
