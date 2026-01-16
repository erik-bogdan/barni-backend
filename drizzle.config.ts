import type { Config } from 'drizzle-kit'
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  out: './migrations',
  schema: './packages/db/src/schema.ts',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL_DRIZZLE!,
  },
}) satisfies Config;