import { AsyncLocalStorage } from "node:async_hooks"

import type { ReservedSql, Sql } from "postgres"

export type NestingPoolClient = {
  client: ReservedSql
  /** Must be called to release this acquisition; calls after the first have no effect. */
  release: () => void
  nested: boolean
}

type Connection = {
  client: ReservedSql
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
 * A wrapper around a postgres.js pool that allows for nested connections.
 */
export class NestingPool {
  private activeConnections = 0
  private closePromise: Promise<void> | undefined
  private closing = false
  private resolveIdle: (() => void) | undefined

  constructor(
    private readonly pool: Sql,
    private readonly closePool?: () => Promise<void>,
  ) {}

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
      if (this.closing) {
        throw new Error("Advisory lock factory is closing or closed")
      }

      this.activeConnections += 1
      try {
        const client = await this.pool.reserve()
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
      } catch (error) {
        this.finishConnection()
        throw error
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
    if (connection.references === 0) {
      try {
        connection.release()
      } finally {
        this.finishConnection()
      }
    }
  }

  private finishConnection() {
    this.activeConnections -= 1
    if (this.activeConnections === 0) {
      this.resolveIdle?.()
      this.resolveIdle = undefined
    }
  }

  /**
   * Stops new acquisitions and closes the pool after active connections are released.
   */
  close(): Promise<void> {
    if (this.activeConnectionContext()) {
      return Promise.reject(
        new Error(
          "Cannot close advisory lock factory from an active lock context",
        ),
      )
    }

    this.closePromise ??= this.closeWhenIdle()
    return this.closePromise
  }

  private async closeWhenIdle() {
    this.closing = true

    if (this.activeConnections > 0) {
      await new Promise<void>((resolve) => {
        this.resolveIdle = resolve
      })
    }

    await this.closePool?.()
  }

  /**
   * Acquires a client from the pool and executes the provided function.
   *
   * The client is released after the function completes.
   *
   * For nested lock calls, the client is reused from the AsyncLocalStorage.
   */
  async withClient<T>(fn: (client: ReservedSql) => Promise<T>) {
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
