import { describe, expect, it } from "bun:test"
import { createHash } from "node:crypto"

import { deriveAdvisoryLockKey, resolveAdvisoryLockKey } from "./key"

describe("deriveAdvisoryLockKey", () => {
  it("reads the root key from the SHA-256 digest of the name", () => {
    for (const name of ["db:migrate", "задача:✅", ""]) {
      expect(deriveAdvisoryLockKey(name)).toBe(
        createHash("sha256").update(name).digest().readBigInt64BE(),
      )
    }
  })

  it("keeps derived keys stable", () => {
    expect(deriveAdvisoryLockKey("db:migrate")).toBe(3385325551285341936n)
    expect(deriveAdvisoryLockKey("db:migrate", ["tenant-a", "jobs"])).toBe(
      -1540740859457476831n,
    )
  })

  it("folds namespaces in call order", () => {
    const key = deriveAdvisoryLockKey("job", ["outer", "inner"])

    expect(deriveAdvisoryLockKey("job", ["outer", "inner"])).toBe(key)
    expect(deriveAdvisoryLockKey("job", ["inner", "outer"])).not.toBe(key)
    expect(deriveAdvisoryLockKey("job", ["outer"])).not.toBe(key)
    expect(deriveAdvisoryLockKey("job")).not.toBe(key)
  })
})

describe("resolveAdvisoryLockKey", () => {
  it("derives keys for string names", () => {
    expect(resolveAdvisoryLockKey("job", ["tenant-a"])).toBe(
      deriveAdvisoryLockKey("job", ["tenant-a"]),
    )
  })

  it("passes signed 64-bit root keys through", () => {
    for (const key of [0n, -(2n ** 63n), 2n ** 63n - 1n]) {
      expect(resolveAdvisoryLockKey(key, [])).toBe(key)
    }
  })

  it("rejects keys outside the signed 64-bit range", () => {
    expect(() => resolveAdvisoryLockKey(2n ** 63n, [])).toThrow(RangeError)
    expect(() => resolveAdvisoryLockKey(-(2n ** 63n) - 1n, [])).toThrow(
      RangeError,
    )
  })

  it("rejects raw keys in namespaces", () => {
    expect(() => resolveAdvisoryLockKey(1n, ["tenant-a"])).toThrow(TypeError)
  })
})
