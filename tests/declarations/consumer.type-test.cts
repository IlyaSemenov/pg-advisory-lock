// Type-checks the packed declarations from a CommonJS consumer; CI runs it with the package installed.
import { createAdvisoryLockManager } from "pg-advisory-lock"
import { createTestAdvisoryLockManager } from "pg-advisory-lock/testing"

export const locks = createAdvisoryLockManager("postgres://localhost")
export const testLocks = createTestAdvisoryLockManager()
