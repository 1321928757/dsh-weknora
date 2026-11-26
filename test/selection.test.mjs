import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  ALL_KNOWLEDGE_BASES,
  SessionSelection,
  effectiveKnowledgeBaseScope,
  normalizeIds,
  validateSelection,
} from '../dist/selection.js'

const A = 'kb-a'
const B = 'kb-b'

test('a missing selection is not an explicit empty one', () => {
  const selection = new SessionSelection()
  // Nothing visible yet: the session must stay uninitialized so a later warm-up
  // can still auto-select the only base that exists.
  assert.deepEqual(selection.idsFor('s1', []), [])
  assert.equal(selection.has('s1'), false)

  // Exactly one base exists → auto-select it, without the user having to.
  assert.deepEqual(selection.idsFor('s1', [A]), [A])
  assert.equal(selection.has('s1'), true)

  // A session that cleared its choice stays cleared even with one base.
  const cleared = new SessionSelection()
  cleared.idsFor('s2', [A])
  cleared.set('s2', [])
  assert.deepEqual(cleared.idsFor('s2', [A]), [])
})

test('reading reconciles: a deleted knowledge base drops out', () => {
  const selection = new SessionSelection()
  selection.set('s1', [A, B])
  assert.deepEqual(selection.idsFor('s1', [A, B]), [A, B])
  assert.deepEqual(selection.idsFor('s1', [A]), [A], 'the vanished id is dropped')
  // The sentinel never depends on what is visible.
  selection.set('s1', [ALL_KNOWLEDGE_BASES])
  assert.deepEqual(selection.idsFor('s1', [A]), [ALL_KNOWLEDGE_BASES])
})

test('a blank session id selects nothing', () => {
  const selection = new SessionSelection()
  assert.deepEqual(selection.idsFor(undefined, [A]), [])
  assert.deepEqual(selection.idsFor('', [A]), [])
})

test('a cold catalogue hides the selection without destroying it', () => {
  const selection = new SessionSelection()
  assert.deepEqual(selection.idsFor('s1', [A, B]), [])
  selection.set('s1', [B])
  // The backend went away: nothing is visible, so nothing is offered to the
  // model — but the user's choice must survive, because the retry restores it.
  assert.deepEqual(selection.idsFor('s1', []), [])
  assert.deepEqual(selection.peek('s1'), [B], 'the stored selection is untouched')
  assert.deepEqual(selection.idsFor('s1', [A, B]), [B], 'and comes back once the list does')
})

test('peek does not initialize and forget clears', () => {
  const selection = new SessionSelection()
  assert.equal(selection.peek('s1'), undefined)
  selection.set('s1', [A])
  assert.deepEqual(selection.peek('s1'), [A])
  assert.equal(selection.forget('s1'), true)
  assert.equal(selection.forget('s1'), false)
  assert.equal(selection.has('s1'), false)
})

test('normalizeIds trims, drops blanks and dedupes', () => {
  assert.deepEqual(normalizeIds([' a ', '', 'a', 'b']), ['a', 'b'])
})

test('the select-all sentinel is exclusive', () => {
  assert.deepEqual(validateSelection('s1', [ALL_KNOWLEDGE_BASES], [A]), { ok: true, ids: [ALL_KNOWLEDGE_BASES] })
  const mixed = validateSelection('s1', [ALL_KNOWLEDGE_BASES, A], [A])
  assert.equal(mixed.ok, false)
  assert.match(mixed.error, /不能与具体知识库同时选中/)
})

test('a selection naming an unknown knowledge base is refused', () => {
  const result = validateSelection('s1', ['kb-ghost'], [A])
  assert.equal(result.ok, false)
  assert.match(result.error, /知识库不存在：kb-ghost/)
})

test('a selection without a session id is refused', () => {
  assert.equal(validateSelection('', [A], [A]).ok, false)
  assert.equal(validateSelection(undefined, [A], [A]).ok, false)
  assert.equal(validateSelection('s1', 'kb-a', [A]).ok, false)
})

// ── 会话选择如何决定一次调用的检索范围 ────────────────────────────────────────

const scope = (input) => effectiveKnowledgeBaseScope({
  requested: [],
  knowledgeIds: [],
  selection: [],
  available: [A, B, 'kb-c'],
  ...input,
})

test('no parameter and no selection narrows to the session selection', () => {
  assert.deepEqual(scope({ selection: [A] }), [A])
})

test('a parameter naming a selected base keeps it', () => {
  assert.deepEqual(scope({ selection: [A, B], requested: [A] }), [A])
})

test('a parameter naming an unselected base is narrowed away, never widened', () => {
  assert.deepEqual(scope({ selection: [A], requested: ['kb-c'] }), [])
})

test('select-all expands to every visible base', () => {
  assert.deepEqual(scope({ selection: [ALL_KNOWLEDGE_BASES] }), [A, B, 'kb-c'])
  assert.deepEqual(scope({ selection: [ALL_KNOWLEDGE_BASES], requested: [B] }), [B])
})

test('naming document ids is already a scope, so no base ids are added', () => {
  assert.deepEqual(scope({ selection: [A], knowledgeIds: ['doc-1'] }), [])
})
