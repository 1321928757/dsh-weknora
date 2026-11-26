/**
 * `settings.section` — the WeKnora configuration page.
 *
 * Non-secret fields are edited through the shell's own config form bindings, so
 * a save writes the user override layer and the running plugin picks it up in
 * place. The API key is different: it must never appear in the config row, so it
 * goes through the host's credential write and only `saved / not set` comes back.
 */

import { React } from './context.ts'
import type { ClientContext, ConfigForm } from './context.ts'
import type { Bridge, SelectionResult } from './bridge.ts'
import type { I18n } from '../i18n.ts'

const h = React.createElement

interface FormsService {
  get<T = Record<string, unknown>>(entryId: string): ConfigForm<T> | undefined
}

export interface SettingsDeps {
  readonly call: Bridge['call']
  readonly i18n: I18n
  readonly ctx: ClientContext
}

interface EffectiveView {
  readonly baseUrl?: string
  readonly tenantId?: string
  readonly maxResults?: number
  readonly maxChunkChars?: number
  readonly requestTimeoutMs?: number
  readonly chatTimeoutMs?: number
  readonly resourceUrls?: 'public' | 'handle'
  readonly agentId?: string
  readonly toolPrefix?: string
}

interface StatusView {
  readonly ok: boolean
  readonly configured?: boolean
  readonly baseUrl?: string
  readonly hasApiKey?: boolean
  readonly knowledgeBaseCount?: number
  readonly hintWhenUnselected?: boolean
  readonly enabledTools?: string[]
  readonly effective?: EffectiveView
}

interface Draft {
  baseUrl: string
  tenantId: string
  maxResults: string
  maxChunkChars: string
  requestTimeout: string
  chatTimeout: string
  resourceUrls: 'public' | 'handle'
  agentId: string
  hintWhenUnselected: boolean
  tools: Record<'listKnowledgeBases' | 'search' | 'readDocument' | 'ask', boolean>
}

const TOOL_KEYS = ['listKnowledgeBases', 'search', 'readDocument', 'ask'] as const

function toDraft(value: Record<string, unknown> | undefined, status: StatusView | undefined): Draft {
  const record = value ?? {}
  const tools = (record['tools'] ?? {}) as Record<string, unknown>
  const enabled = status?.enabledTools
  return {
    baseUrl: typeof record['baseUrl'] === 'string' ? record['baseUrl'] : '',
    tenantId: typeof record['tenantId'] === 'string' ? record['tenantId'] : '',
    maxResults: String(record['maxResults'] ?? ''),
    maxChunkChars: String(record['maxChunkChars'] ?? ''),
    requestTimeout: String(Math.round(Number(record['requestTimeoutMs'] ?? 0) / 1000) || ''),
    chatTimeout: String(Math.round(Number(record['chatTimeoutMs'] ?? 0) / 1000) || ''),
    resourceUrls: record['resourceUrls'] === 'handle' ? 'handle' : 'public',
    agentId: typeof record['agentId'] === 'string' ? record['agentId'] : '',
    hintWhenUnselected: record['hintWhenUnselected'] !== false,
    tools: Object.fromEntries(TOOL_KEYS.map(key => [
      key,
      enabled === undefined ? tools[key] !== false : enabled.includes(key),
    ])) as Draft['tools'],
  }
}

/** Seconds in the UI, milliseconds in the config. */
const seconds = (value: string): number => Math.round(Number(value) * 1000)
const isPositive = (value: string): boolean => /^\d+$/.test(value.trim()) && Number(value) > 0

