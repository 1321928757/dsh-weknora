/**
 * The Typert manifest for this package's host face.
 *
 * `@deepseek-ai/dsh-typert-loader` finds it through `exports["./typert"]` and
 * validates it field by field: `package` must equal the package name, `face`
 * must be exactly `"host"`, every codec must be `mode: "strict"` with a `create()`
 * factory (the api gateway calls `codec.create().parse(value)`), and `model`
 * must exist even when empty — a missing `model` fails the whole loader row,
 * which would take every plugin's RPC routing down with it.
 *
 * Keep `package` in sync with package.json; `test/bundle-manifest.test.mjs`
 * asserts it.
 */
import { z } from 'zod'

const argsCodec = {
  mode: 'strict' as const,
  typeSymbol: '@wxg-prc-cpg/dsh-weknora#Args',
  create: () => z.record(z.string(), z.unknown()),
}
const resultCodec = {
  mode: 'strict' as const,
  typeSymbol: '@wxg-prc-cpg/dsh-weknora#Result',
  create: () => z.record(z.string(), z.unknown()),
}

const invocation = (method: string) => ({
  id: `weknora/${method}`,
  service: 'weknora',
  namespace: 'weknora',
  method,
  invocation: { kind: 'direct' as const },
  parameters: [{ name: 'args', wire: 'args', source: 'json', codec: argsCodec }],
  result: resultCodec,
})

const member = (name: string, signature: string, summary: string, jsDoc: string) => ({
  kind: 'method' as const,
  name,
  signature,
  summary,
  jsDoc,
})

const METHODS = [
  'getSelection',
  'setSelection',
  'listKnowledgeBases',
  'testConnection',
  'getConfigStatus',
  'forgetSession',
  'setApiKey',
] as const

export const TYPERT = {
  package: '@wxg-prc-cpg/dsh-weknora',
  face: 'host',
  schemas: [],
  invocations: METHODS.map(invocation),
  model: {
    services: [
      {
        description:
          'dsh-weknora 知识库服务 (ctx.weknora)：会话级知识库选择、知识库列表、连通性自检与凭据写入。'
          + 'dsh-weknora knowledge service (ctx.weknora): per-session selection, listing, '
          + 'connectivity check and credential write.',
        summary: 'dsh-weknora 知识库服务 (dsh-weknora knowledge service)。',
        tags: [],
        jsDoc: '/** dsh-weknora 知识库服务 (ctx.weknora)。dsh-weknora knowledge service (ctx.weknora). */',
        key: 'weknora',
        exportName: 'WeknoraService',
        members: [
          member(
            'getSelection',
            'getSelection(args: object): Promise<object>',
            '读取会话已选知识库与当前可见列表。Read the selection and the visible bases for a session.',
            '/**\n * @param args - { sessionId }\n * @returns { ok:true, knowledgeBaseIds, knowledgeBases, fetchedAt } 或 { ok:false, error }\n */',
          ),
          member(
            'setSelection',
            'setSelection(args: object): Promise<object>',
            '原子替换会话已选知识库集合（空数组=清空，随即不再暴露工具）。Replace a session knowledge-base set.',
            '/**\n * @param args - { sessionId, knowledgeBaseIds: string[] }\n * @returns { ok:true, knowledgeBaseIds, knowledgeBases } 或 { ok:false, error }\n */',
          ),
          member(
            'listKnowledgeBases',
            'listKnowledgeBases(args: object): Promise<object>',
            '列出该凭据可见的知识库，refresh 为真时强制回源。List visible bases; refresh forces a round trip.',
            '/**\n * @param args - { refresh?: boolean }\n * @returns { ok:true, knowledgeBases, fetchedAt } 或 { ok:false, error }\n */',
          ),
          member(
            'testConnection',
            'testConnection(args: object): Promise<object>',
            '测试未保存的服务地址或已保存配置的连通性，不写入任何状态。Test connectivity without persisting anything.',
            '/**\n * @param args - { baseUrl?, apiKey? }\n * @returns { ok:true, latencyMs, knowledgeBaseCount } 或 { ok:false, error }\n */',
          ),
          member(
            'getConfigStatus',
            'getConfigStatus(): Promise<object>',
            '配置摘要：服务地址、是否有密钥、启用工具与知识库数量（永不含密钥本身）。Config summary; never the key.',
            '/**\n * @returns { ok:true, configured, baseUrl, hasApiKey, toolPrefix, hasCustomAgent, enabledTools, knowledgeBaseCount, fetchedAt, hintWhenUnselected }\n */',
          ),
          member(
            'forgetSession',
            'forgetSession(args: object): Promise<object>',
            '丢弃一个会话的选择（会话销毁时由宿主自动调用）。Drop a session selection.',
            '/**\n * @param args - { sessionId }\n * @returns { ok:true, forgotten } 或 { ok:false, error }\n */',
          ),
          member(
            'setApiKey',
            'setApiKey(args: object): Promise<object>',
            '写入或清除 API Key（空字符串=清除），永不回显。Write or clear the API key; never echoed.',
            '/**\n * @param args - { apiKey: string }\n * @returns { ok:true, hasApiKey } 或 { ok:false, error }\n */',
          ),
        ],
        types: [],
      },
    ],
    events: [],
    objects: [],
  },
}

export default TYPERT
