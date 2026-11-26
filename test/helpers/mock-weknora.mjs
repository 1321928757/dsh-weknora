/**
 * A stand-in WeKnora backend used by the unit tests and by the end-to-end run
 * inside dsh. It speaks the same routes, envelopes and SSE event types as the
 * real server (see internal/handler/session/qa.go and internal/types/chat.go),
 * so a test failure here means the plugin, not the fixture, drifted.
 */

import { createServer } from 'node:http'

const DOCUMENTS = [
  {
    knowledge_id: 'doc-retrieval-pipeline',
    knowledge_title: 'WeKnora 检索流程.md',
    knowledge_base_id: 'kb-product',
    // WeKnora stores the generated summary in `description`, not `summary`.
    description: '讲解 WeKnora 混合检索的召回、阈值与父子分块回溯。',
    chunks: [
      'WeKnora 的混合检索先做向量召回，再做关键词召回，最后交给 rerank 模型统一排序。',
      '默认的 vector_threshold 是 0.5，keyword_threshold 是 0.3，可以在知识库配置里按库调整。',
      '父子分块开启后，命中子块会回溯父块，把更完整的上下文交给生成模型。',
    ],
  },
  {
    knowledge_id: 'doc-architecture',
    knowledge_title: '系统架构图.md',
    knowledge_base_id: 'kb-product',
    description: '检索与生成两层的系统架构示意图。',
    chunks: [
      '系统由检索与生成两层组成，整体结构见架构图。\n\n![系统架构](resource://AbCdEfGhIjKlMnOpQrStUv)',
    ],
  },
  {
    knowledge_id: 'doc-deployment',
    knowledge_title: 'WeKnora 部署手册.md',
    knowledge_base_id: 'kb-ops',
    description: '单机与 Kubernetes 部署方式，以及可选的向量库后端。',
    chunks: [
      'WeKnora 支持 docker compose 单机部署，也提供 Helm chart 用于 Kubernetes。',
      '向量库可以选择 pgvector、Milvus、Qdrant、Weaviate、OpenSearch 等后端。',
    ],
  },
  {
    // Title and body share no wording on purpose: retrieving this document by
    // name is the only way to reach it, which is what the by-name search is for.
    knowledge_id: 'doc-release-checklist',
    knowledge_title: '灰度发布检查单.md',
    knowledge_base_id: 'kb-ops',
    description: '上线前的确认项与回滚准备。',
    chunks: [
      '上线前需确认监控告警、回滚预案与数据库变更脚本均已就绪，并由值班同学复核。',
    ],
  },
]

const KNOWLEDGE_BASES = [
  { id: 'kb-product', name: 'Product docs', description: 'WeKnora 产品与检索文档' },
  { id: 'kb-ops', name: 'Ops runbooks', description: '部署与运维手册' },
]

const ARCH_HANDLE = 'resource://AbCdEfGhIjKlMnOpQrStUv'
const ARCH_PUBLIC = 'https://cdn.example.com/architecture.png'

/** Rewrite the internal handle into a loadable URL, as WeKnora does on request. */
function rewriteResources(value, publicMode) {
  if (publicMode !== true) return value
  if (typeof value === 'string') return value.split(ARCH_HANDLE).join(ARCH_PUBLIC)
  if (Array.isArray(value)) return value.map(entry => rewriteResources(entry, publicMode))
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, rewriteResources(entry, publicMode)]),
    )
  }
  return value
}

/**
 * Deterministic relevance: the share of the query's characters the text also has.
 * Enough to rank and to filter, and stable enough to assert on.
 */
function scoreOf(query, text) {
  const wanted = new Set(String(query ?? '').toLowerCase().replace(/[ \t\r\n]+/g, ''))
  if (wanted.size === 0) return 0
  const haystack = String(text ?? '').toLowerCase()
  let hit = 0
  for (const token of wanted) if (haystack.includes(token)) hit += 1
  return Math.round((hit / wanted.size) * 1000) / 1000
}