export function createSettings(deps: SettingsDeps): unknown {
  const { call, i18n, ctx } = deps
  const t = i18n.t

  return function WeknoraSettingsPage(): unknown {
    const forms = ctx.get<FormsService>('configForms')
    const form = forms?.get?.('weknora') ?? forms?.get?.('@wxg-prc-cpg/dsh-weknora')

    const [snapshot, setSnapshot] = React.useState(() => form?.getSnapshot())
    const [status, setStatus] = React.useState<StatusView | undefined>(undefined)
    const [draft, setDraft] = React.useState<Draft>(() => toDraft(undefined, undefined))
    const [errors, setErrors] = React.useState<Record<string, string>>({})
    const [message, setMessage] = React.useState<{ kind: 'ok' | 'err', text: string } | undefined>(undefined)
    const [busy, setBusy] = React.useState(false)
    const [keyEditing, setKeyEditing] = React.useState(false)
    const [keyValue, setKeyValue] = React.useState('')
    const summaryRef = React.useRef<HTMLElement | null>(null)
    /** Bumped on every rejected submit; only that moves focus to the summary. */
    const [rejects, setRejects] = React.useState(0)

    React.useEffect(() => {
      if (rejects > 0) summaryRef.current?.focus()
    }, [rejects])

    React.useEffect(() => {
      if (form === undefined) return
      return form.subscribe(() => setSnapshot(form.getSnapshot()))
    }, [form])

    const value = (snapshot?.value ?? {}) as Record<string, unknown>

    /**
     * True once the user has touched the draft. A re-seed from the persisted form
     * must not overwrite edits that are not saved yet — saving the API key bumps
     * `status.hasApiKey`, which used to silently restore the old service address.
     */
    const dirtyRef = React.useRef(false)

    React.useEffect(() => {
      if (dirtyRef.current) return
      setDraft(toDraft(value, status))
      // The old verdicts belong to the old draft.
      setErrors({})
      // Seeding the draft from the form is intentional: a remote change (another
      // window, a plugin reload) must win, otherwise Save would resurrect stale
      // values the user never touched.
    }, [snapshot?.status, JSON.stringify(value), status?.hasApiKey])

    React.useEffect(() => {
      void call<StatusView>('getConfigStatus').then(result => {
        if (result?.ok === true) setStatus(result)
      }).catch(() => undefined)
    }, [call])

    const writable = snapshot?.writable !== false && typeof form?.set === 'function'

    const patch = (next: Partial<Draft>): void => {
      dirtyRef.current = true
      setDraft(current => ({ ...current, ...next }))
    }

    /**
     * Validate a draft, optionally overlaid with values taken straight from the
     * DOM. The overlay matters on blur: a blur can arrive in the same tick as the
     * input that caused it, before React has committed the new draft.
     */
    const validate = (overrides: Partial<Draft> = {}): Record<string, string> => {
      const view: Draft = { ...draft, ...overrides }
      const found: Record<string, string> = {}
      if (view.baseUrl.trim() !== '' && !/^https?:\/\//i.test(view.baseUrl.trim())) {
        found['baseUrl'] = t('settings.error.baseUrl')
      }
      for (const key of ['maxResults', 'maxChunkChars', 'requestTimeout', 'chatTimeout'] as const) {
        if (view[key].trim() !== '' && !isPositive(view[key])) found[key] = t('settings.error.number')
      }
      if (!TOOL_KEYS.some(key => view.tools[key])) found['tools'] = t('settings.error.toolsAllOff')
      return found
    }

    const dropError = (key: string): void => {
      setErrors(previous => {
        if (previous[key] === undefined) return previous
        const next = { ...previous }
        delete next[key]
        return next
      })
    }

    /**
     * Toggle helpers read the previous draft instead of the rendered one: two
     * clicks inside one frame would otherwise both start from the same snapshot
     * and the first would be lost.
     */
    const toggleTool = (key: typeof TOOL_KEYS[number]): void => {
      dirtyRef.current = true
      const turningOn = draft.tools[key] === false
      setDraft(current => ({ ...current, tools: { ...current.tools, [key]: !current.tools[key] } }))
      // Re-enabling a tool answers the "keep at least one" complaint immediately.
      if (turningOn) dropError('tools')
    }
    const toggleHint = (): void => {
      dirtyRef.current = true
      setDraft(current => ({ ...current, hintWhenUnselected: !current.hintWhenUnselected }))
    }

    const save = async (): Promise<void> => {
      const found = validate()
      setErrors(found)
      if (Object.keys(found).length > 0) {
        // The summary does not exist yet — it is rendered by this very update —
        // so the focus move is an effect, not a call.
        setRejects(previous => previous + 1)
        return
      }
      if (form?.set === undefined) {
        setMessage({ kind: 'err', text: t('settings.readonly') })
        return
      }
      setBusy(true)
      setMessage(undefined)
      try {
        const writes: [string, unknown][] = [
          ['baseUrl', draft.baseUrl.trim() === '' ? undefined : draft.baseUrl.trim()],
          ['tenantId', draft.tenantId.trim() === '' ? undefined : draft.tenantId.trim()],
          ['maxResults', draft.maxResults.trim() === '' ? undefined : Number(draft.maxResults)],
          ['maxChunkChars', draft.maxChunkChars.trim() === '' ? undefined : Number(draft.maxChunkChars)],
          ['requestTimeoutMs', draft.requestTimeout.trim() === '' ? undefined : seconds(draft.requestTimeout)],
          ['chatTimeoutMs', draft.chatTimeout.trim() === '' ? undefined : seconds(draft.chatTimeout)],
          ['resourceUrls', draft.resourceUrls],
          ['agentId', draft.agentId.trim() === '' ? undefined : draft.agentId.trim()],
          ['hintWhenUnselected', draft.hintWhenUnselected],
          ...TOOL_KEYS.map(key => [`tools.${key}`, draft.tools[key]] as [string, unknown]),
        ]
        for (const [field, next] of writes) {
          if (next === undefined) await form.unset?.(field)
          else await form.set(field, next)
        }
        dirtyRef.current = false
      setMessage({ kind: 'ok', text: t('settings.saved') })
      } catch (error) {
        setMessage({ kind: 'err', text: t('settings.error.saveFailed', { reason: String((error as Error)?.message ?? error) }) })
      } finally {
        setBusy(false)
      }
    }

    const test = async (): Promise<void> => {
      setBusy(true)
      setMessage(undefined)
      try {
        const result = await call<SelectionResult & { latencyMs?: number, knowledgeBaseCount?: number }>(
          'testConnection',
          { baseUrl: draft.baseUrl.trim() === '' ? undefined : draft.baseUrl.trim() },
        )
        if (result?.ok !== true) throw new Error(result?.error ?? '')
        setMessage({ kind: 'ok', text: t('settings.status.connected', { ms: result.latencyMs ?? 0, n: result.knowledgeBaseCount ?? 0 }) })
        setStatus(current => ({ ...(current ?? { ok: true }), knowledgeBaseCount: result.knowledgeBaseCount ?? 0 }))
      } catch (error) {
        setMessage({ kind: 'err', text: t('settings.error.testFailed', { reason: String((error as Error)?.message ?? error) }) })
      } finally {
        setBusy(false)
      }
    }

    /**
     * Write the key. The value is an argument on purpose: the clear button used
     * to call this right after `setKeyValue('')`, and the state update had not
     * landed yet, so it saved the key the user meant to discard.
     */
    const saveKey = async (next: string): Promise<void> => {
      setBusy(true)
      try {
        const result = await call<{ ok: boolean, hasApiKey?: boolean, error?: string }>('setApiKey', { apiKey: next })
        if (result?.ok !== true) throw new Error(result?.error ?? '')
        setStatus(current => ({ ...(current ?? { ok: true }), hasApiKey: result.hasApiKey === true }))
        setKeyEditing(false)
        setKeyValue('')
        setMessage({ kind: 'ok', text: next.trim() === '' ? t('settings.key.cleared') : t('settings.key.saved') })
      } catch (error) {
        setMessage({ kind: 'err', text: t('settings.error.keyFailed', { reason: String((error as Error)?.message ?? error) }) })
      } finally {
        setBusy(false)
      }
    }

    const fieldError = (key: string): string | undefined => errors[key]
    const fieldId = (key: string): string => `weknora-field-${key}`

    /** Re-check one field on blur, leaving the others' verdicts alone. */
    const recheck = (key: keyof Draft, value?: unknown): void => {
      const found = validate(value === undefined ? {} : ({ [key]: value } as Partial<Draft>))
      setErrors(previous => {
        const next = { ...previous }
        if (found[key] === undefined) delete next[key]
        else next[key] = found[key]
        return next
      })
    }

    const focusField = (key: string): void => {
      const element = document.getElementById(fieldId(key))
      if (element !== null) {
        element.scrollIntoView({ block: 'center' })
        element.focus()
      }
    }

    const input = (key: keyof Draft, extra: Record<string, unknown> = {}): unknown => h('input', {
      id: fieldId(key),
      className: 'weknora-input',
      value: String(draft[key] ?? ''),
      'aria-invalid': fieldError(key) === undefined ? undefined : 'true',
      'aria-describedby': fieldError(key) === undefined ? undefined : `${fieldId(key)}-error`,
      onInput: (event: Event) => patch({ [key]: (event.target as HTMLInputElement).value } as Partial<Draft>),
      onBlur: (event: Event) => recheck(key, (event.target as HTMLInputElement).value),
      ...extra,
    })

    /**
     * One settings row. The error belongs under the control it describes, not in
     * the summary alone: the summary says what is wrong, the field says where.
     */
    const row = (label: string, control: unknown, hint?: string, errorKeys: string[] = []): unknown => h('div', { className: 'weknora-frow' },
      h('div', { className: 'lbl' }, label),
      h('div', { className: 'ctl' },
        control,
        // Deliberately not role="alert": the summary above already announces the
        // failure, and three assertive regions for one submit reads as a stutter.
        // aria-invalid + aria-describedby carry the same information.
        ...errorKeys.map(key => (fieldError(key) === undefined
          ? null
          : h('div', { key, className: 'weknora-field-error', id: `${fieldId(key)}-error` }, fieldError(key)))),
        hint === undefined ? null : h('div', { className: 'weknora-hint' }, hint)))

    const errorCount = Object.keys(errors).length

    return h('div', { className: 'weknora-root weknora-settings' },
      h('h2', null, t('settings.title')),
      h('p', { className: 'lede' }, t('settings.description')),

      errorCount > 0
        ? h('div', {
          key: 'summary',
          className: 'weknora-message is-err weknora-errsummary',
          role: 'alert',
          tabIndex: -1,
          ref: (element: HTMLElement | null) => { summaryRef.current = element },
        }, h('div', null,
          h('div', null, t('settings.error.summary')),
          // Every entry is also the link to the field it is about.
          h('ul', null, Object.entries(errors).map(([key, text]) => h('li', { key },
            h('button', {
              type: 'button',
              className: 'weknora-link',
              onClick: () => focusField(key),
            }, text))))))
        : null,

      // ── connection ────────────────────────────────────────────────────
      h('div', { className: 'weknora-group' },
        h('div', { className: 'gh' }, t('settings.group.connection')),
        row(t('settings.field.baseUrl'), input('baseUrl', { className: 'weknora-input is-mono', placeholder: 'https://weknora.example.com', disabled: !writable }), t('settings.field.baseUrlHint'), ['baseUrl']),
        row(t('settings.field.status'), h('div', { className: 'weknora-status' },
          h('span', { className: 'ok' }),
          h('span', null, status?.knowledgeBaseCount === undefined
            ? t('settings.status.unknown')
            : t('settings.status.bases', { n: status.knowledgeBaseCount })),
          h('span', { className: 'weknora-spacer' }),
          h('button', { type: 'button', className: 'weknora-btn', disabled: busy, onClick: () => void test() },
            busy ? t('settings.testing') : t('settings.test'))))),

      // ── auth ──────────────────────────────────────────────────────────
      h('div', { className: 'weknora-group' },
        h('div', { className: 'gh' }, t('settings.group.auth')),
        row(t('settings.field.apiKey'),
          keyEditing
            ? h('div', { className: 'weknora-secret' },
                h('input', {
                  className: 'weknora-input is-mono',
                  type: 'password',
                  value: keyValue,
                  placeholder: t('settings.key.placeholder'),
                  'aria-label': t('settings.field.apiKey'),
                  onInput: (event: Event) => setKeyValue((event.target as HTMLInputElement).value),
                }),
                h('button', { type: 'button', className: 'weknora-btn is-primary', disabled: busy, onClick: () => void saveKey(keyValue) }, t('settings.key.save')),
                h('button', { type: 'button', className: 'weknora-btn', onClick: () => { setKeyEditing(false); setKeyValue('') } }, t('settings.key.cancel')))
            : h('div', { className: 'weknora-secret' },
                h('span', { className: 'val' }, status?.hasApiKey === true ? `•••••••• ${t('settings.key.saved')}` : t('settings.key.notSet')),
                h('button', {
                  type: 'button',
                  className: 'weknora-btn',
                  onClick: () => setKeyEditing(true),
                }, status?.hasApiKey === true ? t('settings.key.replace') : t('settings.key.save')),
                status?.hasApiKey === true
                  ? h('button', {
                    type: 'button',
                    className: 'weknora-btn is-danger',
                    disabled: busy,
                    onClick: () => { setKeyValue(''); void saveKey('') },
                  }, t('settings.key.clear'))
                  : null),
          t('settings.field.apiKeyHint')),
        row(t('settings.field.tenantId'), input('tenantId', { className: 'weknora-input is-mono', disabled: !writable, placeholder: status?.['effective']?.tenantId ?? '' }), t('settings.field.tenantIdHint'))),

      // ── retrieval ─────────────────────────────────────────────────────
      h('div', { className: 'weknora-group' },
        h('div', { className: 'gh' }, t('settings.group.retrieval')),
        row(t('settings.field.maxResults'), h('div', { className: 'weknora-inline' },
          input('maxResults', { className: 'weknora-input is-mono', inputMode: 'numeric', disabled: !writable, placeholder: String(status?.['effective']?.maxResults ?? '') }),
          h('span', { className: 'weknora-hint' }, t('settings.field.maxChunkChars')),
          input('maxChunkChars', { className: 'weknora-input is-mono', inputMode: 'numeric', disabled: !writable, placeholder: String(status?.['effective']?.maxChunkChars ?? '') })), undefined, ['maxResults', 'maxChunkChars']),
        row(t('settings.field.requestTimeout'), h('div', { className: 'weknora-inline' },
          input('requestTimeout', { className: 'weknora-input is-mono', inputMode: 'numeric', disabled: !writable, placeholder: String(Math.round((status?.['effective']?.requestTimeoutMs ?? 0) / 1000) || '') }),
          h('span', { className: 'weknora-hint' }, t('settings.field.chatTimeout')),
          input('chatTimeout', { className: 'weknora-input is-mono', inputMode: 'numeric', disabled: !writable, placeholder: String(Math.round((status?.['effective']?.chatTimeoutMs ?? 0) / 1000) || '') })), undefined, ['requestTimeout', 'chatTimeout']),
        row(t('settings.field.resourceUrls'),
          h('div', { className: 'weknora-radios' },
            h('label', null,
              h('span', { className: 'weknora-radio', 'data-on': draft.resourceUrls === 'public' }),
              h('span', null, t('settings.resource.public'))),
            h('label', null,
              h('span', { className: 'weknora-radio', 'data-on': draft.resourceUrls === 'handle' }),
              h('span', null, t('settings.resource.handle')))),
          t('settings.field.resourceUrlsHint')),
        row(t('settings.field.agentId'), input('agentId', { className: 'weknora-input is-mono', disabled: !writable, placeholder: status?.['effective']?.agentId ?? '' }), t('settings.field.agentIdHint'))),

      // ── tools ─────────────────────────────────────────────────────────
      h('div', { className: 'weknora-group' },
        h('div', { className: 'gh' }, t('settings.group.tools')),
        h('div', {
          className: 'weknora-checks',
          id: fieldId('tools'),
          tabIndex: -1,
        }, TOOL_KEYS.map(key => h('label', { key },
          h('span', {
            className: 'weknora-cb',
            'data-on': draft.tools[key],
            onClick: () => {
              if (!writable) return
              toggleTool(key)
            },
          }),
          h('span', { className: 'mono' }, `weknora_${key === 'listKnowledgeBases' ? 'list_knowledge_bases' : key === 'readDocument' ? 'read_document' : key}`)))),
        fieldError('tools') === undefined
          ? null
          : h('div', { className: 'weknora-field-error', id: `${fieldId('tools')}-error` }, fieldError('tools')),
        h('div', { className: 'weknora-footnote' }, t('settings.tools.footnote')),
        h('div', { className: 'weknora-frow', style: { marginTop: '12px' } },
          h('div', { className: 'lbl' }),
          h('div', { className: 'ctl' },
            h('label', { className: 'weknora-checks', style: { display: 'flex' } },
              h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '7px' } },
                h('span', {
                  className: 'weknora-cb',
                  'data-on': draft.hintWhenUnselected,
                  onClick: () => { if (writable) toggleHint() },
                }),
                h('span', null, t('settings.hint.toggle')))),
            h('div', { className: 'weknora-hint' }, t('settings.hint.hint'))))),

      // ── actions ───────────────────────────────────────────────────────
      h('div', { className: 'weknora-actions' },
        h('button', { type: 'button', className: 'weknora-btn is-primary', disabled: busy || !writable, onClick: () => void save() },
          busy ? t('settings.saving') : t('settings.save')),
        h('button', {
          type: 'button',
          className: 'weknora-btn',
          disabled: busy,
          onClick: () => { setKeyEditing(false); void call('listKnowledgeBases', { refresh: true }).catch(() => undefined) },
        }, t('settings.reset'))),

      message === undefined
        ? null
        : h('div', {
          className: `weknora-message${message.kind === 'ok' ? ' is-ok' : ' is-err'}`,
          role: message.kind === 'err' ? 'alert' : 'status',
        }, message.text),

      writable ? null : h('div', { className: 'weknora-message' }, t('settings.readonly')))
  }
}
