/**
 * Capture the dark-theme matrix and measure its contrast, without touching the
 * machine's system theme.
 *
 * The shell switches palette with `@media (prefers-color-scheme: dark)` and does
 * not respond to a `data-ds-theme` attribute (verified), so the only way to see
 * dark is to emulate the media feature. A private headless Chrome with
 * `Emulation.setEmulatedMedia` does exactly that, and keeps the user's desktop
 * appearance out of it.
 *
 *   node scripts/dark-matrix.mjs --url http://127.0.0.1:60013 --token <token>
 *
 * Writes `.research/picker-dark-{unselected,selected,error}.png` and prints the
 * contrast of every label in the panel.
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const args = process.argv.slice(2)
const argOf = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index === -1 ? fallback : args[index + 1]
}

const appUrl = argOf('url', 'http://127.0.0.1:60013')
const token = argOf('token', '')
const controlUrl = argOf('control', 'http://127.0.0.1:59300')
const sessionId = argOf('session', '')
const port = Number(argOf('port', '9333'))

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  join(process.env.LOCALAPPDATA ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
]
const browserPath = CHROME_CANDIDATES.find(candidate => candidate !== '' && existsSync(candidate))
if (browserPath === undefined) {
  console.error('no Chrome/Edge found; pass a path by editing CHROME_CANDIDATES')
  process.exit(2)
}

const profileDir = join(process.env.TEMP ?? '.', `wk-dark-profile-${Date.now()}`)
const child = spawn(browserPath, [
  '--headless=new',
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profileDir}`,
  '--hide-scrollbars',
  '--force-device-scale-factor=1',
  '--window-size=1280,900',
  'about:blank',
], { stdio: 'ignore' })

let sequence = 0
const pending = new Map()

async function waitForDevtools() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`)
      if (response.ok) return
    } catch {
      // not up yet
    }
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  throw new Error('devtools endpoint never came up')
}

await waitForDevtools()

const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const page = targets.find(entry => entry.type === 'page')
if (page === undefined) throw new Error('no page target')

const socket = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true })
  socket.addEventListener('error', reject, { once: true })
})

socket.addEventListener('message', event => {
  const payload = JSON.parse(event.data)
  const waiter = pending.get(payload.id)
  if (waiter === undefined) return
  pending.delete(payload.id)
  if (payload.error !== undefined) waiter.reject(new Error(payload.error.message))
  else waiter.resolve(payload.result)
})

function send(method, params = {}) {
  const id = ++sequence
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params }))
  })
}

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  })
  if (result.exceptionDetails !== undefined) {
    throw new Error(result.exceptionDetails.exception?.description ?? 'evaluate failed')
  }
  return result.result.value
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

async function shot(file) {
  const { data } = await send('Page.captureScreenshot', { format: 'png' })
  mkdirSync('.research', { recursive: true })
  writeFileSync(join('.research', file), Buffer.from(data, 'base64'))
  return file
}

await send('Page.enable')
await send('Runtime.enable')
await send('Emulation.setEmulatedMedia', {
  features: [{ name: 'prefers-color-scheme', value: 'dark' }],
})

const startUrl = token === '' ? appUrl : `${appUrl}/?token=${token}`
await send('Page.navigate', { url: startUrl })
await wait(6000)

// The app restores the last session id from localStorage; pin it so the picker mounts.
if (sessionId !== '') {
  await evaluate(`localStorage.setItem('dsh.sessions.current', ${JSON.stringify(JSON.stringify({ sessionId }))})`)
}
await send('Page.navigate', { url: startUrl })
await wait(7000)

const closeDialogs = async () => {
  await evaluate(`(() => {
    for (const button of document.querySelectorAll('[role=dialog] button[aria-label]')) button.click()
    return true
  })()`)
  await wait(400)
}

async function openPicker() {
  await evaluate(`(() => { const chip = document.querySelector('.weknora-chip'); if (chip) chip.click(); return true })()`)
  await wait(1200)
}

async function control(path) {
  try {
    await fetch(`${controlUrl}${path}`, { method: 'POST' })
  } catch (error) {
    console.error(`control ${path} failed: ${error.message}`)
  }
}

const captured = []

await closeDialogs()
await control('/clear')
await control('/bases?count=12')
await openPicker()

const dark = await evaluate(`(() => {
  const panel = document.querySelector('.weknora-panel')
  if (panel === null) return null
  const texts = []
  for (const element of panel.querySelectorAll('*')) {
    if (element.children.length !== 0) continue
    const text = (element.textContent || '').trim()
    if (text === '') continue
    const style = getComputedStyle(element)
    const backgrounds = []
    let node = element
    while (node !== null && backgrounds.length < 5) {
      const fill = getComputedStyle(node).backgroundColor
      if (fill !== 'rgba(0, 0, 0, 0)' && fill !== 'transparent') backgrounds.push(fill)
      node = node.parentElement
    }
    texts.push({ cls: String(element.className || element.tagName), text: text.slice(0, 16), color: style.color, size: style.fontSize, backgrounds })
  }
  const surface = getComputedStyle(panel)
  return {
    scheme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
    fill: surface.backgroundColor,
    backdrop: surface.backdropFilter,
    shadow: surface.boxShadow,
    bodyBackground: getComputedStyle(document.body).backgroundColor,
    rows: panel.querySelectorAll('[role="option"]').length,
    texts,
  }
})()`)

if (dark === null) throw new Error('picker did not open')
captured.push(await shot('picker-dark-unselected.png'))

// selected state
await evaluate(`(() => {
  const rows = [...document.querySelectorAll('.weknora-panel [role="option"]')]
  rows[1]?.click()
  rows[2]?.click()
  return true
})()`)
await wait(900)
captured.push(await shot('picker-dark-selected.png'))

// failure state
await control('/fail?path=/api/v1/knowledge-bases&status=500')
await evaluate(`(() => { const x = document.querySelector('.weknora-panel .weknora-x'); if (x) x.click(); return true })()`)
await wait(300)
await openPicker()
captured.push(await shot('picker-dark-error.png'))
await control('/clear')

// ── contrast, same rules as the light audit ────────────────────────────────
const hex = value => {
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
const lum = rgb => {
  const linear = rgb.map(channel => (channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4))
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
}
const contrast = (a, b) => {
  const [bright, dark] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (bright + 0.05) / (dark + 0.05)
}

const fill = hex(dark.fill)
const body = hex(dark.bodyBackground) ?? [0, 0, 0, 1]
let backdrop = over(fill, body.slice(0, 3))
const rowsMeasured = []
for (const entry of dark.texts) {
  const colour = hex(entry.color)
  if (colour === undefined) continue
  const size = Number.parseFloat(String(entry.size))
  const isIcon = /^[\u2000-\u2BFF\u25A0-\u27BF\u00D7\u2715\u2716]+$/u.test(String(entry.text).trim())
  const threshold = isIcon ? 3 : (size >= 18.66 ? 3 : 4.5)
  let background = backdrop
  for (const layerText of [...entry.backgrounds].reverse()) {
    const layer = hex(layerText)
    if (layer === undefined) continue
    background = over([...layer.slice(0, 3), layer[3]], background)
  }
  rowsMeasured.push({ ...entry, size, threshold, ratio: contrast(over(colour, background), background) })
}
const failing = rowsMeasured.filter(entry => entry.ratio < entry.threshold)
const worst = rowsMeasured.reduce((low, entry) => (entry.ratio / entry.threshold < low.ratio / low.threshold ? entry : low), rowsMeasured[0])

console.log(`scheme=${dark.scheme} rows=${dark.rows}`)
console.log(`surface=${dark.fill} backdrop=${dark.backdrop}`)
console.log(`elevation=${String(dark.shadow).slice(0, 60)}`)
console.log(`labels measured=${rowsMeasured.length} worst(relative)=${worst.ratio.toFixed(2)}:1 (${worst.cls}, ${worst.size}px)`)
for (const entry of failing.slice(0, 5)) {
  console.log(`FAIL ${entry.cls} "${entry.text}" ${entry.ratio.toFixed(2)}:1 < ${entry.threshold}`)
}
console.log(`screenshots: ${captured.join(', ')}`)

socket.close()
child.kill()
process.exit(failing.length === 0 && dark.scheme === 'dark' ? 0 : 1)
