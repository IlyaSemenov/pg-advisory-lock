import { createAdvisoryLock } from "pg-advisory-lock"
import { describe, expect, it } from "vitest"

import { databaseUrl } from "#test-utils"

const { createMutex, tryLock } = createAdvisoryLock(databaseUrl)

describe("mutex.tryLock", () => {
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

describe("convenience tryLock", () => {
  it("returns unlock function when lock is available", async () => {
    const unlock = await tryLock("test-lock")
    expect(unlock).not.toBeUndefined()

    if (unlock) {
      await unlock()
    }
  })

  it("returns undefined when lock is not available", async () => {
    // First lock should succeed
    const unlock1 = await tryLock("test-lock")
    expect(unlock1).not.toBeUndefined()

    // Second lock should fail
    const unlock2 = await tryLock("test-lock")
    expect(unlock2).toBeUndefined()

    // Clean up
    if (unlock1) {
      await unlock1()
    }
  })

  it("works independently of mutex instances", async () => {
    const mutex = createMutex("test-lock")

    // Lock with convenience method
    const unlock1 = await tryLock("test-lock")
    expect(unlock1).not.toBeUndefined()

    // Try to lock with mutex instance - should fail
    const unlock2 = await mutex.tryLock()
    expect(unlock2).toBeUndefined()

    // Clean up
    if (unlock1) {
      await unlock1()
    }

    // Now mutex should be able to lock
    const unlock3 = await mutex.tryLock()
    expect(unlock3).not.toBeUndefined()

    if (unlock3) {
      await unlock3()
    }
  })
})
