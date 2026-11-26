/**
 * The bridge to the host service.
 *
 * The client half only sees a remote namespace after it mounts this package's
 * own descriptor set, so `call` mounts lazily and then unwraps the gateway's
 * `{ ok, value | error }` envelope. Nothing above this file knows the wire shape,
 * which is what lets the transport be swapped without touching the UI.
 */

import { PACKAGE_ID } from './context.ts'
import type { ClientContext, RemoteApi, RemoteService } from './context.ts'

export const METHODS = [
  'getSelection',
  'setSelection',
  'listKnowledgeBases',
  'testConnection',
  'getConfigStatus',
  'forgetSession',
  'setApiKey',
] as const

export type Method = typeof METHODS[number]

/**
 * The client is not allowed to require `zod` (the shell only exposes React), so
 * the parameter/result codecs hand-validate. The host validates for real.
 */
const jsonObject = {
  parse: (value: unknown): unknown => value,
  safeParse: (value: unknown): { success: true, data: unknown } => ({ success: true, data: value }),
}

const codec = (typeSymbol: string) => ({ mode: 'strict' as const, typeSymbol, create: () => jsonObject })

const descriptor = (method: Method) => ({
  id: `${PACKAGE_ID}#weknora/${method}`,
  service: 'weknora',
  namespace: 'weknora',
  method,
  invocation: { kind: 'direct' as const },
  parameters: [{ name: 'args', wire: 'args', source: 'json', codec: codec(`${PACKAGE_ID}#Args`) }],
  result: codec(`${PACKAGE_ID}#Result`),
})

const CONTRIBUTION = { package: PACKAGE_ID, descriptors: METHODS.map(descriptor) }

export interface Bridge {
  /** Call one host method; rejects only on transport failure. */
  call<T>(method: Method, payload?: unknown): Promise<T>
  /** Warm the mount without caring about the outcome. */
  ready(): Promise<boolean>
}

export function createBridge(ctx: ClientContext): Bridge {
  let api: RemoteApi | undefined
  let pending: Promise<RemoteApi> | undefined

  const mount = async (): Promise<RemoteApi> => {
    if (api !== undefined) return api
    if (pending === undefined) {
      pending = (async () => {
        const remote = ctx.get<RemoteService>('remote')
        if (remote === undefined || typeof remote.$mount !== 'function') {
          throw new Error('远程服务不可用')
        }
        const unmount = await remote.$mount(CONTRIBUTION)
        ctx.effect?.(() => unmount, 'dsh-weknora: remote')
        const found = ctx.get<RemoteApi>('remote.weknora')
        if (found === undefined) throw new Error('WeKnora 服务未就绪')
        api = found
        return found
      })()
    }
    return await pending
  }

  return {
    async ready(): Promise<boolean> {
      try {
        await mount()
        return true
      } catch {
        return false
      }
    },
    async call<T>(method: Method, payload?: unknown): Promise<T> {
      const target = await mount()
      const fn = target[method]
      if (typeof fn !== 'function') throw new Error(`WeKnora 服务缺少 ${method}`)
      const envelope = await fn(payload ?? {}) as { ok?: unknown, value?: unknown, error?: unknown } | null
      if (envelope === null || typeof envelope !== 'object') throw new Error('WeKnora 服务无响应')
      if (envelope.ok !== true) throw new Error(String(envelope.error ?? '调用失败'))
      return envelope.value as T
    },
  }
}

export interface SelectionResult {
  readonly ok: boolean
  readonly error?: string
  readonly knowledgeBaseIds?: string[]
  readonly knowledgeBases?: readonly KnowledgeBaseRecord[]
  readonly fetchedAt?: number
  /** Present when the listing has never succeeded; explains an empty list. */
  readonly catalogError?: string
  /** True when the deployment has never been configured (default address, no key). */
  readonly needsSetup?: boolean
}

export interface KnowledgeBaseRecord {
  readonly id: string
  readonly name: string
  readonly description?: string
}
