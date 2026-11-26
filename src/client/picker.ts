/**
 * `conversation.input.left` — the per-session knowledge-base picker.
 *
 * Selecting is the only thing that makes retrieval tools visible in a session,
 * so the surface has to be honest about it: the subtitle says the tools load
 * only after a pick, clearing says so again, and a failed save says the previous
 * set is still in force.
 */

import { React, ReactDOM } from './context.ts'
import type { SessionSlotProps } from './context.ts'
import type { Bridge, KnowledgeBaseRecord, SelectionResult } from './bridge.ts'
import { createSelectionWriter } from '../selection-writer.ts'
import type { I18n } from '../i18n.ts'

const ALL = '*'

export interface PickerDeps {
  readonly call: Bridge['call']
  readonly i18n: I18n
}

type Phase = 'loading' | 'ready' | 'error' | 'unconfigured'

interface Toast {
  readonly id: number
  readonly text: string
  readonly kind: 'ok' | 'err'
}

const h = React.createElement

function icon(path: unknown, size = 15): unknown {
  return h('svg', {
    className: 'weknora-chip-icon',
    viewBox: '0 0 16 16',
    width: size,
    height: size,
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': 1.35,
    'aria-hidden': 'true',
  }, path)
}

const ICON_SHELF = [
  h('rect', { key: 'r', x: 2, y: 3, width: 12, height: 10, rx: 1.6 }),
  h('path', { key: 'a', d: 'M2 6.4h12' }),
  h('path', { key: 'b', d: 'M5.6 6.4v6.6' }),
]
const ICON_CARET = h('path', { d: 'M3 4.8 6 7.8l3-3' })

