import { expect, it } from "vitest"

import { createAdvisoryLockKey } from "./key"

const strings = [
  "foo",
  "bar",
  "Glittering prizes",
  "'Join the army!', they said. 'See the world!', they said. I'd rather be sailing.",
]
// Come up with more keys by combining existing keys
strings.push(...strings.flatMap(s1 => strings.map(s2 => s1 + s2)))

it("generates different keys", () => {
  const keys = new Set(strings.map(createAdvisoryLockKey))
  expect(keys.size).toBe(strings.length)
})

it("generates signed 64-bit bigints", () => {
  for (const key of strings.map(createAdvisoryLockKey)) {
    expect(key).toBeGreaterThanOrEqual(-(1n << 63n))
    expect(key).toBeLessThan(1n << 63n)
  }
})
