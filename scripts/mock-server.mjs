/**
 * Boot the mock WeKnora backend for a manual GUI check.
 *
 * Prints the base URL it bound to, then stays up: the isolated dsh instance is
 * configured with that URL so the picker has real knowledge bases to list.
 *
 * A second, tiny HTTP server on `--control` lets a shell drive the states the
 * picker has to survive without restarting anything: fail a route, slow it down,
 * or change how many knowledge bases the deployment serves. That is what makes
 * the state-matrix screenshots repeatable instead of hand-staged.
 *
 *   node scripts/mock-server.mjs --bases 12 --control 59300
 *   curl -X POST "http://127.0.0.1:59300/fail?path=/knowledge-bases&status=500"
 *   curl -X POST "http://127.0.0.1:59300/clear"
 *   curl -X POST "http://127.0.0.1:59300/latency?ms=1500"
 *   curl -X POST "http://127.0.0.1:59300/bases?count=0"
 */
import { createServer } from 'node:http'

import { startMockWeknora } from '../test/helpers/mock-weknora.mjs'

const arg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? fallback : process.argv[index + 1]
}

const mock = await startMockWeknora({
  baseCount: Number(arg('bases', '0')) || undefined,
  onlyBases: arg('only') === undefined ? undefined : arg('only').split(',').filter(Boolean),
  delayMs: Number(arg('delay', '0')) || undefined,
  port: Number(arg('port', '0')) || undefined,
})
// The tests read `mock.url` directly; a shell needs it on stdout.
process.stdout.write(`MOCK_URL=${mock.url}\n`)

const controlPort = Number(arg('control', '0'))
if (controlPort > 0) {
  createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    const reply = (body) => {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify(body))
    }
    switch (url.pathname) {
      case '/clear':
        mock.reset()
        reply({ ok: true })
        return
      case '/fail':
        mock.fail(url.searchParams.get('path') ?? '/knowledge-bases', Number(url.searchParams.get('status') ?? '500'))
        reply({ ok: true, failures: mock.failures() })
        return
      case '/latency':
        mock.setDelay(Number(url.searchParams.get('ms') ?? '0'))
        reply({ ok: true })
        return
      case '/bases':
        mock.setBaseCount(Number(url.searchParams.get('count') ?? '0'))
        reply({ ok: true, baseCount: mock.baseCount() })
        return
      case '/requests':
        reply({ paths: mock.requests.map(entry => `${entry.method} ${entry.path}`) })
        return
      default:
        response.writeHead(404).end()
    }
  }).listen(controlPort, '127.0.0.1')
  process.stdout.write(`CONTROL=http://127.0.0.1:${controlPort}\n`)
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => { void mock.close().then(() => process.exit(0)) })
}
