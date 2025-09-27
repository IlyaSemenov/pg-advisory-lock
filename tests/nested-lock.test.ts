import { createAdvisoryLock } from "pg-advisory-lock"
import { expect, it, test } from "vitest"

import { databaseUrl, sleep } from "#test-utils"

const { createMutex, withLock, tryLock, tryWithLock } = createAdvisoryLock(databaseUrl)

test("withLock > withLock with same key", async () => {
  const result = await withLock("nested-test", async () => {
    // This should reuse the same connection and not deadlock
    const nestedResult = await withLock("nested-test", async () => "nested-success")
    return { outer: "success", nested: nestedResult }
  })

  expect(result).toEqual({ outer: "success", nested: "nested-success" })
})

test("withLock > tryWithLock with same key", async () => {
  const result = await withLock("nested-try-test", async () => {
    // This should reuse the same connection and succeed
    const nestedResult = await tryWithLock("nested-try-test", async () => "nested-success")
    return { outer: "success", nested: nestedResult }
  })

  expect(result).toEqual({
    outer: "success",
    nested: { acquired: true, result: "nested-success" },
  })
})

test("withLock > tryLock with same key", async () => {
  const result = await withLock("nested-trylock-test", async () => {
    // This should reuse the same connection and succeed
    const unlock = await tryLock("nested-trylock-test")
    expect(unlock).toBeDefined()
    await unlock?.()
    return "success"
  })

  expect(result).toBe("success")
})

test("withLock > mutex.withLock with same key", async () => {
  const mutex = createMutex("mixed-nested-test")
  const result = await withLock("mixed-nested-test", async () => {
    // This should reuse the same connection and not deadlock
    const nestedResult = await mutex.withLock(async () => "nested-success")
    return { outer: "success", nested: nestedResult }
  })

  expect(result).toEqual({ outer: "success", nested: "nested-success" })
})

test("mutex.withLock > withLock with same key", async () => {
  const mutex = createMutex("mixed-nested-test-2")
  const result = await mutex.withLock(async () => {
    // This should reuse the same connection and not deadlock
    const nestedResult = await withLock("mixed-nested-test-2", async () => "nested-success")
    return { outer: "success", nested: nestedResult }
  })

  expect(result).toEqual({ outer: "success", nested: "nested-success" })
})

test("deeply nested withLock", async () => {
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

test("withLock prevents concurrent access from different call stacks", async () => {
  let log = ""

  await Promise.all([
    withLock("concurrent-test", async () => {
      log += "a"
      await sleep(50)
      log += "b"
    }),
    sleep(10).then(() =>
      withLock("concurrent-test", async () => {
        log += "c"
        await sleep(10)
        log += "d"
      }),
    ),
  ])

  expect(log).toBe("abcd")
})
