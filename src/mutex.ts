import type { ReservedSql } from "postgres"

import type { NestingPool } from "./pool"

/**
 * The discriminated result of a non-blocking lock attempt with a callback.
 */
export type TryWithLockResult<T> =
  | { acquired: false }
  | { acquired: true; result: T }

/**
 * A reusable mutex bound to one logical advisory lock name and its namespaces.
 */
export interface AdvisoryMutex {
  tryLock(): Promise<(() => Promise<void>) | undefined>
  tryWithLock<T>(fn: () => PromiseLike<T>): Promise<TryWithLockResult<T>>
  withLock<T>(fn: () => PromiseLike<T>): Promise<T>
  wrapWithLock<TArgs extends readonly unknown[], TReturn>(
    fn: (...args: TArgs) => PromiseLike<TReturn>,
  ): (...args: TArgs) => Promise<TReturn>
}

class PostgresAdvisoryMutex implements AdvisoryMutex {
  private readonly name: string
  private readonly namespaces: readonly string[]
  private readonly pool: NestingPool

  constructor(
    pool: NestingPool,
    name: string,
    namespaces: readonly string[] = [],
  ) {
    this.name = name
    this.namespaces = namespaces
    this.pool = pool
  }

  private lockKey(client: ReservedSql) {
    const zero = client`0`
    const hash = (value: string, seed: typeof zero) =>
      client`hashtextextended(${value}::text COLLATE "C", ${seed})`

    let seed = zero
    for (const namespace of this.namespaces) {
      seed = hash(namespace, seed)
    }

    return hash(this.name, seed)
  }

  private async lock(client: ReservedSql): Promise<void> {
    await client`
      SELECT
      FROM (SELECT pg_advisory_lock(${this.lockKey(client)})) AS control
      OFFSET 1
    `
  }

  private async tryToLock(client: ReservedSql): Promise<boolean> {
    const result = await client`
      SELECT
      FROM (
        SELECT pg_try_advisory_lock(${this.lockKey(client)}) AS succeeded
      ) AS control
      -- Keep success rowless: postgres.js row transforms can throw after acquisition.
      WHERE NOT succeeded
    `
    return result.count === 0
  }

  private async unlock(client: ReservedSql): Promise<boolean> {
    const result = await client`
      SELECT
      FROM (
        SELECT pg_advisory_unlock(${this.lockKey(client)}) AS succeeded
      ) AS control
      -- Keep success rowless: postgres.js row transforms can throw after release.
      WHERE NOT succeeded
    `
    return result.count === 0
  }

  /**
   * Acquires the lock and executes the provided function.
   */
  async withLock<T>(fn: () => PromiseLike<T>): Promise<T> {
    return await this.pool.withClient(async (client) => {
      await this.lock(client)

      try {
        return await fn()
      } finally {
        await this.unlock(client)
      }
    })
  }

  /**
   * Attempts to acquire the lock without blocking and execute the provided function if successful.
   *
   * @returns
   *  - `{ acquired: false }` if the lock is not available
   *  - `{ acquired: true, result: T }` if the lock was acquired and the function executed
   */
  async tryWithLock<T>(
    fn: () => PromiseLike<T>,
  ): Promise<TryWithLockResult<T>> {
    return await this.pool.withClient(async (client) => {
      if (await this.tryToLock(client)) {
        try {
          return { acquired: true, result: await fn() }
        } finally {
          await this.unlock(client)
        }
      } else {
        return { acquired: false }
      }
    })
  }

  /**
   * Attempts to acquire the lock without blocking.
   *
   * The returned unlock function is idempotent and must be called to release the lock and its connection.
   *
   * @returns an unlock function if successful, or `undefined` if the lock is not available.
   */
  async tryLock(): Promise<(() => Promise<void>) | undefined> {
    const { client, release } = await this.pool.getClient()

    try {
      if (await this.tryToLock(client)) {
        let unlockPromise: Promise<void> | undefined
        return () => {
          unlockPromise ??= (async () => {
            try {
              if (!(await this.unlock(client))) {
                throw new Error(
                  "Advisory lock is no longer held by its connection",
                )
              }
            } finally {
              release()
            }
          })()
          return unlockPromise
        }
      } else {
        release()
        return undefined
      }
    } catch (error) {
      release()
      throw error
    }
  }

  /**
   * Wraps a function to always acquire this mutex's lock before calling it.
   *
   * @param fn - The function to wrap
   * @returns A wrapped function that acquires the lock before calling the original function
   */
  wrapWithLock<TArgs extends readonly unknown[], TReturn>(
    fn: (...args: TArgs) => PromiseLike<TReturn>,
  ): (...args: TArgs) => Promise<TReturn> {
    return async (...args: TArgs) => this.withLock(() => fn(...args))
  }
}

/** Creates a mutex bound to a logical name and namespace chain. */
export function createAdvisoryMutex(
  pool: NestingPool,
  name: string,
  namespaces: readonly string[] = [],
): AdvisoryMutex {
  return new PostgresAdvisoryMutex(pool, name, namespaces)
}
