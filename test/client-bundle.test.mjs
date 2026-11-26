import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const BUNDLE = new URL('../dist/client/client.js', import.meta.url)
const PACKAGE = new URL('../package.json', import.meta.url)

const source = await readFile(BUNDLE, 'utf8')
const pkg = JSON.parse(await readFile(PACKAGE, 'utf8'))

const reactStub = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect: () => {},
  useMemo: factory => factory(),
  useCallback: callback => callback,
  useRef: initial => ({ current: initial }),
  Fragment: 'Fragment',
}

/** Evaluate the bundle the way the shell does: register, then materialize. */
function loadBundle() {
  const entries = []
  const window = { __ModuleLoader__: { load: entry => entries.push(entry) } }
  const evaluate = new Function('window', 'require', source)
  // The top level only registers; `require` is first touched inside the factory.
  evaluate(window, () => { throw new Error('the bundle must not require at load time') })
  return entries
}

const entries = loadBundle()

test('the bundle registers exactly one factory under the package name', () => {
  assert.equal(entries.length, 1)
  assert.equal(entries[0].id, pkg.name, 'the loader resolves the entry by package name')
  assert.equal(typeof entries[0].factory, 'function')
})

test('materializing yields a Cordis plugin shape', () => {
  const materialized = entries[0].factory(specifier => {
    if (specifier === 'react' || specifier === 'react-dom') return reactStub
    throw new Error(`unexpected require: ${specifier}`)
  })
  assert.deepEqual(materialized.inject, ['slots'])
  assert.equal(typeof materialized.apply, 'function')
})

test('React is borrowed from the module table, never bundled', () => {
  assert.match(source, /require\("react"\)/)
  assert.doesNotMatch(source, /zod/, 'the client may not require zod')
  // A bundled React would put the bundle far above this; it is 60 kB today.
  assert.ok(source.length < 200_000, `bundle size ${source.length}`)
})

test('apply registers the picker, the settings page and its nav icon', () => {
  const materialized = entries[0].factory(specifier => {
    if (specifier === 'react' || specifier === 'react-dom') return reactStub
    throw new Error(`unexpected require: ${specifier}`)
  })

  const registrations = []
  let injected = 0
  const slots = {
    inject(key, callback) {
      injected++
      assert.equal(typeof key, 'string')
      callback()
      return () => {}
    },
    register(options, component) {
      registrations.push({ options, component })
      return () => {}
    },
  }
  const ctx = {
    get: key => (key === 'slots' ? slots : undefined),
    effect: () => () => {},
  }

  materialized.apply(ctx)

  assert.equal(injected, 3)
  assert.deepEqual(
    registrations.map(entry => [entry.options.name, entry.options.id]),
    [
      ['conversation.input.left', 'weknora-kb'],
      ['settings.section', 'weknora'],
      ['settings.section.icon', 'weknora'],
    ],
  )
  for (const { options, component } of registrations) {
    assert.equal(typeof options.order, 'number', `${options.name} needs an order`)
    assert.equal(typeof component, 'function', `${options.name} needs a component`)
  }
  // A thunk label follows the locale without re-registering.
  assert.equal(typeof registrations[1].options.label, 'function')
})

test('apply stays inert when the slot service is absent', () => {
  const materialized = entries[0].factory(specifier => {
    if (specifier === 'react' || specifier === 'react-dom') return reactStub
    throw new Error(`unexpected require: ${specifier}`)
  })
  assert.doesNotThrow(() => materialized.apply({ get: () => undefined }))
})

test('the advertised client subpath exists in package.json', () => {
  assert.equal(typeof pkg.exports['./client'], 'object')
  assert.equal(pkg.dsh.client.platform, 'web')
  assert.equal(typeof pkg.exports['./typert'], 'object')
})
