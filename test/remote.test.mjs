import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { KnowledgeBaseCatalog } from '../dist/catalog.js'
import { LiveConfig } from '../dist/live-config.js'
import { createRemoteService } from '../dist/remote.js'
import { SecretStore } from '../dist/secrets.js'
import { SessionSelection } from '../dist/selection.js'

const BASES = [
  { id: 'kb-1', name: '产品文档', description: '' },
  { id: 'kb-2', name: '研发规范', description: '' },
]

async function harness(overrides = {}, options = {}) {
  const home = await mkdtemp(join(tmpdir(), 'dsh-weknora-remote-'))
  const selections = new SessionSelection()
  const catalog = new KnowledgeBaseCatalog()
  const live = new LiveConfig({ baseUrl: options.baseUrl ?? 'https://kb.example.com' })
  const secrets = new SecretStore(join(home, 'credentials.json'))
  const client = { listKnowledgeBases: async () => BASES }
  const service = createRemoteService({
    selection: selections,
    catalog,
    live,
    secrets,
    client,
    clientFor: () => ({ listKnowledgeBases: async () => BASES }),
    ...overrides,
  })
  return { service, selections, catalog, secrets }
}

test('a selection naming an unknown base is refused', async () => {
  const { service } = await harness()
  const result = await service.setSelection({ sessionId: 's1', knowledgeBaseIds: ['kb-ghost'] })
  assert.equal(result.ok, false)
  assert.match(result.error, /知识库不存在：kb-ghost/)
})

test('a selection without a session id is refused', async () => {
  const { service } = await harness()
  const result = await service.setSelection({ sessionId: '', knowledgeBaseIds: ['kb-1'] })
  assert.equal(result.ok, false)
  assert.match(result.error, /缺少会话标识/)
})

test('a valid selection is stored and read back per session', async () => {
  const { service } = await harness()
  const saved = await service.setSelection({ sessionId: 's1', knowledgeBaseIds: ['kb-1', 'kb-2'] })
  assert.equal(saved.ok, true)
  assert.deepEqual(saved.knowledgeBaseIds, ['kb-1', 'kb-2'])

  const read = await service.getSelection({ sessionId: 's1' })
  assert.deepEqual(read.knowledgeBaseIds, ['kb-1', 'kb-2'])

  const other = await service.getSelection({ sessionId: 's2' })
  assert.deepEqual(other.knowledgeBaseIds, [], 'a neighbour session is independent')
})

test('forgetSession drops one session only', async () => {
  const { service } = await harness()
  await service.setSelection({ sessionId: 's1', knowledgeBaseIds: ['kb-1'] })
  const forgotten = await service.forgetSession({ sessionId: 's1' })
  assert.equal(forgotten.ok, true)
  assert.equal(forgotten.forgotten, true)
  const read = await service.getSelection({ sessionId: 's1' })
  assert.deepEqual(read.knowledgeBaseIds, [])
})

test('the config status never carries the key', async () => {
  const { service, secrets } = await harness()
  await secrets.save('sk-super-secret')
  const status = await service.getConfigStatus()
  assert.equal(status.ok, true)
  assert.equal(status.hasApiKey, true)
  assert.equal(status.hasCustomAgent, false)
  assert.deepEqual(status.enabledTools.sort(), ['ask', 'listKnowledgeBases', 'readDocument', 'search'])
  const serialized = JSON.stringify(status)
  assert.doesNotMatch(serialized, /sk-super-secret/)
  assert.equal('apiKey' in status, false)
})

test('api keys save and clear through the service', async () => {
  const { service } = await harness()
  assert.equal((await service.getConfigStatus()).hasApiKey, false)

  const saved = await service.setApiKey({ apiKey: '  sk-new  ' })
  assert.equal(saved.ok, true)
  assert.equal(saved.hasApiKey, true)
  assert.equal((await service.getConfigStatus()).hasApiKey, true)

  const cleared = await service.setApiKey({ apiKey: '' })
  assert.equal(cleared.ok, true)
  assert.equal(cleared.hasApiKey, false)

  const rejected = await service.setApiKey({ apiKey: 42 })
  assert.equal(rejected.ok, false)
})

test('a connection test reports latency and count without saving anything', async () => {
  const { service } = await harness()
  const result = await service.testConnection({})
  assert.equal(result.ok, true)
  assert.equal(result.knowledgeBaseCount, 2)
  assert.equal(typeof result.latencyMs, 'number')
})

test('a malformed base URL is refused before any request', async () => {
  const { service } = await harness()
  const result = await service.testConnection({ baseUrl: 'not a url' })
  assert.equal(result.ok, false)
  assert.match(result.error, /服务地址必须是 http\(s\)/)
})