export function createPicker(deps: PickerDeps): unknown {
  const { call, i18n } = deps
  const t = i18n.t

  return function WeknoraKbPicker(props: SessionSlotProps): unknown {
    const sessionId = props?.sessionId

    const [phase, setPhase] = React.useState<Phase>('loading')
    const [bases, setBases] = React.useState<readonly KnowledgeBaseRecord[]>([])
    const [selected, setSelected] = React.useState<readonly string[]>([])
    const [open, setOpen] = React.useState(false)
    const [busy, setBusy] = React.useState(false)
    const [reason, setReason] = React.useState<string | undefined>(undefined)
    const [query, setQuery] = React.useState('')
    const [toast, setToast] = React.useState<Toast | undefined>(undefined)
    const [anchor, setAnchor] = React.useState<{ left: number, bottom: number } | undefined>(undefined)
    /** A listing round trip is in flight, whatever phase the panel is in. */
    const [refreshing, setRefreshing] = React.useState(false)
    /**
     * The skeleton only appears when a listing is genuinely slow. Between 100 and
     * 200ms a spinner reads as a flicker, so the show is delayed past that.
     */
    const [showSkeleton, setShowSkeleton] = React.useState(false)

    const triggerRef = React.useRef<HTMLElement | null>(null)
    const panelRef = React.useRef<HTMLElement | null>(null)
    const listRef = React.useRef<HTMLElement | null>(null)
    /** Monotonic id of the newest load; older answers are dropped. */
    const loadTicket = React.useRef(0)

    const flash = React.useCallback((text: string, kind: 'ok' | 'err') => {
      setToast({ id: Date.now(), text, kind })
    }, [])

    React.useEffect(() => {
      if (toast === undefined) return
      const timer = setTimeout(() => setToast(undefined), 2200)
      return () => clearTimeout(timer)
    }, [toast])
    /**
     * Optimistic writes, ordered and revision-guarded.
     *
     * The queueing and rollback rules live in `selection-writer` so they can be
     * tested without a browser; this only maps them onto React state.
     */
    const writer = React.useMemo(() => createSelectionWriter({
      write: async (ids) => {
        const result = await call<SelectionResult>('setSelection', { sessionId, knowledgeBaseIds: [...ids] })
        if (result?.ok !== true) throw new Error(result?.error ?? 'save failed')
      },
      onOptimistic: (ids) => {
        setSelected(ids)
        setBusy(true)
        setReason(undefined)
      },
      onSettled: (ids, note) => {
        setSelected(ids)
        setBusy(false)
        if (note !== undefined) flash(note, 'ok')
      },
      onRollback: (ids, error) => {
        const detail = String((error as Error)?.message ?? error)
        setSelected(ids)
        setBusy(false)
        setReason(detail)
        flash(t('picker.toast.failed', { reason: detail }), 'err')
      },
    }), [call, flash, sessionId, t])


    /** Load the session selection; also the reconnect path after a failure. */
    const load = React.useCallback(async (refresh: boolean) => {
      if (typeof sessionId !== 'string' || sessionId === '') {
        setPhase('unconfigured')
        return
      }
      // Mount and open both load, and either can finish last: without a ticket the
      // later-but-older answer wins, which once put a freshly saved selection back
      // to "nothing selected" with no event left to correct it.
      const ticket = (loadTicket.current += 1)
      const current = (): boolean => loadTicket.current === ticket
      setPhase(phase => (phase === 'ready' ? phase : 'loading'))
      setRefreshing(true)
      try {
        // Ask first: the answer says whether a deployment is configured at all, and
        // a fresh install is not an error — probing the built-in default address
        // only ever reports the local port as broken, which is what made the panel
        // shout "拉取知识库失败" at someone who had configured nothing.
        const view = await call<SelectionResult>('getSelection', { sessionId })
        if (!current()) return
        if (view?.ok === false) throw new Error(view.error ?? '')
        if (view?.needsSetup === true) {
          setBases([])
          setSelected([])
          setReason(undefined)
          setPhase('unconfigured')
          return
        }
        const ids = view?.knowledgeBaseIds ?? []
        // Adopt what the host reports; `seed` does not write back.
        writer.seed(ids)
        setSelected(ids)
        setBases(view?.knowledgeBases ?? [])
        setReason(undefined)
        // An empty list that never loaded is a failure with a reason, not a
        // deployment with no knowledge bases. Saying "no bases" here would send
        // the user to check API-key permissions for a network problem.
        const known = view?.knowledgeBases ?? []
        if (!refresh && known.length === 0 && view?.catalogError !== undefined) {
          setReason(view.catalogError)
          setPhase('error')
          return
        }
        // Refreshing the list is the second round trip, and only worth paying once
        // we know there is a deployment to ask.
        if (refresh) {
          const listed = await call<SelectionResult>('listKnowledgeBases', { refresh: true })
          if (!current()) return
          if (listed?.ok === false) throw new Error(listed.error ?? '')
          setBases(listed?.knowledgeBases ?? [])
        }
        setPhase('ready')
      } catch (error) {
        if (!current()) return
        setReason(String((error as Error)?.message ?? error))
        // A failed load never drops what the session already had.
        setPhase('error')
      } finally {
        if (current()) setRefreshing(false)
      }
    }, [call, sessionId, writer])

    React.useEffect(() => {
      if (!refreshing) {
        setShowSkeleton(false)
        return
      }
      const timer = setTimeout(() => setShowSkeleton(true), 160)
      return () => clearTimeout(timer)
    }, [refreshing])

    React.useEffect(() => {
      void load(false)
    }, [load])

    const close = React.useCallback(() => {
      setOpen(false)
      setQuery('')
      // The panel lives in a portal, so closing it otherwise drops focus to body
      // and the next Tab starts from the top of the document.
      triggerRef.current?.focus()
    }, [])


    const openPanel = React.useCallback(() => {
      const element = triggerRef.current
      if (element !== null) {
        const rect = element.getBoundingClientRect()
        // Height is bounded by the stylesheet (min(420px, 60vh)); clamping the
        // bottom by that bound is what keeps the header and its close button on
        // screen when the composer sits high up the window.
        const panelHeight = Math.min(420, window.innerHeight * 0.6)
        setAnchor({
          left: Math.max(8, Math.min(rect.left, window.innerWidth - 400)),
          bottom: Math.max(8, Math.min(window.innerHeight - rect.top + 8, window.innerHeight - panelHeight - 8)),
        })
      }
      setOpen(true)
      // List fresh on every open: a knowledge base added in WeKnora must appear
      // without restarting dsh, and a failed open should say so instead of
      // showing a stale list.
      void load(true)
    }, [load])

    // The capture-phase handler below needs the current query without
    // re-registering the listeners on every keystroke.
    const queryRef = React.useRef('')
    queryRef.current = query

    // Outside click, Escape and viewport changes all close the panel: it is
    // fixed-positioned, so a stale anchor is worse than a closed panel.
    React.useEffect(() => {
      if (!open) return
      const onPointerDown = (event: Event): void => {
        const target = event.target as Node | null
        if (target === null) return
        if (panelRef.current?.contains(target) === true) return
        if (triggerRef.current?.contains(target) === true) return
        setOpen(false)
      }
      const onKeyDown = (event: KeyboardEvent): void => {
        if (event.key !== 'Escape') return
        event.stopPropagation()
        // Escape in a search box means "clear what I typed" first; only the next
        // press closes. Closing on the first press threw the query away.
        const target = event.target as HTMLElement | null
        const inField = target !== null && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')
        if (inField && queryRef.current !== '') {
          setQuery('')
          return
        }
        close()
      }
      const onResize = (): void => setOpen(false)
      document.addEventListener('pointerdown', onPointerDown, true)
      document.addEventListener('keydown', onKeyDown, true)
      window.addEventListener('resize', onResize)
      return () => {
        document.removeEventListener('pointerdown', onPointerDown, true)
        document.removeEventListener('keydown', onKeyDown, true)
        window.removeEventListener('resize', onResize)
      }
    }, [open, close])


    React.useEffect(() => {
      if (!open) return
      const panel = panelRef.current
      if (panel === null) return
      const field = panel.querySelector('input')
      if (field instanceof HTMLElement) field.focus()
      else panel.focus()
    }, [open])

    const toggle = React.useCallback((id: string) => {
      if (typeof sessionId !== 'string' || sessionId === '') return
      const previous = writer.intent()
      const next = id === ALL
        ? (previous.includes(ALL) ? [] : [ALL])
        : (previous.includes(id) ? previous.filter(entry => entry !== id) : [...previous.filter(entry => entry !== ALL), id])
      const name = id === ALL ? t('picker.all') : (bases.find(base => base.id === id)?.name ?? id)
      const added = !previous.includes(id)
      writer.push(next, added ? t('picker.toast.added', { name }) : t('picker.toast.removed', { name }))
    }, [bases, sessionId, t, writer])

    const clearAll = React.useCallback(() => {
      if (typeof sessionId !== 'string' || sessionId === '') return
      writer.push([], t('picker.toast.cleared'))
    }, [sessionId, t, writer])

    // ── derived ───────────────────────────────────────────────────────────
    const count = selected.filter(id => id !== ALL).length
    const isAll = selected.includes(ALL)
    const state = reason !== undefined ? 'warn' : (count > 0 || isAll ? 'on' : 'off')
    // The chip names the capability, never a single base: a name here reads like
    // a workspace selector and makes the chip's width jump with the data.
    const triggerLabel = t('picker.trigger.empty')
    const filtered = query.trim() === ''
      ? bases
      : bases.filter(base => `${base.name} ${base.description ?? ''}`.toLowerCase().includes(query.trim().toLowerCase()))

    // ── trigger ───────────────────────────────────────────────────────────
    const trigger = h('button', {
      key: 'trigger',
      ref: (element: HTMLElement | null) => { triggerRef.current = element },
      type: 'button',
      className: 'weknora-chip',
      'data-state': state,
      'aria-haspopup': 'dialog',
      'aria-expanded': open,
      title: state === 'warn' ? reason : undefined,
      onClick: () => { if (open) close(); else openPanel() },
    },
      icon(ICON_SHELF),
      h('span', { key: 'label' }, state === 'warn' ? `${t('picker.trigger.empty')} !` : triggerLabel),
      count > 0 && !isAll ? h('span', { key: 'count', className: 'weknora-count' }, String(count)) : null,
      isAll ? h('span', { key: 'all', className: 'weknora-tag' }, 'ALL') : null,
      h('svg', {
        key: 'caret',
        className: 'weknora-chip-caret',
        viewBox: '0 0 12 12',
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': 1.5,
        'aria-hidden': 'true',
      }, ICON_CARET))

    if (!open) return h('div', { className: 'weknora-root' }, trigger)

    const panel = h('div', {
      key: 'panel',
      ref: (element: HTMLElement | null) => { panelRef.current = element },
      className: 'weknora-panel',
      role: 'dialog',
      tabIndex: -1,
      'aria-label': t('picker.title'),
      style: anchor === undefined
        ? { left: 8, bottom: 8 }
        : { left: `${anchor.left}px`, bottom: `${anchor.bottom}px` },
      onKeyDown: (event: KeyboardEvent) => { moveFocus(event) },
    },
      h('div', { key: 'head', className: 'weknora-head' },
        h('div', { key: 'text' },
          h('div', { className: 'weknora-title' }, t('picker.title')),
          h('div', { className: 'weknora-sub' },
            count === 0 && !isAll
              ? t('picker.subtitle.unselected')
              : t('picker.subtitle.selected', { n: isAll ? bases.length : count }))),
        h('button', {
          key: 'x',
          type: 'button',
          className: 'weknora-x',
          'aria-label': t('picker.close'),
          onClick: close,
        }, '✕')),

      renderBody(),


      h('div', { key: 'foot', className: 'weknora-foot' },
        // The status slot doubles as the toast surface: it is where the eye
        // already is, it cannot be occluded by anything, and reporting there
        // moves no layout.
        h('span', { key: 'sel', className: 'weknora-sel', role: 'status', 'aria-live': 'polite' },
          toast === undefined
            ? null
            : h('span', { key: 'dot', className: `weknora-dot${toast.kind === 'err' ? ' is-err' : ''}` }),
          toast === undefined
            ? (count === 0 && !isAll ? t('picker.none') : t('picker.selectedCount', { n: isAll ? bases.length : count }))
            : toast.text),
        busy ? h('span', { key: 'spin', className: 'weknora-spin' }) : null,
        h('span', { key: 'sp', className: 'weknora-spacer' }),
        h('button', {
          key: 'clear',
          type: 'button',
          className: 'weknora-btn',
          disabled: count === 0 && !isAll,
          onClick: clearAll,
        }, t('picker.clear')),
        h('button', { key: 'done', type: 'button', className: 'weknora-btn is-primary', onClick: close }, t('picker.done'))))

    const nodes: unknown[] = []
    if (typeof document !== 'undefined') nodes.push(ReactDOM.createPortal(panel, document.body))
    return h('div', { className: 'weknora-root' }, trigger, ...nodes)

    // ── body ──────────────────────────────────────────────────────────────
    function renderBody(): unknown {
      // Only take over when there is nothing to show: a refresh that already has
      // rows must not unmount them (that drops focus, scroll and the search box).
      if (phase === 'loading' || (showSkeleton && bases.length === 0)) {
        return h('div', { key: 'body', className: 'weknora-list' },
          h('div', { className: 'weknora-skeleton' }),
          h('div', { className: 'weknora-skeleton' }),
          h('div', { className: 'weknora-skeleton' }))
      }
      if (phase === 'unconfigured') return emptyState(t('picker.empty.unconfigured'), t('picker.empty.unconfiguredHint'))
      if (phase === 'error') {
        return h('div', { key: 'body' },
          h('div', { className: 'weknora-alert', role: 'alert' },
            icon([h('circle', { key: 'c', cx: 8, cy: 8, r: 6 }), h('path', { key: 'p', d: 'M8 5v3.4M8 10.6v.4' })], 14),
            h('div', null,
              h('div', null, t('picker.error.load', { reason: reason ?? '' })),
              h('div', { className: 'weknora-alert-sub' }, t('picker.error.keep')))),
          h('div', { className: 'weknora-foot', style: { borderTop: 0, justifyContent: 'flex-end' } },
            h('button', { type: 'button', className: 'weknora-btn', onClick: () => void load(true) }, t('picker.retry'))))
      }
      if (bases.length === 0) return emptyState(t('picker.empty.none'), t('picker.empty.noneHint'))

      const rows: unknown[] = [
        h('button', {
          key: '__all',
          type: 'button',
          className: 'weknora-row',
          role: 'option',
          'aria-selected': isAll,
          onClick: () => toggle(ALL),
        },
        h('span', { className: 'weknora-box' }),
        h('span', { className: 'weknora-row-main' },
          h('span', { className: 'weknora-row-name' },
            t('picker.all'),
            h('span', { className: 'weknora-tag' }, t('picker.all.count', { n: bases.length }))),
          h('span', { className: 'weknora-row-desc' }, t('picker.all.hint')))),
        h('div', { key: '__div', className: 'weknora-divider', role: 'presentation' }),
      ]

      if (filtered.length === 0) {
        rows.push(h('div', { key: '__none', className: 'weknora-empty', role: 'presentation' },
          h('div', { className: 't' }, t('picker.noMatch', { q: query })),
          h('button', { type: 'button', className: 'weknora-btn', onClick: () => setQuery('') }, t('picker.search.clear'))))
      }

      for (const base of filtered) {
        rows.push(h('button', {
          key: base.id,
          type: 'button',
          className: 'weknora-row',
          role: 'option',
          'aria-selected': selected.includes(base.id),
          onClick: () => toggle(base.id),
        },
        h('span', { className: 'weknora-box' }),
        h('span', { className: 'weknora-row-main' },
          h('span', { className: 'weknora-row-name' }, base.name),
          base.description === undefined || base.description === ''
            ? null
            : h('span', { className: 'weknora-row-desc' }, base.description))))
      }

      const search = bases.length >= 6 || query !== ''
        ? h('div', { key: 'search', className: 'weknora-search' },
            h('div', { className: 'weknora-field' },
              h('svg', { viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6, 'aria-hidden': 'true' },
                h('circle', { cx: 7, cy: 7, r: 4.2 }),
                h('path', { d: 'm10.2 10.2 3 3' })),
              h('input', {
                type: 'search',
                value: query,
                placeholder: t('picker.search'),
                'aria-label': t('picker.search'),
                onInput: (event: Event) => setQuery((event.target as HTMLInputElement).value),
              })))
        : null

      return h('div', { key: 'body' }, search,
        h('div', { className: 'weknora-list', role: 'listbox', 'aria-multiselectable': 'true', ref: (element: HTMLElement | null) => { listRef.current = element } }, rows))
    }

    function emptyState(title: string, hint: string): unknown {
      return h('div', { key: 'body', className: 'weknora-empty' },
        h('div', { className: 't' }, title),
        h('div', { className: 'd' }, hint),
        h('button', {
          type: 'button',
          className: 'weknora-btn is-primary',
          onClick: () => {
            close()
            if (!openSettings()) flash(t('picker.openSettingsManual'), 'err')
          },
        }, t('picker.openSettings')))
    }
  }
}

