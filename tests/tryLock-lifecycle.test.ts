import { afterEach, beforeEach, describe, expect, it } from "bun:test"

import { createAdvisoryLockManager } from "pg-advisory-lock"
import postgres from "postgres"

import { databaseUrl } from "#test-utils"

describe("tryLock lifecycle", () => {
  let contenderLocks: ReturnType<typeof createAdvisoryLockManager>
  let contenderPool: postgres.Sql
  let holderLocks: ReturnType<typeof createAdvisoryLockManager>
  let holderPool: postgres.Sql
  let unlocks: Array<() => Promise<void>>

  beforeEach(() => {
    contenderPool = postgres(databaseUrl, { max: 1 })
    holderPool = postgres(databaseUrl, { max: 1 })
    contenderLocks = createAdvisoryLockManager(contenderPool)
    holderLocks = createAdvisoryLockManager(holderPool)
    unlocks = []
  })

  afterEach(async () => {
    await Promise.allSettled(unlocks.map((unlock) => unlock()))
    await Promise.all([contenderPool.end(), holderPool.end()])
  })

  async function acquireLock(lock: Promise<(() => Promise<void>) | undefined>) {
    const unlock = await lock
    if (!unlock) throw new Error("Expected to acquire the lock")
    unlocks.push(unlock)
    return unlock
  }

  it("holds the lock and connection until unlock", async () => {
    const unlock = await acquireLock(holderLocks.tryLock("manual-lifecycle"))
    const contenderMutex = contenderLocks.createMutex("manual-lifecycle")

    const blockedUnlock = await contenderMutex.tryLock()

    expect(blockedUnlock).toBeUndefined()
    const releasedAttempt = await contenderLocks.tryWithLock(
      "available-after-failed-attempt",
      async () => "success",
    )
    expect(releasedAttempt).toEqual({ acquired: true, result: "success" })

    await unlock()

    await acquireLock(contenderMutex.tryLock())
    const releasedConnection = await holderLocks.tryWithLock(
      "available-after-unlock",
      async () => "success",
    )
    expect(releasedConnection).toEqual({ acquired: true, result: "success" })
  })

  it("allows repeated and concurrent unlock calls", async () => {
    const unlock = await acquireLock(holderLocks.tryLock("idempotent-unlock"))

    await Promise.all([unlock(), unlock(), unlock()])

    const acquired = await contenderLocks.tryWithLock(
      "idempotent-unlock",
      async () => "success",
    )
    expect(acquired).toEqual({ acquired: true, result: "success" })
    const releasedConnection = await holderLocks.tryWithLock(
      "available-after-idempotent-unlock",
      async () => "success",
    )
    expect(releasedConnection).toEqual({ acquired: true, result: "success" })
  })

  it("keeps a nested manual lock after the outer callback completes", async () => {
    let unlock: (() => Promise<void>) | undefined

    await holderLocks.withLock("nested-manual-lock", async () => {
      unlock = await acquireLock(holderLocks.tryLock("nested-manual-lock"))
    })

    const blocked = await contenderLocks.tryWithLock(
      "nested-manual-lock",
      async () => "unexpected",
    )
    expect(blocked).toEqual({ acquired: false })

    await unlock?.()

    const acquired = await contenderLocks.tryWithLock(
      "nested-manual-lock",
      async () => "success",
    )
    expect(acquired).toEqual({ acquired: true, result: "success" })
  })
})
