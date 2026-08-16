import { AsyncLocalStorage } from "node:async_hooks"

import type { Pool, PoolClient } from "pg"

export type NestingPoolClient = {
  client: PoolClient
  /** Must be called to release this acquisition; calls after the first have no effect. */
  release: () => void
  nested: boolean
}

type Connection = {
  client: PoolClient
  references: number
  release: () => void
}

type ConnectionContext = {
  connection: Connection
  active: boolean
  parent: ConnectionContext | undefined
}

type AcquiredConnection = {
  connection: Connection
  release: () => void
  nested: boolean
}

/**
 * An extension of the `Pool` class that allows for nested connections.
 */
export class NestingPool {
  constructor(private readonly pool: Pool) {}

  connectionStorage = new AsyncLocalStorage<ConnectionContext>()

  /**
   * Creates a new client, or reuses an existing client from the AsyncLocalStorage.
   */
  async getClient(): Promise<NestingPoolClient> {
    const { connection, release, nested } = await this.acquireConnection()
    return { client: connection.client, release, nested }
  }

  private activeConnectionContext(): ConnectionContext | undefined {
    let context = this.connectionStorage.getStore()
    while (context && !context.active) context = context.parent
    return context
  }

  private async acquireConnection(): Promise<AcquiredConnection> {
    const context = this.activeConnectionContext()
    if (context) {
      context.connection.references += 1
      return {
        connection: context.connection,
        release: this.createRelease(context.connection),
        nested: true,
      }
    } else {
      const client = await this.pool.connect()
      const connection: Connection = {
        client,
        references: 1,
        release: () => client.release(),
      }
      return {
        connection,
        release: this.createRelease(connection),
        nested: false,
      }
    }
  }

  private createRelease(connection: Connection) {
    let released = false
    return () => {
      if (released) return
      released = true
      this.releaseConnection(connection)
    }
  }

  private releaseConnection(connection: Connection) {
    connection.references -= 1
    if (connection.references === 0) connection.release()
  }

  /**
   * Acquires a client from the pool and executes the provided function.
   *
   * The client is released after the function completes.
   *
   * For nested lock calls, the client is reused from the AsyncLocalStorage.
   */
  async withClient<T>(fn: (client: PoolClient) => Promise<T>) {
    const { connection, release } = await this.acquireConnection()
    const context: ConnectionContext = {
      connection,
      active: true,
      parent: this.connectionStorage.getStore(),
    }

    return this.connectionStorage.run(context, async () => {
      try {
        return await fn(connection.client)
      } finally {
        context.active = false
        release()
      }
    })
  }
}
