import { createAdvisoryLock } from "pg-advisory-lock"
import { describe, expect, it } from "vitest"

import { databaseUrl, sleep } from "#test-utils"

const { createMutex, withLock, tryLock, tryWithLock } = createAdvisoryLock(databaseUrl)

describe("nested lock operations", () => {
  it("should handle nested withLock calls with same key", async () => {
    let executed = false
    let nestedExecuted = false

    const result = await withLock("nested-test", async () => {
      executed = true

      // This should reuse the same connection and not deadlock
      const nestedResult = await withLock("nested-test", async () => {
        nestedExecuted = true
        return "nested-success"
      })

      return { outer: "success", nested: nestedResult }
    })

    expect(executed).toBe(true)
    expect(nestedExecuted).toBe(true)
    expect(result).toEqual({ outer: "success", nested: "nested-success" })
  })

  it("should handle nested tryWithLock calls with same key", async () => {
    let executed = false
    let nestedExecuted = false

    const result = await withLock("nested-try-test", async () => {
      executed = true

      // This should reuse the same connection and succeed
      const nestedResult = await tryWithLock("nested-try-test", async () => {
        nestedExecuted = true
        return "nested-success"
      })

      return { outer: "success", nested: nestedResult }
    })

    expect(executed).toBe(true)
    expect(nestedExecuted).toBe(true)
    expect(result).toEqual({
      outer: "success",
      nested: { acquired: true, result: "nested-success" },
    })
  })

  it("should handle nested tryLock calls with same key", async () => {
    let executed = false

    const result = await withLock("nested-trylock-test", async () => {
      executed = true

      // This should reuse the same connection and succeed
      const unlock = await tryLock("nested-trylock-test")
      expect(unlock).toBeDefined()

      if (unlock) {
        await unlock()
      }

      return "success"
    })

    expect(executed).toBe(true)
    expect(result).toBe("success")
  })

  it("should handle mutex.withLock nested in convenience withLock", async () => {
    const mutex = createMutex("mixed-nested-test")
    let executed = false
    let nestedExecuted = false

    const result = await withLock("mixed-nested-test", async () => {
      executed = true

      // This should reuse the same connection and not deadlock
      const nestedResult = await mutex.withLock(async () => {
        nestedExecuted = true
        return "nested-success"
      })

      return { outer: "success", nested: nestedResult }
    })

    expect(executed).toBe(true)
    expect(nestedExecuted).toBe(true)
    expect(result).toEqual({ outer: "success", nested: "nested-success" })
  })

  it("should handle convenience withLock nested in mutex.withLock", async () => {
    const mutex = createMutex("mixed-nested-test-2")
    let executed = false
    let nestedExecuted = false

    const result = await mutex.withLock(async () => {
      executed = true

      // This should reuse the same connection and not deadlock
      const nestedResult = await withLock("mixed-nested-test-2", async () => {
        nestedExecuted = true
        return "nested-success"
      })

      return { outer: "success", nested: nestedResult }
    })

    expect(executed).toBe(true)
    expect(nestedExecuted).toBe(true)
    expect(result).toEqual({ outer: "success", nested: "nested-success" })
  })

  it("should handle deeply nested locks", async () => {
    let depth1 = false
    let depth2 = false
    let depth3 = false

    const result = await withLock("deep-nested-test", async () => {
      depth1 = true

      return await withLock("deep-nested-test", async () => {
        depth2 = true

        return await withLock("deep-nested-test", async () => {
          depth3 = true
          return "deep-success"
        })
      })
    })

    expect(depth1).toBe(true)
    expect(depth2).toBe(true)
    expect(depth3).toBe(true)
    expect(result).toBe("deep-success")
  })

  it("should still prevent concurrent access from different call stacks", async () => {
    let log = ""

    await Promise.all([
      withLock("concurrent-test", async () => {
        log += "a"
        await sleep(50)
        log += "b"
      }),
      sleep(1).then(() =>
        withLock("concurrent-test", async () => {
          log += "c"
          await sleep(50)
          log += "d"
        }),
      ),
    ])

    expect(log).toBe("abcd")
  })
})
