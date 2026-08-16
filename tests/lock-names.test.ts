import { describe, expect, it } from "bun:test"

import { createAdvisoryLockManager } from "pg-advisory-lock"

import { databaseUrl } from "#test-utils"

const lockNames = ["задача:✅", "", "tenant/acme/resource/job:42"]

describe("server-side lock keys", () => {
  for (const name of lockNames) {
    it(`supports ${JSON.stringify(name)}`, async () => {
      const locks = createAdvisoryLockManager(databaseUrl)

      try {
        const result = await locks.withLock(name, async () => "success")
        expect(result).toBe("success")
      } finally {
        await locks.close()
      }
    })
  }
})
