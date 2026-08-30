import { describe, expectTypeOf, test } from "bun:test"

import {
  type AdvisoryLockKeyspace,
  type AdvisoryLockManager,
  type AdvisoryMutex,
  createAdvisoryLockManager,
  type TryWithLockResult,
} from "pg-advisory-lock"
import {
  createTestAdvisoryLockManager,
  createTestAdvisoryLockState,
} from "pg-advisory-lock/testing"
import postgres from "postgres"

import { databaseUrl } from "#test-utils"

describe("wrapWithLock type tests", () => {
  const { wrapWithLock } = createAdvisoryLockManager(databaseUrl)

  test("should preserve function signature with multiple parameters", () => {
    const originalFunction = async (a: number, b: string, c: boolean) => {
      return { a, b, c }
    }

    const wrappedFunction = wrapWithLock("test", originalFunction)

    expectTypeOf(wrappedFunction).parameter(0).toBeNumber()
    expectTypeOf(wrappedFunction).parameter(1).toBeString()
    expectTypeOf(wrappedFunction).parameter(2).toBeBoolean()
    expectTypeOf(wrappedFunction).returns.toEqualTypeOf<
      Promise<{ a: number; b: string; c: boolean }>
    >()
  })

  test("should preserve function signature with no parameters", () => {
    const originalFunction = async () => {
      return "no params"
    }

    const wrappedFunction = wrapWithLock("test", originalFunction)

    expectTypeOf(wrappedFunction).parameter(0).toBeUndefined()
    expectTypeOf(wrappedFunction).returns.toEqualTypeOf<Promise<string>>()
  })

  test("should preserve function signature with rest parameters", () => {
    const originalFunction = async (...args: number[]) => {
      return args.reduce((sum, n) => sum + n, 0)
    }

    const wrappedFunction = wrapWithLock("test", originalFunction)

    expectTypeOf(wrappedFunction).parameter(0).toBeNumber()
    expectTypeOf(wrappedFunction).toBeCallableWith(1, 2, 3)
    expectTypeOf(wrappedFunction).returns.toEqualTypeOf<Promise<number>>()
  })

  test("should preserve function signature with generic return types", () => {
    const originalFunction = async <T>(data: T): Promise<T> => {
      return data
    }

    const wrappedFunction = wrapWithLock("test", originalFunction)

    expectTypeOf(wrappedFunction).parameter(0).toBeUnknown()
    expectTypeOf(wrappedFunction).returns.toEqualTypeOf<Promise<unknown>>()

    // Test with specific type
    const result = wrappedFunction("test")
    expectTypeOf(result).toEqualTypeOf<Promise<string>>()
  })

  test("should preserve function signature with complex object parameters", () => {
    interface User {
      id: number
      name: string
      email?: string
    }

    const originalFunction = async (
      user: User,
      action: "create" | "update",
    ) => {
      return { ...user, action, timestamp: new Date() }
    }

    const wrappedFunction = wrapWithLock("test", originalFunction)

    expectTypeOf(wrappedFunction).parameter(0).toMatchTypeOf<User>()
    expectTypeOf(wrappedFunction)
      .parameter(1)
      .toEqualTypeOf<"create" | "update">()
    expectTypeOf(wrappedFunction).toBeCallableWith(
      { id: 1, name: "John" },
      "create",
    )
  })

  test("should preserve union types", () => {
    const originalFunction = async (
      input: string | number,
    ): Promise<string | number> => {
      return input
    }

    const wrappedFunction = wrapWithLock("test", originalFunction)

    expectTypeOf(wrappedFunction).parameter(0).toEqualTypeOf<string | number>()
    expectTypeOf(wrappedFunction).returns.toEqualTypeOf<
      Promise<string | number>
    >()
  })

  test("should reject invalid parameter types", () => {
    const originalFunction = async (num: number) => {
      return num * 2
    }

    const wrappedFunction = wrapWithLock("test", originalFunction)

    // @ts-expect-error string is not assignable to number
    expectTypeOf(wrappedFunction).parameter(0).toBeString()
  })
})

