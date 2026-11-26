/**
 * Serialized, optimistic writes for the knowledge-base selection.
 *
 * Clicking faster than a round trip is normal, and the host replaces the whole
 * set on every write. Two rules keep that honest:
 *
 *  - writes are queued, so the host never sees a stale set arrive after a newer
 *    one (last-write-wins is only safe if the writes leave in order);
 *  - only the newest intent may settle or roll back, so an early response cannot
 *    resurrect a selection the user has already moved past.
 *
 * The writer owns no UI: it reports through callbacks, which makes the ordering
 * and rollback rules testable without a browser.
 */

export interface SelectionWriterCallbacks {
  /** Write one set; reject to simulate a failed round trip. */
  write(ids: readonly string[]): Promise<void>
  /** Render the intent immediately, before the host confirms. */
  onOptimistic(ids: readonly string[]): void
  /** The newest intent was accepted; `note` is the message to report. */
  onSettled(ids: readonly string[], note: string | undefined): void
  /** The newest intent was rejected: `ids` is the last confirmed set. */
  onRollback(ids: readonly string[], error: unknown, note: string | undefined): void
}

export interface SelectionWriter {
  /** The set the user currently sees (optimistic). */
  intent(): readonly string[]
  /** Adopt a set read from the host, e.g. on mount. Does not write. */
  seed(ids: readonly string[]): void
  /** Replace the selection; `note` is reported when the write settles. */
  push(ids: readonly string[], note?: string): void
}

export function createSelectionWriter(callbacks: SelectionWriterCallbacks): SelectionWriter {
  let desired: readonly string[] = []
  let confirmed: readonly string[] = []
  let revision = 0
  /** Resolves when the last queued write settled; `undefined` while idle. */
  let tail: Promise<unknown> | undefined

  const writeThrough = async (next: readonly string[]): Promise<void> => {
    await callbacks.write(next)
    confirmed = next
  }

  return {
    intent: () => desired,

    seed(ids) {
      desired = ids.slice()
      confirmed = ids.slice()
    },

    push(ids, note) {
      const next = ids.slice()
      desired = next
      const at = ++revision
      callbacks.onOptimistic(next)

      // The first write leaves immediately; later ones queue behind it. Chaining
      // onto a rejected tail would poison every later click, so the tail is
      // flattened: one failure must not stop the queue.
      const run = tail === undefined ? writeThrough(next) : tail.then(() => writeThrough(next))
      tail = run.then(() => undefined, () => undefined)

      void run.then(
        () => {
          if (at !== revision) return
          callbacks.onSettled(confirmed.slice(), note)
        },
        (error: unknown) => {
          if (at !== revision) return
          desired = confirmed.slice()
          callbacks.onRollback(confirmed.slice(), error, note)
        },
      )
    },
  }
}
