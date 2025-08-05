// pg is a CommonJS package, so for ESM compatibility it must be imported as a default import
import pg from "pg"

import type { TryWithLockResult } from "./mutex"
import { AdvisoryLockMutex } from "./mutex"

export function createAdvisoryLock(connection: string | pg.Pool) {
  const pool = typeof connection === "string"
    ? new pg.Pool({ connectionString: connection })
    : connection

  /**
   * Creates a new mutex.
   */
  function createMutex(name: string) {
    return new AdvisoryLockMutex(pool, name)
  }

  /**
   * Acquires the lock and execute the provided function.
   */
  async function withLock<T>(name: string, fn: () => PromiseLike<T>): Promise<T> {
    return createMutex(name).withLock(fn)
  }

  /**
   * Attempts to acquire the lock without blocking.
   *
   * @returns an unlock function if successful, or `undefined` if the lock is not available.
   */
  async function tryLock(name: string): Promise<(() => Promise<void>) | undefined> {
    return createMutex(name).tryLock()
  }

  /**
   * Attempts to acquire the lock without blocking and execute the provided function if successful.
   *
   * @returns
   *  - `{ acquired: false }` if the lock is not available
   *  - `{ acquired: true, result: T }` if the lock was acquired and the function executed
   */
  async function tryWithLock<T>(name: string, fn: () => PromiseLike<T>): Promise<TryWithLockResult<T>> {
    return createMutex(name).tryWithLock(fn)
  }

  return { createMutex, withLock, tryLock, tryWithLock }
}
