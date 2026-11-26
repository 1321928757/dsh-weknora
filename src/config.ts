/** Plugin configuration: schema for the settings surface, defaults, and load-time validation. */

import Schema from '@deepseek-ai/schemastery'

/** Which tools the plugin registers. Omitted entries keep their default. */
export interface ToolToggles {
  listKnowledgeBases?: boolean
  search?: boolean
  readDocument?: boolean
  ask?: boolean
}

/** User-supplied configuration, as written in a Cordis patch row or the settings page. */
export interface PluginConfig {
  /** WeKnora API root, with or without the `/api/v1` suffix. */
  baseUrl?: string
  /** Workspace id, required only for platform-scoped API keys (`X-Tenant-ID`). */
  tenantId?: string
  /** Deployment-wide default scope, used only when a session selected nothing. */
  knowledgeBaseIds?: string[]
  /** Default custom agent for `weknora_ask`; omitted uses the RAG pipeline. */
  agentId?: string
  /** Default and maximum number of chunks a search returns. */
  maxResults?: number
  /** Per-chunk character budget before the plugin truncates content. */
  maxChunkChars?: number
  /** Timeout for non-streaming requests. */
  requestTimeoutMs?: number
  /** Timeout for a streamed answer, which includes model and tool time. */
  chatTimeoutMs?: number
  /**
   * `public` asks WeKnora for directly loadable file URLs in answers and
   * citations (the default: dsh can render `https://` Markdown images, not
   * `resource://` handles). `handle` keeps the internal references.
   */
  resourceUrls?: 'handle' | 'public'
  /** Tool-name prefix, so two instances can serve two deployments. */
  toolPrefix?: string
  /** Per-tool registration switches. */
  tools?: ToolToggles
  /**
   * Tell the model the plugin exists while a session has selected no knowledge
   * base. Costs one short sentence per step; off means zero WeKnora context.
   */
  hintWhenUnselected?: boolean
}

/** Configuration after defaults and validation. */
export interface ResolvedConfig {
  baseUrl: string
  apiKey: string | undefined
  tenantId: string | undefined
  knowledgeBaseIds: string[]
  agentId: string | undefined
  maxResults: number
  maxChunkChars: number
  requestTimeoutMs: number
  chatTimeoutMs: number
  resourceUrls: 'handle' | 'public'
  toolPrefix: string
  tools: Required<ToolToggles>
  hintWhenUnselected: boolean
}

/**
 * The built-in service address. A deployment still pointing here has never been
 * configured, which is a different thing from "the address is wrong".
 */
export const DEFAULT_BASE_URL = 'http://localhost:8080/api/v1'

const DEFAULTS = {
  baseUrl: DEFAULT_BASE_URL,
  maxResults: 8,
  maxChunkChars: 1200,
  requestTimeoutMs: 30_000,
  chatTimeoutMs: 300_000,
  resourceUrls: 'public',
  toolPrefix: 'weknora',
  hintWhenUnselected: true,
} as const

/**
 * The declarative schema the harness renders into a settings form. Every field
 * is `.volatile()`, so a saved edit reaches the running plugin in place instead
 * of restarting it.
 *
 * `apiKey` is deliberately absent: secrets live in the credentials store, so a
 * config row is safe to read, dump and back up.
 */
