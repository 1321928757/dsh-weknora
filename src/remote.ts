/**
 * The host-side operation surface the settings page and the picker call.
 *
 * Every method returns an explicit result: a failed validation or an unreachable
 * backend is a value, not a thrown error, so the client renders the reason
 * instead of a stack trace. The API key never appears in any return value.
 */

import type { KnowledgeBaseCatalog } from './catalog.ts'
import { DEFAULT_BASE_URL, normalizeBaseUrl } from './config.ts'
import type { LiveConfig } from './live-config.ts'
import type { SecretStore } from './secrets.ts'
import { validateSelection } from './selection.ts'
import type { SessionSelection } from './selection.ts'
import { describeError } from './errors.ts'
import { WeknoraClient } from './client.ts'

export type RemoteResult<T> = ({ readonly ok: true } & T) | { readonly ok: false, readonly error: string }

export interface RemoteDeps {
  readonly selection: SessionSelection
  readonly catalog: KnowledgeBaseCatalog
  readonly live: LiveConfig
  readonly secrets: SecretStore
  readonly client: WeknoraClient
  /** Overridable for tests and for probing an unsaved base URL. */
  readonly clientFor?: (baseUrl: string, apiKey: string | undefined) => Pick<WeknoraClient, 'listKnowledgeBases'>
}

export interface KnowledgeBaseView {
  readonly id: string
  readonly name: string
  readonly description: string
}

export interface SelectionView {
  readonly knowledgeBaseIds: string[]
  /** True when nothing points at a real deployment yet (default address, no key). */
  readonly needsSetup: boolean
  readonly knowledgeBases: readonly KnowledgeBaseView[]
  readonly fetchedAt: number | undefined
  /** Set when the listing has never succeeded, so an empty list has a reason. */
  readonly catalogError?: string | undefined
}

/**
 * The effective configuration, with no secret in it.
 *
 * The settings page edits the *user override* layer, so a field the user never
 * touched reads back as absent. Sending the resolved values separately lets the
 * page show what is actually in force without pretending the override exists.
 */
export interface EffectiveConfigView {
  readonly baseUrl: string
  readonly tenantId: string | undefined
  readonly maxResults: number
  readonly maxChunkChars: number
  readonly requestTimeoutMs: number
  readonly chatTimeoutMs: number
  readonly resourceUrls: 'public' | 'handle'
  readonly agentId: string | undefined
  readonly toolPrefix: string
}

export interface ConfigStatusView {
  readonly configured: boolean
  readonly needsSetup: boolean
  readonly baseUrl: string
  readonly hasApiKey: boolean
  readonly toolPrefix: string
  readonly hasCustomAgent: boolean
  readonly enabledTools: string[]
  readonly knowledgeBaseCount: number
  readonly fetchedAt: number | undefined
  /** True once a listing has succeeded at least once; false means the count is not evidence. */
  readonly catalogWarm: boolean
  /** Why the last listing failed, if it did — shown instead of a green "connected". */
  readonly catalogError: string | undefined
  readonly hintWhenUnselected: boolean
  readonly effective: EffectiveConfigView
}

/** Longest session id accepted: a map key must not be attacker-sized. */
const MAX_SESSION_ID = 200
/** Most knowledge bases one selection may name. */
const MAX_SELECTION_IDS = 200

function originOf(url: string): string | undefined {
  try {
    return new URL(url).origin
  } catch {
    return undefined
  }
}

/** The one place a session id is validated, so every method agrees. */
function sessionIdOf(args: unknown): { ok: true, id: string } | { ok: false, error: string } {
  const raw = field(args, 'sessionId')
  if (typeof raw !== 'string' || raw.trim() === '') return { ok: false, error: '缺少会话标识' }
  const id = raw.trim()
  if (id.length > MAX_SESSION_ID) return { ok: false, error: '会话标识过长' }
  return { ok: true, id }
}

/**
 * Whether the plugin has ever been pointed at a deployment.
 *
 * "No API key" alone is not it: an unauthenticated deployment is legitimate. The
 * signal is the built-in default address *and* no key — the state a fresh install
 * is in, where probing would only ever report the default address as broken.
 */
