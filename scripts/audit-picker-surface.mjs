/**
 * Measure the picker's floating surface in the live GUI and check the two things
 * a floating menu can silently get wrong:
 *
 *   1. it must not let the text underneath show through — a fill paired with a
 *      `backdrop-filter` blur, plus a real elevation;
 *   2. its small type must stay readable — every label has to clear its WCAG
 *      floor against the colour the surface actually composites to, not against
 *      pure white.
 *
 * Usage (needs the CDP proxy from the GUI session this plugin runs in):
 *   node scripts/audit-picker-surface.mjs [--target <id>] [--url http://localhost:3456]
 *
 * Exits non-zero when a check fails, so it can be wired into CI later.
 */

const args = process.argv.slice(2)
const argOf = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index === -1 ? fallback : args[index + 1]
}

const proxy = argOf('url', 'http://localhost:3456')
let target = argOf('target', '')

async function call(path, body) {
  const separator = path.includes('?') ? '&' : '?'
  const response = await fetch(`${proxy}${path}${separator}target=${target}`, {
    method: body === undefined ? 'GET' : 'POST',
    body,
  })
  return await response.json()
}

async function evaluate(expression) {
  const result = await call('/eval', expression)
  if (result.error !== undefined) throw new Error(String(result.error))
  return JSON.parse(result.value)
}

if (target === '') {
  const listed = await (await fetch(`${proxy}/targets`)).json()
  const first = Array.isArray(listed.targets) ? listed.targets[0] : undefined
  if (first === undefined) {
    console.error('no CDP target; pass --target <id>')
    process.exit(2)
  }
  target = first.id ?? first.targetId
}

/** Parse `rgb()` / `rgba()` / `color(srgb …)` into [r, g, b, a] on 0..1. */
function parseColor(value) {
  const text = String(value).trim()
  const leading = text.match(/^rgba?\(([^)]+)\)$/i)
  if (leading !== null) {
    const parts = leading[1].split(/[\s,/]+/).filter(Boolean).map(Number)
    return [parts[0] / 255, parts[1] / 255, parts[2] / 255, parts[3] === undefined ? 1 : parts[3]]
  }
  const modern = text.match(/^color\(srgb\s+([^)]+)\)$/i)
  if (modern !== null) {
    const parts = modern[1].split(/[\s/]+/).filter(Boolean).map(Number)
    return [parts[0], parts[1], parts[2], parts[3] === undefined ? 1 : parts[3]]
  }
  return undefined
}

const over = (top, bottom) => top.slice(0, 3).map((channel, index) => channel * top[3] + bottom[index] * (1 - top[3]))

const luminance = rgb => {
  const linear = rgb.map(channel => (channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4))
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
}

