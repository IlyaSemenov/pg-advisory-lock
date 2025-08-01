import { env } from "node:process"

// Empty string means connect with current user
export const databaseUrl = env.DATABASE_URL ?? ""
