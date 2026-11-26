#!/usr/bin/env node
/**
 * End-to-end check inside a real DeepSeek Harness install: install this package
 * into a throwaway dsh profile with `dsh plugin add`, boot the headless profile
 * against a fake OpenAI-compatible model and a mock WeKnora backend, and assert
 * that the harness agent loop actually called the tools and answered from what
 * they returned.
 *
 * Three scenarios run, because all three are documented paths:
 *   A. the bundle's shipped `cordis.patch.yml`, configured only by environment
 *      variables — what a user gets straight after `dsh plugin add`.
 *   B. a profile patch that overrides the row, including a renamed tool prefix,
 *      which also proves configuration reaches the plugin.
 *   C. a row with no knowledge base scope, where the plugin resolves the full
 *      visible set itself — WeKnora refuses an unscoped search.
 *
 * Usage:
 *   node test/e2e/run-in-dsh.mjs                 # installs dsh into a cache dir
 *   DSH_BIN=/path/to/dsh node test/e2e/run-in-dsh.mjs
 *   DSH_E2E_LOG=/tmp/transcript.log node test/e2e/run-in-dsh.mjs
 *
 * Environment:
 *   DSH_PACKAGE_SPEC  npm spec for the harness (default `@deepseek-ai/dsh@latest`)
 *   DSH_INSTALL_DIR   where to keep that install (default `<tmp>/dsh-e2e-install`)
 *   DSH_E2E_KEEP_HOME keep the throwaway `DSH_HOME` for inspection
 */

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { startFakeModel } from './fake-model.mjs'
import { startMockWeknora } from '../helpers/mock-weknora.mjs'

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const installDir = process.env.DSH_INSTALL_DIR ?? join(tmpdir(), 'dsh-e2e-install')
const dshSpec = process.env.DSH_PACKAGE_SPEC ?? '@deepseek-ai/dsh@latest'
const API_KEY = 'e2e-api-key'
const QUESTION = 'WeKnora 的默认检索阈值是多少？请查知识库后回答。'
const transcript = []

function log(line) {
  transcript.push(line)
  process.stdout.write(`${line}\n`)
}

/**
 * Translate a Windows `.cmd` shim into the process it actually starts.
 *
 * Node refuses to spawn a `.cmd` without a shell (EINVAL), and a shell would
 * re-split the arguments — including a question that contains spaces. The
 * desktop launcher is a three-line shim, so re-create it instead: run the
 * bundled Electron binary as node against the CLI entry it names.
 */
function resolveSpawn(command, args) {
  if (process.platform !== 'win32' || !/\.(cmd|bat)$/i.test(command)) {
    return { file: command, argv: args, env: {} }
  }
  const binDir = dirname(command)
  return {
    file: resolve(binDir, '../../../../DeepSeek Harness.exe'),
    argv: [
      resolve(binDir, '../../../app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js'),
      ...args,
    ],
    env: { ELECTRON_RUN_AS_NODE: '1' },
  }
}

/** Run a command to completion, capturing both streams. */
function run(command, args, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const target = resolveSpawn(command, args)
    if (!existsSync(target.file)) {
      rejectRun(new Error(`launcher not found: ${target.file} (from ${command})`))
      return
    }
    const child = spawn(target.file, target.argv, {
      cwd: options.cwd ?? packageDir,
      env: { ...process.env, ...target.env, ...options.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', part => {
      stdout += part
    })
    child.stderr.on('data', part => {
      stderr += part
    })
    child.on('error', rejectRun)
    child.on('close', code => resolveRun({ code, stdout, stderr }))
  })
}

/** Resolve a dsh launcher, installing one from npm when none was supplied. */
async function resolveDsh() {
  if (process.env.DSH_BIN !== undefined) return process.env.DSH_BIN
  const binary = join(installDir, 'node_modules', '.bin', 'dsh')
  if (existsSync(binary)) {
    log(`# reusing the dsh install at ${installDir}`)
    return binary
  }
  log(`# installing ${dshSpec} into ${installDir} (first run only)`)
  await mkdir(installDir, { recursive: true })
  await writeFile(join(installDir, 'package.json'), JSON.stringify({ name: 'dsh-e2e-install', private: true }, null, 2))
  const install = await run('npm', ['install', '--no-audit', '--no-fund', dshSpec], { cwd: installDir })
  if (install.code !== 0) throw new Error(`npm install ${dshSpec} failed:\n${install.stderr}`)
  return binary
}

