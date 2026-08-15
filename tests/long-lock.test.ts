import { expect, test } from "bun:test"

import { createAdvisoryLock } from "pg-advisory-lock"

import { databaseUrl, sleep } from "#test-utils"

function promiseWithResolve<T>() {
  let resolve: ((value: T | PromiseLike<T>) => void) | undefined
  const promise = new Promise<T>((_resolve) => (resolve = _resolve))
  if (!resolve) throw new Error("Promise executor did not initialize resolve")
  return { promise, resolve }
}

// This is not supported for now.
test.failing("lock for longer than idleTimeoutMillis", async () => {
  const { withLock } = createAdvisoryLock({
    connectionString: databaseUrl,
    idleTimeoutMillis: 10,
  })

  const { promise, resolve } = promiseWithResolve<string>()

  const result = await withLock("lock1", async () => {
    sleep(100).then(async () => {
      // Error: Client was closed and is not queryable
      const nestedResult = await withLock(
        "lock2",
        async () => "nested-success",
      ).catch(() => "nested-error")
      resolve(nestedResult)
    })
    return "success"
  })

  const nestedResult = await promise

  expect(result).toEqual("success")
  expect(nestedResult).toEqual("nested-success")
})
