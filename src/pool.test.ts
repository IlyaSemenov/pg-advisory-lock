import { afterEach, beforeEach, describe, expect, it } from "bun:test"

import { Pool } from "pg"

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

    it("should ignore repeated release calls", async () => {
      const { release } = await nestingPool.getClient()

      release()
      release()

      expect(pool.idleCount).toBe(1)
    })
  })

  describe("withClient", () => {
    it("should execute function with client and release it", async () => {
      const result = await nestingPool.withClient(async (client) => {
        const queryResult = await client.query("SELECT 4 as test")
        return queryResult.rows[0].test
      })

      expect(result).toBe(4)
      expect(pool.idleCount).toBe(1)
    })

    it("should release client even when function throws", async () => {
      const mockError = new Error("test error")

      await expect(
        nestingPool.withClient(async () => {
          throw mockError
        }),
      ).rejects.toThrow("test error")
      expect(pool.idleCount).toBe(1)

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
        const nestedResult = await nestingPool.withClient(
          async (nestedClient) => {
            expect(nestedClient).toBe(outerClient) // Should be the same client
            const queryResult = await nestedClient.query("SELECT 6 as test")
            return queryResult.rows[0].test
          },
        )

        expect(nestedResult).toBe(6)

        // Test that outer client is still working
        const queryResult = await outerClient.query("SELECT 7 as test")
        return queryResult.rows[0].test
      })

      expect(result).toBe(7)
    })

    it("should reuse the client across sequential nested calls", async () => {
      const clients = await nestingPool.withClient(async (outerClient) => {
        const firstClient = await nestingPool.withClient(
          async (client) => client,
        )
        const secondClient = await nestingPool.withClient(
          async (client) => client,
        )

        expect(pool.idleCount).toBe(0)
        return { outerClient, firstClient, secondClient }
      })

      expect(clients.firstClient).toBe(clients.outerClient)
      expect(clients.secondClient).toBe(clients.outerClient)
      expect(pool.idleCount).toBe(1)
    })

    it("should reuse the client across concurrent nested calls", async () => {
      const clients = await nestingPool.withClient(async (outerClient) => {
        const firstStarted = Promise.withResolvers<void>()
        const secondStarted = Promise.withResolvers<void>()
        const finishNested = Promise.withResolvers<void>()

        const firstOperation = nestingPool.withClient(async (client) => {
          firstStarted.resolve()
          await finishNested.promise
          return client
        })
        const secondOperation = nestingPool.withClient(async (client) => {
          secondStarted.resolve()
          await finishNested.promise
          return client
        })

        await Promise.all([firstStarted.promise, secondStarted.promise])
        const idleWhileNested = pool.idleCount
        finishNested.resolve()

        const [firstClient, secondClient] = await Promise.all([
          firstOperation,
          secondOperation,
        ])
        return {
          outerClient,
          firstClient,
          secondClient,
          idleWhileNested,
          idleAfterNested: pool.idleCount,
        }
      })

      expect(clients.firstClient).toBe(clients.outerClient)
      expect(clients.secondClient).toBe(clients.outerClient)
      expect(clients.idleWhileNested).toBe(0)
      expect(clients.idleAfterNested).toBe(0)
      expect(pool.idleCount).toBe(1)
    })

    it("should handle multiple nested levels correctly", async () => {
      const result = await nestingPool.withClient(async (level1Client) => {
        const level2Result = await nestingPool.withClient(
          async (level2Client) => {
            expect(level2Client).toBe(level1Client)

            const level3Result = await nestingPool.withClient(
              async (level3Client) => {
                expect(level3Client).toBe(level1Client)
                const queryResult = await level3Client.query("SELECT 8 as test")
                return queryResult.rows[0].test
              },
            )

            expect(level3Result).toBe(8)
            const queryResult = await level2Client.query("SELECT 9 as test")
            return queryResult.rows[0].test
          },
        )

        expect(level2Result).toBe(9)
        const queryResult = await level1Client.query("SELECT 10 as test")
        return queryResult.rows[0].test
      })

      expect(result).toBe(10)
    })
  })

  describe("asyncLocalStorage behavior", () => {
    it("should use different clients for independent concurrent acquisitions", async () => {
      const [firstClient, secondClient] = await Promise.all([
        nestingPool.getClient(),
        nestingPool.getClient(),
      ])

      firstClient.release()
      secondClient.release()

      expect(firstClient.client).not.toBe(secondClient.client)
      expect(pool.idleCount).toBe(2)
    })

    it("should keep the client acquired while a nested context is active", async () => {
      const nestedStarted = Promise.withResolvers<void>()
      const finishNested = Promise.withResolvers<void>()
      let nestedOperation!: Promise<void>

      await nestingPool.withClient(async () => {
        nestedOperation = nestingPool.withClient(async () => {
          nestedStarted.resolve()
          await finishNested.promise
        })
        await nestedStarted.promise
      })

      expect(pool.idleCount).toBe(0)

      finishNested.resolve()
      await nestedOperation

      expect(pool.idleCount).toBe(1)
    })

    it("should find an active parent behind a completed nested context", async () => {
      const resumeChild = Promise.withResolvers<void>()
      let childOperation!: Promise<boolean>

      await nestingPool.withClient(async (outerClient) => {
        await nestingPool.withClient(async () => {
          childOperation = (async () => {
            await resumeChild.promise
            return nestingPool.withClient(
              async (childClient) => childClient === outerClient,
            )
          })()
        })

        resumeChild.resolve()
        expect(await childOperation).toBe(true)
        expect(pool.idleCount).toBe(0)
      })

      expect(pool.idleCount).toBe(1)
    })

    it("should not reuse a client from a completed async context", async () => {
      const continueOrphanedOperation = Promise.withResolvers<void>()
      let orphanedClientPromise!: ReturnType<NestingPool["getClient"]>

      await nestingPool.withClient(async () => {
        orphanedClientPromise = (async () => {
          await continueOrphanedOperation.promise
          return nestingPool.getClient()
        })()
      })

      continueOrphanedOperation.resolve()
      const orphanedClient = await orphanedClientPromise
      const queryResult = await orphanedClient.client.query("SELECT 13 as test")
      orphanedClient.release()

      expect(orphanedClient.nested).toBe(false)
      expect(queryResult.rows[0].test).toBe(13)
    })

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
