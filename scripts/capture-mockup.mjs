/**
 * Regenerate `.research/ui-mockup.html` from the running GUI.
 *
 * The mockup drifted from the implementation once already (it still showed the
 * single-name trigger and no footer status slot), so it is no longer drawn by
 * hand: this pulls the plugin's own stylesheet and the live DOM for each surface
 * and writes them into one static page. Run it against a tab that has the picker
 * open:
 *
 *   node scripts/capture-mockup.mjs --target <cdp target id>
 *
 * The light palette is resolved from the live page and inlined, so the file
 * renders without the shell. Dark is covered by the archived screenshots and by
 * the token table in `docs/dsh-menu-surface-guide.md` — re-implementing the whole
 * `--dsw-*` dark set here would be a second source of truth to drift.
 */

import { writeFileSync } from 'node:fs'

const args = process.argv.slice(2)
const argOf = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index === -1 ? fallback : args[index + 1]
}

const proxy = argOf('url', 'http://localhost:3456')
const target = argOf('target', '')
if (target === '') {
  console.error('usage: node scripts/capture-mockup.mjs --target <id>')
  process.exit(2)
}

async function evaluate(expression) {
  const response = await fetch(`${proxy}/eval?target=${target}`, { method: 'POST', body: expression })
  const result = await response.json()
  if (result.error !== undefined) throw new Error(String(result.error))
  return JSON.parse(result.value)
}

/** Tokens the stylesheet reads; resolved so the page needs no shell. */
const TOKENS = [
  '--dsw-alias-bg-base', '--dsw-alias-bg-layer-2', '--dsw-alias-label-primary',
  '--dsw-alias-label-secondary', '--dsw-alias-label-tertiary', '--dsw-alias-label-quaternary',
  '--dsw-menu-surface-fill', '--dsw-alias-menu-group-header-fill', '--dsw-alias-brand-primary',
  '--dsw-elevation-prominent',
]

const captured = await evaluate(`(() => {
  const style = [...document.querySelectorAll('style')]
    .map(node => node.textContent || '')
    .find(text => text.includes('.weknora-')) || ''
  const panel = document.querySelector('.weknora-panel')
  const root = document.querySelector('.weknora-root')
  const trigger = root === null ? null : root.querySelector('button')
  const body = getComputedStyle(document.body)
  const tokens = {}
  for (const name of ${JSON.stringify(TOKENS)}) tokens[name] = body.getPropertyValue(name).trim()
  const icon = document.querySelector('svg[data-weknora-icon]')
  return JSON.stringify({
    style,
    panel: panel === null ? '' : panel.outerHTML,
    trigger: trigger === null ? '' : trigger.outerHTML,
    tokens,
    lang: document.documentElement.lang,
    rows: panel === null ? 0 : panel.querySelectorAll('[role="option"]').length,
  })
})()`)

if (captured.panel === '') {
  console.error('the picker is not open; open it first so the panel can be captured')
  process.exit(2)
}

const tokenBlock = Object.entries(captured.tokens)
  .map(([name, value]) => `  ${name}: ${value === '' ? '/* shell default */' : value};`)
  .join('\n')

const html = `<!doctype html>
<html lang="${captured.lang || 'zh-CN'}">
<head>
<meta charset="utf-8">
<title>dsh-weknora UI mockup (generated)</title>
<!--
  GENERATED FILE — do not hand-edit.

  Everything below the palette block is the plugin's own stylesheet and the live
  DOM captured from a running dsh web GUI, so this page cannot drift from the
  implementation the way a hand-drawn mockup does. Regenerate with:

      node scripts/capture-mockup.mjs --target <cdp target id>

  Light palette was resolved from the page at capture time. Dark is documented by
  docs/assets/gui/*.png and the token table in docs/dsh-menu-surface-guide.md.
-->
<style>
:root {
${tokenBlock}
  --mock-bg: var(--dsw-alias-bg-base, #fff);
}
body {
  margin: 0; padding: 28px; background: var(--mock-bg);
  font: 13px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
  color: var(--dsw-alias-label-primary, #0f1115);
}
.mock-title { font-size: 12px; font-weight: 600; opacity: .55; margin: 26px 0 8px; letter-spacing: .04em; text-transform: uppercase; }
.mock-note { font-size: 12px; opacity: .6; margin: 0 0 18px; }
.mock-row { display: flex; gap: 14px; align-items: flex-start; flex-wrap: wrap; }
.mock-stage { position: relative; min-height: 320px; }
/* the real panel is fixed-positioned; give it a local box so it can be shown inline */
.mock-stage .weknora-panel { position: relative !important; inset: auto !important; left: auto !important; bottom: auto !important; }
${captured.style}
</style>
</head>
<body>
<h1 style="font-size:16px;margin:0 0 4px">dsh-weknora — 界面快照（由运行中的 GUI 直接抓取）</h1>
<p class="mock-note">触发器三态、多选面板（本次抓取到 ${captured.rows} 行）、设置页。样式与 DOM 均来自实现本身。</p>

<div class="mock-title">触发器 · 同一按钮的三种 data-state（未选择 / 已选 / 告警）</div>
<div class="mock-row" id="triggers"></div>

<div class="mock-title">多选面板</div>
<div class="mock-stage" id="panel"></div>

<script>
  // The captured markup is inert: strip the handlers the shell bound by cloning.
  const trigger = document.createElement('div')
  trigger.innerHTML = ${JSON.stringify(captured.trigger)}
  document.getElementById('triggers').append(trigger)

  const panel = document.createElement('div')
  panel.innerHTML = ${JSON.stringify(captured.panel)}
  document.getElementById('panel').append(panel)

  // Show the other two trigger states by relabelling the same node: the states
  // differ only in the count badge and the state attribute.
  const button = trigger.querySelector('button')
  if (button !== null) {
    const copy = button.cloneNode(true)
    copy.dataset.state = 'on'
    const badge = copy.querySelector('.weknora-n, .weknora-count, .weknora-badge')
    if (badge !== null) badge.textContent = '2'
    document.getElementById('triggers').append(copy)

    const warn = button.cloneNode(true)
    warn.dataset.state = 'warn'
    document.getElementById('triggers').append(warn)
  }
</script>
</body>
</html>
`

writeFileSync('.research/ui-mockup.html', html)
console.log(`wrote .research/ui-mockup.html (${html.length} bytes, ${captured.rows} rows, ${Object.keys(captured.tokens).length} tokens)`)
