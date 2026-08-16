import { afterEach, beforeEach, describe, expect, it } from "bun:test"

import postgres from "postgres"

import { databaseUrl, sleep } from "#test-utils"

import { NestingPool } from "./pool"

describe("test NestingPool", () => {
  let pool: postgres.Sql
  let nestingPool: NestingPool
  let activeConnections: number

  beforeEach(() => {
    pool = postgres(databaseUrl)
    activeConnections = 0
    const reserve = pool.reserve.bind(pool)
    pool.reserve = async () => {
      const client = await reserve()
      const release = client.release.bind(client)
      activeConnections += 1
      client.release = () => {
        activeConnections -= 1
        release()
      }
      return client
    }
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
      const queryResult = await result.client`SELECT 1 AS test`
      expect(queryResult[0]?.test).toBe(1)

      result.release()
    })

    it("should reuse existing client from AsyncLocalStorage when called within withClient", async () => {
      const result = await nestingPool.withClient(async (outerClient) => {
        // Call getClient within the AsyncLocalStorage context
        const nestedResult = await nestingPool.getClient()

        expect(nestedResult.client).toBe(outerClient)

        // Test that the client can actually query
        const queryResult = await nestedResult.client`SELECT 2 AS test`
        expect(queryResult[0]?.test).toBe(2)

        nestedResult.release()
        return "success"
      })

      expect(result).toBe("success")
    })

    it("should properly release client when release is called", async () => {
      const { client, release } = await nestingPool.getClient()

      // Test that client is working
      const queryResult = await client`SELECT 3 AS test`
      expect(queryResult[0]?.test).toBe(3)

      release()

      // The client should be released back to the pool
      // Note: The client object might still be usable, but it's been returned to the pool
      expect(release).toBeDefined()
    })

    it("should ignore repeated release calls", async () => {
      const { release } = await nestingPool.getClient()

      release()
      release()

      expect(activeConnections).toBe(0)
    })
  })

  describe("withClient", () => {
    it("should execute function with client and release it", async () => {
      const result = await nestingPool.withClient(async (client) => {
        const queryResult = await client`SELECT 4 AS test`
        return queryResult[0]?.test
      })

      expect(result).toBe(4)
      expect(activeConnections).toBe(0)
    })

    it("should release client even when function throws", async () => {
      const mockError = new Error("test error")

      await expect(
        nestingPool.withClient(async () => {
          throw mockError
        }),
      ).rejects.toThrow("test error")
      expect(activeConnections).toBe(0)

      // Should be able to use the pool again
      const result = await nestingPool.withClient(async (client) => {
        const queryResult = await client`SELECT 5 AS test`
        return queryResult[0]?.test
      })

      expect(result).toBe(5)
    })

    it("should support nested calls by reusing the same client", async () => {
      const result = await nestingPool.withClient(async (outerClient) => {
        // Nested call
        const nestedResult = await nestingPool.withClient(
          async (nestedClient) => {
            expect(nestedClient).toBe(outerClient) // Should be the same client
            const queryResult = await nestedClient`SELECT 6 AS test`
            return queryResult[0]?.test
          },
        )

        expect(nestedResult).toBe(6)

        // Test that outer client is still working
        const queryResult = await outerClient`SELECT 7 AS test`
        return queryResult[0]?.test
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

        expect(activeConnections).toBe(1)
        return { outerClient, firstClient, secondClient }
      })

      expect(clients.firstClient).toBe(clients.outerClient)
      expect(clients.secondClient).toBe(clients.outerClient)
      expect(activeConnections).toBe(0)
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
        const activeWhileNested = activeConnections
        finishNested.resolve()

        const [firstClient, secondClient] = await Promise.all([
          firstOperation,
          secondOperation,
        ])
        return {
          outerClient,
          firstClient,
          secondClient,
          activeWhileNested,
          activeAfterNested: activeConnections,
        }
      })

      expect(clients.firstClient).toBe(clients.outerClient)
      expect(clients.secondClient).toBe(clients.outerClient)
      expect(clients.activeWhileNested).toBe(1)
      expect(clients.activeAfterNested).toBe(1)
      expect(activeConnections).toBe(0)
    })

    it("should handle multiple nested levels correctly", async () => {
      const result = await nestingPool.withClient(async (level1Client) => {
        const level2Result = await nestingPool.withClient(
          async (level2Client) => {
            expect(level2Client).toBe(level1Client)

            const level3Result = await nestingPool.withClient(
              async (level3Client) => {
                expect(level3Client).toBe(level1Client)
                const queryResult = await level3Client`SELECT 8 AS test`
                return queryResult[0]?.test
              },
            )

            expect(level3Result).toBe(8)
            const queryResult = await level2Client`SELECT 9 AS test`
            return queryResult[0]?.test
          },
        )

        expect(level2Result).toBe(9)
        const queryResult = await level1Client`SELECT 10 AS test`
        return queryResult[0]?.test
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
      expect(activeConnections).toBe(0)
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

      expect(activeConnections).toBe(1)

      finishNested.resolve()
      await nestedOperation

      expect(activeConnections).toBe(0)
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
        expect(activeConnections).toBe(1)
      })

      expect(activeConnections).toBe(0)
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
      const queryResult = await orphanedClient.client`SELECT 13 AS test`
      orphanedClient.release()

      expect(orphanedClient.nested).toBe(false)
      expect(queryResult[0]?.test).toBe(13)
    })

    it("should maintain separate contexts for different async operations", async () => {
      const operation1 = async () => {
        const { client, release } = await nestingPool.getClient()
        await sleep(10)
        const result = await client`SELECT 11 AS test`
        release()
        return result[0]?.test
      }

      const operation2 = async () => {
        const { client, release } = await nestingPool.getClient()
        await sleep(10)
        const result = await client`SELECT 12 AS test`
        release()
        return result[0]?.test
      }

      // Run operations concurrently
      const [result1, result2] = await Promise.all([operation1(), operation2()])

      expect(result1).toBe(11)
      expect(result2).toBe(12)
    })
  })
})
