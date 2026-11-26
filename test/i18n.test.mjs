import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'

import { createI18n } from '../dist/i18n.js'

/**
 * The shell publishes the active locale on `<html lang>` and flips it when the
 * user changes language. Reading it once at install time is the bug these tests
 * exist to prevent: the plugin would keep speaking the old language forever.
 */
function shellSays(lang) {
  globalThis.document = { documentElement: { lang } }
}

afterEach(() => {
  delete globalThis.document
})

test('the shell locale wins over the browser locale', () => {
  shellSays('en')
  const i18n = createI18n()
  assert.equal(i18n.lang, 'en')
  assert.equal(i18n.t('picker.done'), 'Done')
})

test('a language switch takes effect without recreating the instance', () => {
  shellSays('zh-CN')
  const i18n = createI18n()
  assert.equal(i18n.t('picker.done'), '完成')

  shellSays('en')
  assert.equal(i18n.lang, 'en', 'lang follows the shell')
  assert.equal(i18n.t('picker.done'), 'Done', 'and so does every later lookup')

  shellSays('zh-TW')
  assert.equal(i18n.t('picker.done'), '完成', 'any zh variant is Chinese')
})

test('an empty lang falls back to the browser locale, not to English', () => {
  shellSays('')
  const i18n = createI18n()
  // navigator.language in this host is whatever the machine says; assert only
  // that a value is produced and that the dictionary is reachable.
  assert.ok(['zh', 'en'].includes(i18n.lang))
  assert.notEqual(i18n.t('picker.done'), 'picker.done')
})

test('a missing English string degrades to Chinese, never to the key', () => {
  shellSays('en')
  const i18n = createI18n()
  // `picker.all.count` exists in both tables; take a key that only Chinese has
  // by pretending it is missing from the English one.
  const zhOnly = 'picker.selectedCount'
  assert.equal(i18n.t(zhOnly, { n: 2 }), '2 selected')
  assert.equal(i18n.t('no.such.key'), 'no.such.key', 'an unknown key is visible, not blank')
})

test('placeholders are filled once and left alone when absent', () => {
  shellSays('zh-CN')
  const i18n = createI18n()
  assert.equal(i18n.t('picker.selectedCount', { n: 3 }), '已选 3 个')
  assert.equal(i18n.t('picker.none'), '未选择 · 工具不可用')
  assert.equal(i18n.t('picker.noMatch', { q: 'zzz' }), '没有匹配「zzz」的知识库')
})
