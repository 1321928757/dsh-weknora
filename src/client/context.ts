/** Client-side structural types for the slice of the shell this plugin uses. */

export interface ReactElementLike {
  readonly __element?: never
}

/** The subset of React this bundle calls. */
export interface ReactLike {
  createElement(type: unknown, props?: Record<string, unknown> | null, ...children: unknown[]): unknown
  useState<T>(initial: T | (() => T)): [T, (next: T | ((previous: T) => T)) => void]
  useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void
  useMemo<T>(factory: () => T, deps: readonly unknown[]): T
  useCallback<T extends (...args: never[]) => unknown>(callback: T, deps: readonly unknown[]): T
  useRef<T>(initial: T): { current: T }
  Fragment: unknown
}

export interface ReactDomLike {
  createPortal(children: unknown, container: Element): unknown
}

declare const __PACKAGE_ID__: string

/* The shell's module table supplies both; the bundle never includes them. */
declare const require: (specifier: string) => unknown

export const React = require('react') as ReactLike
export const ReactDOM = require('react-dom') as ReactDomLike

export interface SlotRegisterOptions {
  readonly name: string
  readonly id: string
  readonly order?: number
  readonly label?: string | (() => string)
}

export interface SlotsService {
  inject(key: string, callback: () => void): () => void
  register(options: SlotRegisterOptions, component: unknown): () => void
}

/** One mounted remote namespace: `ctx.get('remote.<ns>')`. */
export interface RemoteApi {
  [method: string]: ((args: unknown) => Promise<unknown>) | undefined
}

export interface RemoteService {
  $mount(contribution: unknown): Promise<() => void>
}

export interface ConfigFormSnapshot<T> {
  readonly status: string
  readonly value: T
  readonly writable?: boolean
}

/** The settings shell's form bindings for one plugin row. */
export interface ConfigForm<T = Record<string, unknown>> {
  getSnapshot(): ConfigFormSnapshot<T>
  subscribe(listener: () => void): () => void
  set?(field: string, value: unknown): Promise<boolean>
  unset?(field: string): Promise<boolean>
}

export interface ClientContext {
  get<T = unknown>(key: string): T | undefined
  effect?(run: () => void | (() => void), label?: string): void
  timeout?(callback: () => void, ms: number): () => void
}

/** Session-scope slot entries receive the session id from the shell. */
export interface SessionSlotProps {
  readonly sessionId?: string
}

export const PACKAGE_ID: string = __PACKAGE_ID__
