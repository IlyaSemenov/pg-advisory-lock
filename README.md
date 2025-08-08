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

const databaseUrl = "postgresql://user:pass@localhost/db"
const { createMutex, withLock } = createAdvisoryLock(databaseUrl)

await withLock("my-resource", async () => {
  // Critical section - only one process can execute this at a time
  console.log("Doing exclusive work...")
  await someAsyncWork()
  // Lock is automatically released when function completes or throws
})
```

or use a mutex instance:

```ts
const mutex = createMutex("my-resource")
await mutex.withLock(async () => {
  // Your exclusive code here
})
```

### Using with Existing Connection Pool

```ts
import { Pool } from "pg"
import { createAdvisoryLock } from "pg-advisory-lock"

const pool = new Pool({ connectionString: "postgresql://..." })
const { createMutex, withLock } = createAdvisoryLock(pool)

await withLock("my-resource", async () => {
  // Your exclusive code here
})
```

### Non-blocking Lock Attempts

```ts
const { createMutex, tryWithLock } = createAdvisoryLock("postgresql://...")

const result = await tryWithLock("my-resource", async () => {
  // We got the lock, do exclusive work
  console.log("Lock acquired!")
  return await someWork()
})

if (result.acquired) {
  console.log("Work completed:", result.result)
} else {
  console.log("Lock not available, skipping work")
}
```

or use a mutex instance:

```ts
const mutex = createMutex("my-resource")
const result = await mutex.tryWithLock(async () => {
  console.log("Lock acquired!")
  return await someWork()
})

if (result.acquired) {
  console.log("Work completed:", result.result)
} else {
  console.log("Lock not available, skipping work")
}
```

> **Note**: The library also includes low-level `tryLock` methods that return unlock functions (similar to the `advisory-lock` API), but using `tryWithLock` is recommended as it automatically handles lock cleanup and provides a cleaner API.

## Lock Names and IDs

Lock names are converted to numeric IDs using a hash function (namely, 64-bit `djb2`). This means:

- The same name will always produce the same lock ID
- Different names will (very likely) produce different lock IDs
- Lock names are case-sensitive

## Nested Locks

The library supports nested lock calls with the same key within the same async context:

```ts
await withLock("my-resource", async () => {
  console.log("Outer lock acquired")

  // This will not deadlock - it reuses the same database connection
  await withLock("my-resource", async () => {
    console.log("Nested lock acquired")
    // Both locks are effectively held by the same connection
  })

  console.log("Back to outer lock")
  // Lock is released when the outermost function completes
})
```

**Note**: This connection reuse only applies within the same async execution context. Concurrent calls from different execution contexts will still properly block each other as expected.

## API

### `createAdvisoryLock(connection)`

Creates an advisory lock factory with methods for creating mutexes and acquiring locks.

- `connection`: Either a PostgreSQL connection string or a `pg.Pool` instance

Returns an object with:

- `createMutex(name)`: Creates a mutex for the given resource name
- `withLock(name, fn)`: Convenience method to acquire a lock and execute a function
- `tryWithLock(name, fn)`: Convenience method to attempt acquiring a lock and execute a function without blocking
- `tryLock(name)`: Low-level method to attempt acquiring a lock without blocking (discouraged, use `tryWithLock` instead)

### `createMutex(name)`

Creates a mutex for the given resource name.

- `name`: A string identifier for the resource to lock

Returns a `Mutex` instance.

### `withLock(name, fn)`

Convenience method that creates a mutex and immediately executes a function with the lock.

- `name`: A string identifier for the resource to lock
- `fn`: An async function to execute while holding the lock

Returns the result of the function. The lock is released even if the function throws an error.

### `tryWithLock(name, fn)`

Convenience method that creates a mutex and attempts to acquire the lock without blocking, executing the function if successful.

- `name`: A string identifier for the resource to lock
- `fn`: An async function to execute while holding the lock

Returns:

- `{ acquired: false }` if the lock is not available
- `{ acquired: true, result: T }` if the lock was acquired and the function executed successfully

### `tryLock(name)`

Low-level convenience method that creates a mutex and attempts to acquire the lock without blocking. **Note**: Using `tryWithLock` is recommended instead.

- `name`: A string identifier for the resource to lock

Returns:

- An unlock function if the lock was acquired
- `undefined` if the lock is not available

### `mutex.withLock(fn)`

Acquires the lock, executes the function, and automatically releases the lock.

- `fn`: An async function to execute while holding the lock

Returns the result of the function. The lock is released even if the function throws an error.

### `mutex.tryWithLock(fn)`

Attempts to acquire the lock without blocking and executes the provided function if successful.

- `fn`: An async function to execute while holding the lock

Returns:

- `{ acquired: false }` if the lock is not available
- `{ acquired: true, result: T }` if the lock was acquired and the function executed successfully

### `mutex.tryLock()`

Low-level method that attempts to acquire the lock without blocking. **Note**: Using `tryWithLock` is recommended instead.

Returns:

- An unlock function if the lock was acquired
- `undefined` if the lock is not available

### `createAdvisoryLockKey(str)`

Generates a lock key from a string.

Returns a 64-bit signed `BigInt`.
