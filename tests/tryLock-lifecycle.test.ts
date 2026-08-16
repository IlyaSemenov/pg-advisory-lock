import { afterEach, beforeEach, describe, expect, it } from "bun:test"

import { createAdvisoryLock } from "pg-advisory-lock"
import postgres from "postgres"

import { databaseUrl } from "#test-utils"

describe("tryLock lifecycle", () => {
  let firstPool: postgres.Sql
  let secondPool: postgres.Sql
  let firstLocks: ReturnType<typeof createAdvisoryLock>
  let secondLocks: ReturnType<typeof createAdvisoryLock>
  let unlocks: Array<() => Promise<void>>

  beforeEach(() => {
    firstPool = postgres(databaseUrl, { max: 1 })
    secondPool = postgres(databaseUrl, { max: 1 })
    firstLocks = createAdvisoryLock(firstPool)
    secondLocks = createAdvisoryLock(secondPool)
    unlocks = []
  })

  afterEach(async () => {
    await Promise.allSettled(unlocks.map((unlock) => unlock()))
    await Promise.all([firstPool.end(), secondPool.end()])
  })

  async function acquireLock(lock: Promise<(() => Promise<void>) | undefined>) {
    const unlock = await lock
    if (!unlock) throw new Error("Expected to acquire the lock")
    unlocks.push(unlock)
    return unlock
  }

  it("holds the lock and connection until unlock", async () => {
    const unlock = await acquireLock(firstLocks.tryLock("manual-lifecycle"))
    const secondMutex = secondLocks.createMutex("manual-lifecycle")

    const blockedUnlock = await secondMutex.tryLock()

    expect(blockedUnlock).toBeUndefined()
    const releasedAttempt = await secondLocks.tryWithLock(
      "available-after-failed-attempt",
      async () => "success",
    )
    expect(releasedAttempt).toEqual({ acquired: true, result: "success" })

    await unlock()

    await acquireLock(secondMutex.tryLock())
    const releasedConnection = await firstLocks.tryWithLock(
      "available-after-unlock",
      async () => "success",
    )
    expect(releasedConnection).toEqual({ acquired: true, result: "success" })
  })

  it("allows repeated and concurrent unlock calls", async () => {
    const unlock = await acquireLock(firstLocks.tryLock("idempotent-unlock"))

    await Promise.all([unlock(), unlock(), unlock()])

    const acquired = await secondLocks.tryWithLock(
      "idempotent-unlock",
      async () => "success",
    )
    expect(acquired).toEqual({ acquired: true, result: "success" })
    const releasedConnection = await firstLocks.tryWithLock(
      "available-after-idempotent-unlock",
      async () => "success",
    )
    expect(releasedConnection).toEqual({ acquired: true, result: "success" })
  })

  it("keeps a nested manual lock after the outer callback completes", async () => {
    let unlock: (() => Promise<void>) | undefined

    await firstLocks.withLock("nested-manual-lock", async () => {
      unlock = await acquireLock(firstLocks.tryLock("nested-manual-lock"))
    })

    const blocked = await secondLocks.tryWithLock(
      "nested-manual-lock",
      async () => "unexpected",
    )
    expect(blocked).toEqual({ acquired: false })

    await unlock?.()

    const acquired = await secondLocks.tryWithLock(
      "nested-manual-lock",
      async () => "success",
    )
    expect(acquired).toEqual({ acquired: true, result: "success" })
  })
})
