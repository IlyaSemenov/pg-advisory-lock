import { createAdvisoryLock } from "pg-advisory-lock"
import { describe, expect, it } from "vitest"

import { databaseUrl, sleep } from "#test-utils"

const { createMutex, tryWithLock } = createAdvisoryLock(databaseUrl)

describe("mutex.tryWithLock", () => {
  it("executes function and returns result when lock is available", async () => {
    const mutex = createMutex("test-lock")
    let executed = false

    const result = await mutex.tryWithLock(async () => {
      executed = true
      return "success"
    })

    expect(executed).toBe(true)
    expect(result).toEqual({ acquired: true, result: "success" })
  })

  it("returns acquired: false when lock is not available", async () => {
    const mutex = createMutex("test-lock")

    const [result1, result2] = await Promise.all([
      mutex.tryWithLock(async () => {
        await sleep(100) // Hold the lock for a bit
        return "first"
      }),
      sleep(1).then(() => mutex.tryWithLock(async () => {
        return "second"
      })),
    ])

    expect(result1).toEqual({ acquired: true, result: "first" })
    expect(result2).toEqual({ acquired: false })
  })

  it("releases lock even when function throws", async () => {
    const mutex = createMutex("test-lock")

    await expect(
      mutex.tryWithLock(async () => {
        throw new Error("test error")
      }),
    ).rejects.toThrow("test error")

    // Should be able to acquire the lock again
    const result = await mutex.tryWithLock(async () => "success")
    expect(result).toEqual({ acquired: true, result: "success" })
  })

  it("works with different mutex objects but same key", async () => {
    const mutex1 = createMutex("test-lock")
    const mutex2 = createMutex("test-lock")

    const [result1, result2] = await Promise.all([
      mutex1.tryWithLock(async () => {
        await sleep(100) // Hold the lock for a bit
        return "first"
      }),
      sleep(1).then(() => mutex2.tryWithLock(async () => {
        return "second"
      })),
    ])

    expect(result1).toEqual({ acquired: true, result: "first" })
    expect(result2).toEqual({ acquired: false })
  })

  it("allows concurrent execution with different keys", async () => {
    const mutex1 = createMutex("test-lock-1")
    const mutex2 = createMutex("test-lock-2")
    let log = ""

    const [result1, result2] = await Promise.all([
      mutex1.tryWithLock(async () => {
        log += "a"
        await sleep(20)
        log += "b"
        return "first"
      }),
      sleep(5).then(() => mutex2.tryWithLock(async () => {
        log += "c"
        await sleep(20)
        log += "d"
        return "second"
      })),
    ])

    expect(result1).toEqual({ acquired: true, result: "first" })
    expect(result2).toEqual({ acquired: true, result: "second" })
    expect(log).toBe("acbd") // Should interleave since different locks
  })
})

describe("convenience tryWithLock", () => {
  it("executes function and returns result when lock is available", async () => {
    let executed = false

    const result = await tryWithLock("test-lock", async () => {
      executed = true
      return "success"
    })

    expect(executed).toBe(true)
    expect(result).toEqual({ acquired: true, result: "success" })
  })

  it("returns acquired: false when lock is not available", async () => {
    const [result1, result2] = await Promise.all([
      tryWithLock("test-lock", async () => {
        await sleep(100)
        return "first"
      }),
      sleep(1).then(() => tryWithLock("test-lock", async () => "second")),
    ])

    expect(result1).toEqual({ acquired: true, result: "first" })
    expect(result2).toEqual({ acquired: false })
  })

  it("releases lock even when function throws", async () => {
    await expect(
      tryWithLock("test-lock", async () => {
        throw new Error("test error")
      }),
    ).rejects.toThrow("test error")

    // Should be able to acquire the lock again
    const result = await tryWithLock("test-lock", async () => "success")
    expect(result).toEqual({ acquired: true, result: "success" })
  })

  it("works independently of mutex instances", async () => {
    const mutex = createMutex("test-lock")

    const [result1, result2] = await Promise.all([
      tryWithLock("test-lock", async () => {
        await sleep(50)
        return "convenience"
      }),
      sleep(10).then(() => mutex.tryWithLock(async () => "mutex")),
    ])

    expect(result1).toEqual({ acquired: true, result: "convenience" })
    expect(result2).toEqual({ acquired: false })

    // Now mutex should be able to lock
    const result3 = await mutex.tryWithLock(async () => "mutex-after")
    expect(result3).toEqual({ acquired: true, result: "mutex-after" })
  })

  it("handles return values of different types", async () => {
    const numberResult = await tryWithLock("test-lock", async () => 42)
    expect(numberResult).toEqual({ acquired: true, result: 42 })

    const objectResult = await tryWithLock("test-lock", async () => ({ foo: "bar" }))
    expect(objectResult).toEqual({ acquired: true, result: { foo: "bar" } })

    const arrayResult = await tryWithLock("test-lock", async () => [1, 2, 3])
    expect(arrayResult).toEqual({ acquired: true, result: [1, 2, 3] })

    const undefinedResult = await tryWithLock("test-lock", async () => undefined)
    expect(undefinedResult).toEqual({ acquired: true, result: undefined })
  })
})