/** Passage hits for a query, limited to the scope the caller asked for. */
function searchResults(query, knowledgeBaseIds, knowledgeIds) {
  const bases = new Set((knowledgeBaseIds ?? []).filter(id => typeof id === 'string' && id !== ''))
  const documents = new Set((knowledgeIds ?? []).filter(id => typeof id === 'string' && id !== ''))
  const results = []
  for (const document of DOCUMENTS) {
    if (bases.size > 0 && !bases.has(document.knowledge_base_id)) continue
    if (documents.size > 0 && !documents.has(document.knowledge_id)) continue
    document.chunks.forEach((content, index) => {
      const score = scoreOf(query, content)
      if (score <= 0.25) return
      results.push({
        id: document.knowledge_id + '-chunk-' + index,
        knowledge_id: document.knowledge_id,
        knowledge_title: document.knowledge_title,
        knowledge_filename: document.knowledge_title,
        knowledge_base_id: document.knowledge_base_id,
        chunk_index: index,
        content,
        score,
        match_type: 'vector',
      })
    })
  }
  return results.sort((left, right) => right.score - left.score).slice(0, 8)
}

/** The answer the fake pipeline streams back. */
function answerFor(query, results) {
  if (results.length === 0) return '没有检索到与「' + query + '」相关的内容。'
  const cited = results.slice(0, 2).map(result => result.content).join(' ')
  return '根据知识库内容：' + cited + '（问题：' + query + '）'
}

/**
 * Start the mock backend.
 *
 * @param {object} [options]
 * @param {string} [options.apiKey] - when set, a request without it is a 401.
 * @param {string[]} [options.onlyBases] - serve only these knowledge-base ids.
 * @param {number} [options.baseCount] - serve this many synthetic bases instead.
 * @param {boolean} [options.forbidPublicResourceUrls] - 403 on resource_urls=public.
 * @param {boolean} [options.streamError] - the chat stream reports an error.
 * @param {boolean} [options.streamTruncated] - the chat stream dies mid-answer.
 * @param {number} [options.port] - fixed port, so a configured GUI keeps working.
 */