/** Arrow keys walk the rows; Space/Enter keep the native button behaviour. */
/** Arrow keys walk the rows; Home/End jump to the ends. Space/Enter are the
 *  native button activation, so they need no handler of their own. */
function moveFocus(event: KeyboardEvent): void {
  const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End']
  if (!keys.includes(event.key)) return
  // Home/End move the caret while typing; hijacking them here made the search
  // box impossible to edit with the keyboard.
  const target = event.target as HTMLElement | null
  if (target !== null && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
  const panel = event.currentTarget as HTMLElement | null
  if (panel === null) return
  const rows = [...panel.querySelectorAll('[role="option"]')] as HTMLElement[]
  if (rows.length === 0) return
  event.preventDefault()
  const index = rows.findIndex(row => row === document.activeElement)
  let next: number
  switch (event.key) {
    case 'ArrowDown':
      next = index < 0 ? 0 : Math.min(index + 1, rows.length - 1)
      break
    case 'ArrowUp':
      next = index < 0 ? rows.length - 1 : Math.max(index - 1, 0)
      break
    case 'Home':
      next = 0
      break
    default:
      next = rows.length - 1
      break
  }
  rows[next]?.focus()
}

/**
 * Jump to this plugin's settings section through the shell's settings trigger.
 *
 * The shell does not publish a stable selector for it (its labels are localized,
 * and the current build keeps Settings out of the account and "More" menus), so
 * this is a best effort that reports failure instead of swallowing it: a button
 * that does nothing is worse than a button that explains where to click.
 *
 * @returns whether an element was actually clicked.
 */
function openSettings(): boolean {
  try {
    const direct = document.querySelector(
      '[data-testid="settings-trigger"], [aria-label="设置"], [aria-label="Settings"], [title="设置"], [title="Settings"]',
    )
    if (direct instanceof HTMLElement) {
      direct.click()
      return true
    }
    // The shell's settings entry is a plain sidebar button labelled 设置 / Settings
    // (its label carries the shortcut too, so match the prefix). Restricting the
    // search to the left rail keeps us away from in-page controls with that word.
    const candidates = [...document.querySelectorAll('button, [role="button"]')]
    for (const candidate of candidates) {
      if (!(candidate instanceof HTMLElement)) continue
      const text = (candidate.textContent ?? '').trim()
      if (!/^(设置|Settings)\b/.test(text)) continue
      if (candidate.getBoundingClientRect().left > 360) continue
      candidate.click()
      return true
    }
  } catch {
    // No navigator at all: fall through to the guidance message.
  }
  return false
}
