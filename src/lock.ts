import { Pool } from "pg"

import { AdvisoryLockMutex } from "./mutex"

export function createAdvisoryLock(connection: string | Pool) {
  const pool = typeof connection === "string"
    ? new Pool({ connectionString: connection })
    : connection

  return function createMutex(name: string) {
    return new AdvisoryLockMutex(pool, name)
  }
}
