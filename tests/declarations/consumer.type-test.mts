// Type-checks the packed declarations from an ES module consumer; CI runs it with the package installed.
import { createAdvisoryLockManager } from "pg-advisory-lock"
import { createTestAdvisoryLockManager } from "pg-advisory-lock/testing"
import postgres from "postgres"

export const locksFromUrl = createAdvisoryLockManager("postgres://localhost")
export const locksFromOptions = createAdvisoryLockManager({
  host: "localhost",
  max: 2,
})
export const locksFromSql = createAdvisoryLockManager(
  postgres("postgres://localhost"),
)
export const testLocks = createTestAdvisoryLockManager()
