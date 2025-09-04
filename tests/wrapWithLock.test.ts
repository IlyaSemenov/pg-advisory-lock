import { createAdvisoryLock } from "pg-advisory-lock"
import { describe, expect, it } from "vitest"

import { databaseUrl } from "#test-utils"

const { createMutex, wrapWithLock } = createAdvisoryLock(databaseUrl)

describe("wrapWithLock", () => {
  it("wraps function and executes with lock", async () => {
    const sum = wrapWithLock("test-lock", async (a: number, b: number) => {
      return a + b
    })
    const result = await sum(1, 2)

    expect(result).toBe(3)
  })

  it("passes error", async () => {
    const fn = wrapWithLock("test-lock", async () => {
      throw new Error("test error")
    })

    await expect(fn()).rejects.toThrow("test error")
  })
})

describe("mutex.wrapWithLock", () => {
  it("wraps function using mutex instance", async () => {
    const mutex = createMutex("test-mutex-lock")
    const toUpper = mutex.wrapWithLock(async (message: string) => {
      return message.toUpperCase()
    })
    const result = await toUpper("hello")

    expect(result).toBe("HELLO")
  })

  it("passes error", async () => {
    const mutex = createMutex("test-mutex-lock")
    const fn = mutex.wrapWithLock(async () => {
      throw new Error("mutex test error")
    })

    await expect(fn()).rejects.toThrow("mutex test error")
  })
})
