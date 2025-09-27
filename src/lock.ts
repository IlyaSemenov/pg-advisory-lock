// pg is a CommonJS package, so for ESM compatibility it must be imported as a default import
import pg from "pg"

import type { TryWithLockResult } from "./mutex"
import { AdvisoryLockMutex } from "./mutex"
import { NestingPool } from "./pool"

export function createAdvisoryLock(connection: string | pg.PoolConfig | pg.Pool) {
  const basePool = connection instanceof pg.Pool
    ? connection
    : new pg.Pool(typeof connection === "object" ? connection : { connectionString: connection })

  const pool = new NestingPool(basePool)

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
   * Attempts to acquire the lock without blocking and execute the provided function if successful.
   *
   * @returns
   *  - `{ acquired: false }` if the lock is not available
   *  - `{ acquired: true, result: T }` if the lock was acquired and the function executed
   */
  async function tryWithLock<T>(name: string, fn: () => PromiseLike<T>): Promise<TryWithLockResult<T>> {
    return createMutex(name).tryWithLock(fn)
  }

  /**
   * Attempts to acquire the lock without blocking.
   *
   * @returns an unlock function if successful, or `undefined` if the lock is not available.
   *
   * @deprecated Use `tryWithLock` instead. This method does not work reliably for nested locks.
   */
  async function tryLock(name: string): Promise<(() => Promise<void>) | undefined> {
    return createMutex(name).tryLock()
  }

  /**
   * Wraps a function to always acquire a lock before calling it.
   *
   * @param name - The resource name to lock
   * @param fn - The function to wrap
   * @returns A wrapped function that acquires the lock before calling the original function
   */
  function wrapWithLock<TArgs extends readonly unknown[], TReturn>(
    name: string,
    fn: (...args: TArgs) => PromiseLike<TReturn>,
  ): (...args: TArgs) => Promise<TReturn> {
    return createMutex(name).wrapWithLock(fn)
  }

  return { createMutex, withLock, tryLock, tryWithLock, wrapWithLock }
}
