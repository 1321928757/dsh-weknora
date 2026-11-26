/**
 * An in-memory snapshot of the knowledge bases this deployment can serve.
 *
 * Tool-activation conditions run on every model step and must never touch the
 * network, so this snapshot is what they read. It is refreshed when the picker
 * opens, when the settings page tests the connection, and after any tool call
 * that already listed the bases.
 */

import { describeError } from './errors.ts'
import { ALL_KNOWLEDGE_BASES } from './selection.ts'

export interface KnowledgeBaseEntry {
  readonly id: string
  readonly name: string
  readonly description: string
}

/** Project one raw WeKnora knowledge-base record onto the fields we display. */
export function toEntry(raw: unknown): KnowledgeBaseEntry | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const record = raw as { id?: unknown, name?: unknown, description?: unknown }
  const id = typeof record.id === 'string' ? record.id.trim() : ''
  if (id === '') return undefined
  const name = typeof record.name === 'string' && record.name.trim() !== '' ? record.name.trim() : id
  const description = typeof record.description === 'string' ? record.description.trim() : ''
  return { id, name, description }
}

export class KnowledgeBaseCatalog {
  private entries: readonly KnowledgeBaseEntry[] = []
  private fetchedAtMs: number | undefined
  private inflight: Promise<readonly KnowledgeBaseEntry[]> | undefined
  private lastErrorText: string | undefined

  /** When the current snapshot was taken, or `undefined` before the first one. */
  get fetchedAt(): number | undefined {
    return this.fetchedAtMs
  }

  get isWarm(): boolean {
    return this.fetchedAtMs !== undefined
  }

  /**
   * Why the last refresh failed, if it did.
   *
   * An empty snapshot caused by an unreachable backend must not be reported as
   * "this API key sees no knowledge bases" — that blames permissions for a
   * network problem and sends the user to the wrong place.
   */
  get lastError(): string | undefined {
    return this.lastErrorText
  }

  /** Visible ids, read synchronously. Empty before the first successful refresh. */
  ids(): string[] {
    return this.entries.map(entry => entry.id)
  }

  list(): readonly KnowledgeBaseEntry[] {
    return this.entries
  }

  nameOf(id: string): string {
    if (id === ALL_KNOWLEDGE_BASES) return '全部知识库'
    return this.entries.find(entry => entry.id === id)?.name ?? id
  }

  /** Display names for a scope; used by `describeScope`. */
  label(id: string): string {
    return this.nameOf(id)
  }

  /** Fold a raw `GET /knowledge-bases` response into the snapshot. */
  absorb(raw: readonly unknown[]): readonly KnowledgeBaseEntry[] {
    const entries: KnowledgeBaseEntry[] = []
    const seen = new Set<string>()
    for (const item of raw) {
      const entry = toEntry(item)
      if (entry === undefined || seen.has(entry.id)) continue
      seen.add(entry.id)
      entries.push(entry)
    }
    // A response we can read is proof the backend answered, so a failure recorded
    // earlier (a refused boot-time warm-up) must not survive it: the status row
    // would keep saying "not connected" right after a passing test.
    this.lastErrorText = undefined
    this.commit(entries)
    return entries
  }

  /**
   * Refresh from the backend. Concurrent callers share one request; a failure
   * keeps the previous snapshot, because a network blip must not make selected
   * knowledge bases disappear.
   */
  async refresh(load: () => Promise<readonly unknown[]>): Promise<readonly KnowledgeBaseEntry[]> {
    if (this.inflight !== undefined) return await this.inflight
    const pending = (async (): Promise<readonly KnowledgeBaseEntry[]> => {
      try {
        const raw = await load()
        this.lastErrorText = undefined
        return this.absorb(raw)
      } catch (error) {
        // Keep the previous snapshot; only record why this refresh failed.
        this.lastErrorText = describeError(error)
        throw error
      } finally {
        this.inflight = undefined
      }
    })()
    this.inflight = pending
    return await pending
  }

  private commit(entries: readonly KnowledgeBaseEntry[]): void {
    this.entries = entries
    this.fetchedAtMs = Date.now()
  }
}