function needsSetup(baseUrl: string, hasKey: boolean): boolean {
  return !hasKey && baseUrl === DEFAULT_BASE_URL
}

function field(args: unknown, key: string): unknown {
  return typeof args === 'object' && args !== null && !Array.isArray(args)
    ? (args as Record<string, unknown>)[key]
    : undefined
}

export function createRemoteService(deps: RemoteDeps) {
  const { selection, catalog, live, secrets, client } = deps
  const clientFor = deps.clientFor
    ?? ((baseUrl: string, apiKey: string | undefined) => new WeknoraClient(() => ({ ...live.current(), baseUrl, apiKey })))

  async function refreshCatalog(): Promise<readonly KnowledgeBaseView[]> {
    const signal = AbortSignal.timeout(live.current().requestTimeoutMs)
    return await catalog.refresh(() => client.listKnowledgeBases(signal))
  }

  /** A selection may only be applied against ids we can currently see. */
  async function ensureWarm(): Promise<RemoteResult<{ readonly knowledgeBases: readonly KnowledgeBaseView[] }>> {
    if (catalog.isWarm) return { ok: true, knowledgeBases: catalog.list() }
    try {
      return { ok: true, knowledgeBases: await refreshCatalog() }
    } catch (error) {
      return { ok: false, error: describeError(error) }
    }
  }

  return {
    async getSelection(args: unknown): Promise<RemoteResult<SelectionView>> {
      const session = sessionIdOf(args)
      if (!session.ok) return session
      await secrets.load()
      return {
        ok: true,
        needsSetup: needsSetup(live.current().baseUrl, secrets.has()),
        knowledgeBaseIds: selection.idsFor(session.id, catalog.ids()),
        knowledgeBases: catalog.list(),
        fetchedAt: catalog.fetchedAt,
        // Only meaningful while the snapshot is cold: it explains an empty list
        // that is empty because the backend failed, not because it has nothing.
        catalogError: catalog.isWarm ? undefined : catalog.lastError,
      }
    },

    async setSelection(args: unknown): Promise<RemoteResult<SelectionView>> {
      const session = sessionIdOf(args)
      if (!session.ok) return session
      const warm = await ensureWarm()
      // Never apply a selection we cannot validate: an unknown id would keep a
      // tool visible for a knowledge base that does not exist.
      if (!warm.ok) return warm
      const validated = validateSelection(session.id, field(args, 'knowledgeBaseIds'), catalog.ids())
      if (!validated.ok) return validated
      if (validated.ids.length > MAX_SELECTION_IDS) {
        return { ok: false, error: `一次最多选择 ${MAX_SELECTION_IDS} 个知识库` }
      }
      selection.set(session.id, validated.ids)
      return {
        ok: true,
        needsSetup: needsSetup(live.current().baseUrl, secrets.has()),
        knowledgeBaseIds: validated.ids,
        knowledgeBases: catalog.list(),
        fetchedAt: catalog.fetchedAt,
      }
    },

    async listKnowledgeBases(args: unknown): Promise<RemoteResult<{ knowledgeBases: readonly KnowledgeBaseView[], fetchedAt: number | undefined }>> {
      const refresh = field(args, 'refresh') === true
      try {
        const entries = refresh || !catalog.isWarm ? await refreshCatalog() : catalog.list()
        return { ok: true, knowledgeBases: entries, fetchedAt: catalog.fetchedAt }
      } catch (error) {
        return { ok: false, error: describeError(error) }
      }
    },

    async testConnection(args: unknown): Promise<RemoteResult<{ latencyMs: number, knowledgeBaseCount: number }>> {
      const requested = field(args, 'baseUrl')
      const effective = live.current().baseUrl
      let baseUrl = effective
      if (typeof requested === 'string' && requested.trim() !== '') {
        try {
          baseUrl = new URL(normalizeBaseUrl(requested)).toString().replace(/\/+$/, '')
        } catch {
          return { ok: false, error: `服务地址必须是 http(s) 开头的绝对地址：${requested}` }
        }
      }
      const override = field(args, 'apiKey')
      const supplied = typeof override === 'string' && override.trim() !== '' ? override.trim() : undefined
      // The stored key only ever goes to the configured origin. Otherwise this one
      // call would hand the user's credential to any host a client names — the key
      // is written owner-only precisely so it cannot travel.
      const stored = await secrets.load()
      const sameOrigin = originOf(baseUrl) === originOf(effective)
      const apiKey = supplied ?? (sameOrigin ? stored : undefined)
      // An address the user typed but never saved is not the configured one, so a
      // probe would go out anonymous and come back 401 — which reads as "your key
      // is invalid" while the key is fine and simply not this address's to use.
      // Name what is actually wrong instead of spending the round trip.
      if (apiKey === undefined && !sameOrigin && stored !== undefined) {
        return {
          ok: false,
          error: `服务地址还没生效（当前生效的是 ${effective}，测试用的是 ${baseUrl}）。`
            + '已保存的 API Key 只会发给生效的服务地址，所以这次没有带 Key——后端回的 401 不是 Key 无效。'
            + '点「保存并测试」把地址存下来再测；要单独测这个地址，请在「替换」里填入该部署的 Key。',
        }
      }
      const started = Date.now()
      try {
        const bases = await clientFor(baseUrl, apiKey).listKnowledgeBases(AbortSignal.timeout(10_000))
        // A successful listing against the configured deployment is also the
        // freshest catalog we can get for free, so the status row and the picker
        // stop reporting a cold snapshot after a passing test.
        if (sameOrigin) catalog.absorb(bases)
        return { ok: true, latencyMs: Date.now() - started, knowledgeBaseCount: bases.length }
      } catch (error) {
        return { ok: false, error: describeError(error) }
      }
    },

    async getConfigStatus(): Promise<RemoteResult<ConfigStatusView>> {
      // The settings page is the first caller after boot, and the cold read is
      // async: without this it would report "no key" for a key that is on disk.
      await secrets.load()
      const config = live.current()
      return {
        ok: true,
        configured: secrets.has(),
        needsSetup: needsSetup(config.baseUrl, secrets.has()),
        baseUrl: config.baseUrl,
        hasApiKey: secrets.has(),
        toolPrefix: config.toolPrefix,
        hasCustomAgent: config.agentId !== undefined,
        enabledTools: Object.entries(config.tools)
          .filter(([, enabled]) => enabled)
          .map(([key]) => key),
        knowledgeBaseCount: catalog.ids().length,
        fetchedAt: catalog.fetchedAt,
        catalogWarm: catalog.isWarm,
        catalogError: catalog.lastError,
        hintWhenUnselected: config.hintWhenUnselected,
        effective: {
          baseUrl: config.baseUrl,
          tenantId: config.tenantId,
          maxResults: config.maxResults,
          maxChunkChars: config.maxChunkChars,
          requestTimeoutMs: config.requestTimeoutMs,
          chatTimeoutMs: config.chatTimeoutMs,
          resourceUrls: config.resourceUrls,
          agentId: config.agentId,
          toolPrefix: config.toolPrefix,
        },
      }
    },

    async forgetSession(args: unknown): Promise<RemoteResult<{ forgotten: boolean }>> {
      const session = sessionIdOf(args)
      if (!session.ok) return session
      return { ok: true, forgotten: selection.forget(session.id) }
    },

    /** Store or clear the API key. The key is never echoed back. */
    async setApiKey(args: unknown): Promise<RemoteResult<{ hasApiKey: boolean }>> {
      const value = field(args, 'apiKey')
      // Missing is an error, not "clear": a truncated call used to wipe the key.
      if (typeof value !== 'string') {
        return { ok: false, error: 'API Key 参数缺失：要清除请显式传入空字符串' }
      }
      try {
        await secrets.save(value)
        return { ok: true, hasApiKey: secrets.has() }
      } catch (error) {
        return { ok: false, error: `保存 API Key 失败：${describeError(error)}` }
      }
    },
  }
}

export type WeknoraRemoteService = ReturnType<typeof createRemoteService>
