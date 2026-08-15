import { defineConfig } from "tsdown"

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs", "esm"],
  dts: true,
  exports: true,
  nodeProtocol: "strip",
  publint: true,
  attw: {
    profile: "strict",
  },
})
