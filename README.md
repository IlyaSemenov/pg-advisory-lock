# pg-advisory-lock

`pg-advisory-lock` coordinates exclusive work between application instances through PostgreSQL session-level advisory locks.
It is useful when the protected work includes external I/O, non-transactional operations, or multiple database transactions.

## Install

```sh
npm install pg-advisory-lock
```

Node.js 18.18 or newer and PostgreSQL 14 or newer are required.
Use a direct connection or [PgBouncer session pooling](https://www.pgbouncer.org/features.html).
PgBouncer transaction and statement pooling are unsupported.

## Quick Start

Create one manager and reuse it for the lifetime of the application:

```ts
import { createAdvisoryLockManager } from "pg-advisory-lock"

const locks = createAdvisoryLockManager(
  "postgresql://user:pass@localhost/database",
)

await locks.withLock("db:migrate", async () => {
  await runMigrations()
})

// During graceful shutdown:
await locks.close()
```

`withLock()` waits until the lock is available, runs the callback, and releases the lock whether the callback returns or throws.
It has no built-in acquisition timeout.

All applications using the same lock name in the same keyspace and connected to the same PostgreSQL database coordinate on the same advisory lock.

## Locking Operations

### Try Without Waiting

Use `tryWithLock()` when unavailable work should be skipped instead of queued:

```ts
const result = await locks.tryWithLock("reports:refresh", async () => {
  return await refreshReports()
})

if (!result.acquired) {
  console.log("Another worker is already refreshing reports")
}
```

When acquired, the result is `{ acquired: true, result }`; otherwise it is `{ acquired: false }`.

### Reusable Helpers

Create a mutex when several call sites use the same logical name, or wrap a function that should always take a lock:

```ts
const mutex = locks.createMutex("search:index")
await mutex.withLock(rebuildSearchIndex)

const rebuildExclusively = locks.wrapWithLock(
  "search:index",
  rebuildSearchIndex,
)
```

An `AdvisoryMutex` provides `withLock()`, `tryWithLock()`, `tryLock()`, and `wrapWithLock()`.

### Raw Keys

The root manager also accepts a signed 64-bit `bigint` instead of a name and uses it as the PostgreSQL advisory key directly:

```ts
await locks.withLock(42n, async () => {
  await runExclusiveJob()
})
```

Values outside the signed 64-bit range are rejected with a `RangeError`.

### Manage a Lock Across Hooks

Most code should use `withLock()` or `tryWithLock()` so release is automatic.
Use `tryLock()` when a framework only provides separate before/after hooks:

```ts
type LockContext = {
  unlock?: () => Promise<void>
}

async function before(context: LockContext) {
  context.unlock = await locks.tryLock("imports:run")
  if (!context.unlock) throw new Error("An import is already running")
}

async function after(context: LockContext) {
  await context.unlock?.()
}
```

A successful `tryLock()` reserves a connection until its idempotent unlock function is called.
The integration must guarantee that the after hook runs even when the protected work fails.

A top-level `tryLock()` does not create a nesting context for later operations.
Another top-level operation uses a different connection and will wait or fail on the same lock until `unlock()` runs.

## Namespaces

Namespaces let different tenants or subsystems reuse the same logical lock names without coordinating with each other:

```ts
const { withLock } = locks.namespace("tenant-a")

await withLock("db:migrate", async () => {
  await migrateTenant()
})
```

`locks.namespace("tenant-a")` and `locks.namespace("tenant-b")` create derived keyspaces.
The same name within one keyspace resolves to the same advisory key, while different namespaces normally resolve it to different keys.

Namespaces accept only string names, because a raw key cannot be namespaced.

Namespaces can be nested, and their order is significant:

```ts
const jobLocks = locks.namespace("tenant-a").namespace("jobs")
```

Derived keyspaces reuse the root manager's connection pool and lifecycle.
Only the root manager exposes `close()`.

## Connections and Lifecycle

Passing a connection string or postgres.js options creates a postgres.js instance owned by the manager:

```ts
const locks = createAdvisoryLockManager({
  database: "app",
  host: "db.example.com",
  idle_timeout: 30,
  user: "app",
})
```

You can instead share an existing postgres.js instance with application queries:

```ts
import postgres from "postgres"
import { createAdvisoryLockManager } from "pg-advisory-lock"

const sql = postgres("postgresql://...")
const locks = createAdvisoryLockManager(sql)
```

Each top-level acquisition reserves one connection while waiting and for the duration of its callback, or until a manual lock is released.
When application queries share the pool, lock waiters can exhaust it and prevent the current lock holder from finishing.
Use a sufficiently large shared pool or a dedicated manager pool when contention is possible.

### Closing the Manager

Derived keyspaces, mutexes, and wrapped functions share the root manager's lifecycle.
`close()` stops new top-level acquisitions and waits for existing acquisitions to finish.
It closes a postgres.js instance created by the manager, but not one supplied by the caller:

```ts
await locks.close()
await sql.end()
```

Calling it inside an active lock callback rejects to avoid waiting for that callback itself.
Shutdown may wait indefinitely for a blocking acquisition, an unfinished callback, or a forgotten manual lock.
Release every successful `tryLock()` before awaiting shutdown.

The root manager also implements the asynchronous disposal protocol, so integrations can use `Symbol.asyncDispose` instead of calling `close()` directly.

## Reentrant and Concurrent Calls

Nested calls in the same active async context reuse its PostgreSQL session and are reentrant.
The async context therefore acts as one owner, including for sibling calls:

```ts
await locks.withLock("resource", async () => {
  await Promise.all([
    locks.withLock("resource", task1),
    locks.withLock("resource", task2),
  ])
})
```

Both nested callbacks may overlap because they use the same lock-owning session.
Nested calls are therefore not an additional in-process mutex.
Independent top-level async contexts use separate sessions and coordinate through PostgreSQL.

## Failure Model

If the lock-owning PostgreSQL session is lost, PostgreSQL releases the lock while its JavaScript callback may continue running.
Another application instance can then acquire the same lock.
The library therefore does not provide fencing or exactly-once execution.
Use idempotency or fencing tokens when those guarantees are required.

Locks coordinate only within one PostgreSQL database, not across databases, clusters, primaries, or replicas.

## Session-Level and Transaction-Level Locks

This library uses session-level locks because they can protect work outside a single database transaction.
They remain held for the callback or until a manual lock is released.

When all protected work fits inside one transaction, PostgreSQL's `pg_advisory_xact_lock` may be simpler because it releases automatically at commit or rollback.
Transaction-level locks and this manager have different lifecycles and are not interchangeable.

PostgreSQL makes session-level and transaction-level locks on the same key conflict across sessions.
Use [`deriveAdvisoryLockKey()`](#lock-key-derivation) to take a transaction-level lock that coordinates with a named lock of this manager:

```ts
const key = deriveAdvisoryLockKey("db:migrate")

await sql.begin(async (sql) => {
  await sql`SELECT pg_advisory_xact_lock(${String(key)}::int8)`
  await migrate(sql)
})
```

## Lock Key Derivation

A name in the root keyspace maps to the first 8 bytes of its UTF-8 SHA-256 digest, read as a signed big-endian 64-bit integer:

```ts
import { createHash } from "node:crypto"

const key = createHash("sha256").update(name).digest().readBigInt64BE()
```

Namespaces derive a seed that is prepended to the hashed name.
Given `S₀` as an empty byte string and `Sₙ = SHA-256(Sₙ₋₁ ‖ namespaceₙ)`, a name in `n` nested namespaces maps to the first 8 bytes of `SHA-256(Sₙ ‖ name)`.

This derivation is a stable contract, so keys can be computed outside this package.
`deriveAdvisoryLockKey()` implements it:

```ts
import { deriveAdvisoryLockKey } from "pg-advisory-lock"

deriveAdvisoryLockKey("db:migrate")
deriveAdvisoryLockKey("db:migrate", ["tenant-a", "jobs"])
```

The second call returns the key used by `locks.namespace("tenant-a").namespace("jobs")`.

Names are case-sensitive.
Different names, namespace chains, or raw keys can theoretically collide in the 64-bit keyspace.

## Testing

Use `pg-advisory-lock/testing` to test code against the manager contract without connecting to PostgreSQL:

```ts
import { createTestAdvisoryLockManager } from "pg-advisory-lock/testing"

const locks = createTestAdvisoryLockManager()
```

If a test needs multiple managers connected to the same PostgreSQL lock space, create and pass shared state:

```ts
import {
  createTestAdvisoryLockManager,
  createTestAdvisoryLockState,
} from "pg-advisory-lock/testing"

const state = createTestAdvisoryLockState()
const locks1 = createTestAdvisoryLockManager({ state })
const locks2 = createTestAdvisoryLockManager({ state })
```

## Acknowledgments

Originally inspired by [advisory-lock](https://github.com/olalonde/advisory-lock).
