import { describe, expect, it } from "bun:test"

import { createAdvisoryLockManager } from "pg-advisory-lock"
import postgres from "postgres"

import { databaseUrl } from "#test-utils"

const closedError = "Advisory lock manager is closing or closed"

function connectionOptions() {
  const url = new URL(databaseUrl)
  return {
    database: decodeURIComponent(url.pathname.slice(1)) || undefined,
    host: url.hostname,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    port: url.port ? Number(url.port) : undefined,
    user: url.username ? decodeURIComponent(url.username) : undefined,
  }
}

describe("lifecycle", () => {
  it("closes an internally created postgres.js instance", async () => {
    let closedConnections = 0
    const locks = createAdvisoryLockManager({
      ...connectionOptions(),
      onclose: () => {
        closedConnections += 1
      },
    })

    await locks.withLock("owned-lifecycle", async () => "success")

    const closePromise = locks[Symbol.asyncDispose]()
    expect(closePromise).toBe(locks.close())
    await closePromise

    expect(closedConnections).toBe(1)
    await expect(
      locks.withLock("closed-owned-lifecycle", async () => "unexpected"),
    ).rejects.toThrow(closedError)
  })

  it("leaves a caller-owned postgres.js instance open", async () => {
    const sql = postgres(databaseUrl)
    const locks = createAdvisoryLockManager(sql)
    const mutex = locks.createMutex("closed-mutex")
    const namespace = locks.namespace("closed-namespace")
    const wrapped = locks.wrapWithLock("closed-wrapper", async () => "result")

    try {
      await locks.close()

      await expect(locks.tryLock("closed-lock")).rejects.toThrow(closedError)
      await expect(mutex.withLock(async () => "unexpected")).rejects.toThrow(
        closedError,
      )
      await expect(
        namespace.withLock("closed-lock", async () => "unexpected"),
      ).rejects.toThrow(closedError)
      await expect(wrapped()).rejects.toThrow(closedError)

      const result = await sql`SELECT 1 AS value`
      expect(result[0]?.value).toBe(1)
    } finally {
      await sql.end()
    }
  })

  it("waits for an active callback and allows its nested locks", async () => {
    const sql = postgres(databaseUrl)
    const locks = createAdvisoryLockManager(sql)
    const callbackStarted = Promise.withResolvers<void>()
    const continueCallback = Promise.withResolvers<void>()
    let operation: Promise<void> | undefined
    let closing: Promise<void> | undefined

    try {
      operation = locks.withLock("active-callback", async () => {
        callbackStarted.resolve()
        await continueCallback.promise
        const nestedResult = await locks.withLock(
          "nested-during-close",
          async () => "nested-success",
        )
        expect(nestedResult).toBe("nested-success")
      })
      await callbackStarted.promise

      let closed = false
      closing = locks.close().then(() => {
        closed = true
      })
      await Promise.resolve()

      expect(closed).toBe(false)
      await expect(
        locks.tryWithLock("after-close-started", async () => "unexpected"),
      ).rejects.toThrow(closedError)

      continueCallback.resolve()
      await operation
      await closing
      expect(closed).toBe(true)
    } finally {
      continueCallback.resolve()
      await Promise.allSettled([operation, closing].filter(Boolean))
      await sql.end()
    }
  })

  it("waits for a manual lock to be unlocked", async () => {
    const sql = postgres(databaseUrl)
    const locks = createAdvisoryLockManager(sql)
    let unlock: (() => Promise<void>) | undefined
    let closing: Promise<void> | undefined

    try {
      unlock = await locks.tryLock("active-manual-lock")
      if (!unlock) throw new Error("Expected to acquire the lock")

      let closed = false
      closing = locks.close().then(() => {
        closed = true
      })
      await Promise.resolve()
      expect(closed).toBe(false)

      await unlock()
      await closing
      expect(closed).toBe(true)
    } finally {
      await unlock?.()
      await closing
      await sql.end()
    }
  })

  it("rejects close from an active lock context", async () => {
    const sql = postgres(databaseUrl)
    const locks = createAdvisoryLockManager(sql)

    try {
      await locks.withLock("self-close", async () => {
        await expect(locks.close()).rejects.toThrow(
          "Cannot close advisory lock manager from an active lock context",
        )
      })

      const result = await locks.withLock(
        "still-open-after-rejected-close",
        async () => "success",
      )
      expect(result).toBe("success")
      await locks.close()
    } finally {
      await sql.end()
    }
  })

  it("rejects close behind a completed nested lock context", async () => {
    const sql = postgres(databaseUrl)
    const locks = createAdvisoryLockManager(sql)
    const resumeChild = Promise.withResolvers<void>()
    let child!: Promise<
      { error: unknown; status: "rejected" } | { status: "resolved" }
    >

    try {
      await locks.withLock("self-close-active-parent", async () => {
        await locks.withLock("self-close-completed-child", async () => {
          child = (async () => {
            await resumeChild.promise
            return locks.close().then(
              () => ({ status: "resolved" }) as const,
              (error: unknown) => ({ error, status: "rejected" }) as const,
            )
          })()
        })

        resumeChild.resolve()
        const outcome = await Promise.race([
          child,
          new Promise<{ status: "pending" }>((resolve) => {
            setTimeout(() => resolve({ status: "pending" }), 50)
          }),
        ])

        expect(outcome.status).toBe("rejected")
        if (outcome.status === "rejected") {
          expect(outcome.error).toEqual(
            new Error(
              "Cannot close advisory lock manager from an active lock context",
            ),
          )
        }
      })

      await locks.close()
    } finally {
      resumeChild.resolve()
      if (child) await Promise.allSettled([child])
      await sql.end()
    }
  })
})
