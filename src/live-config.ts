/** Live plugin configuration: volatile reads, validation, and a last-good fallback. */

import { ConfigError, materializeConfig, resolveConfig } from './config.ts'
import type { ResolvedConfig } from './config.ts'

export interface LiveConfigOptions {
  readonly logger?: { warn(...args: unknown[]): void }
  /** Resolves the API key outside the config row (credentials store or private file). */
  readonly secret?: () => string | undefined
}

/**
 * A configuration reader that never throws after construction.
 *
 * The settings page can persist a half-finished row at any moment, and a throw
 * escaping from a tool-activation condition ends the whole model step with
 * `TOOL_ACTIVATION_FAILED`. So a bad read keeps the previous good snapshot and
 * only logs once per distinct problem.
 */
export class LiveConfig {
  private lastGood: ResolvedConfig
  private lastWarn: string | undefined

  /**
   * @param raw - the Cordis row config, whose `.volatile()` fields are read on every call.
   * @param options - logger and secret resolver.
   * @throws ConfigError when the initial row is unusable: a typo belongs at boot.
   */
  constructor(private readonly raw: unknown, private readonly options: LiveConfigOptions = {}) {
    this.lastGood = resolveConfig(materializeConfig(raw), options.secret?.())
  }

  /** The configuration a consumer should use right now. */
  current(): ResolvedConfig {
    try {
      const next = resolveConfig(materializeConfig(this.raw), this.options.secret?.())
      this.lastGood = next
      this.lastWarn = undefined
      return next
    } catch (error) {
      const message = error instanceof ConfigError ? error.message : String(error)
      if (message !== this.lastWarn) {
        this.lastWarn = message
        this.options.logger?.warn(`dsh-weknora: 配置暂时不可用，继续使用上一次合法值。\n${message}`)
      }
      return this.lastGood
    }
  }
}
