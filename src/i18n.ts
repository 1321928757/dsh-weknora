/**
 * Copy for both surfaces. The bundle carries its own dictionary because the
 * shell's locale service is not a plugin contract; a missing translation must
 * degrade to the key's Chinese text, never to an empty string.
 */

export type Language = 'zh' | 'en'

const ZH: Record<string, string> = {
  'picker.trigger.empty': '知识库',
  'picker.title': '选择知识库',
  'picker.subtitle.unselected': '仅对当前会话生效。未选择时不加载 weknora_* 工具。',
  'picker.subtitle.selected': '仅对当前会话生效。已选 {n} 个，检索只在这些库里进行。',
  'picker.all': '全部知识库',
  'picker.all.hint': '检索当前 API Key 可见的所有知识库',
  'picker.all.count': '{n} 个库',
  'picker.search': '搜索知识库名称或描述',
  'picker.search.clear': '清空搜索',
  'picker.noMatch': '没有匹配「{q}」的知识库',
  'picker.selectedCount': '已选 {n} 个',
  'picker.none': '未选择 · 工具不可用',
  'picker.clear': '清空',
  'picker.done': '完成',
  'picker.retry': '重试',
  'picker.openSettings': '打开设置',
  'picker.openSettingsManual': '请手动打开 设置 → WeKnora 知识库（这个 shell 没有可跳转的设置入口）',
  'picker.empty.unconfigured': '还没有配置 WeKnora',
  'picker.empty.unconfiguredHint': '在 设置 → WeKnora 知识库 里填好服务地址与 API Key 之后，这里会列出你的知识库。未选择时不会加载 weknora_* 工具。',
  'picker.empty.none': '这个 API Key 看不到任何知识库',
  'picker.empty.noneHint': '检查它的知识库权限范围，或换一个 Key。',
  'picker.error.load': '拉取知识库失败：{reason}',
  'picker.error.keep': '已选范围保持不变。',
  'picker.toast.added': '已添加「{name}」',
  'picker.toast.removed': '已移除「{name}」',
  'picker.toast.cleared': '已清空，检索工具不再对本次会话可用',
  'picker.toast.failed': '选择未能保存：{reason}',
  'picker.close': '关闭',
  'settings.title': 'WeKnora 知识库',
  'settings.description': '把公司 WeKnora 知识库的检索能力接入 Agent。改动即时生效，不需要重启。',
  'settings.openFile': '打开配置文件',
  'settings.group.connection': '连接',
  'settings.group.auth': '鉴权',
  'settings.group.retrieval': '检索默认值',
  'settings.group.tools': '工具',
  'settings.field.baseUrl': '服务地址',
  'settings.field.baseUrlHint': '只填域名也可以，会自动补 /api/v1。',
  'settings.field.baseUrlUnsaved': '地址已修改，保存后才会生效。',
  'settings.field.status': '状态',
  'settings.field.apiKey': 'API Key',
  'settings.field.apiKeyHint': '需要 retrieve 能力；启用 weknora_ask 还需要 chat。密钥只存本机，不回显、不进模型上下文。',
  'settings.field.tenantId': '工作区 ID',
  'settings.field.tenantIdHint': '仅平台级 API Key 需要（X-Tenant-ID）。',
  'settings.field.maxResults': '召回条数',
  'settings.field.maxChunkChars': '单片段字符上限',
  'settings.field.requestTimeout': '检索超时（秒）',
  'settings.field.chatTimeout': '问答超时（秒）',
  'settings.field.resourceUrls': '引用文件',
  'settings.field.resourceUrlsHint': '限定知识库的 Key 拿不到直链（WeKnora 会 403），插件会自动回退 handle。',
  'settings.field.agentId': '自定义 Agent',
  'settings.field.agentIdHint': '可选；填了之后 weknora_ask 走 ReAct 流水线。留空则用 RAG 流水线。',
  'settings.resource.public': '直链 public',
  'settings.resource.handle': '内部引用 handle',
  'settings.hint.toggle': '未选择时提示模型该插件存在',
  'settings.hint.hint': '约 40 token/步。关掉后模型完全不知道 WeKnora 存在。',
  'settings.tools.footnote': '这些工具只有在当前会话选择了知识库之后才会进入模型上下文；未选择时工具声明、参数 schema 与执行入口都不存在，不占 token。',
  'settings.key.saved': '已保存',
  'settings.key.cleared': '已清除，当前没有 API Key',
  'settings.key.notSet': '未设置',
  'settings.key.replace': '替换',
  'settings.key.clear': '清除',
  'settings.key.placeholder': '粘贴 API Key',
  'settings.key.save': '保存',
  'settings.key.cancel': '取消',
  'settings.test': '测试连接',
  'settings.test.saveAndTest': '保存并测试',
  'settings.testing': '测试中…',
  'settings.status.connected': '已连接 · {ms}ms · {n} 个知识库',
  'settings.status.bases': '已连接 · {n} 个知识库',
  'settings.status.failed': '未连接',
  'settings.status.unknown': '尚未测试',
  'settings.save': '保存',
  'settings.saving': '保存中…',
  'settings.saved': '已保存',
  'settings.reset': '恢复默认',
  'settings.readonly': '当前环境不支持在此保存配置，请改用 profile 的 cordis.patch.yml。',
  'settings.error.summary': '有字段需要修正',
  'settings.error.baseUrl': '请填写 http(s) 开头的地址',
  'settings.error.number': '需要大于 0 的整数',
  'settings.error.toolsAllOff': '至少保留一个工具；要完全关闭请停用插件',
  'settings.error.saveFailed': '保存失败：{reason}',
  'settings.error.keyFailed': '保存 API Key 失败：{reason}',
  'settings.error.testFailed': '测试连接失败：{reason}',
}

