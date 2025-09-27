import { AsyncLocalStorage } from "node:async_hooks"

import type { Pool, PoolClient } from "pg"

export type NestingPoolClient = {
  client: PoolClient
  release: () => void
  nested: boolean
}

/**
 * An extension of the `Pool` class that allows for nested connections.
 */
export class NestingPool {
  constructor(private readonly pool: Pool) {}

  connectionStorage = new AsyncLocalStorage<PoolClient>()

  /**
   * Creates a new client, or reuses an existing client from the AsyncLocalStorage.
   */
  async getClient(): Promise<NestingPoolClient> {
    const client = this.connectionStorage.getStore()
    if (client) {
      return {
        client,
        release: () => {},
        nested: true,
      }
    } else {
      const client = await this.pool.connect()
      return {
        client,
        release: () => client.release(),
        nested: false,
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
    const { client, release, nested } = await this.getClient()

    if (nested) {
      return await fn(client)
    } else {
      return this.connectionStorage.run(client, async () => {
        try {
          return await fn(client)
        } finally {
          release()
        }
      })
    }
  }
}
