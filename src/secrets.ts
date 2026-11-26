/**
 * API-key storage.
 *
 * The key must never live in the config row: that row is read by every settings
 * query, dumped into diagnostics and included in backups. It lives in a private
 * file under the harness home instead, written atomically with owner-only mode,
 * and is only ever handed to the outbound request — never back to the client,
 * never into a tool result.
 *
 * `SecretStore` is the single seam: swapping in the harness credentials service
 * later means replacing this class, not its callers.
 *
 * Three properties this class has to keep, because losing any of them loses the
 * user's key silently:
 *
 * 1. **Atomic replacement.** A crash mid-write must leave the previous key.
 * 2. **No failed read is remembered.** A file locked by an antivirus at boot is
 *    not "there is no key"; the next call reads again.
 * 3. **A save wins over an in-flight load.** The revision counter stops a slow
 *    read from clobbering a newer write with the value it read before it.
 */

import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { chmodSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'

const RELATIVE_PATH = ['storages', 'dsh-weknora', 'credentials.json'] as const

/** Resolve `$DSH_HOME/storages/dsh-weknora/credentials.json`. */
export function credentialFile(home: string | undefined = process.env['DSH_HOME']): string {
  const root = home !== undefined && home.trim() !== '' ? home : join(homedir(), '.dsh')
  return join(root, ...RELATIVE_PATH)
}

interface CredentialFile {
  apiKey?: string
}

export class SecretStore {
  private value: string | undefined
  private loading: Promise<void> | undefined
  /** Bumped by every write; a load that started earlier must not apply. */
  private revision = 0

  constructor(
    private readonly file: string = credentialFile(),
    private readonly logger?: { warn(...args: unknown[]): void },
  ) {}

  /** The key to use right now; synchronous so a request path can read it. */
  cached(): string | undefined {
    return this.value
  }

  /**
   * Load once, tolerating a missing or corrupt file.
   *
   * A failure is not cached: the file may be temporarily locked, and pinning
   * "no key" for the life of the process would look like a 401 to the user.
   */
  async load(): Promise<string | undefined> {
    if (this.loading === undefined) {
      const startedAt = this.revision
      this.loading = (async () => {
        try {
          const raw = await readFile(this.file, 'utf8')
          const parsed = JSON.parse(raw) as CredentialFile
          const key = typeof parsed.apiKey === 'string' ? parsed.apiKey.trim() : ''
          // A save that landed while this read was in flight wins.
          if (this.revision === startedAt) this.value = key === '' ? undefined : key
        } catch (error) {
          const code = (error as { code?: string }).code
          if (code !== 'ENOENT') {
            this.logger?.warn(`dsh-weknora: 读取凭据失败（${this.file}）：${String(error)}；下次会重试。`)
          }
          if (this.revision === startedAt) this.value = undefined
          // Do not remember the failure: the next caller retries the read.
          this.loading = undefined
        }
      })()
    }
    await this.loading
    return this.value
  }

  /** Forget the cached read so the next `load()` goes back to disk. */
  async reload(): Promise<string | undefined> {
    this.loading = undefined
    return await this.load()
  }

  /** Store a new key. An empty string clears it. */
  async save(apiKey: string): Promise<void> {
    const trimmed = apiKey.trim()
    if (trimmed === '') {
      await this.clear()
      return
    }
    await this.writeAtomically(`${JSON.stringify({ apiKey: trimmed } satisfies CredentialFile, null, 2)}\n`)
    this.value = trimmed
  }

  /**
   * Remove the stored key.
   *
   * Deleting the file (rather than rewriting `{}`) is what makes the removal
   * atomic: there is no window in which a truncated JSON object could be read
   * as "the credential file is corrupt".
   */
  async clear(): Promise<void> {
    this.revision += 1
    this.loading = undefined
    try {
      await unlink(this.file)
    } catch (error) {
      const code = (error as { code?: string }).code
      if (code !== 'ENOENT') throw error
    }
    this.value = undefined
  }

  has(): boolean {
    return this.value !== undefined && this.value !== ''
  }

  /** Write to a unique temp file in the same directory, then rename over. */
  private async writeAtomically(payload: string): Promise<void> {
    this.revision += 1
    this.loading = undefined
    const dir = join(this.file, '..')
    await mkdir(dir, { recursive: true })
    // The suffix is unique per write: two windows saving at once must not share
    // one temp inode and tear the rename.
    const tmp = `${this.file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
    try {
      await writeFile(tmp, payload, 'utf8')
      // Best effort: the mode matters on POSIX, and is a no-op on Windows.
      try {
        chmodSync(tmp, 0o600)
      } catch {
        // Ignore: no equivalent on this platform.
      }
      await rename(tmp, this.file)
    } catch (error) {
      // Leave no debris behind if the write or the rename failed.
      try {
        await unlink(tmp)
      } catch {
        // The temp file never existed, or is already gone.
      }
      throw error
    }
  }
}