test('a listing failure keeps the previous snapshot', async () => {
  let fail = false
  const { service, catalog } = await harness()
  await service.listKnowledgeBases({ refresh: true })
  assert.deepEqual(catalog.ids(), ['kb-1', 'kb-2'])

  const flaky = createRemoteService({
    selection: new SessionSelection(),
    catalog,
    live: new LiveConfig({ baseUrl: 'https://kb.example.com' }),
    secrets: new SecretStore(join(await mkdtemp(join(tmpdir(), 'x-')), 'c.json')),
    client: { listKnowledgeBases: async () => { if (fail) throw new Error('boom'); return BASES } },
    clientFor: () => ({ listKnowledgeBases: async () => BASES }),
  })
  fail = true
  const result = await flaky.listKnowledgeBases({ refresh: true })
  assert.equal(result.ok, false)
  // The reason travels bare: the UI owns the "拉取知识库失败：" wording, so the
  // message never reads as "拉取知识库失败：拉取知识库失败：…".
  assert.equal(result.error, 'boom')
  assert.deepEqual(catalog.ids(), ['kb-1', 'kb-2'], 'the snapshot survives a failed refresh')
  assert.equal(catalog.lastError, 'boom', 'and the reason is kept for the picker')
})

test('testing an address that is not the configured one does not carry the stored key', async () => {
  const calls = []
  const { service, secrets } = await harness({
    clientFor: (baseUrl, apiKey) => ({
      listKnowledgeBases: async () => {
        calls.push({ baseUrl, apiKey })
        return BASES
      },
    }),
  })
  await secrets.save('sk-stored')
  const result = await service.testConnection({ baseUrl: 'https://other.example.com' })
  assert.equal(result.ok, true)
  assert.equal(calls.at(-1).apiKey, undefined, 'the stored key stays with the configured origin')
})

test('testing the configured address still uses the stored key', async () => {
  const calls = []
  const { service, secrets } = await harness({
    clientFor: (baseUrl, apiKey) => ({
      listKnowledgeBases: async () => {
        calls.push({ apiKey })
        return BASES
      },
    }),
  })
  await secrets.save('sk-stored')
  await service.testConnection({ baseUrl: 'https://kb.example.com' })
  assert.equal(calls.at(-1).apiKey, 'sk-stored')
})

test('an explicit key is used for a foreign address', async () => {
  const calls = []
  const { service } = await harness({
    clientFor: (baseUrl, apiKey) => ({
      listKnowledgeBases: async () => {
        calls.push({ apiKey })
        return BASES
      },
    }),
  })
  await service.testConnection({ baseUrl: 'https://other.example.com', apiKey: 'sk-typed' })
  assert.equal(calls.at(-1).apiKey, 'sk-typed')
})

test('a foreign address that rejects the anonymous probe says why', async () => {
  const { service, secrets } = await harness({
    clientFor: () => ({
      listKnowledgeBases: async () => {
        throw Object.assign(new Error('GET /knowledge-bases failed with HTTP 401: invalid api key'), { status: 401 })
      },
    }),
  })
  await secrets.save('sk-stored')
  const result = await service.testConnection({ baseUrl: 'https://other.example.com' })
  assert.equal(result.ok, false)
  assert.match(result.error, /未转发已保存的 API Key/)
})

test('setApiKey without a key is refused instead of clearing', async () => {
  const { service, secrets } = await harness()
  await service.setApiKey({ apiKey: 'sk-1' })
  assert.equal(secrets.has(), true)
  const malformed = await service.setApiKey({})
  assert.equal(malformed.ok, false)
  assert.equal(secrets.has(), true, 'a malformed call must not destroy the credential')
  const cleared = await service.setApiKey({ apiKey: '' })
  assert.equal(cleared.ok, true)
  assert.equal(secrets.has(), false)
})

test('an oversized session id is refused rather than stored', async () => {
  const { service } = await harness()
  const result = await service.getSelection({ sessionId: 'x'.repeat(500) })
  assert.equal(result.ok, false)
  assert.match(result.error, /会话标识过长/)
})

test('a fresh install reports needsSetup instead of a probe failure', async () => {
  const { service } = await harness({}, { baseUrl: 'http://localhost:8080/api/v1' })
  const view = await service.getSelection({ sessionId: 's1' })
  assert.equal(view.ok, true)
  // Nothing configured: the picker must explain that, not report the default
  // address as a broken deployment.
  assert.equal(view.needsSetup, true)
})

test('the plugin stops asking for setup once it has an address or a key', async () => {
  const keyed = await harness({}, { baseUrl: 'http://localhost:8080/api/v1' })
  await keyed.secrets.save('sk-1')
  assert.equal((await keyed.service.getSelection({ sessionId: 's1' })).needsSetup, false)

  const custom = await harness()
  assert.equal((await custom.service.getSelection({ sessionId: 's1' })).needsSetup, false)
})
