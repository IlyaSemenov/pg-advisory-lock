import { expect, test } from "bun:test"

import { createAdvisoryLock } from "pg-advisory-lock"

import { databaseUrl, sleep } from "#test-utils"

function promiseWithResolve<T>() {
  let resolve: ((value: T | PromiseLike<T>) => void) | undefined
  const promise = new Promise<T>((_resolve) => (resolve = _resolve))
  if (!resolve) throw new Error("Promise executor did not initialize resolve")
  return { promise, resolve }
}

test("lock for longer than idle_timeout", async () => {
  const url = new URL(databaseUrl)
  const { withLock } = createAdvisoryLock({
    database: url.pathname.slice(1) || undefined,
    host: url.hostname,
    idle_timeout: 0.01,
    pass: url.password || undefined,
    port: url.port ? Number(url.port) : undefined,
    user: url.username || undefined,
  })

  const { promise, resolve } = promiseWithResolve<string>()

  const result = await withLock("lock1", async () => {
    sleep(100).then(async () => {
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