/** The two rows that make dsh talk to the fake model instead of DeepSeek. */
function modelPatchRows(modelUrl) {
  return [
    {
      id: 'agent-default-model',
      config: { provider: 'weknora-e2e', model: 'weknora-e2e-model' },
    },
    {
      id: 'llm-pi-ai',
      config: {
        providers: {
          'weknora-e2e': {
            displayName: 'WeKnora e2e gateway',
            apiKeyEnv: 'WEKNORA_E2E_MODEL_KEY',
            api: 'openai-completions',
            baseURL: modelUrl,
            models: [{
              id: 'weknora-e2e-model',
              name: 'WeKnora e2e model',
              contextWindow: 65536,
              maxTokens: 4096,
            }],
          },
        },
      },
    },
  ]
}

/**
 * Boot the headless profile once and assert the whole path: the harness offered
 * the tools, the tools reached WeKnora, the retrieved passages reached the
 * model, and the printed answer is grounded in them.
 */
async function scenario(options) {
  const {
    label, dsh, home, baseEnv, patch, prefix,
    expectTools = true, expectHint = true, onlyBases,
  } = options

  // Each scenario owns its backend: a deployment with exactly one visible base
  // is what makes a session auto-select, so the see-no-tools and see-tools cases
  // need different fixtures rather than a different code path.
  const weknora = await startMockWeknora({
    apiKey: API_KEY,
    ...(onlyBases === undefined ? {} : { onlyBases }),
  })
  const env = { ...baseEnv, WEKNORA_BASE_URL: weknora.url }
  const model = await startFakeModel({ searchTool: `${prefix}_search`, readTool: `${prefix}_read_document` })
  const requestsBefore = weknora.requests.length
  const patchRows = typeof patch === 'function' ? patch(weknora.url) : patch
  log(`\n=== ${label} ===`)
  log(`# mock WeKnora   ${weknora.url}${onlyBases === undefined ? '' : ` (only ${onlyBases.join(', ')})`}`)
  try {
    await writeFile(
      join(home, 'profiles', 'headless', 'cordis.patch.yml'),
      JSON.stringify([...patchRows, ...modelPatchRows(model.url)], null, 2),
    )

    const dump = await run(dsh, ['--profile', 'headless', '--dump-config'], { env })
    assert.equal(dump.code, 0, `--dump-config must succeed:\n${dump.stderr}`)
    assert.match(dump.stdout, /name: ["']?@wxg-prc-cpg\/dsh-weknora/, 'the composed tree must mount the plugin')

    log(`\n=== ${label} ===`)
    log(`$ dsh --profile headless "${QUESTION}"`)
    const boot = await run(dsh, ['--profile', 'headless', QUESTION], { env })
    log(`--- stdout ---\n${boot.stdout.trim()}`)
    if (boot.stderr.trim() !== '') log(`--- stderr ---\n${boot.stderr.trim()}`)
    assert.equal(boot.code, 0, 'the headless run must exit 0')

    const offered = (model.requests.at(0)?.offeredTools ?? []).filter(name => name.startsWith(`${prefix}_`))
    log(`# tools offered to the model: ${offered.join(', ') || '(none)'}`)

    if (!expectTools) {
      // The headline promise of this design: no knowledge base chosen, no tool.
      // Not "the tool fails once called" — the schema never reaches the model.
      assert.deepEqual(
        offered,
        [],
        `${label}: no ${prefix}_* tool may be offered before the session picks a knowledge base`,
      )
      const seen = model.requests.at(0)?.allText ?? ''
      assert.equal(
        seen.includes(`若本轮工具列表中没有 ${prefix}_* 工具`),
        expectHint,
        expectHint
          ? 'the unselected hint must still tell the model the capability exists'
          : 'hintWhenUnselected=false must remove the hint entirely',
      )
      // The list warm-up is expected — it is what the activation condition reads.
      // What must not happen is a *retrieval*: those endpoints are the capability
      // the session has not asked for yet.
      const touched = weknora.requests.slice(requestsBefore).map(request => request.path)
      log(`# WeKnora received: ${touched.join(', ') || '(nothing)'}`)
      const retrieval = touched.filter(path => path.startsWith('/api/v1/knowledge-search')
        || path.startsWith('/api/v1/chunks/'))
      assert.deepEqual(retrieval, [], `no retrieval may happen without a selection, got ${retrieval.join(', ')}`)
      assert.match(boot.stdout, /没有可用的知识库检索工具/, 'the run must still answer, just without retrieval')
      log(`# PASS (${label}): zero ${prefix}_* tools offered, no retrieval reached WeKnora, `
        + `hint ${expectHint ? 'present' : 'absent'}.`)
      return
    }

    for (const suffix of ['search', 'read_document', 'ask', 'list_knowledge_bases']) {
      assert.ok(offered.includes(`${prefix}_${suffix}`), `${prefix}_${suffix} must appear in the model's tool schemas`)
    }

    const calls = weknora.requests.slice(requestsBefore)
    const paths = calls.map(request => request.path)
    log(`# WeKnora received: ${paths.join(', ')}`)
    assert.ok(paths.includes('/api/v1/knowledge-search'), 'search must reach the retrieval endpoint')
    assert.ok(paths.some(path => path.startsWith('/api/v1/chunks/')), 'read_document must reach the chunk endpoint')
    assert.equal(
      weknora.requests.slice(requestsBefore).every(request => request.headers['x-api-key'] === API_KEY),
      true,
      'every call must carry the configured API key',
    )

    const toolResults = model.requests.flatMap(request => request.toolResults).join('\n')
    assert.match(toolResults, /vector_threshold 是 0\.5/, 'the model must see the retrieved passage verbatim')
    assert.match(toolResults, /knowledge_id: doc-retrieval-pipeline/, 'search hits must carry a usable knowledge_id')
    assert.match(boot.stdout, /0\.5/, 'the printed answer must carry the retrieved threshold')

    log(`# PASS (${label}): ${prefix}_search and ${prefix}_read_document ran inside dsh against WeKnora, `
      + 'and the answer came from the retrieved passages.')
  } finally {
    await model.close()
    await weknora.close()
  }
}

async function main() {
  if (!existsSync(join(packageDir, 'dist', 'index.js'))) {
    throw new Error('build the package first: npm run build')
  }

  const home = await mkdtemp(join(tmpdir(), 'dsh-weknora-home-'))
  const dsh = await resolveDsh()
  const baseEnv = {
    DSH_HOME: home,
    WEKNORA_E2E_MODEL_KEY: 'not-a-real-key',
  }

  log(`# DSH_HOME       ${home}`)
  log(`# dsh launcher   ${dsh}`)

  try {
    // Install this package into a fresh profile exactly as a user would.
    const install = await run(dsh, ['plugin', '--profile', 'headless', 'add', packageDir], { env: baseEnv })
    log(`\n$ dsh plugin --profile headless add ${packageDir}\n${install.stdout.trim()}\n${install.stderr.trim()}`)
    assert.equal(install.code, 0, 'dsh plugin add must succeed')

    // The API key lives in this package's own credential file now, never in the
    // config row, so the e2e seeds it the way the settings page would.
    const credentialFile = join(home, 'storages', 'dsh-weknora', 'credentials.json')
    await mkdir(dirname(credentialFile), { recursive: true })
    await writeFile(credentialFile, `${JSON.stringify({ apiKey: API_KEY }, null, 2)}\n`, 'utf8')
    log(`# credential file ${credentialFile}`)

    const manifest = JSON.parse(await readFile(join(home, 'profiles', 'headless', 'package.json'), 'utf8'))
    log(`# profile bundles: ${JSON.stringify(manifest.dsh.profile.bundles)}`)
    assert.ok(
      manifest.dsh.profile.bundles.includes('@wxg-prc-cpg/dsh-weknora'),
      'the bundle must join the profile layer list',
    )

    // A. The shipped bundle patch, configured only by environment variables, on a
    //    deployment with two bases: nothing is selected, so no tool may appear.
    await scenario({
      label: 'A · 未选择知识库 → 工具不进上下文',
      dsh,
      home,
      baseEnv,
      patch: [],
      prefix: 'weknora',
      expectTools: false,
    })

    // B. A single visible base, so the session auto-selects it and the tools do
    //    appear; a profile override also renames them, proving config reaches in.
    await scenario({
      label: 'B · 单库部署自动选中 + 前缀覆盖',
      dsh,
      home,
      baseEnv,
      onlyBases: ['kb-product'],
      prefix: 'kb',
      patch: url => [{
        id: 'weknora',
        config: {
          baseUrl: url,
          toolPrefix: 'kb',
          maxResults: 3,
          maxChunkChars: 400,
        },
      }],
    })

    // C. Same two-base deployment as A, but the hint is switched off, which must
    //    leave the model with no evidence the plugin exists at all.
    await scenario({
      label: 'C · 提示开关关闭 → 模型完全看不到插件',
      dsh,
      home,
      baseEnv,
      prefix: 'weknora',
      expectTools: false,
      expectHint: false,
      patch: () => [{ id: 'weknora', config: { hintWhenUnselected: false } }],
    })

    log('\n# ALL SCENARIOS PASSED')
  } finally {
    const logPath = process.env.DSH_E2E_LOG
    if (logPath !== undefined) await writeFile(logPath, `${transcript.join('\n')}\n`)
    if (process.env.DSH_E2E_KEEP_HOME === undefined) await rm(home, { recursive: true, force: true })
  }
}

await main()
