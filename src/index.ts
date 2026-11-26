/**
 * dsh-weknora: a DeepSeek Harness plugin that gives the agent retrieval,
 * document reading and composed answers from a WeKnora knowledge base.
 *
 * The tools are registered with a per-step activation condition, so a session
 * that has not chosen a knowledge base does not carry their schemas at all.
 *
 * @module dsh-weknora
 */

import { KnowledgeBaseCatalog } from './catalog.ts'
import { WeknoraClient } from './client.ts'
import { LiveConfig } from './live-config.ts'
import { createRemoteService } from './remote.ts'
import { SecretStore, credentialFile } from './secrets.ts'
import { describeError } from './errors.ts'
import { SessionSelection } from './selection.ts'
import type { HarnessContext, LoggerLike, PromptContextEntry, SystemPromptLike, ToolDefinition } from './harness.ts'
import { withSessionScope } from './scope.ts'
import { createTools } from './tools.ts'

export const name = 'dsh-weknora'

/**
 * The tool registry and the prompt assembler. Both are read, never written:
 * the assembler only carries the one-line hint shown while nothing is selected.
 * Cordis hides a service from `ctx.get` unless the plugin injects it, so the
 * hint would silently never appear without `systemPrompt` here.
 */
export const inject = ['tools', 'systemPrompt'] as const

export { Config } from './config.ts'
export { ConfigError, materializeConfig, normalizeBaseUrl, resolveConfig } from './config.ts'
export { LiveConfig } from './live-config.ts'
export { WeknoraApiError, WeknoraClient } from './client.ts'
export { createTools } from './tools.ts'
export { SessionSelection, ALL_KNOWLEDGE_BASES, effectiveKnowledgeBaseScope, validateSelection } from './selection.ts'
export { KnowledgeBaseCatalog } from './catalog.ts'
export { SecretStore, credentialFile } from './secrets.ts'
export { createRemoteService } from './remote.ts'
export { withSessionScope } from './scope.ts'

/**
 * Injected while a session has chosen nothing. Tool activation cannot explain
 * itself — the tools are simply absent — so the model needs one sentence to know
 * the capability exists and that the user has to pick a knowledge base first.
 * The wording is conditional, so it stays truthful while tools *are* visible.
 */
/**
 * Injected while a session has chosen nothing. Tool activation cannot explain
 * itself — the tools are simply absent — so the model needs one sentence to know
 * the capability exists and that the user has to pick a knowledge base first.
 * The wording is conditional, so it stays truthful while tools *are* visible.
 *
 * @param prefix - the configured tool prefix, so a renamed deployment does not
 *   point the model at tool names that do not exist.
 */
export function ungatedHint(prefix = 'weknora'): string {
  return `WeKnora 知识库插件已启用。若本轮工具列表中没有 ${prefix}_* 工具，说明用户尚未在输入栏的`
    + '「知识库」按钮中选择知识库——需要检索内部文档时，请提示用户先去选择。'
    + '工具出现后，检索范围由用户所选知识库决定，无需在参数里指定。'
}

export const UNGATED_HINT = ungatedHint()

const SERVICE_KEY = 'weknora'
const NAMESPACE = 'weknora'

function warnIfLegacyApiKey(config: unknown, logger: LoggerLike | undefined): void {
  if (typeof config !== 'object' || config === null) return
  if (!('apiKey' in (config as Record<string, unknown>))) return
  logger?.warn('dsh-weknora: config.apiKey 已不再支持；密钥改为存放在本机凭据文件中。'
    + '请在 设置 → WeKnora 知识库 重新录入 API Key。')
}

/**
 * Attach the binding the Typert gateway requires.
 *
 * `serviceKey`/`namespace` must match this package's `./typert` manifest, and
 * `service` must be the exact object handed to `provide` — the gateway compares
 * it by identity. Without this the client mounts fine and then every call fails
 * with `no visible typertRemote binding`, so it is not optional.
 */
function bindRemote<T extends object>(service: T): T {
  Object.defineProperty(service, 'typertRemote', {
    configurable: false,
    enumerable: false,
    writable: false,
    value: { service, serviceKey: SERVICE_KEY, namespace: NAMESPACE },
  })
  return service
}

