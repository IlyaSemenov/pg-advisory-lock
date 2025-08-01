import { createAdvisoryLock } from "pg-advisory-lock"
import { describe, expect, it } from "vitest"

import { databaseUrl, sleep } from "#test-utils"

const createMutex = createAdvisoryLock(databaseUrl)

describe("withLock", () => {
  it("executes function and releases lock", async () => {
    const mutex = createMutex("test-lock")
    let executed = false

    const result = await mutex.withLock(async () => {
      executed = true
      return "success"
    })

    expect(executed).toBe(true)
    expect(result).toBe("success")
  })

  it("releases lock even when function throws", async () => {
    const mutex = createMutex("test-lock")

    await expect(
      mutex.withLock(async () => {
        throw new Error("test error")
      }),
    ).rejects.toThrow("test error")

    // Should be able to acquire the lock again
    const result = await mutex.withLock(async () => "success")
    expect(result).toBe("success")
  })

  it("prevents concurrent execution", async () => {
    const mutex = createMutex("test-lock")
    let log = ""

    await Promise.all([
      mutex.withLock(async () => {
        log += "a"
        await new Promise(resolve => setTimeout(resolve, 50))
        log += "b"
      }),
      sleep(1).then(() => mutex.withLock(async () => {
        log += "c"
        await new Promise(resolve => setTimeout(resolve, 50))
        log += "d"
      })),
    ])

    expect(log).toBe("abcd")
  })

  it("prevents concurrent execution with different mutex object but same key", async () => {
    const mutex1 = createMutex("test-lock")
    const mutex2 = createMutex("test-lock")
    let log = ""

    await Promise.all([
      mutex1.withLock(async () => {
        log += "a"
        await new Promise(resolve => setTimeout(resolve, 50))
        log += "b"
      }),
      sleep(1).then(() => mutex2.withLock(async () => {
        log += "c"
        await new Promise(resolve => setTimeout(resolve, 50))
        log += "d"
      })),
    ])

    expect(log).toBe("abcd")
  })

  it("allows concurrent execution with different keys", async () => {
    const mutex1 = createMutex("test-lock-1")
    const mutex2 = createMutex("test-lock-2")
    let log = ""

    await Promise.all([
      mutex1.withLock(async () => {
        log += "a"
        await new Promise(resolve => setTimeout(resolve, 10))
        log += "b"
      }),
      sleep(1).then(() => mutex2.withLock(async () => {
        log += "c"
        await new Promise(resolve => setTimeout(resolve, 50))
        log += "d"
      })),
    ])

    expect(log).toBe("acbd")
  })
})

describe("tryLock", () => {
  it("returns unlock function when lock is available", async () => {
    const mutex = createMutex("test-lock")

    const unlock = await mutex.tryLock()
    expect(unlock).not.toBeNull()

    if (unlock) {
      await unlock()
    }
  })

  it("returns null when lock is not available", async () => {
    const mutex = createMutex("test-lock")

    // First lock should succeed
    const unlock1 = await mutex.tryLock()
    expect(unlock1).not.toBeNull()

    // Second lock should fail
    const unlock2 = await mutex.tryLock()
    expect(unlock2).toBeUndefined()

    // Clean up
    if (unlock1) {
      await unlock1()
    }
  })
})
