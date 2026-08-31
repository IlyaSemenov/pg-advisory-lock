import { AsyncLocalStorage } from "node:async_hooks"

import type { AdvisoryLockKeyspace, AdvisoryLockManager } from "./lock"
import type { AdvisoryMutex, TryWithLockResult } from "./mutex"

const stateBrand: unique symbol = Symbol("TestAdvisoryLockState")

function serializeAdvisoryLockKey(
  namespaces: readonly string[],
  name: string,
): string {
  return JSON.stringify([...namespaces, name])
}

/** Shared in-memory PostgreSQL advisory lock space for test managers. */
export interface TestAdvisoryLockState {
  readonly [stateBrand]: true
}

export interface CreateTestAdvisoryLockManagerOptions {
  /** A shared state for modeling managers connected to the same lock space. */
  state?: TestAdvisoryLockState
}

type LockOwner = object

type LockWaiter = {
  owner: LockOwner
  resolve: () => void
}

type HeldLock = {
  count: number
  owner: LockOwner
  waiters: LockWaiter[]
}

class TestAdvisoryLockStateImplementation implements TestAdvisoryLockState {
  readonly [stateBrand] = true
  private readonly locks = new Map<string, HeldLock>()

  async acquire(key: string, owner: LockOwner): Promise<void> {
    const held = this.locks.get(key)
    if (!held) {
      this.locks.set(key, { count: 1, owner, waiters: [] })
      return
    }
    if (held.owner === owner) {
      held.count += 1
      return
    }

    await new Promise<void>((resolve) => {
      held.waiters.push({ owner, resolve })
    })
  }

  tryAcquire(key: string, owner: LockOwner): boolean {
    const held = this.locks.get(key)
    if (!held) {
      this.locks.set(key, { count: 1, owner, waiters: [] })
      return true
    }
    if (held.owner === owner) {
      held.count += 1
      return true
    }
    return false
  }

  release(key: string, owner: LockOwner): void {
    const held = this.locks.get(key)
    if (!held || held.owner !== owner) {
      throw new Error("Advisory lock is no longer held by its connection")
    }

    held.count -= 1
    if (held.count > 0) return

    const waiter = held.waiters.shift()
    if (!waiter) {
      this.locks.delete(key)
      return
    }

    held.count = 1
    held.owner = waiter.owner
    waiter.resolve()
  }
}

type Owner = {
  references: number
}

type OwnerContext = {
  active: boolean
  owner: Owner
  parent: OwnerContext | undefined
}

type AcquiredOwner = {
  owner: Owner
  release: () => void
}

const closedError = "Advisory lock manager is closing or closed"

class TestManagerLifecycle {
  private activeOwners = 0
  private closePromise: Promise<void> | undefined
  private closing = false
  private resolveIdle: (() => void) | undefined
  private readonly ownerStorage = new AsyncLocalStorage<OwnerContext>()

  private activeOwnerContext(): OwnerContext | undefined {
    let context = this.ownerStorage.getStore()
    while (context && !context.active) context = context.parent
    return context
  }

  private acquireOwner(): AcquiredOwner {
    const context = this.activeOwnerContext()
    if (context) {
      context.owner.references += 1
      return {
        owner: context.owner,
        release: this.createRelease(context.owner),
      }
    }

    if (this.closing) throw new Error(closedError)

    this.activeOwners += 1
    const owner = { references: 1 }
    return { owner, release: this.createRelease(owner) }
  }

  private createRelease(owner: Owner): () => void {
    let released = false
    return () => {
      if (released) return
      released = true
      owner.references -= 1
      if (owner.references === 0) this.finishOwner()
    }
  }

  private finishOwner(): void {
    this.activeOwners -= 1
    if (this.activeOwners === 0) {
      this.resolveIdle?.()
      this.resolveIdle = undefined
    }
  }

  async withOwner<T>(fn: (owner: Owner) => Promise<T>): Promise<T> {
    const { owner, release } = this.acquireOwner()
    const context: OwnerContext = {
      active: true,
      owner,
      parent: this.ownerStorage.getStore(),
    }

    return await this.ownerStorage.run(context, async () => {
      try {
        return await fn(owner)
      } finally {
        context.active = false
        release()
      }
    })
  }

