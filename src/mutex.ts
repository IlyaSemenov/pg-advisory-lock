import { createAdvisoryLockKey } from "./key"
import type { NestingPool } from "./pool"

export type TryWithLockResult<T> = { acquired: false } | { acquired: true, result: T }

export class AdvisoryLockMutex {
  private readonly pool: NestingPool
  private readonly lockKey: bigint

  constructor(pool: NestingPool, name: string) {
    this.pool = pool
    this.lockKey = createAdvisoryLockKey(name)
  }

  /**
   * Acquires the lock and executes the provided function.
   */
  async withLock<T>(fn: () => PromiseLike<T>): Promise<T> {
    return await this.pool.withClient(async (client) => {
      // Acquire the advisory lock (blocks until available)
      await client.query("SELECT pg_advisory_lock($1)", [this.lockKey])

      try {
        return await fn()
      } finally {
        // Always release the lock
        await client.query("SELECT pg_advisory_unlock($1)", [this.lockKey])
      }
    })
  }

  /**
   * Attempts to acquire the lock without blocking.
   *
   * @returns an unlock function if successful, or `undefined` if the lock is not available.
   */
  async tryLock(): Promise<(() => Promise<void>) | undefined> {
    const { client, release } = await this.pool.getClient()

    try {
      // Try to acquire the advisory lock (non-blocking)
      const result = await client.query("SELECT pg_try_advisory_lock($1) as acquired", [this.lockKey])
      const acquired = result.rows[0]?.acquired

      if (acquired) {
        // Return unlock function that releases the lock and releases the client
        return async () => {
          try {
            await client.query("SELECT pg_advisory_unlock($1)", [this.lockKey])
          } finally {
            release()
          }
        }
      } else {
        // Lock not available, release the client immediately
        release()
        return undefined
      }
    } catch (error) {
      // On error, release the client and re-throw
      release()
      throw error
    }
  }

  /**
   * Attempts to acquire the lock without blocking and execute the provided function if successful.
   *
   * @returns
   *  - `{ acquired: false }` if the lock is not available
   *  - `{ acquired: true, result: T }` if the lock was acquired and the function executed
   */
  async tryWithLock<T>(fn: () => PromiseLike<T>): Promise<TryWithLockResult<T>> {
    const unlock = await this.tryLock()
    if (unlock) {
      try {
        const result = await fn()
        return { acquired: true, result }
      } finally {
        await unlock()
      }
    } else {
      return { acquired: false }
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