/**
 * Register the tools, the hint and the client-facing service.
 *
 * @param ctx - the Cordis context, with `ctx.tools` injected.
 * @param config - the plugin's `config` row. A typo fails the load; a later bad
 *   edit keeps the last good snapshot instead (see `LiveConfig`).
 */
export function apply(ctx: HarnessContext, config: unknown): void {
  const logger = ctx.logger
  warnIfLegacyApiKey(config, logger)

  const secrets = new SecretStore(credentialFile(), logger)
  const live = new LiveConfig(config, {
    secret: () => secrets.cached(),
    ...(logger === undefined ? {} : { logger }),
  })
  const catalog = new KnowledgeBaseCatalog()
  const selection = new SessionSelection()
  const client = new WeknoraClient(() => live.current())

  /** Warm the snapshot the activation conditions read; failure is not fatal. */
  const warm = async (): Promise<void> => {
    await secrets.load()
    try {
      await catalog.refresh(() => client.listKnowledgeBases(AbortSignal.timeout(live.current().requestTimeoutMs)))
    } catch (error) {
      logger?.warn(`dsh-weknora: 预热知识库列表失败（${describeError(error)}）；选择器打开时会重试。`)
    }
  }

  const available = (): string[] => catalog.ids()
  const askUsesCustomAgent = (): boolean => live.current().agentId !== undefined

  /** Register one tool plus its per-step visibility condition. */
  const register = (definition: ToolDefinition): void => {
    const scoped = withSessionScope(definition, { selection, available, askUsesCustomAgent })
    const options = {
      // Synchronous and in-memory only: a rejection here would end the model step
      // with TOOL_ACTIVATION_FAILED, so this must never touch the network.
      when: (context: { agent?: { id: string } }): boolean =>
        selection.idsFor(context.agent?.id, available()).length > 0,
    }
    if (ctx.effect !== undefined) {
      ctx.effect(() => ctx.tools.register(scoped, options), `dsh-weknora: tool ${definition.name}`)
    } else {
      ctx.tools.register(scoped, options)
    }
  }

  const definitions = createTools(client, () => live.current(), { label: id => catalog.label(id) })
  for (const definition of definitions) register(definition)

  // The hint is a plain closure over the live config: no assembly context, no
  // per-session lookup, nothing that can fail per step.
  let systemPrompt: SystemPromptLike | undefined
  try {
    systemPrompt = ctx.get?.<SystemPromptLike>('systemPrompt')
  } catch (error) {
    logger?.warn(`dsh-weknora: 读取 systemPrompt 服务失败（${describeError(error)}）；未选择时的提示不会出现。`)
  }
  if (systemPrompt?.context !== undefined) {
    // The tool names are fixed when `register` runs, which happens once per load.
    // The hint must name that same prefix — reading the live one would point the
    // model at tools that do not exist after a settings edit.
    const registeredPrefix = live.current().toolPrefix
    let warnedPrefix = false
    const hintText = (): string => {
      if (!live.current().hintWhenUnselected) return ''
      const current = live.current().toolPrefix
      if (current !== registeredPrefix && !warnedPrefix) {
        warnedPrefix = true
        logger?.warn(`dsh-weknora: toolPrefix 已改为 ${current}，需重新加载插件才生效（当前仍是 ${registeredPrefix}）。`)
      }
      return ungatedHint(registeredPrefix)
    }
    const entry: PromptContextEntry = {
      name: 'dsh-weknora-hint',
      order: 210,
      text: hintText,
    }
    if (ctx.effect !== undefined) ctx.effect(() => systemPrompt.context?.(entry) ?? (() => {}), 'dsh-weknora: hint')
    else systemPrompt.context(entry)
  }

  ctx.on?.('agent/disposed', payload => {
    const id = (payload as { agent?: { id?: unknown } } | undefined)?.agent?.id
    if (typeof id === 'string') selection.forget(id)
  })

  const service = bindRemote(createRemoteService({ selection, catalog, live, secrets, client }))
  ctx.provide?.(SERVICE_KEY, service)

  void warm().catch(() => undefined)

  logger?.info(`dsh-weknora: ${definitions.length} tool(s) registered against ${live.current().baseUrl};`
    + ' 未选择知识库的会话不会看到它们')
}