const EN: Record<string, string> = {
  'picker.trigger.empty': 'Knowledge',
  'picker.title': 'Choose knowledge bases',
  'picker.subtitle.unselected': 'Applies to this session only. Retrieval tools load only after you pick one.',
  'picker.subtitle.selected': 'Applies to this session only. {n} selected; retrieval stays inside them.',
  'picker.all': 'All knowledge bases',
  'picker.all.hint': 'Search every base this API key can see',
  'picker.all.count': '{n} bases',
  'picker.search': 'Search name or description',
  'picker.search.clear': 'Clear search',
  'picker.noMatch': 'No knowledge base matches “{q}”',
  'picker.selectedCount': '{n} selected',
  'picker.none': 'Nothing selected · tools unavailable',
  'picker.clear': 'Clear',
  'picker.done': 'Done',
  'picker.retry': 'Retry',
  'picker.openSettings': 'Open settings',
  'picker.openSettingsManual': 'Open Settings → WeKnora yourself: this shell exposes no jump target.',
  'picker.empty.unconfigured': 'WeKnora is not configured yet',
  'picker.empty.unconfiguredHint': 'Set the server address and API key in Settings → WeKnora, then your bases appear here. Nothing loads until you pick one.',
  'picker.empty.none': 'This API key sees no knowledge base',
  'picker.empty.noneHint': 'Check its scope, or use a different key.',
  'picker.error.load': 'Could not load knowledge bases: {reason}',
  'picker.error.keep': 'Your selection is unchanged.',
  'picker.toast.added': 'Added “{name}”',
  'picker.toast.removed': 'Removed “{name}”',
  'picker.toast.cleared': 'Cleared — retrieval tools are no longer available here',
  'picker.toast.failed': 'Selection not saved: {reason}',
  'picker.close': 'Close',
  'settings.title': 'WeKnora',
  'settings.description': 'Give the agent retrieval over your WeKnora knowledge bases. Changes apply immediately.',
  'settings.openFile': 'Open config file',
  'settings.group.connection': 'Connection',
  'settings.group.auth': 'Authentication',
  'settings.group.retrieval': 'Retrieval defaults',
  'settings.group.tools': 'Tools',
  'settings.field.baseUrl': 'Server address',
  'settings.field.baseUrlHint': 'A bare host works; /api/v1 is appended for you.',
  'settings.field.baseUrlUnsaved': 'Address edited — it takes effect once you save.',
  'settings.field.status': 'Status',
  'settings.field.apiKey': 'API key',
  'settings.field.apiKeyHint': 'Needs the retrieve scope; weknora_ask also needs chat. Stored locally, never echoed, never sent to the model.',
  'settings.field.tenantId': 'Workspace id',
  'settings.field.tenantIdHint': 'Only for a platform-scoped key (X-Tenant-ID).',
  'settings.field.maxResults': 'Max results',
  'settings.field.maxChunkChars': 'Chunk character budget',
  'settings.field.requestTimeout': 'Retrieval timeout (s)',
  'settings.field.chatTimeout': 'Answer timeout (s)',
  'settings.field.resourceUrls': 'Cited files',
  'settings.field.resourceUrlsHint': 'A base-restricted key cannot receive public URLs (403); the plugin falls back to handle mode.',
  'settings.field.agentId': 'Custom agent',
  'settings.field.agentIdHint': 'Optional; weknora_ask then uses the ReAct pipeline, otherwise RAG.',
  'settings.resource.public': 'Public links',
  'settings.resource.handle': 'Internal handles',
  'settings.hint.toggle': 'Tell the model this plugin exists while nothing is selected',
  'settings.hint.hint': 'About 40 tokens per step. Off means the model has no idea WeKnora is installed.',
  'settings.tools.footnote': 'These tools only enter the model context after the session selects a knowledge base; otherwise their declarations, schemas and entry points are absent and cost nothing.',
  'settings.key.saved': 'Saved',
  'settings.key.cleared': 'Cleared — no API key is set',
  'settings.key.notSet': 'Not set',
  'settings.key.replace': 'Replace',
  'settings.key.clear': 'Clear',
  'settings.key.placeholder': 'Paste the API key',
  'settings.key.save': 'Save',
  'settings.key.cancel': 'Cancel',
  'settings.test': 'Test connection',
  'settings.test.saveAndTest': 'Save & test',
  'settings.testing': 'Testing…',
  'settings.status.connected': 'Connected · {ms}ms · {n} bases',
  'settings.status.bases': 'Connected · {n} bases',
  'settings.status.failed': 'Not connected',
  'settings.status.unknown': 'Not tested yet',
  'settings.save': 'Save',
  'settings.saving': 'Saving…',
  'settings.saved': 'Saved',
  'settings.reset': 'Reset',
  'settings.readonly': 'Configuration cannot be saved here; edit the profile cordis.patch.yml instead.',
  'settings.error.summary': 'Some fields need attention',
  'settings.error.baseUrl': 'Use an http(s) address',
  'settings.error.number': 'Needs a whole number greater than 0',
  'settings.error.toolsAllOff': 'Keep at least one tool; disable the plugin to turn everything off',
  'settings.error.saveFailed': 'Save failed: {reason}',
  'settings.error.keyFailed': 'Saving the API key failed: {reason}',
  'settings.error.testFailed': 'Connection test failed: {reason}',
}

