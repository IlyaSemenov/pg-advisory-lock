import { afterEach, beforeEach, describe, expect, it } from "bun:test"

import {
  type AdvisoryLockManager,
  createAdvisoryLockManager,
  deriveAdvisoryLockKey,
} from "pg-advisory-lock"
import postgres from "postgres"

import { databaseUrl } from "#test-utils"

describe("lock keys", () => {
  let locks: AdvisoryLockManager
  let sql: postgres.Sql

  beforeEach(() => {
    locks = createAdvisoryLockManager(databaseUrl)
    sql = postgres(databaseUrl)
  })

  afterEach(async () => {
    await locks.close()
    await sql.end()
  })

  async function isKeyAvailable(key: bigint) {
    const [{ available }] = await sql<[{ available: boolean }]>`
      SELECT pg_try_advisory_xact_lock(${String(key)}::int8) AS available
    `
    return available
  }

  it("locks the derived key for a name", async () => {
    const key = deriveAdvisoryLockKey("keys:name")

    await locks.withLock("keys:name", async () => {
      expect(await isKeyAvailable(key)).toBe(false)
    })
    expect(await isKeyAvailable(key)).toBe(true)
  })

  it("locks the derived key for a namespaced name", async () => {
    const key = deriveAdvisoryLockKey("keys:name", ["tenant-a", "jobs"])

    await locks
      .namespace("tenant-a")
      .namespace("jobs")
      .withLock("keys:name", async () => {
        expect(await isKeyAvailable(key)).toBe(false)
      })
  })

  it("locks a raw bigint key", async () => {
    for (const key of [42n, -(2n ** 63n), 2n ** 63n - 1n]) {
      await locks.withLock(key, async () => {
        expect(await isKeyAvailable(key)).toBe(false)
      })
    }
  })

  it("coordinates a name and its derived raw key", async () => {
    await locks.withLock("keys:shared", async () => {
      const contender = createAdvisoryLockManager(databaseUrl)
      try {
        expect(
          await contender.tryWithLock(
            deriveAdvisoryLockKey("keys:shared"),
            async () => "unexpected",
          ),
        ).toEqual({ acquired: false })
      } finally {
        await contender.close()
      }
    })
  })

  it("rejects keys outside the signed 64-bit range", async () => {
    await expect(locks.withLock(2n ** 63n, async () => {})).rejects.toThrow(
      RangeError,
    )
  })
})
