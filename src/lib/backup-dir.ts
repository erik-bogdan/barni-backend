import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'


export const BACKUP_FILENAME_REGEX = /^backup-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.sql$/

let validatedBackupDir: string | null = null

export function ensureBackupDir(): string {
  if (validatedBackupDir) return validatedBackupDir

  const dir = process.env.BACKUP_DIR || '/tmp/solvo-backups'
  if (!path.isAbsolute(dir)) {
    throw new Error('BACKUP_DIR must be an absolute path')
  }

  const realDir = fs.realpathSync(dir)
  const stats = fs.statSync(realDir)

  if (!stats.isDirectory()) {
    throw new Error('BACKUP_DIR must point to a directory')
  }

  validatedBackupDir = realDir
  return validatedBackupDir
}

export async function resolveBackupPath(filename: string): Promise<{ fullPath: string }> {
  const base = ensureBackupDir()
  const candidate = path.join(base, filename)
  const resolved = await fsp.realpath(candidate)

  // The realpath check prevents path traversal and symlink escape outside BACKUP_DIR.
  const baseWithSep = base.endsWith(path.sep) ? base : `${base}${path.sep}`
  if (!resolved.startsWith(baseWithSep)) {
    throw new Error('Backup path escapes BACKUP_DIR')
  }

  return { fullPath: resolved }
}

export async function ensureBackupFileExists(filename: string): Promise<{ fullPath: string; size: number }> {
  const { fullPath } = await resolveBackupPath(filename)
  const stats = await fsp.stat(fullPath)
  if (!stats.isFile()) {
    throw new Error('Backup path is not a file')
  }

  return { fullPath, size: stats.size }
}

