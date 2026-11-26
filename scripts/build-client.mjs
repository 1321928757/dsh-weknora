#!/usr/bin/env node
/**
 * Build the browser half of the plugin.
 *
 * The DSH web shell loads a client bundle through `window.__ModuleLoader__`, so
 * the artifact is a lazy-CJS factory rather than an ES module: the shell passes
 * a `require` that resolves its own module table (React, react-dom), and takes
 * back `{ inject, apply }` from the factory's return value.
 *
 * React is never bundled: the shell owns one copy and a second copy would break
 * hooks. Everything else is inlined.
 */
import { build } from 'esbuild'
import { readFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
const outfile = resolve(root, 'dist/client/client.js')

await mkdir(dirname(outfile), { recursive: true })

await build({
  entryPoints: [resolve(root, 'src/client/index.ts')],
  outfile,
  bundle: true,
  // CommonJS is deliberate: it is the dialect `__ModuleLoader__` factories use.
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  charset: 'utf8',
  legalComments: 'none',
  logLevel: 'warning',
  // The shell provides these; bundling them would fork React's internals.
  external: ['react', 'react-dom', 'react/jsx-runtime'],
  define: {
    __PACKAGE_ID__: JSON.stringify(pkg.name),
  },
  banner: {
    js: `window.__ModuleLoader__.load({ id: ${JSON.stringify(pkg.name)}, factory: (require) => {\n`
      + 'var module = { exports: {} }; var exports = module.exports;',
  },
  footer: {
    js: '\nreturn module.exports;\n} });',
  },
})

console.log(`[build-client] ${pkg.name} -> dist/client/client.js`)