export async function startMockWeknora(options = {}) {
  const requests = []
  const failures = new Map()
  const runtime = {
    baseCount: Number(options.baseCount) > 0 ? Number(options.baseCount) : undefined,
    onlyBases: Array.isArray(options.onlyBases) ? [...options.onlyBases] : undefined,
    delayMs: 0,
  }
  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://mock.invalid')
    const chunks = []
    request.on('data', chunk => chunks.push(chunk))
    request.on('end', () => {
      const rawBody = Buffer.concat(chunks).toString('utf8')
      let body = {}
      if (rawBody !== '') {
        try {
          body = JSON.parse(rawBody)
        } catch {
          body = { _unparsed: rawBody }
        }
      }
      requests.push({
        method: request.method,
        path: url.pathname,
        query: Object.fromEntries(url.searchParams),
        headers: request.headers,
        body,
      })

      const json = (status, payload) => {
        response.writeHead(status, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify(payload))
      }

      // A forced failure short-circuits everything, auth included: that is what a
      // 500 from the deployment looks like.
      const forced = failures.get(url.pathname)
      if (forced !== undefined) {
        json(forced, { success: false, error: { message: 'forced ' + forced } })
        return
      }
      if (options.apiKey !== undefined && request.headers['x-api-key'] !== options.apiKey) {
        json(401, { success: false, error: { message: 'invalid api key' } })
        return
      }
      // Only resource-bearing calls are restricted: the listing carries no figures,
      // and a key that cannot see public URLs still has to be able to enumerate.
      // Restricted keys are refused on every resource-bearing call, the listing
      // included; the client's fallback keys off this exact wording.
      if (options.forbidPublicResourceUrls === true && url.searchParams.get('resource_urls') === 'public') {
        json(403, {
          success: false,
          error: { message: 'resource_urls=public is not available for a knowledge-base-scoped API key' },
        })
        return
      }
      // Absent means handle: the client only sends the parameter when it wants
      // loadable URLs, so an omitted parameter is 'keep internal handles'.
      const publicMode = url.searchParams.get('resource_urls') === 'public'

      const route = () => {
        if (request.method === 'GET' && url.pathname === '/api/v1/knowledge-bases') {
          json(200, { success: true, data: servedBases() })
          return
        }

        if (request.method === 'POST'
          && (url.pathname === '/api/v1/knowledge-search' || url.pathname === '/api/v1/knowledge/search')) {
          if ((body.knowledge_base_id ?? []).length === 0
            && (body.knowledge_base_ids ?? []).length === 0
            && (body.knowledge_ids ?? []).length === 0
            && (body.tag_ids ?? []).length === 0) {
          json(400, {
            success: false,
            error: {
              message: 'At least one knowledge_base_id, knowledge_base_ids, knowledge_ids, or scoped tag must be provided',
            },
          })
          return
        }
        json(200, {
          success: true,
          data: rewriteResources(
            searchResults(body.query, body.knowledge_base_ids ?? [], body.knowledge_ids ?? []),
            publicMode,
          ),
        })
        return
      }

      // By-name search: spans every base (the caller filters), so it needs no scope.
      if (request.method === 'GET' && url.pathname === '/api/v1/knowledge/search') {
        const keyword = String(url.searchParams.get('keyword') ?? '').toLowerCase()
        const limit = Number(url.searchParams.get('limit') ?? '10')
        const matches = keyword === ''
          ? []
          : DOCUMENTS.filter((document) => {
            const title = String(document.knowledge_title ?? '').toLowerCase()
            const filename = String(document.knowledge_filename ?? document.knowledge_title ?? '').toLowerCase()
            return title.includes(keyword) || filename.includes(keyword)
          })
        json(200, {
          success: true,
          data: matches.slice(0, Number.isFinite(limit) && limit > 0 ? limit : 10).map((document) => {
            const base = KNOWLEDGE_BASES.find(entry => entry.id === document.knowledge_base_id)
            return {
            id: document.knowledge_id,
            id: document.knowledge_id,
            knowledge_id: document.knowledge_id,
            title: document.knowledge_title,
            file_name: document.knowledge_filename ?? document.knowledge_title,
            knowledge_base_id: document.knowledge_base_id,
            knowledge_base_name: base === undefined ? document.knowledge_base_id : base.name,
            knowledge_title: document.knowledge_title,
            knowledge_title: document.knowledge_title,
            knowledge_filename: document.knowledge_filename ?? document.knowledge_title,
            knowledge_base_id: document.knowledge_base_id,
            description: document.description,
            }
          }),
        })
        return
      }

      if (request.method === 'GET' && url.pathname.startsWith('/api/v1/knowledge/')) {
        const knowledgeId = decodeURIComponent(url.pathname.slice('/api/v1/knowledge/'.length))
        const document = DOCUMENTS.find(entry => entry.knowledge_id === knowledgeId)
        if (document === undefined) {
          json(404, { success: false, error: { message: 'knowledge not found' } })
          return
        }
        json(200, {
          success: true,
          data: {
            knowledge_id: document.knowledge_id,
            title: document.knowledge_title,
            file_name: document.knowledge_filename ?? document.knowledge_title,
            summary: document.description,
            knowledge_title: document.knowledge_title,
            knowledge_base_id: document.knowledge_base_id,
            description: document.description,
          },
        })
        return
      }

      if (request.method === 'GET' && url.pathname.startsWith('/api/v1/chunks/')) {
        const knowledgeId = decodeURIComponent(url.pathname.slice('/api/v1/chunks/'.length))
        const document = DOCUMENTS.find(entry => entry.knowledge_id === knowledgeId)
        if (document === undefined) {
          json(404, { success: false, error: { message: 'knowledge not found' } })
          return
        }
        const page = Number(url.searchParams.get('page') ?? '1')
        const pageSize = Number(url.searchParams.get('page_size') ?? '10')
        const start = (page - 1) * pageSize
        json(200, {
          success: true,
          data: document.chunks.slice(start, start + pageSize).map((content, index) => ({
            id: `${knowledgeId}-chunk-${start + index}`,
            knowledge_id: knowledgeId,
            knowledge_base_id: 'kb-product',
            content,
            chunk_index: start + index,
            is_enabled: true,
          })),
          total: document.chunks.length,
          page,
          page_size: pageSize,
        })
        return
      }

      if (request.method === 'POST' && url.pathname === '/api/v1/sessions') {
        json(201, { success: true, data: { id: 'session-mock-1', title: body.title ?? '' } })
        return
      }

      const chatMatch = /^\/api\/v1\/(knowledge-chat|agent-chat)\/(.+)$/.exec(url.pathname)
      if (request.method === 'POST' && chatMatch !== null) {
        const [, route, sessionId] = chatMatch
        response.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        })
        const send = payload => response.write(`event:message\ndata:${JSON.stringify(payload)}\n\n`)
        if (options.streamError === true) {
          send({ id: 'e1', response_type: 'error', content: 'model provider unavailable', done: true })
          response.end()
          return
        }
        // The RAG route retrieves only what the request scopes: a session holds
        // no knowledge base of its own (CreateSessionRequest carries none), so
        // WeKnora has no default to fall back on and answers from nothing.
        // Retrieving here anyway would hide an unscoped ask from the tests. The
        // agent route does have a server-side default, its KBSelectionMode.
        const scoped = (body.knowledge_base_ids ?? []).length > 0 || (body.knowledge_ids ?? []).length > 0
        const results = rewriteResources(
          route === 'agent-chat' || scoped
            ? searchResults(body.query ?? '', body.knowledge_base_ids ?? [], [])
            : [],
          publicMode,
        )
        if (route === 'agent-chat') {
          send({
            id: 't1',
            response_type: 'tool_call',
            content: '',
            done: false,
            session_id: sessionId,
            tool_calls: [{ id: 'call-1', function: { name: 'knowledge_search', arguments: '{}' } }],
          })
        }
        send({ id: 'r1', response_type: 'references', content: '', done: false, knowledge_references: results })
        const pieces = answerFor(body.query ?? '', results).match(/.{1,24}/gs) ?? []
        // A stream cut off mid-answer, which is what a dropped connection or a
        // killed backend looks like: answer deltas but no `complete`.
        if (options.streamTruncated === true) {
          send({ id: 'a1', response_type: 'answer', content: pieces[0] ?? '', done: false, session_id: sessionId })
          response.end()
          return
        }
        for (const piece of pieces) {
          send({ id: 'a1', response_type: 'answer', content: piece, done: false, session_id: sessionId })
        }
        send({ id: 'c1', response_type: 'complete', content: '', done: true, session_id: sessionId })
        response.end()
        return
      }

      json(404, { success: false, error: { message: `no route for ${request.method} ${url.pathname}` } })
      }

      // Latency is applied to the whole request so the picker can show its
      // loading state; it is what the control surface toggles.
      if (runtime.delayMs > 0) setTimeout(route, runtime.delayMs)
      else route()
    })
  })

  // onlyBases narrows the deployment to the named bases: a single visible base
  // is what makes a session auto-select without any UI.
  //
  // baseCount synthesizes a wide deployment instead, which is what the picker's
  // search box needs (it only appears from six bases up). Synthetic bases carry
  // a description on every third entry so filtering can be checked against both
  // name and description.
  const synthesized = count => Array.from({ length: count }, (_, index) => {
    const n = String(index + 1).padStart(2, '0')
    return {
      id: `kb-syn-${n}`,
      name: `知识库 ${n}`,
      description: index % 3 === 0 ? '合成夹具：季度归档与检索演练' : '',
    }
  })

  const servedBases = () => {
    // `0` is a real state (a deployment with no knowledge bases), so it must be
    // distinguishable from "no override configured".
    if (runtime.baseCount !== undefined) return synthesized(runtime.baseCount)
    if (Array.isArray(runtime.onlyBases)) {
      return KNOWLEDGE_BASES.filter(base => runtime.onlyBases.includes(base.id))
    }
    return KNOWLEDGE_BASES
  }

  // A fixed port keeps a GUI session's configured base URL valid across restarts.
  const port = Number(options.port) > 0 ? Number(options.port) : 0
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve))
  const bound = server.address().port
  return {
    url: `http://127.0.0.1:${bound}/api/v1`,
    requests,
    /** Force `path` to answer `status` from now on. */
    fail(path, status) {
      failures.set(path, status)
    },
    /** Every forced failure, for a control surface to report back. */
    failures() {
      return Object.fromEntries(failures)
    },
    setDelay(ms) {
      runtime.delayMs = Number(ms) > 0 ? Number(ms) : 0
    },
    setBaseCount(count) {
      const value = Number(count)
      runtime.baseCount = Number.isFinite(value) && value >= 0 ? value : undefined
    },
    baseCount() {
      return runtime.baseCount
    },
    /** Restore the fixture to its initial state. */
    reset() {
      failures.clear()
      runtime.delayMs = 0
      runtime.baseCount = Number(options.baseCount) > 0 ? Number(options.baseCount) : undefined
      runtime.onlyBases = Array.isArray(options.onlyBases) ? [...options.onlyBases] : undefined
    },
    async close() {
      await new Promise(resolve => server.close(resolve))
    },
  }
}

export { ARCH_HANDLE, ARCH_PUBLIC, DOCUMENTS, KNOWLEDGE_BASES }
