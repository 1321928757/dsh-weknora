# dsh web 浮层表面参考（WeKnora 插件实测）

这份文档回答一个问题：**在这个 shell 里，"和宿主一样的浮层"具体是什么材质**。所有数值都是
`scripts/audit-picker-surface.mjs` 与 `scripts/dark-matrix.mjs` 在真实 GUI 里读计算样式得到的，
不是目测或从设计稿抄的。

## 1. 表面材质

| 项 | 明色 | 暗色 |
|---|---|---|
| 填充 | `rgba(252, 253, 254, 0.7)` | `rgba(48, 49, 54, 0.64)` |
| 背景模糊 | `backdrop-filter: blur(40px) saturate(1.5)` | 同左 |
| 抬升 | `0 0 0 .5px rgba(0,0,0,.16), 0 4px 16px rgba(0,0,0,.12)` | `0 0 0 .5px rgba(255,255,255,.2), 0 4px 16px rgba(0,0,0,.4)` |
| 页眉/页脚 | `rgba(248, 249, 250, 0.94)` | 由暗色 token 派生 |
| 行背景 | 透明（不许再叠一层 alpha） | 同左 |
| 定位 | `position: fixed; z-index: 60` | 同左 |

两条必须成对出现：**填充是半透明的，就一定要有 `backdrop-filter`**。只给 alpha 不给模糊，正文
会透上来变成灰糊；只给模糊不给 alpha，表面会硬得像另一个应用。

## 2. 主题切换机制

shell **只用** `@media (prefers-color-scheme: dark)` 切主题：

- 设 `data-ds-theme` / `data-theme` 属性**不会**切换配色（实测无效，不要依赖）；
- 想验证暗色又不改系统主题，用 CDP 的 `Emulation.setEmulatedMedia` 把
  `prefers-color-scheme` 置为 `dark` —— `scripts/dark-matrix.mjs` 就是这么做的；
- 因此插件的暗色适配也只能挂在同一个媒体查询上，不要自己加类名开关。

## 3. 小字对比度：为什么要派生 token

把为大字号设计的 `--dsw-alias-label-tertiary` 用在 11.5px 上是错的：审计脚本首次运行就报
`.weknora-row-desc` **3.66:1**（门槛 4.5:1）。修法不是放大字号，而是派生两个**小字专用** token，
向 `label-primary` 混色：

| token | 混色比例 | 明色实测 | 暗色实测 |
|---|---|---|---|
| `--wk-fg-3-small` | tertiary 78% + primary 22% | 5.26:1 | 8.32:1 |
| `--wk-fg-4-small` | quaternary 55% + primary 45% | 5.20:1 | 8.78:1 |

暗色整体更宽松（24 个标签最差 7.30:1），但 token 必须两边都成立，所以混色比例按明色定。

## 4. 怎么自己验

```sh
# 明色：直接对运行中的 GUI 逐条判定（退出码非零=有检查不平，可进 CI）
node scripts/audit-picker-surface.mjs --target <cdp target id>

# 暗色：私有 headless Chrome + 媒体特性模拟，截图并实测对比度
node scripts/dark-matrix.mjs --url http://127.0.0.1:60013 --token <token>

# 生成界面快照（样式与 DOM 都来自实现本身）
node scripts/capture-mockup.mjs --target <cdp target id>
```

审计规则：正文与次要文字门槛 **4.5:1**；≥18.66px 的标题或单个字形（图标）门槛 **3:1**。
每个文本节点按**自己的背景链**合成后再算，而不是拿一个全局背景色去比。

## 5. 已知边界

- `z-index: 60` 与 shell 自身浮层（命令面板、设置弹窗）的层叠关系未逐一验证；
- `color-mix()` 需要 Chromium ≥ 111；桌面端 Electron 44 与当代浏览器都满足，`@supports not`
  分支里保留了降级色；
- 弹层 portal 到 `document.body`，所以 `--wk-*` 变量必须同时声明在 `.weknora-root` 与
  `.weknora-panel` 上，少一个就会出现"变量丢失"式的透明/黑字。
