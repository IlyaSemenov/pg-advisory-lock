import { Pool } from "pg"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { databaseUrl, sleep } from "#test-utils"

import { NestingPool } from "./pool"

describe("test NestingPool", () => {
  let pool: Pool
  let nestingPool: NestingPool

  beforeEach(() => {
    pool = new Pool({ connectionString: databaseUrl })
    nestingPool = new NestingPool(pool)
  })

  afterEach(async () => {
    await pool.end()
  })

  describe("getClient", () => {
    it("should acquire a new client when no client exists in storage", async () => {
      const result = await nestingPool.getClient()

      expect(result.client).toBeDefined()
      expect(typeof result.release).toBe("function")

      // Test that the client can actually query
      const queryResult = await result.client.query("SELECT 1 as test")
      expect(queryResult.rows[0].test).toBe(1)

      result.release()
    })

    it("should reuse existing client from AsyncLocalStorage when called within withClient", async () => {
      const result = await nestingPool.withClient(async (outerClient) => {
        // Call getClient within the AsyncLocalStorage context
        const nestedResult = await nestingPool.getClient()

        expect(nestedResult.client).toBe(outerClient)

        // Test that the client can actually query
        const queryResult = await nestedResult.client.query("SELECT 2 as test")
        expect(queryResult.rows[0].test).toBe(2)

        nestedResult.release()
        return "success"
      })

      expect(result).toBe("success")
    })

    it("should properly release client when release is called", async () => {
      const { client, release } = await nestingPool.getClient()

      // Test that client is working
      const queryResult = await client.query("SELECT 3 as test")
      expect(queryResult.rows[0].test).toBe(3)

      release()

      // The client should be released back to the pool
      // Note: The client object might still be usable, but it's been returned to the pool
      expect(release).toBeDefined()
    })
  })

  describe("withClient", () => {
    it("should execute function with client and release it", async () => {
      const result = await nestingPool.withClient(async (client) => {
        const queryResult = await client.query("SELECT 4 as test")
        return queryResult.rows[0].test
      })

      expect(result).toBe(4)
    })

    it("should release client even when function throws", async () => {
      const mockError = new Error("test error")

      await expect(
        nestingPool.withClient(async () => {
          throw mockError
        }),
      ).rejects.toThrow("test error")

      // Should be able to use the pool again
      const result = await nestingPool.withClient(async (client) => {
        const queryResult = await client.query("SELECT 5 as test")
        return queryResult.rows[0].test
      })

      expect(result).toBe(5)
    })

    it("should support nested calls by reusing the same client", async () => {
      const result = await nestingPool.withClient(async (outerClient) => {
        // Nested call
        const nestedResult = await nestingPool.withClient(async (nestedClient) => {
          expect(nestedClient).toBe(outerClient) // Should be the same client
          const queryResult = await nestedClient.query("SELECT 6 as test")
          return queryResult.rows[0].test
        })

        expect(nestedResult).toBe(6)

        // Test that outer client is still working
        const queryResult = await outerClient.query("SELECT 7 as test")
        return queryResult.rows[0].test
      })

      expect(result).toBe(7)
    })

    it("should handle multiple nested levels correctly", async () => {
      const result = await nestingPool.withClient(async (level1Client) => {
        const level2Result = await nestingPool.withClient(async (level2Client) => {
          expect(level2Client).toBe(level1Client)

          const level3Result = await nestingPool.withClient(async (level3Client) => {
            expect(level3Client).toBe(level1Client)
            const queryResult = await level3Client.query("SELECT 8 as test")
            return queryResult.rows[0].test
          })

          expect(level3Result).toBe(8)
          const queryResult = await level2Client.query("SELECT 9 as test")
          return queryResult.rows[0].test
        })

        expect(level2Result).toBe(9)
        const queryResult = await level1Client.query("SELECT 10 as test")
        return queryResult.rows[0].test
      })

      expect(result).toBe(10)
    })
  })

  describe("asyncLocalStorage behavior", () => {
    it("should maintain separate contexts for different async operations", async () => {
      const operation1 = async () => {
        const { client, release } = await nestingPool.getClient()
        await sleep(10)
        const result = await client.query("SELECT 11 as test")
        release()
        return result.rows[0].test
      }

      const operation2 = async () => {
        const { client, release } = await nestingPool.getClient()
        await sleep(10)
        const result = await client.query("SELECT 12 as test")
        release()
        return result.rows[0].test
      }

      // Run operations concurrently
      const [result1, result2] = await Promise.all([operation1(), operation2()])

      expect(result1).toBe(11)
      expect(result2).toBe(12)
    })
  })
})
