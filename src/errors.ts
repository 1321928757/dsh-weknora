/** Human-readable reasons for the failures a user can actually act on. */

import { WeknoraApiError } from './client.ts'

/**
 * Turn a thrown value into a sentence a non-engineer can act on. Never includes
 * the API key: `WeknoraApiError` already redacts it at construction.
 */
export function describeError(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'TimeoutError') return '请求超时：服务地址不可达或响应过慢'
    if (error.name === 'AbortError') return '请求已取消'
    // Transport failures are checked first: the client wraps them in its own
    // error type, so a status-first branch would return "fetch failed" verbatim.
    // A real HTTP status never produces these codes or this wording.
    const code = transportCode(error)
    if (code === 'ECONNREFUSED') return '无法连接到服务地址：端口未开放（ECONNREFUSED）'
    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return '无法解析服务地址：请检查域名或 DNS（ENOTFOUND）'
    if (code === 'ECONNRESET') return '连接被对端重置：请重试，或确认服务是否健康（ECONNRESET）'
    if (code === 'CERT_HAS_EXPIRED' || code === 'DEPTH_ZERO_SELF_SIGNED_CERT') {
      return 'TLS 证书校验失败：请检查服务证书（自签证书需要改用受信证书）'
    }
    if (/fetch failed/i.test(error.message)) return '无法连接到服务地址：请检查地址、网络与端口'
  }
  if (error instanceof WeknoraApiError) {
    switch (error.status) {
      case 401:
        return '鉴权失败：API Key 无效或已过期（HTTP 401）'
      case 403:
        return '权限不足：这个 API Key 不能访问该资源（HTTP 403）'
      case 404:
        return '接口不存在（HTTP 404）：请确认服务地址指向 WeKnora，且地址末尾不需要多余的路径'
      case 429:
        return '请求过于频繁（HTTP 429）'
      case 500:
      case 502:
      case 503:
      case 504: {
        // Keep whatever the server said, minus the redundant request prefix.
        const detail = error.message.replace(/^[A-Z]+ \S+ failed with HTTP \d{3}: /, '')
        return `WeKnora 服务端错误（HTTP ${error.status}）${detail === '' ? '' : `：${detail}`}`
      }
      default:
        break
    }
    return error.message
  }
  if (error instanceof Error) return error.message
  return String(error)
}

/** Walk `cause` for the first errno-style code fetch hides there. */
function transportCode(error: Error): string | undefined {
  let current: unknown = error
  for (let depth = 0; depth < 4 && current !== null && typeof current === 'object'; depth += 1) {
    const code = (current as { code?: unknown }).code
    if (typeof code === 'string') return code
    current = (current as { cause?: unknown }).cause
  }
  return undefined
}
