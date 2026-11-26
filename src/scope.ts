/**
 * Bind a tool's knowledge-base scope to the session selection.
 *
 * The model is never asked to carry the user's selection, so this wrapper writes
 * `knowledge_base_ids` before the tool body sees the arguments. Narrowing is
 * honoured; widening is not.
 */

import { ALL_KNOWLEDGE_BASES, effectiveKnowledgeBaseScope } from './selection.ts'
import type { SessionSelection } from './selection.ts'
import type { ToolDefinition, ToolRunContext } from './harness.ts'

/** Tools whose retrieval scope comes from the session selection. */
const SCOPED_SUFFIXES = ['search', 'ask'] as const

function isScoped(name: string): boolean {
  return SCOPED_SUFFIXES.some(suffix => name === suffix || name.endsWith(`_${suffix}`))
}

function record(args: unknown): Record<string, unknown> {
  return typeof args === 'object' && args !== null && !Array.isArray(args)
    ? { ...(args as Record<string, unknown>) }
    : {}
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '')
}

export interface ScopeWiring {
  readonly selection: SessionSelection
  /** Knowledge bases the deployment can serve right now; synchronous and cached. */
  readonly available: () => string[]
  /** True when `weknora_ask` runs a custom agent that resolves its own scope. */
  readonly askUsesCustomAgent: () => boolean
}

/**
 * Wrap one tool definition so its retrieval scope comes from the session.
 *
 * @param definition - the tool as built by `createTools`.
 * @param wiring - session selection, visible ids, and the custom-agent predicate.
 * @returns the same definition for unscoped tools, or a copy with a scoped `execute`.
 */
export function withSessionScope(definition: ToolDefinition, wiring: ScopeWiring): ToolDefinition {
  if (!isScoped(definition.name)) return definition

  return {
    ...definition,
    async execute(args: unknown, exec: ToolRunContext): Promise<unknown> {
      const sessionId = exec.agent?.id
      const sessionIds = wiring.selection.idsFor(sessionId, wiring.available())
      const scoped = record(args)
      const requested = strings(scoped['knowledge_base_ids'])
      const knowledgeIds = strings(scoped['knowledge_ids'])

      // A custom agent resolves its own scope server-side from its KB selection
      // mode; ids sent from here would override that as an explicit mention.
      // The tool parameter is the model's own way into the ReAct pipeline, so the
      // bypass has to consider it too: sending session ids there would override
      // the agent's server-side KBSelectionMode as an explicit mention.
      const requestedAgent = typeof scoped['agent_id'] === 'string' ? scoped['agent_id'].trim() : ''
      if (definition.name.endsWith('_ask') && (wiring.askUsesCustomAgent() || requestedAgent !== '')) {
        return await definition.execute(args, exec)
      }

      const resolved = effectiveKnowledgeBaseScope({
        requested,
        knowledgeIds,
        selection: sessionIds,
        available: wiring.available(),
      })

      // An empty array is NOT "nothing allowed": the tool body reads a missing
      // knowledge_base_ids as "no restriction" and would fall back to every base
      // the credential can see. So each refusal has to be explicit.
      if (sessionIds.length === 0) {
        throw new Error('本会话尚未选择知识库：请先在输入栏的「知识库」控件中选择，再重新提问。')
      }
      if (requested.length > 0 && resolved.length === 0) {
        throw new Error(
          `请求的知识库不在本次会话已选范围内（${requested.join(', ')}），本次不执行检索。`)
      }
      if (resolved.length === 0 && knowledgeIds.length === 0) {
        throw new Error('知识库目录暂时不可用（可能尚未就绪或服务不可达），请稍后重试。')
      }
      if (resolved.length > 0) scoped['knowledge_base_ids'] = resolved
      else delete scoped['knowledge_base_ids']

      return await definition.execute(scoped, exec)
    },
  }
}

/** Exported for tests: the sentinel a selection uses for "every visible base". */
export { ALL_KNOWLEDGE_BASES }
