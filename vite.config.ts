import tsconfigPaths from "vite-tsconfig-paths"
import { defineConfig } from "vitest/config"

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    // Tests interfere with each other because they use the same database and the same lock names.
    fileParallelism: false,
    testTimeout: 1000,
  },
})
