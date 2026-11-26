import assert from 'node:assert/strict'
import { test } from 'node:test'

import { WeknoraApiError } from '../dist/client.js'
import { describeError } from '../dist/errors.js'

/** A fetch-level failure keeps its errno on `cause`, sometimes two levels down. */
function transport(code, depth = 1) {
  const error = new Error('GET /knowledge-bases failed: fetch failed')
  if (depth === 1) error.cause = { code }
  if (depth === 2) error.cause = new Error('connect failed', { cause: { code } })
  return error
}

test('an HTTP status wins over the generic transport wording', () => {
  assert.match(describeError(new WeknoraApiError('nope', 401)), /鉴权失败/)
  assert.match(describeError(new WeknoraApiError('nope', 403)), /权限不足/)
  assert.match(describeError(new WeknoraApiError('nope', 404)), /接口不存在/)
  assert.match(describeError(new WeknoraApiError('nope', 429)), /请求过于频繁/)
})

test('a refused connection says so instead of quoting fetch', () => {
  assert.match(describeError(transport('ECONNREFUSED')), /端口未开放/)
  assert.match(describeError(transport('ECONNREFUSED', 2)), /端口未开放/, 'the cause chain is walked')
  assert.doesNotMatch(describeError(transport('ECONNREFUSED')), /fetch failed/)
})

test('DNS and TLS failures each get their own sentence', () => {
  assert.match(describeError(transport('ENOTFOUND')), /无法解析服务地址/)
  assert.match(describeError(transport('EAI_AGAIN')), /无法解析服务地址/)
  assert.match(describeError(transport('CERT_HAS_EXPIRED')), /TLS 证书校验失败/)
})

test('a bare fetch failure still avoids the raw wording', () => {
  const message = describeError(new Error('GET /x failed: fetch failed'))
  assert.match(message, /无法连接到服务地址/)
})

test('timeouts and cancellations are distinguished', () => {
  const timeout = new Error('timed out')
  timeout.name = 'TimeoutError'
  assert.match(describeError(timeout), /请求超时/)
  const aborted = new Error('aborted')
  aborted.name = 'AbortError'
  assert.match(describeError(aborted), /请求已取消/)
})

test('anything else passes through rather than becoming a mystery', () => {
  assert.equal(describeError(new Error('something specific')), 'something specific')
  assert.equal(describeError('a string'), 'a string')
})