export interface I18n {
  readonly lang: Language
  t(key: string, vars?: Record<string, string | number>): string
}

/**
 * Which language to speak, right now.
 *
 * The shell publishes the active locale on `<html lang>` and updates it when the
 * user switches language, so this must be read per call — caching it at install
 * time would leave the plugin stuck in whatever language was active then.
 * `navigator.language` is only the initial guess for a shell that says nothing.
 *
 * The DOM types are declared structurally here because this module is also built
 * into the host half, whose tsconfig has no `dom` lib.
 */
function detectLanguage(): Language {
  try {
    const scope = globalThis as {
      document?: { documentElement?: { lang?: string } }
      navigator?: { language?: string }
    }
    const tag = String(scope.document?.documentElement?.lang ?? '')
    if (tag !== '') return /^zh/i.test(tag) ? 'zh' : 'en'
    const nav = String(scope.navigator?.language ?? 'zh')
    return nav.toLowerCase().startsWith('zh') ? 'zh' : 'en'
  } catch {
    return 'zh'
  }
}

export function createI18n(): I18n {
  return {
    get lang(): Language {
      return detectLanguage()
    },
    t(key, vars) {
      const table = detectLanguage() === 'zh' ? ZH : EN
      // A missing English string degrades to the Chinese one, never to the key.
      const template = table[key] ?? ZH[key] ?? key
      if (vars === undefined) return template
      return template.replace(/\{(\w+)\}/g, (match, name: string) =>
        Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match)
    },
  }
}
