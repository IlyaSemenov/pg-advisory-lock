// @ts-check

import { defineConfig } from "@ilyasemenov/eslint-config"

export default defineConfig().append({
  files: ["**/*.md/*.ts"],
  rules: {
    "no-console": "off",
  },
})
