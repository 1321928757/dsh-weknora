import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createSelectionWriter } from '../dist/selection-writer.js'

/** Let every queued write get as far as its pending promise. */
const tick = () => new Promise(resolve => setTimeout(resolve, 0))

/** A write that stays pending until the test resolves it. */
function deferredWrite() {
  const calls = []
  const pending = []
  const write = ids => {
    calls.push(ids.slice())
    return new Promise((resolve, reject) => pending.push({ ids, resolve, reject }))
  }
  return { write, calls, pending }
}

function recorder() {
  const events = []
  return {
    events,
    onOptimistic: ids => events.push(['optimistic', ids.join(',')]),
    onSettled: (ids, note) => events.push(['settled', ids.join(','), note]),
    onRollback: (ids, error, note) => events.push(['rollback', ids.join(','), String(error.message ?? error), note]),
  }
}

test('ten clicks in one tick leave in order and keep the last intent', async () => {
  const { write, calls, pending } = deferredWrite()
  const sink = recorder()
  const writer = createSelectionWriter({ write, ...sink })
  writer.seed([])

  // Ten toggles of the same base: five on, five off, none of them awaited.
  for (let index = 0; index < 10; index += 1) {
    writer.push(index % 2 === 0 ? ['kb-a'] : [], `click-${index}`)
  }

  assert.deepEqual(writer.intent(), [], 'the visible set is the tenth intent')
  assert.equal(calls.length, 1, 'writes are serialized, not fired in parallel')

  // Drain: each write only starts once the previous one settles.
  for (let guard = 0; guard < 20 && calls.length <= 10; guard += 1) {
    const next = pending.shift()
    if (next === undefined) break
    next.resolve()
    await new Promise(resolve => setTimeout(resolve, 0))
  }

  assert.equal(calls.length, 10, 'every click reached the host, in order')
  assert.deepEqual(calls.at(-1), [], 'the host ends on the same set the user sees')
  const settled = sink.events.filter(([kind]) => kind === 'settled')
  assert.equal(settled.length, 1, 'only the newest intent reports a settle')
  assert.equal(settled[0][2], 'click-9', 'and it reports its own note')
})

test('a rejection rolls back to the last confirmed set and says why', async () => {
  const { write, pending } = deferredWrite()
  const sink = recorder()
  const writer = createSelectionWriter({ write, ...sink })
  writer.seed(['kb-a'])

  writer.push(['kb-a', 'kb-b'], 'add b')
  await tick()
  pending.shift().resolve()
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.deepEqual(writer.intent(), ['kb-a', 'kb-b'])

  writer.push(['kb-a'], 'remove b')
  await tick()
  pending.shift().reject(new Error('remote said no'))
  await new Promise(resolve => setTimeout(resolve, 0))

  assert.deepEqual(writer.intent(), ['kb-a', 'kb-b'], 'the confirmed set comes back')
  const rollback = sink.events.find(([kind]) => kind === 'rollback')
  assert.deepEqual(rollback, ['rollback', 'kb-a,kb-b', 'remote said no', 'remove b'])
})

test('an early response cannot resurrect an abandoned intent', async () => {
  const { write, pending } = deferredWrite()
  const sink = recorder()
  const writer = createSelectionWriter({ write, ...sink })
  writer.seed([])

  writer.push(['kb-a'], 'first')
  writer.push(['kb-a', 'kb-b'], 'second')

  // The first write now fails — but the user has already moved on.
  pending.shift().reject(new Error('too late'))
  await new Promise(resolve => setTimeout(resolve, 0))

  assert.equal(sink.events.some(([kind]) => kind === 'rollback'), false, 'a stale failure is ignored')
  assert.deepEqual(writer.intent(), ['kb-a', 'kb-b'], 'the newer intent stands')

  pending.shift().resolve()
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.deepEqual(writer.intent(), ['kb-a', 'kb-b'])
  const settled = sink.events.filter(([kind]) => kind === 'settled')
  assert.deepEqual(settled, [['settled', 'kb-a,kb-b', 'second']])
})

test('one failure does not poison the writes that follow', async () => {
  const { write, pending } = deferredWrite()
  const sink = recorder()
  const writer = createSelectionWriter({ write, ...sink })
  writer.seed([])

  writer.push(['kb-a'], 'first')
  await tick()
  pending.shift().reject(new Error('boom'))
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.deepEqual(writer.intent(), [])

  writer.push(['kb-a'], 'second')
  await tick()
  assert.equal(pending.length, 1, 'the queue keeps draining after a failure')
  pending.shift().resolve()
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.deepEqual(writer.intent(), ['kb-a'])
})

test('seed adopts a set without writing anything', async () => {
  const { write, calls } = deferredWrite()
  const writer = createSelectionWriter({ write, ...recorder() })
  writer.seed(['kb-x'])
  assert.deepEqual(writer.intent(), ['kb-x'])
  assert.equal(calls.length, 0)

  writer.push([])
  assert.deepEqual(calls[0], [], 'the next write starts from the seeded state')
})
