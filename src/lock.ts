import { Pool } from "pg"

import { AdvisoryLockMutex } from "./mutex"

export function createAdvisoryLock(connection: string | Pool) {
  const pool = typeof connection === "string"
    ? new Pool({ connectionString: connection })
    : connection

  function createMutex(name: string) {
    return new AdvisoryLockMutex(pool, name)
  }

  async function withLock<T>(name: string, fn: () => PromiseLike<T>): Promise<T> {
    return createMutex(name).withLock(fn)
  }

  async function tryLock(name: string): Promise<(() => Promise<void>) | undefined> {
    return createMutex(name).tryLock()
  }

  return { createMutex, withLock, tryLock }
}
