/**
 * Browser half of dsh-weknora.
 *
 * Two contributions:
 *  - `settings.section` — the WeKnora configuration page;
 *  - `conversation.input.left` — the per-session knowledge-base picker.
 *
 * Everything here is hand-written on top of `--dsw-*` theme tokens: importing a
 * Harness client UI package is explicitly unsupported, and a component that
 * throws blanks its whole slot entry.
 */

import type { ClientContext, SlotsService } from './context.ts'
import { React } from './context.ts'
import { installStyles } from './styles.ts'
import { createBridge } from './bridge.ts'
import { createPicker } from './picker.ts'
import { createSettings } from './settings.ts'
import { createI18n } from '../i18n.ts'

export const inject = ['slots'] as const

/**
 * Register both surfaces. A missing service leaves the plugin inert rather than
 * throwing: an `apply` that rejects takes the whole bundle entry down with it.
 */
export function apply(ctx: ClientContext): void {
  const slots = ctx.get<SlotsService>('slots')
  if (slots === undefined) return

  installStyles()
  const i18n = createI18n()
  const bridge = createBridge(ctx)

  slots.inject('conversation.input.left', () => slots.register(
    { name: 'conversation.input.left', id: 'weknora-kb', order: 88, label: () => i18n.t('picker.trigger.empty') },
    createPicker({ call: bridge.call, i18n }),
  ))

  slots.inject('settings.section', () => slots.register(
    { name: 'settings.section', id: 'weknora', order: 100, label: () => i18n.t('settings.title') },
    createSettings({ call: bridge.call, i18n, ctx }),
  ))

  // The nav glyph is addressed by the same id; the shell keeps its default when
  // nothing registers one, so this is purely cosmetic.
  slots.inject('settings.section.icon', () => slots.register(
    { name: 'settings.section.icon', id: 'weknora', order: 100, label: i18n.t('settings.title') },
    SettingsIcon,
  ))
}

/** A shelf glyph, drawn with the current text colour so the shell can tint it. */
function SettingsIcon(props: { size?: number, active?: boolean }): unknown {
  const size = typeof props?.size === 'number' ? props.size : 16
  return React.createElement('svg', {
    width: size,
    height: size,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': 1.35,
    'aria-hidden': 'true',
  },
  React.createElement('rect', { x: 2, y: 3, width: 12, height: 10, rx: 1.6 }),
  React.createElement('path', { d: 'M2 6.4h12' }),
  React.createElement('path', { d: 'M5.6 6.4v6.6' }))
}
