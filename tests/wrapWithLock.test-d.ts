import { createAdvisoryLock } from "pg-advisory-lock"
import { assertType, describe, expectTypeOf, test } from "vitest"

import { databaseUrl } from "#test-utils"

describe("wrapWithLock type tests", () => {
  const { wrapWithLock } = createAdvisoryLock(databaseUrl)

  test("should preserve function signature with multiple parameters", () => {
    const originalFunction = async (a: number, b: string, c: boolean) => {
      return { a, b, c }
    }

    const wrappedFunction = wrapWithLock("test", originalFunction)

    expectTypeOf(wrappedFunction).parameter(0).toBeNumber()
    expectTypeOf(wrappedFunction).parameter(1).toBeString()
    expectTypeOf(wrappedFunction).parameter(2).toBeBoolean()
    expectTypeOf(wrappedFunction).returns.toEqualTypeOf<Promise<{ a: number, b: string, c: boolean }>>()
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

    const originalFunction = async (user: User, action: "create" | "update") => {
      return { ...user, action, timestamp: new Date() }
    }

    const wrappedFunction = wrapWithLock("test", originalFunction)

    expectTypeOf(wrappedFunction).parameter(0).toMatchTypeOf<User>()
    expectTypeOf(wrappedFunction).parameter(1).toEqualTypeOf<"create" | "update">()
    expectTypeOf(wrappedFunction).toBeCallableWith({ id: 1, name: "John" }, "create")
  })

  test("should preserve union types", () => {
    const originalFunction = async (input: string | number): Promise<string | number> => {
      return input
    }

    const wrappedFunction = wrapWithLock("test", originalFunction)

    expectTypeOf(wrappedFunction).parameter(0).toEqualTypeOf<string | number>()
    expectTypeOf(wrappedFunction).returns.toEqualTypeOf<Promise<string | number>>()
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
  const { createMutex } = createAdvisoryLock(databaseUrl)

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

describe("createAdvisoryLock return type tests", () => {
  test("should include wrapWithLock in the return type", () => {
    const result = createAdvisoryLock(databaseUrl)

    expectTypeOf(result).toHaveProperty("wrapWithLock")
    expectTypeOf(result.wrapWithLock).toBeFunction()
    expectTypeOf(result.wrapWithLock).parameter(0).toBeString()
    expectTypeOf(result.wrapWithLock).parameter(1).toBeFunction()
    expectTypeOf(result.wrapWithLock).returns.toBeFunction()
  })
})

describe("assertType tests", () => {
  test("should work with assertType", () => {
    const { wrapWithLock } = createAdvisoryLock(databaseUrl)

    const originalFunction = async (x: number) => x * 2
    const wrappedFunction = wrapWithLock("test", originalFunction)

    // These should pass
    assertType<(x: number) => Promise<number>>(wrappedFunction)

    // @ts-expect-error wrong return type
    assertType<(x: number) => Promise<string>>(wrappedFunction)

    // @ts-expect-error wrong parameter type
    assertType<(x: string) => Promise<number>>(wrappedFunction)
  })
})
