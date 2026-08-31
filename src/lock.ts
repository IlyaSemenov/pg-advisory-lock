import postgres from "postgres"

import type { AdvisoryMutex, TryWithLockResult } from "./mutex"
import { createAdvisoryMutex } from "./mutex"
import { NestingPool } from "./pool"

type PostgresOptions = postgres.Options<Record<string, postgres.PostgresType>>

/**
 * A configured mapping from logical lock names to PostgreSQL advisory keys.
 *
 * Namespaces share the root manager's connection lifecycle.
 */
export interface AdvisoryLockKeyspace {
  createMutex(name: string): AdvisoryMutex
  /** Creates an isolated nested namespace within this keyspace. */
  namespace(value: string): AdvisoryLockKeyspace
  tryLock(name: string): Promise<(() => Promise<void>) | undefined>
  tryWithLock<T>(
    name: string,
    fn: () => PromiseLike<T>,
  ): Promise<TryWithLockResult<T>>
  withLock<T>(name: string, fn: () => PromiseLike<T>): Promise<T>
  wrapWithLock<TArgs extends readonly unknown[], TReturn>(
    name: string,
    fn: (...args: TArgs) => PromiseLike<TReturn>,
  ): (...args: TArgs) => Promise<TReturn>
}

/**
 * The root advisory lock manager, including ownership of its connection lifecycle.
 */
export interface AdvisoryLockManager
  extends AdvisoryLockKeyspace,
    AsyncDisposable {
  /** Stops new acquisitions, waits for active locks, and closes owned connections. */
  close(): Promise<void>
}

/**
 * Creates an advisory lock manager backed by PostgreSQL session-level locks.
 *
 * Connection strings and options create an internally owned postgres.js instance.
 * A provided `postgres.Sql` instance remains owned by the caller.
 *
 * @param connection - A PostgreSQL connection string, postgres.js options, or an existing `postgres.Sql` instance.
 * @returns The root lock manager with namespaced operations and lifecycle control.
 */
export function createAdvisoryLockManager(
  connection: string | PostgresOptions | postgres.Sql,
): AdvisoryLockManager {
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

  function createKeyspace(namespaces: readonly string[]): AdvisoryLockKeyspace {
    const createMutex = (name: string) =>
      createAdvisoryMutex(pool, name, namespaces)

    return {
      createMutex,
      namespace: (value) => createKeyspace([...namespaces, value]),
      tryLock: (name) => createMutex(name).tryLock(),
      tryWithLock: (name, fn) => createMutex(name).tryWithLock(fn),
      withLock: (name, fn) => createMutex(name).withLock(fn),
      wrapWithLock: (name, fn) => createMutex(name).wrapWithLock(fn),
    }
  }

  const close = () => pool.close()
  return {
    ...createKeyspace([]),
    close,
    [Symbol.asyncDispose]: close,
  }
}
