import { readFileSync } from 'fs'
import { join } from 'path'
import postgres from 'postgres'
import { env } from '../env'

async function runMigration() {
  const migrationFile = process.argv[2]
  if (!migrationFile) {
    console.error('Usage: bun run src/scripts/run-migration.ts <migration-file>')
    console.error('Example: bun run src/scripts/run-migration.ts migrations/0027_add_stories_cover_urls.sql')
    process.exit(1)
  }

  const migrationPath = join(process.cwd(), migrationFile)
  const sql = readFileSync(migrationPath, 'utf-8')

  const client = postgres(env.DATABASE_URL)
  
  try {
    console.log(`Running migration: ${migrationFile}`)
    await client.unsafe(sql)
    console.log('Migration completed successfully!')
  } catch (error) {
    console.error('Migration failed:', error)
    process.exit(1)
  } finally {
    await client.end()
  }
}

runMigration()
