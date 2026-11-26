/**
 * Per-session knowledge-base selection.
 *
 * Two rules make this more than a `Map`:
 *  - "missing" is not "explicitly empty": a session that never chose anything
 *    may still auto-select the only knowledge base that exists, while a session
 *    the user cleared must stay cleared.
 *  - reading reconciles: an id that no longer exists is dropped, so a deleted
 *    knowledge base cannot keep a tool alive.
 *
 * `idsFor` is called from a tool-activation condition on every model step, so it
 * must stay synchronous and free of I/O.
 */

/** The virtual "every knowledge base this credential can see" entry. */
export const ALL_KNOWLEDGE_BASES = '*'

export type SelectionValidation =
  | { readonly ok: true, readonly ids: string[] }
  | { readonly ok: false, readonly error: string }

/** Trim, drop blanks, and dedupe while preserving order. */
export function normalizeIds(ids: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const entry of ids) {
    if (typeof entry !== 'string') continue
    const trimmed = entry.trim()
    if (trimmed === '' || seen.has(trimmed)) continue
    seen.add(trimmed)
    out.push(trimmed)
  }
  return out
}

/**
 * Check one requested selection against what the deployment can actually serve.
 * `'*'` is exclusive: it never coexists with a concrete id.
 */
export function validateSelection(
  sessionId: unknown,
  ids: unknown,
  available: readonly string[],
): SelectionValidation {
  if (typeof sessionId !== 'string' || sessionId.trim() === '') {
    return { ok: false, error: '缺少会话标识' }
  }
  if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string')) {
    return { ok: false, error: '知识库选择必须是知识库 ID 数组' }
  }
  const normalized = normalizeIds(ids as string[])
  const all = normalized.includes(ALL_KNOWLEDGE_BASES)
  if (all && normalized.length > 1) {
    return { ok: false, error: '「全部知识库」不能与具体知识库同时选中' }
  }
  if (!all && normalized.length > 0) {
    const known = new Set(available)
    const missing = normalized.find(id => !known.has(id))
    if (missing !== undefined) return { ok: false, error: `知识库不存在：${missing}` }
  }
  return { ok: true, ids: normalized }
}

/**
 * Resolve the knowledge-base scope for one call.
 *
 * The model's own `knowledge_base_ids` narrows; it never widens past what the
 * session selected. Naming document ids is already a scope, so nothing is added.
 */
export function effectiveKnowledgeBaseScope(input: {
  readonly requested: readonly string[]
  readonly knowledgeIds: readonly string[]
  readonly selection: readonly string[]
  readonly available: readonly string[]
}): string[] {
  const requested = normalizeIds(input.requested)
  if (requested.length === 0 && input.knowledgeIds.length > 0) return []
  const allowed = input.selection.includes(ALL_KNOWLEDGE_BASES)
    ? [...input.available]
    : input.selection.filter(id => id !== ALL_KNOWLEDGE_BASES)
  if (requested.length === 0) return allowed
  const scope = new Set(allowed)
  return requested.filter(id => scope.has(id))
}

export class SessionSelection {
  private readonly map = new Map<string, Set<string>>()

  /**
   * The session's selection, reconciled against the currently visible ids.
   *
   * @param sessionId - the agent id (SessionId); a blank one selects nothing.
   * @param available - knowledge-base ids the deployment can serve right now.
   * @returns selected ids, `'*'` included verbatim.
   */
  idsFor(sessionId: string | undefined, available: readonly string[]): string[] {
    if (typeof sessionId !== 'string' || sessionId === '') return []
    // Nothing visible yet means "not warmed up", not "user chose nothing":
    // leave the session uninitialized so a later warm-up can still auto-select.
    if (available.length === 0) return []
    let selected = this.map.get(sessionId)
    if (selected === undefined) {
      const only = available.length === 1 ? available[0] : undefined
      selected = new Set<string>(only === undefined ? [] : [only])
      this.map.set(sessionId, selected)
    }
    const live = new Set(available)
    for (const id of [...selected]) {
      if (id !== ALL_KNOWLEDGE_BASES && !live.has(id)) selected.delete(id)
    }
    return [...selected]
  }

  /** Read without initializing, so a status query cannot pin the auto-select. */
  peek(sessionId: string): string[] | undefined {
    const selected = this.map.get(sessionId)
    return selected === undefined ? undefined : [...selected]
  }

  has(sessionId: string): boolean {
    return this.map.has(sessionId)
  }

  set(sessionId: string, ids: readonly string[]): string[] {
    const next = normalizeIds(ids)
    this.map.set(sessionId, new Set(next))
    return next
  }

  forget(sessionId: string): boolean {
    return this.map.delete(sessionId)
  }

  sessions(): string[] {
    return [...this.map.keys()]
  }
}
