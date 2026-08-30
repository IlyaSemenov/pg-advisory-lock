import { describe, expect, expectTypeOf, it } from "bun:test"

import type { AdvisoryLockManager } from "./lock"
import {
  createTestAdvisoryLockManager,
  createTestAdvisoryLockState,
} from "./testing"

describe("test advisory lock manager", () => {
  it("is typed as an AdvisoryLockManager", () => {
    expectTypeOf(
      createTestAdvisoryLockManager(),
    ).toEqualTypeOf<AdvisoryLockManager>()
  })

  it("runs callbacks for one key sequentially", async () => {
    const locks = createTestAdvisoryLockManager()
    const firstStarted = Promise.withResolvers<void>()
    const finishFirst = Promise.withResolvers<void>()
    const events: string[] = []

    const operation1 = locks.withLock("job", async () => {
      events.push("start1")
      firstStarted.resolve()
      await finishFirst.promise
      events.push("finish1")
    })
    await firstStarted.promise

    const operation2 = locks.withLock("job", async () => {
      events.push("start2")
      events.push("finish2")
    })
    await Promise.resolve()
    expect(events).toEqual(["start1"])

    finishFirst.resolve()
    await Promise.all([operation1, operation2])
    expect(events).toEqual(["start1", "finish1", "start2", "finish2"])
  })

  it("runs callbacks for different keys independently", async () => {
    const locks = createTestAdvisoryLockManager()
    const started1 = Promise.withResolvers<void>()
    const started2 = Promise.withResolvers<void>()
    const finish = Promise.withResolvers<void>()

    const operation1 = locks.withLock("job1", async () => {
      started1.resolve()
      await finish.promise
    })
    const operation2 = locks.withLock("job2", async () => {
      started2.resolve()
      await finish.promise
    })

    await Promise.all([started1.promise, started2.promise])
    finish.resolve()
    await Promise.all([operation1, operation2])
  })

  it("returns the occupied and free tryWithLock results", async () => {
    const locks = createTestAdvisoryLockManager()

    await locks.withLock("job", async () => {
      expect(await locks.tryWithLock("job", async () => "nested")).toEqual({
        acquired: true,
        result: "nested",
      })
    })

    const unlock = await locks.tryLock("job")
    if (!unlock) throw new Error("Expected to acquire the lock")
    expect(await locks.tryWithLock("job", async () => "unexpected")).toEqual({
      acquired: false,
    })
    await unlock()

    expect(await locks.tryWithLock("job", async () => "free")).toEqual({
      acquired: true,
      result: "free",
    })
  })

  it("releases a lock after a callback throws", async () => {
    const locks = createTestAdvisoryLockManager()

    await expect(
      locks.withLock("job", async () => {
        throw new Error("failed")
      }),
    ).rejects.toThrow("failed")

    expect(await locks.tryWithLock("job", async () => "available")).toEqual({
      acquired: true,
      result: "available",
    })
  })

  it("holds a manual lock until its idempotent unlock runs", async () => {
    const state = createTestAdvisoryLockState()
    const holder = createTestAdvisoryLockManager({ state })
    const contender = createTestAdvisoryLockManager({ state })
    const unlock = await holder.createMutex("job").tryLock()
    if (!unlock) throw new Error("Expected to acquire the lock")

    expect(await contender.tryLock("job")).toBeUndefined()
    await Promise.all([unlock(), unlock()])

    expect(await contender.tryWithLock("job", async () => "acquired")).toEqual({
      acquired: true,
      result: "acquired",
    })
  })

  it("makes managers with shared state contend", async () => {
    const state = createTestAdvisoryLockState()
    const locks1 = createTestAdvisoryLockManager({ state })
    const locks2 = createTestAdvisoryLockManager({ state })

    await locks1.withLock("job", async () => {
      expect(await locks2.tryWithLock("job", async () => "unexpected")).toEqual(
        { acquired: false },
      )
    })
  })

  it("isolates managers with different state", async () => {
    const locks1 = createTestAdvisoryLockManager({
      state: createTestAdvisoryLockState(),
    })
    const locks2 = createTestAdvisoryLockManager()

    await locks1.withLock("job", async () => {
      expect(
        await locks2.tryWithLock("job", async () => "independent"),
      ).toEqual({ acquired: true, result: "independent" })
    })
  })

  it("preserves nested namespace order across the full keyspace API", async () => {
    const state = createTestAdvisoryLockState()
    const locks1 = createTestAdvisoryLockManager({ state })
    const locks2 = createTestAdvisoryLockManager({ state })
    const keyspace1 = locks1.namespace("tenant").namespace("jobs")
    const keyspace2 = locks2.namespace("tenant").namespace("jobs")

    await keyspace1.createMutex("refresh").withLock(async () => {
      expect(
        await keyspace2.tryWithLock("refresh", async () => "unexpected"),
      ).toEqual({ acquired: false })
      expect(
        await locks2
          .namespace("jobs")
          .namespace("tenant")
          .tryWithLock("refresh", async () => "reversed"),
      ).toEqual({ acquired: true, result: "reversed" })
    })

    const wrapped = keyspace1.wrapWithLock("wrapped", async () =>
      keyspace2.tryWithLock("wrapped", async () => "unexpected"),
    )
    expect(await wrapped()).toEqual({ acquired: false })
  })

  it("waits on close, allows nested work, and rejects new top-level work", async () => {
    const locks = createTestAdvisoryLockManager()
    const callbackStarted = Promise.withResolvers<void>()
    const continueCallback = Promise.withResolvers<void>()

    const operation = locks.withLock("job", async () => {
      callbackStarted.resolve()
      await continueCallback.promise
      expect(await locks.withLock("nested", async () => "done")).toBe("done")
    })
    await callbackStarted.promise

    let closed = false
    const closePromise = locks.close()
    expect(locks.close()).toBe(closePromise)
    const closing = closePromise.then(() => {
      closed = true
    })
    await Promise.resolve()
    expect(closed).toBe(false)
    await expect(
      locks.withLock("new", async () => "unexpected"),
    ).rejects.toThrow("Advisory lock manager is closing or closed")

    continueCallback.resolve()
    await Promise.all([operation, closing])
    expect(closed).toBe(true)
  })

  it("rejects close from an active callback without closing the manager", async () => {
    const locks = createTestAdvisoryLockManager()

    await locks.withLock("job", async () => {
      await expect(locks.close()).rejects.toThrow(
        "Cannot close advisory lock manager from an active lock context",
      )
    })

    expect(await locks.withLock("after", async () => "open")).toBe("open")
    await locks.close()
  })
})
