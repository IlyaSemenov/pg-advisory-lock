import { describe, expect, it } from "bun:test"

import { createAdvisoryLockManager } from "pg-advisory-lock"

import { databaseUrl, sleep } from "#test-utils"

const { createMutex, withLock } = createAdvisoryLockManager(databaseUrl)
const { tryWithLock: independentlyTryWithLock } =
  createAdvisoryLockManager(databaseUrl)

describe("mutex.withLock", () => {
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

    const result = await independentlyTryWithLock(
      "test-lock",
      async () => "success",
    )
    expect(result).toEqual({ acquired: true, result: "success" })
  })

  it("prevents concurrent execution", async () => {
    const mutex = createMutex("test-lock")
    let log = ""

    await Promise.all([
      mutex.withLock(async () => {
        log += "a"
        await sleep(50)
        log += "b"
      }),
      sleep(1).then(() =>
        mutex.withLock(async () => {
          log += "c"
          await sleep(50)
          log += "d"
        }),
      ),
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
        await sleep(50)
        log += "b"
      }),
      sleep(1).then(() =>
        mutex2.withLock(async () => {
          log += "c"
          await sleep(50)
          log += "d"
        }),
      ),
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
        await sleep(10)
        log += "b"
      }),
      sleep(1).then(() =>
        mutex2.withLock(async () => {
          log += "c"
          await sleep(50)
          log += "d"
        }),
      ),
    ])

    expect(log).toBe("acbd")
  })
})

describe("convenience withLock", () => {
  it("executes function and releases lock", async () => {
    let executed = false

    const result = await withLock("test-lock", async () => {
      executed = true
      return "success"
    })

    expect(executed).toBe(true)
    expect(result).toBe("success")
  })

  it("releases lock even when function throws", async () => {
    await expect(
      withLock("test-lock", async () => {
        throw new Error("test error")
      }),
    ).rejects.toThrow("test error")

    const result = await independentlyTryWithLock(
      "test-lock",
      async () => "success",
    )
    expect(result).toEqual({ acquired: true, result: "success" })
  })

  it("prevents concurrent execution", async () => {
    let log = ""

    await Promise.all([
      withLock("test-lock", async () => {
        log += "a"
        await sleep(50)
        log += "b"
      }),
      sleep(1).then(() =>
        withLock("test-lock", async () => {
          log += "c"
          await sleep(50)
          log += "d"
        }),
      ),
    ])

    expect(log).toBe("abcd")
  })
})
