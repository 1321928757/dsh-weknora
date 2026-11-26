import assert from 'node:assert/strict'
import { test } from 'node:test'

import { LiveConfig } from '../dist/live-config.js'

/** A schemastery-style volatile field. */
const volatile = (value) => ({ get: () => value })

test('volatile fields are read on every call, so an edit lands immediately', () => {
  let maxResults = 8
  const row = { maxResults: { get: () => maxResults } }
  const live = new LiveConfig(row)
  assert.equal(live.current().maxResults, 8)
  maxResults = 3
  assert.equal(live.current().maxResults, 3)
})

test('two illegal writes in a row keep the last good snapshot', () => {
  const warnings = []
  let maxResults = 8
  const row = { maxResults: volatile(maxResults) }
  const live = new LiveConfig(row, { logger: { warn: (...args) => warnings.push(args.join(' ')) } })
  assert.equal(live.current().maxResults, 8)

  // A half-finished settings edit: invalid, and it must not be adopted.
  row.maxResults = volatile(0)
  assert.equal(live.current().maxResults, 8)
  assert.equal(live.current().maxResults, 8)
  assert.equal(live.current().maxResults, 8)
  assert.equal(warnings.length, 1, 'one warning per distinct problem, not one per read')

  // Still invalid but a different problem → one more warning.
  row.maxResults = volatile('nope')
  assert.equal(live.current().maxResults, 8)
  assert.equal(warnings.length, 2)

  // Valid again → adopted, and the warning state resets.
  row.maxResults = volatile(3)
  assert.equal(live.current().maxResults, 3)
  row.maxResults = volatile(0)
  assert.equal(live.current().maxResults, 3)
})

test('an unusable row still fails the plugin load', () => {
  assert.throws(() => new LiveConfig({ baseUrl: 'not-a-url' }), /baseUrl must be an absolute URL/)
})

test('the resolved secret is layered in without living in the row', () => {
  const live = new LiveConfig({ baseUrl: 'https://kb.example.com' }, { secret: () => 'sk-test' })
  assert.equal(live.current().apiKey, 'sk-test')
  assert.deepEqual(Object.keys(live.current()).includes('apiKey'), true)
})

test('the hint toggle defaults on and can be turned off', () => {
  assert.equal(new LiveConfig({}).current().hintWhenUnselected, true)
  assert.equal(new LiveConfig({ hintWhenUnselected: false }).current().hintWhenUnselected, false)
})
