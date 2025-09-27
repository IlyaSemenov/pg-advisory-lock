# pg-advisory-lock

## 1.5.0

### Minor Changes

- 792166a: Accept custom pool options for `createAdvisoryLock()`.

### Patch Changes

- 5a59020: Fix nested `tryWithLock`.

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
