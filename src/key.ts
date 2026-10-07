import { createHash } from "node:crypto"

/**
 * Derives the PostgreSQL advisory lock key used for a lock name in a keyspace.
 *
 * Each namespace replaces the seed with `SHA-256(seed ‖ namespace)`, starting from an empty seed.
 * The key is the first 8 bytes of `SHA-256(seed ‖ name)` read as a signed big-endian 64-bit integer.
 * Strings are encoded as UTF-8.
 *
 * @param name - The logical lock name.
 * @param namespaces - The namespace chain in `namespace()` call order.
 * @returns The signed 64-bit key passed to PostgreSQL advisory lock functions.
 */
export function deriveAdvisoryLockKey(
  name: string,
  namespaces: readonly string[] = [],
): bigint {
  let seed: Uint8Array = new Uint8Array(0)
  for (const namespace of namespaces) seed = sha256(seed, namespace)
  return sha256(seed, name).readBigInt64BE()
}

function sha256(seed: Uint8Array, value: string): Buffer {
  return createHash("sha256").update(seed).update(value).digest()
}

/** Resolves a lock name, or a raw key in the root keyspace, to a PostgreSQL advisory lock key. */
export function resolveAdvisoryLockKey(
  name: string | bigint,
  namespaces: readonly string[],
): bigint {
  if (typeof name === "string") return deriveAdvisoryLockKey(name, namespaces)
  if (namespaces.length > 0) {
    throw new TypeError("Namespaced keyspaces accept only string lock names")
  }
  if (BigInt.asIntN(64, name) !== name) {
    throw new RangeError("Advisory lock key must be a signed 64-bit integer")
  }
  return name
}
