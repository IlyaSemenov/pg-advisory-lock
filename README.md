# pg-advisory-lock

A TypeScript library for PostgreSQL advisory locks, providing distributed mutex functionality for Node.js applications.

This is a modern rewrite of [advisory-lock](https://github.com/olalonde/advisory-lock) which seemed to be unmaintained.

## What are PostgreSQL Advisory Locks?

PostgreSQL advisory locks are application-level locks that use the database to coordinate access to shared resources. Unlike table-level locks, advisory locks:

- Are completely controlled by your application
- Don't lock any table data
- Are automatically released when the database session ends
- Can be used to implement distributed mutexes across multiple processes/servers

## Use Cases

- **Job Processing**: Ensure only one worker processes a specific job
- **Database Migrations**: Coordinate schema changes across deployments
- **Resource Initialization**: Ensure expensive resources are initialized only once

## Install

```sh
npm install pg-advisory-lock
```

## Usage

### Basic Usage with Database URL

```ts
import { createAdvisoryLock } from "pg-advisory-lock"

const createMutex = createAdvisoryLock("postgresql://user:pass@localhost/db")
const mutex = createMutex("my-resource")

// Blocking lock - waits until lock is available
await mutex.withLock(async () => {
  // Critical section - only one process can execute this at a time
  console.log("Doing exclusive work...")
  await someAsyncWork()
  // Lock is automatically released when function completes or throws
})
```

### Using with Existing Connection Pool

```ts
import { Pool } from "pg"
import { createAdvisoryLock } from "pg-advisory-lock"

const pool = new Pool({ connectionString: "postgresql://..." })
const createMutex = createAdvisoryLock(pool)
const mutex = createMutex("my-resource")

await mutex.withLock(async () => {
  // Your exclusive code here
})
```

### Non-blocking Lock Attempts

```ts
const mutex = createMutex("my-resource")

// Try to acquire lock without waiting
const unlock = await mutex.tryLock()
if (unlock) {
  try {
    // We got the lock, do exclusive work
    console.log("Lock acquired!")
    await someWork()
  } finally {
    // Always release the lock
    await unlock()
  }
} else {
  console.log("Lock not available, skipping work")
}
```

## Lock Names and IDs

Lock names are converted to numeric IDs using a hash function (namely, 64-bit `djb2`). This means:

- The same name will always produce the same lock ID
- Different names will (very likely) produce different lock IDs
- Lock names are case-sensitive

## API

### `createAdvisoryLock(connection)`

Creates a factory function for creating mutexes.

- `connection`: Either a PostgreSQL connection string or a `pg.Pool` instance

Returns a function that creates mutex instances.

### `createMutex(name)`

Creates a mutex for the given resource name.

- `name`: A string identifier for the resource to lock

Returns a `Mutex` instance.

### `mutex.withLock(fn)`

Acquires the lock, executes the function, and automatically releases the lock.

- `fn`: An async function to execute while holding the lock

Returns the result of the function. The lock is released even if the function throws an error.

### `mutex.tryLock()`

Attempts to acquire the lock without blocking.

Returns:

- An unlock function if the lock was acquired
- `null` if the lock is not available

### `createAdvisoryLockKey(str)`

Generates a lock key from a string.

Returns a 64-bit signed `BigInt`.