export const Config = Schema.object({
  baseUrl: Schema.string()
    .description('WeKnora 服务地址；只填域名会自动补 /api/v1')
    .volatile(),
  tenantId: Schema.string()
    .description('平台级 API Key 的工作区 ID（X-Tenant-ID）')
    .volatile(),
  knowledgeBaseIds: Schema.array(Schema.string())
    .description('部署级默认检索范围；会话选择了知识库时以会话选择为准')
    .volatile(),
  agentId: Schema.string()
    .description('自定义 Agent id；填写后 weknora_ask 走 ReAct 流水线')
    .volatile(),
  maxResults: Schema.natural()
    .min(1)
    .description('召回条数上限')
    .volatile(),
  maxChunkChars: Schema.natural()
    .min(1)
    .description('单个片段的字符预算')
    .volatile(),
  requestTimeoutMs: Schema.natural()
    .min(1)
    .description('检索与读文档的超时（毫秒）')
    .volatile(),
  chatTimeoutMs: Schema.natural()
    .min(1)
    .description('weknora_ask 的超时（毫秒）')
    .volatile(),
  resourceUrls: Schema.union([Schema.const('handle'), Schema.const('public')])
    .description('public：引用里的文件给可直接加载的直链；handle：保留内部引用')
    .volatile(),
  toolPrefix: Schema.string()
    .description('工具名前缀，需匹配 ^[a-z][a-z0-9_]*$')
    .volatile(),
  tools: Schema.object({
    listKnowledgeBases: Schema.boolean().default(true).volatile(),
    search: Schema.boolean().default(true).volatile(),
    readDocument: Schema.boolean().default(true).volatile(),
    ask: Schema.boolean().default(true).volatile(),
  }).description('四个工具的启用开关；至少保留一个'),
  hintWhenUnselected: Schema.boolean()
    .default(true)
    .description('未选择知识库时，向模型提示该插件存在（约 40 token/步）')
    .volatile(),
})

/** Thrown when a patch row configures this plugin in a way it cannot serve. */
export class ConfigError extends Error {
  constructor(violations: string[]) {
    super(`dsh-weknora configuration is invalid:\n  - ${violations.join('\n  - ')}`)
    this.name = 'ConfigError'
  }
}

const API_ROOT = /\/api\/v\d+$/
const TOOL_PREFIX = /^[a-z][a-z0-9_]*$/

/**
 * Normalize a WeKnora base URL to an API root. Both `https://kb.example.com`
 * and `https://kb.example.com/api/v1` are accepted, because a deployment's
 * documented address is usually the bare origin.
 */
export function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '')
  return API_ROOT.test(trimmed) ? trimmed : `${trimmed}/api/v1`
}

function positiveInt(value: unknown, field: string, violations: string[]): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    violations.push(`${field} must be a positive number, received ${JSON.stringify(value)}`)
    return undefined
  }
  return Math.floor(value)
}

function stringList(value: unknown, field: string, violations: string[]): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.some(entry => typeof entry !== 'string' || entry.trim() === '')) {
    violations.push(`${field} must be an array of non-empty strings`)
    return undefined
  }
  return (value as string[]).map(entry => entry.trim())
}

function optionalString(value: unknown, field: string, violations: string[]): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string') {
    violations.push(`${field} must be a string`)
    return undefined
  }
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

function toggle(value: unknown, field: string, fallback: boolean, violations: string[]): boolean {
  if (value === undefined) return fallback
  if (typeof value !== 'boolean') {
    violations.push(`${field} must be a boolean`)
    return fallback
  }
  return value
}

/**
 * Apply defaults and reject an unusable row while the plugin loads, so a typo
 * surfaces at boot rather than inside the first tool call the model makes.
 *
 * @param raw - the `config` value from the Cordis row, or from a live settings read.
 * @param apiKey - the secret resolved outside the config row (see `SecretStore`);
 *   omitted by every caller that has no credentials service to read from.
 * @returns configuration every consumer can read without re-checking.
 */
