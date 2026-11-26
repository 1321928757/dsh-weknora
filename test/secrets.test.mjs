import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'

import { SecretStore } from '../dist/secrets.js'

/** A store pointed at a throwaway directory, with a recorder for warnings. */
async function harness() {
  const home = await mkdtemp(join(tmpdir(), 'dsh-weknora-secrets-'))
  const warnings = []
  const file = join(home, 'storages', 'dsh-weknora', 'credentials.json')
  const store = new SecretStore(file, { warn: (...args) => warnings.push(args.join(' ')) })
  return { store, file, warnings, home }
}

test('save writes the key and load reads it back', async () => {
  const { store, file } = await harness()
  await store.save('  sk-test-123  ')
  assert.equal(store.cached(), 'sk-test-123')
  const raw = JSON.parse(await readFile(file, 'utf8'))
  assert.deepEqual(raw, { apiKey: 'sk-test-123' })
  assert.equal(await store.load(), 'sk-test-123')
})

test('the file is replaced atomically, leaving no temp debris', async () => {
  const { store, file } = await harness()
  await store.save('sk-first')
  await store.save('sk-second')
  const entries = await readdir(dirname(file))
  assert.equal(store.cached(), 'sk-second')
  // No `.tmp` siblings: every temp file was renamed over the target.
  assert.deepEqual(entries.filter(name => name.endsWith('.tmp')), [])
  assert.equal(JSON.parse(await readFile(file, 'utf8')).apiKey, 'sk-second')
})

test('clear removes the file instead of leaving an empty object', async () => {
  const { store, file } = await harness()
  await store.save('sk-test')
  await store.clear()
  assert.equal(store.cached(), undefined)
  await assert.rejects(stat(file), /ENOENT/)
  assert.equal(await store.load(), undefined)
})

test('clearing when nothing was ever stored is not an error', async () => {
  const { store } = await harness()
  await store.clear()
  assert.equal(store.has(), false)
})

test('a failed read is retried instead of pinning "no key"', async () => {
  const { store, file, warnings } = await harness()
  // A directory where the file should be: readFile fails with EISDIR.
  await mkdir(file, { recursive: true })
  assert.equal(await store.load(), undefined)
  assert.equal(warnings.length, 1, 'the failure is reported once')
  assert.equal(store.has(), false)

  // Fix the path the way a user would: the next load must see the key.
  await rm(file, { recursive: true })
  await writeFile(file, JSON.stringify({ apiKey: 'sk-recovered' }), 'utf8')
  assert.equal(await store.load(), 'sk-recovered')
  assert.equal(store.has(), true)
})

test('a corrupt file is tolerated and a later save still wins', async () => {
  const { store, file } = await harness()
  await mkdir(join(file, '..'), { recursive: true })
  await writeFile(file, '{ not json', 'utf8')
  assert.equal(await store.load(), undefined)
  await store.save('sk-fresh')
  assert.equal(await store.load(), 'sk-fresh')
})
