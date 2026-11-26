import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ALL_KNOWLEDGE_BASES, SessionSelection } from '../dist/selection.js'
import { withSessionScope } from '../dist/scope.js'

/** A stub tool that records the arguments its body received. */
function stub(name, seen) {
  return {
    name,
    description: 'stub',
    parameters: { type: 'object', properties: {} },
    output: { schema: { type: 'object' }, render: () => [] },
    async execute(args) {
      seen.args = args
      return { ok: true }
    },
  }
}

function wiring(selection, available, hasCustomAgent = false) {
  return {
    selection,
    available: () => available,
    askUsesCustomAgent: () => hasCustomAgent,
  }
}

test('search receives the session selection when the model names nothing', async () => {
  const selection = new SessionSelection()
  selection.set('s1', ['kb-a'])
  const seen = {}
  const tool = withSessionScope(stub('weknora_search', seen), wiring(selection, ['kb-a', 'kb-b']))
  await tool.execute({ query: 'x' }, { signal: new AbortController().signal, agent: { id: 's1' } })
  assert.deepEqual(seen.args.knowledge_base_ids, ['kb-a'])
})

test('a named base the session did not select is refused, not widened', async () => {
  const selection = new SessionSelection()
  selection.set('s1', ['kb-a'])
  const seen = {}
  const tool = withSessionScope(stub('weknora_search', seen), wiring(selection, ['kb-a', 'kb-b']))
  // The tool body reads a missing/empty knowledge_base_ids as "no restriction",
  // so narrowing to [] would have searched every base. It must refuse instead.
  await assert.rejects(
    tool.execute({ query: 'x', knowledge_base_ids: ['kb-b'] }, { signal: new AbortController().signal, agent: { id: 's1' } }),
    /不在本次会话已选范围内/,
  )
  assert.equal(seen.args, undefined, 'the backend was never called')
})

test('a tool reached with no selection refuses instead of searching everything', async () => {
  const selection = new SessionSelection()
  const seen = {}
  const tool = withSessionScope(stub('weknora_search', seen), wiring(selection, ['kb-a', 'kb-b']))
  await assert.rejects(
    tool.execute({ query: 'x' }, { signal: new AbortController().signal, agent: { id: 's1' } }),
    /尚未选择知识库/,
  )
  assert.equal(seen.args, undefined)
})

test('a cold catalogue leaves the session unselected, so the call is refused', async () => {
  const selection = new SessionSelection()
  selection.set('s1', [ALL_KNOWLEDGE_BASES])
  const seen = {}
  // Select-all with a cold catalogue resolves to nothing; that must not turn into
  // "search everything" either.
  const tool = withSessionScope(stub('weknora_search', seen), wiring(selection, []))
  await assert.rejects(
    tool.execute({ query: 'x' }, { signal: new AbortController().signal, agent: { id: 's1' } }),
    /尚未选择知识库/,
  )
  assert.equal(seen.args, undefined)
})

test('a named base the session selected is kept', async () => {
  const selection = new SessionSelection()
  selection.set('s1', ['kb-a', 'kb-b'])
  const seen = {}
  const tool = withSessionScope(stub('weknora_search', seen), wiring(selection, ['kb-a', 'kb-b']))
  await tool.execute({ query: 'x', knowledge_base_ids: ['kb-b'] }, { signal: new AbortController().signal, agent: { id: 's1' } })
  assert.deepEqual(seen.args.knowledge_base_ids, ['kb-b'])
})

test('select-all expands to every visible base', async () => {
  const selection = new SessionSelection()
  selection.set('s1', [ALL_KNOWLEDGE_BASES])
  const seen = {}
  const tool = withSessionScope(stub('weknora_search', seen), wiring(selection, ['kb-a', 'kb-b']))
  await tool.execute({ query: 'x' }, { signal: new AbortController().signal, agent: { id: 's1' } })
  assert.deepEqual(seen.args.knowledge_base_ids, ['kb-a', 'kb-b'])
})

test('document ids are left as the scope', async () => {
  const selection = new SessionSelection()
  selection.set('s1', ['kb-a'])
  const seen = {}
  const tool = withSessionScope(stub('weknora_search', seen), wiring(selection, ['kb-a']))
  await tool.execute({ query: 'x', knowledge_ids: ['doc-1'] }, { signal: new AbortController().signal, agent: { id: 's1' } })
  assert.equal(seen.args.knowledge_base_ids, undefined)
})

test('a custom agent resolves its own scope, so ask is left untouched', async () => {
  const selection = new SessionSelection()
  selection.set('s1', ['kb-a'])
  const seen = {}
  const tool = withSessionScope(stub('weknora_ask', seen), wiring(selection, ['kb-a'], true))
  await tool.execute({ query: 'x' }, { signal: new AbortController().signal, agent: { id: 's1' } })
  assert.equal(seen.args.knowledge_base_ids, undefined)
})

test('ask without a custom agent still takes the session scope', async () => {
  const selection = new SessionSelection()
  selection.set('s1', ['kb-a'])
  const seen = {}
  const tool = withSessionScope(stub('weknora_ask', seen), wiring(selection, ['kb-a'], false))
  await tool.execute({ query: 'x' }, { signal: new AbortController().signal, agent: { id: 's1' } })
  assert.deepEqual(seen.args.knowledge_base_ids, ['kb-a'])
})

test('tools outside the retrieval scope are returned unchanged', async () => {
  const selection = new SessionSelection()
  const original = stub('weknora_read_document', {})
  const wrapped = withSessionScope(original, wiring(selection, []))
  assert.equal(wrapped, original)
})

test('a call with no session is refused rather than running unscoped', async () => {
  const selection = new SessionSelection()
  const seen = {}
  const tool = withSessionScope(stub('weknora_search', seen), wiring(selection, ['kb-a']))
  // No agent means no session, and no session means no authorization: the old
  // behaviour resolved an empty scope, which the tool body reads as "everything".
  await assert.rejects(
    tool.execute({ query: 'x' }, { signal: new AbortController().signal }),
    /尚未选择知识库/,
  )
  assert.equal(seen.args, undefined)
})

test('an ask that names an agent per call leaves the scope to the server', async () => {
  const selection = new SessionSelection()
  selection.set('s1', ['kb-a'])
  const seen = {}
  const tool = withSessionScope(stub('weknora_ask', seen), wiring(selection, ['kb-a', 'kb-b']))
  await tool.execute(
    { query: 'x', agent_id: 'agent-9' },
    { signal: new AbortController().signal, agent: { id: 's1' } },
  )
  // Sending session ids to a ReAct agent would override its own selection mode.
  assert.equal(seen.args.knowledge_base_ids, undefined)
  assert.equal(seen.args.agent_id, 'agent-9')
})
