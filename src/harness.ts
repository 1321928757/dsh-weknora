/**
 * Structural types for the slice of the DeepSeek Harness contract this plugin
 * uses. Declaring them here keeps the package free of runtime dependencies on
 * harness internals: the shipped code only ever hands `ctx.tools.register()` a
 * plain object, so a harness release that adds optional definition fields does
 * not require a republish of this plugin.
 *
 * The shapes mirror `@deepseek-ai/dsh-tools` (`ToolDefinition`,
 * `ToolRegistrationOptions`, `ToolActivationContext`), `@deepseek-ai/dsh-agent`
 * (`Agent`) and `@deepseek-ai/dsh-llm` (`ContentBlock`, `ToolSchema`) as of
 * dsh 0.2.2-rc.3.
 */

/** Supported subset of JSON Schema that the harness tool registry accepts. */
export interface JsonSchemaNode {
  type?: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null'
  properties?: Record<string, JsonSchemaNode>
  required?: string[]
  additionalProperties?: boolean
  items?: JsonSchemaNode
  enum?: (string | number | boolean | null)[]
  const?: string | number | boolean | null
  description?: string
  title?: string
}

/** Model-facing content block returned by `output.render`. */
export interface TextContentBlock {
  type: 'text'
  text: string
}

/**
 * The agent (session) a registration or call belongs to. The harness types
 * `Agent.id` as `SessionId`, which is what every per-session lookup here keys on.
 */
export interface AgentLike {
  readonly id: string
  readonly session?: { readonly id?: string }
}

/** Execution context handed to a tool body. */
export interface ToolRunContext {
  readonly signal: AbortSignal
  readonly agent?: AgentLike
}

/** One registered model-facing tool. */
export interface ToolDefinition {
  readonly name: string
  readonly description: string
  readonly parameters: JsonSchemaNode
  readonly output: {
    readonly schema: JsonSchemaNode
    render(args: unknown, value: unknown): TextContentBlock[]
  }
  execute(args: unknown, exec: ToolRunContext): Promise<unknown>
  readonly timeoutMs?: number
  isConcurrencySafe?(args: unknown): boolean
}

/** Resolved once per model step, before prompt assembly. */
export interface ToolActivationContext {
  readonly agent: AgentLike
  readonly modelSelection: unknown
  readonly signal: AbortSignal
}

/**
 * `when` decides whether the tool is declared, bound and dispatchable for one
 * step. It runs synchronously-or-asynchronously once per proposed step and MUST
 * NOT do I/O: a rejection ends the step with `TOOL_ACTIVATION_FAILED`.
 */
export interface ToolRegistrationOptions {
  readonly when?: (context: ToolActivationContext) => boolean | Promise<boolean>
}

/** The `ctx.tools` service seam. */
export interface ToolRegistry {
  register(definition: ToolDefinition, options?: ToolRegistrationOptions): () => void
}

export interface LoggerLike {
  info(...args: unknown[]): void
  warn(...args: unknown[]): void
}

/** One runtime-context entry appended to the assembled prompt. */
export interface PromptContextEntry {
  readonly name: string
  readonly order: number
  readonly text: string | ((context: unknown) => string)
  readonly interpolate?: boolean
  readonly required?: boolean
}

export interface SystemPromptLike {
  context?(entry: PromptContextEntry): () => void
}

/**
 * The credentials service seam. Only `modifyRecord` is relied on: the harness
 * documents it as the single write path for a stored secret.
 */
export interface CredentialsLike {
  modifyRecord?(key: string, updater: (current: unknown) => unknown): Promise<unknown> | unknown
}

/** The slice of the Cordis context this plugin uses. Every member but `tools` is optional. */
export interface HarnessContext {
  readonly tools: ToolRegistry
  readonly logger?: LoggerLike
  on?(event: string, listener: (payload: unknown) => void): () => void
  effect?(run: () => void | (() => void), label?: string): void
  get?<T = unknown>(key: string): T | undefined
  provide?(key: string, value: unknown): void
  emit?(event: string, payload?: unknown): void
}
