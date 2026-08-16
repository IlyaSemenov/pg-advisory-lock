---
"pg-advisory-lock": minor
---

Add `close()` for graceful advisory lock factory shutdown.
It stops new acquisitions, waits for active locks, and closes only postgres.js instances created by the library.
