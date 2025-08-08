import { AsyncLocalStorage } from "node:async_hooks"

import type { Pool, PoolClient } from "pg"

export type NestingPoolClient = {
  client: PoolClient
  release: () => void
}

/**
 * An extension of the `Pool` class that allows for nested connections.
 */
export class NestingPool {
  constructor(private readonly pool: Pool) {}

  connectionStorage = new AsyncLocalStorage<PoolClient>()

  async getClient(): Promise<NestingPoolClient> {
    const client = this.connectionStorage.getStore()
    if (client) {
      return {
        client,
        release: () => {
          // No-op. We were reusing the client from the AsyncLocalStorage.
        },
      }
    } else {
      const client = await this.pool.connect()
      this.connectionStorage.enterWith(client)
      return {
        client,
        release: () => {
          this.connectionStorage.disable()
          client.release()
        },
      }
    }
  }

  /**
   * Acquires a client from the pool and executes the provided function.
   *
   * The client is released after the function completes.
   *
   * For nested lock calls, the client is reused from the AsyncLocalStorage.
   */
  async withClient<T>(fn: (client: PoolClient) => Promise<T>) {
    const existingClient = this.connectionStorage.getStore()

    if (existingClient) {
      // Reuse existing client from AsyncLocalStorage
      return await fn(existingClient)
    } else {
      // Create new client and establish AsyncLocalStorage context
      const client = await this.pool.connect()
      return this.connectionStorage.run(client, async () => {
        try {
          return await fn(client)
        } finally {
          client.release()
        }
      })
    }
  }
}
