import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

import { UNGATED_HINT, apply } from '../dist/index.js'
import { startMockWeknora } from './helpers/mock-weknora.mjs'

/**
 * A minimal harness: the real plugin against a mock WeKnora, with a temporary
 * harness home so nothing touches the user's credentials file.
 */
async function mount() {
  const home = await mkdtemp(join(tmpdir(), 'dsh-weknora-home-'))
  const mock = await startMockWeknora()
  after(() => mock.close())
  process.env.DSH_HOME = home

  const warnings = []
  const registrations = new Map()
  const listeners = new Map()
  const services = new Map()
  const contexts = new Map()

  const ctx = {
    tools: {
      register(definition, options) {
        registrations.set(definition.name, { definition, options })
        return () => registrations.delete(definition.name)
      },
    },
    logger: {
      info: () => {},
      warn: (...args) => warnings.push(args.join(' ')),
    },
    on(event, listener) {
      listeners.set(event, listener)
      return () => listeners.delete(event)
    },
    effect(run) {
      run()
    },
    get(key) {
      if (key !== 'systemPrompt') return undefined
      return {
        context(entry) {
          contexts.set(entry.name, entry)
          return () => contexts.delete(entry.name)
        },
      }
    },
    provide(key, value) {
      services.set(key, value)
    },
  }

  apply(ctx, { baseUrl: mock.url, requestTimeoutMs: 2000 })

  const remote = services.get('weknora')
  // `apply` warms the catalogue in the background; wait for it without sleeping.
  for (let attempt = 0; attempt < 400; attempt++) {
    const status = await remote.getConfigStatus()
    if (status.ok === true && status.knowledgeBaseCount > 0) break
    await new Promise(resolve => setTimeout(resolve, 10))
  }

  const warmed = await remote.getConfigStatus()
  assert.ok(warmed.ok === true && warmed.knowledgeBaseCount > 0, 'the catalogue must warm before the assertions')
  return { ctx, mock, remote, registrations, listeners, contexts, warnings }
}

test('every enabled tool registers once, with a condition', async () => {
  const { registrations } = await mount()
  assert.deepEqual([...registrations.keys()].sort(), [
    'weknora_ask',
    'weknora_list_knowledge_bases',
    'weknora_read_document',
    'weknora_search',
  ])
  for (const { options } of registrations.values()) {
    assert.equal(typeof options.when, 'function', 'each tool needs an activation condition')
  }
})

test('the condition hides every tool until the session selects a base', async () => {
  const { registrations } = await mount()
  const search = registrations.get('weknora_search')
  // Synchronous, boolean, and tolerant of an absent agent: a rejection here
  // would end the model step with TOOL_ACTIVATION_FAILED.
  const verdict = search.options.when({})
  assert.equal(typeof verdict, 'boolean')
  assert.equal(verdict, false)
  assert.equal(search.options.when({ agent: { id: 'session-a' } }), false)
})

test('selecting a base turns the tools on for that session only', async () => {
  const { registrations, remote } = await mount()
  const search = registrations.get('weknora_search')
  const saved = await remote.setSelection({ sessionId: 'session-a', knowledgeBaseIds: ['kb-product'] })
  assert.equal(saved.ok, true)

  assert.equal(search.options.when({ agent: { id: 'session-a' } }), true)
  assert.equal(search.options.when({ agent: { id: 'session-b' } }), false, 'a neighbour stays untouched')
})

test('clearing the selection turns the tools back off', async () => {
  const { registrations, remote } = await mount()
  const search = registrations.get('weknora_search')
  await remote.setSelection({ sessionId: 'session-a', knowledgeBaseIds: ['kb-product'] })
  assert.equal(search.options.when({ agent: { id: 'session-a' } }), true)

  await remote.setSelection({ sessionId: 'session-a', knowledgeBaseIds: [] })
  assert.equal(search.options.when({ agent: { id: 'session-a' } }), false)
})

test('a disposed session loses its selection', async () => {
  const { registrations, remote, listeners } = await mount()
  const search = registrations.get('weknora_search')
  await remote.setSelection({ sessionId: 'session-a', knowledgeBaseIds: ['kb-product'] })
  assert.equal(search.options.when({ agent: { id: 'session-a' } }), true)

  listeners.get('agent/disposed')({ agent: { id: 'session-a' } })
  // Previously selected, now missing → and with two bases visible the missing
  // state re-initializes to empty rather than auto-selecting.
  assert.equal(search.options.when({ agent: { id: 'session-a' } }), false)
})

test('the hint is registered, truthful in both states, and switchable', async () => {
  const { contexts } = await mount()
  const entry = contexts.get('dsh-weknora-hint')
  assert.ok(entry, 'the unselected hint must exist')
  assert.equal(typeof entry.text, 'function')
  assert.equal(entry.text({}), UNGATED_HINT)
  // The wording is conditional, so it stays honest while tools are visible.
  assert.match(UNGATED_HINT, /若本轮工具列表中没有 weknora_\*/)
})

test('the client-facing service is provided', async () => {
  const { remote } = await mount()
  for (const method of ['getSelection', 'setSelection', 'listKnowledgeBases', 'testConnection', 'getConfigStatus', 'forgetSession']) {
    assert.equal(typeof remote[method], 'function', `${method} must be callable from the client`)
  }
})

test('a legacy config.apiKey is reported once and does not fail the load', async () => {
  const mock = await startMockWeknora()
  after(() => mock.close())
  const warnings = []
  const ctx = {
    tools: { register: () => () => {} },
    logger: { info: () => {}, warn: (...args) => warnings.push(args.join(' ')) },
  }
  apply(ctx, { baseUrl: mock.url, apiKey: 'legacy-key' })
  const legacy = warnings.filter(line => line.includes('config.apiKey'))
  assert.equal(legacy.length, 1)
  assert.match(legacy[0], /设置 → WeKnora 知识库/)
})

test('the declared schema covers the settings surface and never the key', async () => {
  const { Config } = await import('../dist/index.js')
  const described = JSON.stringify(Config)
  for (const field of ['baseUrl', 'tenantId', 'maxResults', 'maxChunkChars', 'requestTimeoutMs', 'chatTimeoutMs', 'resourceUrls', 'toolPrefix', 'agentId', 'tools', 'hintWhenUnselected']) {
    assert.match(described, new RegExp(`"${field}"`), `${field} must be described`)
  }
  assert.doesNotMatch(described, /apiKey/, 'the key must not be a config field')
})
