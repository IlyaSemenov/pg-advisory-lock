import { Pool } from "pg"

import { Mutex } from "./mutex"

export function createAdvisoryLock(connection: string | Pool) {
  const pool = typeof connection === "string"
    ? new Pool({ connectionString: connection })
    : connection

  return function createMutex(name: string) {
    return new Mutex(pool, name)
  }
}
