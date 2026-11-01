import { defineConfig } from "tsdown"

export default defineConfig({
  entry: {
    index: "src/index.ts",
    testing: "src/testing.ts",
  },
  format: ["cjs", "esm"],
  dts: true,
  exports: true,
  nodeProtocol: "strip",
  treeshake: {
    // Remove leftover bare postgres.js imports so CommonJS declarations type-check with postgres.js 4 in node16 mode.
    moduleSideEffects: "no-external",
  },
  publint: true,
  attw: {
    profile: "strict",
  },
})