export function resolveConfig(raw: PluginConfig | undefined, apiKey?: string): ResolvedConfig {
  const violations: string[] = []
  const config = raw ?? {}
  if (typeof config !== 'object' || Array.isArray(config)) {
    throw new ConfigError(['config must be an object'])
  }

  const baseUrlInput = optionalString(config.baseUrl, 'baseUrl', violations) ?? DEFAULTS.baseUrl
  let baseUrl: string = DEFAULTS.baseUrl
  try {
    const url = new URL(normalizeBaseUrl(baseUrlInput))
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      violations.push(`baseUrl must use http or https, received ${url.protocol}`)
    }
    baseUrl = url.toString().replace(/\/+$/, '')
  } catch {
    violations.push(`baseUrl must be an absolute URL, received ${JSON.stringify(baseUrlInput)}`)
  }

  const resourceUrls = config.resourceUrls ?? DEFAULTS.resourceUrls
  if (resourceUrls !== 'handle' && resourceUrls !== 'public') {
    violations.push(`resourceUrls must be "handle" or "public", received ${JSON.stringify(resourceUrls)}`)
  }

  const toolPrefix = optionalString(config.toolPrefix, 'toolPrefix', violations) ?? DEFAULTS.toolPrefix
  if (!TOOL_PREFIX.test(toolPrefix)) {
    violations.push(`toolPrefix must match ${String(TOOL_PREFIX)}, received ${JSON.stringify(toolPrefix)}`)
  }

  const toolToggles = config.tools ?? {}
  if (typeof toolToggles !== 'object' || Array.isArray(toolToggles)) {
    violations.push('tools must be an object of booleans')
  }

  const resolved: ResolvedConfig = {
    baseUrl,
    apiKey: optionalString(apiKey, 'apiKey', violations),
    tenantId: optionalString(config.tenantId, 'tenantId', violations),
    knowledgeBaseIds: stringList(config.knowledgeBaseIds, 'knowledgeBaseIds', violations) ?? [],
    agentId: optionalString(config.agentId, 'agentId', violations),
    maxResults: positiveInt(config.maxResults, 'maxResults', violations) ?? DEFAULTS.maxResults,
    maxChunkChars: positiveInt(config.maxChunkChars, 'maxChunkChars', violations) ?? DEFAULTS.maxChunkChars,
    requestTimeoutMs: positiveInt(config.requestTimeoutMs, 'requestTimeoutMs', violations) ?? DEFAULTS.requestTimeoutMs,
    chatTimeoutMs: positiveInt(config.chatTimeoutMs, 'chatTimeoutMs', violations) ?? DEFAULTS.chatTimeoutMs,
    resourceUrls: resourceUrls === 'public' ? 'public' : 'handle',
    toolPrefix,
    tools: {
      listKnowledgeBases: toggle(toolToggles.listKnowledgeBases, 'tools.listKnowledgeBases', true, violations),
      search: toggle(toolToggles.search, 'tools.search', true, violations),
      readDocument: toggle(toolToggles.readDocument, 'tools.readDocument', true, violations),
      ask: toggle(toolToggles.ask, 'tools.ask', true, violations),
    },
    hintWhenUnselected: toggle(
      config.hintWhenUnselected,
      'hintWhenUnselected',
      DEFAULTS.hintWhenUnselected,
      violations,
    ),
  }

  if (!Object.values(resolved.tools).some(Boolean)) {
    violations.push('at least one tool must stay enabled; remove the plugin row instead of disabling all of them')
  }
  if (violations.length > 0) throw new ConfigError(violations)
  return resolved
}

/** Read a schemastery `.volatile()` field, or pass a plain value through. */
function field(value: unknown): unknown {
  if (typeof value === 'object' && value !== null && typeof (value as { get?: unknown }).get === 'function') {
    return (value as { get: () => unknown }).get()
  }
  return value
}

/**
 * Materialize a live row config: volatile fields are read at call time, so the
 * settings page's edits reach the next tool call without a reload.
 */
export function materializeConfig(raw: unknown): PluginConfig {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {}
  const source = raw as Record<string, unknown>
  const out: PluginConfig = {}
  const assign = <K extends keyof PluginConfig>(key: K): void => {
    const value = field(source[key])
    if (value !== undefined) out[key] = value as PluginConfig[K]
  }
  assign('baseUrl')
  assign('tenantId')
  assign('knowledgeBaseIds')
  assign('agentId')
  assign('maxResults')
  assign('maxChunkChars')
  assign('requestTimeoutMs')
  assign('chatTimeoutMs')
  assign('resourceUrls')
  assign('toolPrefix')
  assign('hintWhenUnselected')
  const tools = field(source['tools'])
  if (typeof tools === 'object' && tools !== null && !Array.isArray(tools)) {
    const row = tools as Record<string, unknown>
    const toggles: ToolToggles = {}
    for (const key of ['listKnowledgeBases', 'search', 'readDocument', 'ask'] as const) {
      const value = field(row[key])
      if (typeof value === 'boolean') toggles[key] = value
    }
    out.tools = toggles
  }
  return out
}