describe("mutex.wrapWithLock type tests", () => {
  const { createMutex } = createAdvisoryLockManager(databaseUrl)

  test("should preserve function signature for mutex instance", () => {
    const mutex = createMutex("test-resource")
    const originalFunction = async (data: string, count: number) => {
      return data.repeat(count)
    }

    const wrappedFunction = mutex.wrapWithLock(originalFunction)

    expectTypeOf(wrappedFunction).parameter(0).toBeString()
    expectTypeOf(wrappedFunction).parameter(1).toBeNumber()
    expectTypeOf(wrappedFunction).returns.toEqualTypeOf<Promise<string>>()
  })

  test("should work with void return type", () => {
    const mutex = createMutex("test-resource")
    const originalFunction = async (message: string): Promise<void> => {
      console.warn(message)
    }

    const wrappedFunction = mutex.wrapWithLock(originalFunction)

    expectTypeOf(wrappedFunction).parameter(0).toBeString()
    expectTypeOf(wrappedFunction).returns.toEqualTypeOf<Promise<void>>()
  })

  test("should work with never return type", () => {
    const mutex = createMutex("test-resource")
    const originalFunction = async (message: string): Promise<never> => {
      throw new Error(message)
    }

    const wrappedFunction = mutex.wrapWithLock(originalFunction)

    expectTypeOf(wrappedFunction).parameter(0).toBeString()
    expectTypeOf(wrappedFunction).returns.toEqualTypeOf<Promise<never>>()
  })
})

describe("createAdvisoryLockManager return type tests", () => {
  test("should accept postgres.js connection types", async () => {
    const sql = postgres(databaseUrl, { types: { bigint: postgres.BigInt } })

    createAdvisoryLockManager(databaseUrl)
    createAdvisoryLockManager({ max: 1 })
    createAdvisoryLockManager(sql)

    await sql.end()
  })

  test("should include wrapWithLock in the return type", () => {
    const result = createAdvisoryLockManager(databaseUrl)

    expectTypeOf(result.close).toEqualTypeOf<() => Promise<void>>()
    expectTypeOf(result).toHaveProperty("wrapWithLock")
    expectTypeOf(result.wrapWithLock).toBeFunction()
    expectTypeOf(result.wrapWithLock).parameter(0).toBeString()
    expectTypeOf(result.wrapWithLock).parameter(1).toBeFunction()
    expectTypeOf(result.wrapWithLock).returns.toBeFunction()
  })

  test("should expose manager, keyspace, and mutex types", () => {
    const manager = createAdvisoryLockManager(databaseUrl)
    const namespace = manager.namespace("tenant-a")
    const mutex = namespace.createMutex("job")

    expectTypeOf(manager).toEqualTypeOf<AdvisoryLockManager>()
    expectTypeOf(namespace).toEqualTypeOf<AdvisoryLockKeyspace>()
    expectTypeOf(mutex).toEqualTypeOf<AdvisoryMutex>()
    expectTypeOf(mutex.tryWithLock(async () => "done")).toEqualTypeOf<
      Promise<TryWithLockResult<string>>
    >()

    // @ts-expect-error derived keyspaces do not own the manager lifecycle
    void namespace.close

    // @ts-expect-error scope was replaced by namespace
    void manager.scope
  })
})

describe("createTestAdvisoryLockManager return type tests", () => {
  test("matches the manager contract with isolated or shared state", () => {
    const state = createTestAdvisoryLockState()

    expectTypeOf(
      createTestAdvisoryLockManager(),
    ).toEqualTypeOf<AdvisoryLockManager>()
    expectTypeOf(
      createTestAdvisoryLockManager({ state }),
    ).toEqualTypeOf<AdvisoryLockManager>()
  })
})

describe("type assignability tests", () => {
  test("should preserve assignability", () => {
    const { wrapWithLock } = createAdvisoryLockManager(databaseUrl)

    const originalFunction = async (x: number) => x * 2
    const wrappedFunction = wrapWithLock("test", originalFunction)

    // These should pass
    expectTypeOf(wrappedFunction).toEqualTypeOf<
      (x: number) => Promise<number>
    >()

    // @ts-expect-error wrong return type
    const wrongReturn: (x: number) => Promise<string> = wrappedFunction

    // @ts-expect-error wrong parameter type
    const wrongParameter: (x: string) => Promise<number> = wrappedFunction

    void wrongReturn
    void wrongParameter
  })
})
