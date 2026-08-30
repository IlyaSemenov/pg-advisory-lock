# pg-advisory-lock

## 2.1.0

### Minor Changes

- 7174aeb: Add an in-memory test advisory lock manager under `pg-advisory-lock/testing`.

## 2.0.0

### Major Changes

- 2d0ce0e: Replace the `pg` driver with `postgres.js`.
  `createAdvisoryLockManager` now accepts a connection string, native postgres.js options, or an existing `postgres.Sql` instance.
- c6e2d42: Rename the factory and public types to `createAdvisoryLockManager`, `AdvisoryLockManager`, `AdvisoryLockKeyspace`, and `AdvisoryMutex`; create mutex instances through `createMutex()` rather than a public constructor.
  Add composable `namespace` keyspaces that fold string namespaces into the PostgreSQL hash seed in call order.
- 582b3a8: Generate advisory lock keys in PostgreSQL with `hashtextextended` and a deterministic collation.
  Remove the public `createAdvisoryLockKey` function and its client-side DJB2 implementation.

### Minor Changes

- 792166a: Accept native postgres.js options for `createAdvisoryLockManager()`.
- 2e84ae5: Add `close()` for graceful advisory lock manager shutdown.
  It stops new acquisitions, waits for active locks, and closes only postgres.js instances created by the library.

### Patch Changes

- 5a59020: Fix nested `tryWithLock`.
- a305048: Stabilize `tryLock` as a supported manual-lifecycle API.
  Unlock functions are now idempotent and report when their connection no longer owns the lock.
- 029e3fb: Avoid reusing a released connection from an inherited async context.

## 1.4.0

### Minor Changes

- 537a184: Add `wrapWithLock` method.

## 1.3.0

### Minor Changes

- 3eeb5b7: Add support for nested locks within the same async context.

## 1.2.1

### Patch Changes

- 9f03026: Fix ESM build unable to import pg without transpile.

## 1.2.0

### Minor Changes

- 8624dcb: Add `tryWithLock`.

## 1.1.0

### Minor Changes

- bf94952: Export convenience shortcuts `withLock`, `tryLock`.

## 1.0.1

### Patch Changes

- c0a9365: `Mutex` -> `AdvisoryLockMutex`
- 6182df2: Export `createAdvisoryLockKey`.

## 1.0.0

### Major Changes

- a1cbbb3: Initial release.
