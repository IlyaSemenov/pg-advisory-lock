/**
 * Convert a string to a lock key (signed 64-bit integer).
 */
export function createAdvisoryLockKey(str: string): bigint {
  // djb2 hash
  const mask64 = (1n << 64n) - 1n // Max 64-bit integer
  let hash = 5381n
  for (let i = 0; i < str.length; i++) {
    hash = ((hash * 33n) ^ BigInt(str.charCodeAt(i))) & mask64
  }
  return unsignedToSigned64(hash)
}

function unsignedToSigned64(n: bigint) {
  // Check if the number is in the upper half of the unsigned range (>= 2^63)
  if (n >= (1n << 63n)) {
    // Convert to negative by subtracting 2^64
    return n - (1n << 64n)
  }
  return n
}
