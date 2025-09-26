import pg from "pg"
import { createAdvisoryLock } from "pg-advisory-lock"
import { describe, expect, test } from "vitest"

import { databaseUrl } from "#test-utils"

describe("createAdvisoryLock connection types", () => {
  test("connection with string", async () => {
    const { withLock } = createAdvisoryLock(databaseUrl)
    const result = await withLock("test", async () => "success")
    expect(result).toBe("success")
  })

  test("connection with options", async () => {
    const { withLock } = createAdvisoryLock({ connectionString: databaseUrl })
    const result = await withLock("test", async () => "success")
    expect(result).toBe("success")
  })

  test("should throw with default pool idleTimeoutMillis", async () => {
    const pool = new pg.Pool({ connectionString: databaseUrl })
    try {
      const { withLock } = createAdvisoryLock(pool)
      const result = await withLock("test", async () => "success")
      expect(result).toBe("success")
    } finally {
      await pool.end()
    }
  })
})
