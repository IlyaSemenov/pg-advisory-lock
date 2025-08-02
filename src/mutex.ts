import type { Pool } from "pg"

import { createAdvisoryLockKey } from "./key"

export type TryWithLockResult<T> = { acquired: false } | { acquired: true, result: T }

export class AdvisoryLockMutex {
  private readonly pool: Pool
  private readonly lockKey: bigint

  constructor(pool: Pool, name: string) {
    this.pool = pool
    this.lockKey = createAdvisoryLockKey(name)
  }

  /**
   * Acquires the lock and executes the provided function.
   */
  async withLock<T>(fn: () => PromiseLike<T>): Promise<T> {
    const client = await this.pool.connect()
    try {
      // Acquire the advisory lock (blocks until available)
      await client.query("SELECT pg_advisory_lock($1)", [this.lockKey])

      try {
        return await fn()
      } finally {
        // Always release the lock
        await client.query("SELECT pg_advisory_unlock($1)", [this.lockKey])
      }
    } finally {
      // Always return the client to the pool
      client.release()
    }
  }

  /**
   * Attempts to acquire the lock without blocking.
   *
   * @returns an unlock function if successful, or `undefined` if the lock is not available.
   */
  async tryLock(): Promise<(() => Promise<void>) | undefined> {
    const client = await this.pool.connect()

    try {
      // Try to acquire the advisory lock (non-blocking)
      const result = await client.query("SELECT pg_try_advisory_lock($1) as acquired", [this.lockKey])
      const acquired = result.rows[0]?.acquired

      if (acquired) {
        // Return unlock function that releases the lock and returns the client
        return async () => {
          try {
            await client.query("SELECT pg_advisory_unlock($1)", [this.lockKey])
          } finally {
            client.release()
          }
        }
      } else {
        // Lock not available, return client to pool
        client.release()
        return undefined
      }
    } catch (error) {
      // On error, return client to pool and re-throw
      client.release()
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
}
