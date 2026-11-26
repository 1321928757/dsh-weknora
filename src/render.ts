/** Pure projections from a tool's canonical value to model-facing text. */

/** Clip text to a character budget, reporting whether anything was dropped. */
export function clip(text: string, maxChars: number): { text: string, truncated: boolean } {
  const normalized = text.replace(/\r\n/g, '\n').trim()
  if (normalized.length <= maxChars) return { text: normalized, truncated: false }
  return { text: `${normalized.slice(0, maxChars).trimEnd()}…`, truncated: true }
}

/** Human-readable score, tolerant of a backend that omits it. */
export function formatScore(score: number): string {
  return Number.isFinite(score) ? score.toFixed(3) : 'n/a'
}

/**
 * Name a retrieval scope without spending the model's context on it: up to three
 * knowledge-base names, then `+N`. Names rather than ids, because the tool result
 * is where the model and the user learn what a call actually searched.
 *
 * @param ids - the scope that was actually used.
 * @param label - maps an id to its display name; defaults to the id itself.
 */
export function describeScope(ids: string[], label: (id: string) => string = id => id): string {
  if (ids.length === 0) return '(deployment default)'
  const names = ids.map(id => label(id))
  if (names.length <= 3) return names.join(', ')
  return `${names.slice(0, 3).join(', ')} +${names.length - 3}`
}
