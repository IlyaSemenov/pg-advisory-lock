import { createAdvisoryLock } from "pg-advisory-lock"
import { expect, test } from "vitest"

import { databaseUrl, sleep } from "#test-utils"

function promiseWithResolve<T>() {
  let resolve: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>(_resolve => resolve = _resolve)
  return { promise, resolve: resolve! }
}

// This is not supported for now.
test.fails("lock for longer than idleTimeoutMillis", async () => {
  const { withLock } = createAdvisoryLock({ connectionString: databaseUrl, idleTimeoutMillis: 10 })

  const { promise, resolve } = promiseWithResolve<string>()

  const result = await withLock("lock1", async () => {
    sleep(100).then(async () => {
      // Error: Client was closed and is not queryable
      const nestedResult = await withLock("lock2", async () => "nested-success").catch(() => "nested-error")
      resolve(nestedResult)
    })
    return "success"
  })

  const nestedResult = await promise

  expect(result).toEqual("success")
  expect(nestedResult).toEqual("nested-success")
})
