---
"pg-advisory-lock": patch
---

Stabilize `tryLock` as a supported manual-lifecycle API.
Unlock functions are now idempotent and report when their connection no longer owns the lock.
