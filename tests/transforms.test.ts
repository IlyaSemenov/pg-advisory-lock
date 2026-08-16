import { describe, expect, test } from "bun:test"

import { createAdvisoryLock } from "pg-advisory-lock"
import postgres from "postgres"

import { databaseUrl } from "#test-utils"

type Transform = postgres.Options<Record<string, never>>["transform"]

function optionsWithTransform(transform: Transform) {
  const url = new URL(databaseUrl)
  return {
    database: url.pathname.slice(1) || undefined,
    host: url.hostname,
    max: 1,
    pass: url.password || undefined,
    port: url.port ? Number(url.port) : undefined,
    transform,
    user: url.username || undefined,
  }
}

async function expectManualLockLifecycle(
  locks: ReturnType<typeof createAdvisoryLock>,
  name: string,
) {
  const unlock = await locks.tryLock(name)
  expect(unlock).toBeFunction()
  await unlock?.()

  const reacquired = await locks.tryWithLock(name, async () => "reacquired")
  expect(reacquired).toEqual({ acquired: true, result: "reacquired" })
}

describe("postgres.js transforms", () => {
  test("does not transform successful control query rows", async () => {
    let transformedEmptyRows = 0
    const transformedSql = postgres(databaseUrl, {
      max: 1,
      transform: {
        row: {
          from: (row) => {
            if (Object.keys(row).length === 0) {
              transformedEmptyRows += 1
              throw new Error("Unexpected empty result row")
            }
            return row
          },
        },
      },
    })
    const observerSql = postgres(databaseUrl, { max: 1 })
    const locks = createAdvisoryLock(transformedSql)
    const observerLocks = createAdvisoryLock(observerSql)

    try {
      const result = await locks.tryWithLock(
        "throwing-row-transform",
        async () => "success",
      )
      expect(result).toEqual({ acquired: true, result: "success" })

      const unlock = await locks.tryLock("throwing-row-transform-manual")
      expect(unlock).toBeFunction()
      await unlock?.()

      await expect(
        locks.withLock("throwing-row-transform-error", async () => {
          throw new Error("Callback failed")
        }),
      ).rejects.toThrow("Callback failed")

      expect(transformedEmptyRows).toBe(0)
      expect(
        await observerLocks.tryWithLock(
          "throwing-row-transform-error",
          async () => "reacquired",
        ),
      ).toEqual({ acquired: true, result: "reacquired" })
    } finally {
      await Promise.all([transformedSql.end(), observerSql.end()])
    }
  })

  test("supports transforms passed through manager options", async () => {
    const locks = createAdvisoryLock(
      optionsWithTransform({
        column: {
          from: (name) =>
            name === "acquired" || name === "unlocked" ? `db_${name}` : name,
        },
        row: {
          from: (row) => ({ ...row, transformed: true }),
        },
        value: {
          from: (value, column) =>
            column.name === "db_acquired" || column.name === "db_unlocked"
              ? String(value)
              : value,
        },
      }),
    )

    const result = await locks.tryWithLock(
      "transformed-options",
      async () => "success",
    )
    expect(result).toEqual({ acquired: true, result: "success" })
    expect(await locks.withLock("transformed-with-lock", async () => 42)).toBe(
      42,
    )
    await expectManualLockLifecycle(locks, "transformed-manual-lock")
  })

  test("ignores transformed boolean values from an existing Sql", async () => {
    const holderSql = postgres(databaseUrl, { max: 1 })
    const transformedSql = postgres(databaseUrl, {
      max: 1,
      transform: {
        row: {
          from: (row) => ({ ...row, transformed: true }),
        },
        value: {
          from: (value, column) =>
            column.name === "acquired" ? (value ? "yes" : "no") : value,
        },
      },
    })
    const holderLocks = createAdvisoryLock(holderSql)
    const transformedLocks = createAdvisoryLock(transformedSql)
    const unlock = await holderLocks.tryLock("transformed-unavailable-lock")

    try {
      expect(unlock).toBeFunction()
      let callbackCalled = false
      const result = await transformedLocks.tryWithLock(
        "transformed-unavailable-lock",
        async () => {
          callbackCalled = true
        },
      )

      expect(result).toEqual({ acquired: false })
      expect(callbackCalled).toBe(false)
    } finally {
      await unlock?.()
      await Promise.all([holderSql.end(), transformedSql.end()])
    }
  })

  test("ignores transformed unlock results from an existing Sql", async () => {
    const sql = postgres(databaseUrl, {
      max: 1,
      transform: {
        column: {
          from: (name) => (name === "unlocked" ? "db_unlocked" : name),
        },
        row: {
          from: (row) => ("db_unlocked" in row ? { transformed: row } : row),
        },
      },
    })
    const locks = createAdvisoryLock(sql)

    try {
      await expectManualLockLifecycle(locks, "transformed-unlock")
    } finally {
      await sql.end()
    }
  })
})
