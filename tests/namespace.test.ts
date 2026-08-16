import { afterEach, beforeEach, describe, expect, it } from "bun:test"

import {
  type AdvisoryLockManager,
  createAdvisoryLockManager,
} from "pg-advisory-lock"
import postgres from "postgres"

import { databaseUrl } from "#test-utils"

describe("namespace", () => {
  let contenderLocks: AdvisoryLockManager
  let holderLocks: AdvisoryLockManager

  beforeEach(() => {
    contenderLocks = createAdvisoryLockManager(databaseUrl)
    holderLocks = createAdvisoryLockManager(databaseUrl)
  })

  afterEach(async () => {
    await Promise.all([contenderLocks.close(), holderLocks.close()])
  })

  it("isolates string namespaces", async () => {
    await holderLocks.namespace("tenant-a").withLock("job:1", async () => {
      const sameNamespace = await contenderLocks
        .namespace("tenant-a")
        .tryWithLock("job:1", async () => "unexpected")
      const otherNamespace = await contenderLocks
        .namespace("tenant-b")
        .tryWithLock("job:1", async () => "success")

      expect(sameNamespace).toEqual({ acquired: false })
      expect(otherNamespace).toEqual({ acquired: true, result: "success" })
    })
  })

  it("applies namespaces to mutexes, manual locks, and wrappers", async () => {
    const tenantLocks = holderLocks.namespace("tenant-a")
    const unlock = await tenantLocks.createMutex("job:2").tryLock()
    if (!unlock) throw new Error("Expected to acquire the lock")

    try {
      expect(
        await contenderLocks.namespace("tenant-a").tryLock("job:2"),
      ).toBeUndefined()
    } finally {
      await unlock()
    }

    const wrapped = tenantLocks.wrapWithLock("job:3", async () =>
      contenderLocks
        .namespace("tenant-a")
        .tryWithLock("job:3", async () => "unexpected"),
    )
    expect(await wrapped()).toEqual({ acquired: false })
  })

  it("folds nested namespaces in call order", async () => {
    await holderLocks
      .namespace("outer")
      .namespace("inner")
      .withLock("job:4", async () => {
        const sameOrder = await contenderLocks
          .namespace("outer")
          .namespace("inner")
          .tryWithLock("job:4", async () => "unexpected")
        const reverseOrder = await contenderLocks
          .namespace("inner")
          .namespace("outer")
          .tryWithLock("job:4", async () => "success")

        expect(sameOrder).toEqual({ acquired: false })
        expect(reverseOrder).toEqual({ acquired: true, result: "success" })
      })
  })

  it("shares one connection pool between namespaces", async () => {
    const connectionIds = new Set<number>()
    const sql = postgres(databaseUrl, {
      debug: (connectionId) => {
        connectionIds.add(connectionId)
      },
      max: 1,
    })
    const locks = createAdvisoryLockManager(sql)

    try {
      await locks.namespace("tenant-a").withLock("job:5", async () => {})
      await locks.namespace("tenant-b").withLock("job:5", async () => {})

      expect(connectionIds.size).toBe(1)
      await locks.close()
    } finally {
      await sql.end()
    }
  })
})