const contrast = (a, b) => {
  const [bright, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (bright + 0.05) / (dark + 0.05)
}

const measurements = await evaluate(`(() => {
  const panel = document.querySelector('.weknora-panel')
  if (panel === null) return JSON.stringify({ open: false })
  const pick = (element) => {
    const style = getComputedStyle(element)
    return {
      background: style.backgroundColor,
      backdrop: style.backdropFilter || style.webkitBackdropFilter || 'none',
      shadow: style.boxShadow,
      border: style.borderColor,
      radius: style.borderTopLeftRadius,
      position: style.position,
      zIndex: style.zIndex,
    }
  }
  const row = panel.querySelector('[role="option"]')
  // Every leaf node that renders text: contrast is a property of what the user
  // reads, not of the one element somebody remembered to measure.
  const texts = []
  for (const element of panel.querySelectorAll('*')) {
    if (element.children.length !== 0) continue
    const text = (element.textContent || '').trim()
    if (text === '') continue
    const style = getComputedStyle(element)
    // Nearest-first list of the fills this text actually sits on: a primary
    // button paints its own accent background, so the panel is not the backdrop.
    const backgrounds = []
    let node = element
    while (node !== null && backgrounds.length < 5) {
      const fill = getComputedStyle(node).backgroundColor
      if (fill !== 'rgba(0, 0, 0, 0)' && fill !== 'transparent') backgrounds.push(fill)
      node = node.parentElement
    }
    texts.push({
      cls: String(element.className || element.tagName),
      text: text.slice(0, 18),
      color: style.color,
      size: style.fontSize,
      backgrounds,
    })
  }
  const bodyStyle = getComputedStyle(document.body)
  return JSON.stringify({
    open: true,
    theme: document.documentElement.getAttribute('data-ds-theme-source') || 'unknown',
    dark: document.documentElement.getAttribute('data-ds-theme') === 'dark'
      || document.body.getAttribute('data-ds-theme') === 'dark',
    bodyBackground: bodyStyle.backgroundColor,
    surface: pick(panel),
    header: pick(panel.querySelector('header') || panel.firstElementChild),
    footer: (() => { const foot = panel.querySelector('.weknora-foot'); return foot === null ? null : pick(foot) })(),
    row: row === null ? null : pick(row),
    texts,
    rows: panel.querySelectorAll('[role="option"]').length,
  })
})()`)

if (measurements.open !== true) {
  console.error('the picker panel is not open; open it before running the audit')
  process.exit(2)
}

const failures = []
const report = []
const check = (name, ok, detail) => {
  report.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : ` — ${detail}`}`)
  if (!ok) failures.push(name)
}

const { surface, header, footer, row } = measurements
const fill = parseColor(surface.background)
const body = parseColor(measurements.bodyBackground) ?? [1, 1, 1, 1]

check('surface is opaque enough to carry small text', fill[3] >= 0.6, `fill alpha ${fill[3]}`)
check('surface and backdrop-filter come as a pair', fill[3] < 1 ? surface.backdrop !== 'none' : true,
  `backdrop ${surface.backdrop}`)
check('surface has a real elevation', surface.shadow !== 'none' && surface.shadow !== '', surface.shadow.slice(0, 60))
check('surface is positioned and stacked', surface.position === 'fixed' || surface.position === 'absolute',
  `${surface.position} z=${surface.zIndex}`)
if (header !== null) {
  const headerFill = parseColor(header.background)
  check('header carries its own fill', headerFill !== undefined && headerFill[3] > 0, header.background)
}
if (footer !== null) {
  const footerFill = parseColor(footer.background)
  check('footer carries its own fill', footerFill !== undefined && footerFill[3] > 0, footer.background)
}
if (row !== null) {
  const rowFill = parseColor(row.background)
  check('a row never paints over the surface alpha', rowFill[3] === 0 || rowFill[3] >= 0.5, row.background)
}

// Contrast against what the surface composites to, not against pure white.
const composited = over(fill, body.slice(0, 3))
const measured = []
for (const entry of measurements.texts) {
  const colour = parseColor(entry.color)
  if (colour === undefined) continue
  const size = Number.parseFloat(String(entry.size))
  // A lone glyph is a control, not prose: WCAG 1.4.11 asks 3:1 for those.
  const isIcon = /^[\u2000-\u2BFF\u25A0-\u27BF\u00D7\u2715\u2716]+$/u.test(String(entry.text).trim())
  const threshold = isIcon ? 3 : (size >= 18.66 ? 3 : 4.5)
  // Walk the chain outward: each layer paints over the ones already resolved.
  let backdrop = composited
  for (const fill of [...entry.backgrounds].reverse()) {
    const layer = parseColor(fill)
    if (layer === undefined) continue
    backdrop = over([...layer.slice(0, 3), layer[3]], backdrop)
  }
  measured.push({ ...entry, size, threshold, ratio: contrast(over(colour, backdrop), backdrop) })
}
const failing = measured
  .filter(entry => entry.ratio < entry.threshold)
  .sort((left, right) => left.ratio - right.ratio)
check('every label clears its size threshold', failing.length === 0,
  failing.length === 0
    ? `${measured.length} labels, worst ${Math.min(...measured.map(entry => entry.ratio)).toFixed(2)}:1`
    : failing.slice(0, 3)
      .map(entry => `"${entry.text}" (${entry.cls}, ${entry.size}px) ${entry.ratio.toFixed(2)}:1 < ${entry.threshold}`)
      .join('; '))

console.log(`theme=${measurements.theme} dark=${measurements.dark} rows=${measurements.rows}`)
for (const line of report) console.log(line)
process.exit(failures.length === 0 ? 0 : 1)