  getOwner(): AcquiredOwner {
    return this.acquireOwner()
  }

  close(): Promise<void> {
    if (this.activeOwnerContext()) {
      return Promise.reject(
        new Error(
          "Cannot close advisory lock manager from an active lock context",
        ),
      )
    }

    this.closePromise ??= this.closeWhenIdle()
    return this.closePromise
  }

  private async closeWhenIdle(): Promise<void> {
    this.closing = true
    if (this.activeOwners > 0) {
      await new Promise<void>((resolve) => {
        this.resolveIdle = resolve
      })
    }
  }
}

class TestAdvisoryMutex implements AdvisoryMutex {
  private readonly key: string

  constructor(
    private readonly state: TestAdvisoryLockStateImplementation,
    private readonly lifecycle: TestManagerLifecycle,
    namespaces: readonly string[],
    name: string,
  ) {
    this.key = serializeAdvisoryLockKey(namespaces, name)
  }

  async withLock<T>(fn: () => PromiseLike<T>): Promise<T> {
    return await this.lifecycle.withOwner(async (owner) => {
      await this.state.acquire(this.key, owner)
      try {
        return await fn()
      } finally {
        this.state.release(this.key, owner)
      }
    })
  }

  async tryWithLock<T>(
    fn: () => PromiseLike<T>,
  ): Promise<TryWithLockResult<T>> {
    return await this.lifecycle.withOwner(async (owner) => {
      if (!this.state.tryAcquire(this.key, owner)) return { acquired: false }
      try {
        return { acquired: true, result: await fn() }
      } finally {
        this.state.release(this.key, owner)
      }
    })
  }

  async tryLock(): Promise<(() => Promise<void>) | undefined> {
    const { owner, release } = this.lifecycle.getOwner()
    try {
      if (!this.state.tryAcquire(this.key, owner)) {
        release()
        return undefined
      }

      let unlockPromise: Promise<void> | undefined
      return () => {
        unlockPromise ??= Promise.resolve().then(() => {
          try {
            this.state.release(this.key, owner)
          } finally {
            release()
          }
        })
        return unlockPromise
      }
    } catch (error) {
      release()
      throw error
    }
  }

  wrapWithLock<TArgs extends readonly unknown[], TReturn>(
    fn: (...args: TArgs) => PromiseLike<TReturn>,
  ): (...args: TArgs) => Promise<TReturn> {
    return async (...args: TArgs) => this.withLock(() => fn(...args))
  }
}

/** Creates an isolated in-memory PostgreSQL advisory lock space. */
export function createTestAdvisoryLockState(): TestAdvisoryLockState {
  return new TestAdvisoryLockStateImplementation()
}

/** Creates an advisory lock manager for tests without a PostgreSQL connection. */
export function createTestAdvisoryLockManager(
  options: CreateTestAdvisoryLockManagerOptions = {},
): AdvisoryLockManager {
  const state =
    options.state === undefined
      ? new TestAdvisoryLockStateImplementation()
      : options.state
  if (!(state instanceof TestAdvisoryLockStateImplementation)) {
    throw new TypeError("state must be created by createTestAdvisoryLockState")
  }
  const stateImplementation = state

  const lifecycle = new TestManagerLifecycle()

  function createKeyspace(namespaces: readonly string[]): AdvisoryLockKeyspace {
    const createMutex = (name: string) =>
      new TestAdvisoryMutex(stateImplementation, lifecycle, namespaces, name)

    return {
      createMutex,
      namespace: (value) => createKeyspace([...namespaces, value]),
      tryLock: (name) => createMutex(name).tryLock(),
      tryWithLock: (name, fn) => createMutex(name).tryWithLock(fn),
      withLock: (name, fn) => createMutex(name).withLock(fn),
      wrapWithLock: (name, fn) => createMutex(name).wrapWithLock(fn),
    }
  }

  const close = () => lifecycle.close()
  return {
    ...createKeyspace([]),
    close,
    [Symbol.asyncDispose]: close,
  }
}
