import { describe, expect, test } from "bun:test"

import { createAdvisoryLockManager } from "pg-advisory-lock"
import postgres from "postgres"

import { databaseUrl } from "#test-utils"

describe("createAdvisoryLockManager connection types", () => {
  test("connection with string", async () => {
    const { withLock } = createAdvisoryLockManager(databaseUrl)
    const result = await withLock("test", async () => "success")
    expect(result).toBe("success")
  })

  test("connection with options", async () => {
    const url = new URL(databaseUrl)
    const { withLock } = createAdvisoryLockManager({
      database: url.pathname.slice(1) || undefined,
      host: url.hostname,
      pass: url.password || undefined,
      port: url.port ? Number(url.port) : undefined,
      user: url.username || undefined,
    })
    const result = await withLock("test", async () => "success")
    expect(result).toBe("success")
  })

  test("connection with existing sql instance", async () => {
    const sql = postgres(databaseUrl)
    try {
      const { withLock } = createAdvisoryLockManager(sql)
      const result = await withLock("test", async () => "success")
      expect(result).toBe("success")
    } finally {
      await sql.end()
    }
  })
})
