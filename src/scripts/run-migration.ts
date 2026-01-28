import { readFileSync } from 'fs'
import { join } from 'path'
import postgres from 'postgres'
import { env } from '../env'
import { createLogger, setLogger } from '../lib/logger'

const logger = createLogger("backend")
setLogger(logger)

async function runMigration() {
  const migrationFile = process.argv[2]
  if (!migrationFile) {
    logger.error('Usage: bun run src/scripts/run-migration.ts <migration-file>')
    logger.error('Example: bun run src/scripts/run-migration.ts migrations/0027_add_stories_cover_urls.sql')
    process.exit(1)
  }

  const migrationPath = join(process.cwd(), migrationFile)
  const sql = readFileSync(migrationPath, 'utf-8')

  const client = postgres(env.DATABASE_URL)
  
  try {
    logger.info({ migrationFile }, "migration.start")
    await client.unsafe(sql)
    logger.info("migration.completed")
  } catch (error) {
    logger.error({ err: error }, "migration.failed")
    process.exit(1)
  } finally {
    await client.end()
  }
}

runMigration()
