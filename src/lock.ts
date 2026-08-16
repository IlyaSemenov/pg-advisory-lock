import postgres from "postgres"

import type { TryWithLockResult } from "./mutex"
import { AdvisoryLockMutex } from "./mutex"
import { NestingPool } from "./pool"

type PostgresOptions = postgres.Options<Record<string, postgres.PostgresType>>

export function createAdvisoryLock(
  connection: string | PostgresOptions | postgres.Sql,
) {
  const ownsPool = typeof connection !== "function"
  const basePool =
    typeof connection === "function"
      ? connection
      : typeof connection === "string"
        ? postgres(connection)
        : postgres(connection)

  const pool = new NestingPool(
    basePool,
    ownsPool ? () => basePool.end() : undefined,
  )

  /**
   * Creates a new mutex.
   */
  function createMutex(name: string) {
    return new AdvisoryLockMutex(pool, name)
  }

  /**
   * Acquires the lock and execute the provided function.
   */
  async function withLock<T>(
    name: string,
    fn: () => PromiseLike<T>,
  ): Promise<T> {
    return createMutex(name).withLock(fn)
  }

  /**
   * Attempts to acquire the lock without blocking and execute the provided function if successful.
   *
   * @returns
   *  - `{ acquired: false }` if the lock is not available
   *  - `{ acquired: true, result: T }` if the lock was acquired and the function executed
   */
  async function tryWithLock<T>(
    name: string,
    fn: () => PromiseLike<T>,
  ): Promise<TryWithLockResult<T>> {
    return createMutex(name).tryWithLock(fn)
  }

  /**
   * Attempts to acquire the lock without blocking.
   *
   * The returned unlock function is idempotent and must be called to release the lock and its connection.
   *
   * @returns an unlock function if successful, or `undefined` if the lock is not available.
   */
  async function tryLock(
    name: string,
  ): Promise<(() => Promise<void>) | undefined> {
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

  /**
   * Stops new lock acquisitions, waits for active locks, and closes an internally created postgres.js instance.
   *
   * An existing `postgres.Sql` instance remains owned by the caller.
   */
  function close(): Promise<void> {
    return pool.close()
  }

  return { close, createMutex, withLock, tryLock, tryWithLock, wrapWithLock }
}
