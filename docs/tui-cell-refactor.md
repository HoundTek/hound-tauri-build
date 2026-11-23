# htb TUI 重构设计：Cell（字符对象）模型 · 缓冲渲染 · 现代化终端特性

> 日期：2026-11-23
> 范围：`lib/term/`（新增 cell/sgr/buffer/screen/caps）、`tui-app/`（渲染出口与组件迁移）
> 关系：本文档是 `refactor-2026-11.md` 任务二（终端字符串模型）的后续与升级。
> 字符串模型（raw/plain/width + slice/truncate/wrap/pad）保留为**行内文本层**；
> 本文档在其上建立**二维 Cell 缓冲层**，作为 TUI 渲染的唯一出口。

---

## 0. 背景：为什么字符串模型不够

现有架构中，组件产出的是「带 ANSI 的字符串行」，最终 `HOME + page.join('\n') + CLEAR_EOS` 整帧重绘。字符串是一维的，而终端画面是二维的，由此产生一组结构性问题：

| 现象 | 根因 |
| --- | --- |
| 底部溢出切掉日志框边框 / footer | 布局用未折行的条数估算高度，实际行数更多；字符串层面无法在拼装前发现总高超限 |
| 宽度溢出（Width overflow 警告、行被截到屏幕外） | 每行宽度靠各组件自觉，拼装时没有统一的裁剪兜底；已修复的根因：`strip-ansi` 无法剥离 ST（`\x1b\\`）终止的 OSC 8 链接（cargo/rustc 错误输出的格式），`width()` 把链接 URL 算成可见宽度误触发守卫 → `plain()` 改用自家 `skipAnsi` 实现（2026-11-23） |
| 横向滚动需要 `term.slice` 按列切字符串 | 字符串切片每次都要重新 tokenize，且边缘指示器、焦点高亮需要二次叠加，逻辑分散易错 |
| 焦点/选区高亮要操作字符串区间 | `highlight.mjs` 在字符串上找列区间再注入 SGR，与 grapheme/ANSI 边界反复搏斗 |
| 整帧重绘闪烁、吞吐浪费 | 每帧重写全部单元格，即使只有计数器变了一位 |
| 样式能力只有「最后一个 SGR 串」 | tokenizer 只追踪 sgr 原文 + osc8，无法表达/比较/降级结构化样式（如 24 位色在低色终端的降级、curly underline 不支持时的回落） |
| 样式硬编码散落 | `theme.focusBg='\x1b[100m'` 之类的字面量无法做能力检测与降级 |

**核心决策**：把终端画面建模为 `rows × cols` 的 **Cell 对象二维网格**（参考 tcell / notcurses / blessed 的成熟范式），所有绘制写入缓冲（越界自动裁剪），渲染出口做**差量 flush**（只重绘变化的格子，同步输出包裹防撕裂）。字符串 API 保留：组件仍可先产出 raw 字符串，`Buffer.write(x, y, raw)` 一次解析落入格子。

## 1. 现代化终端特性清单

### 1.1 输出侧（本方案覆盖）

| 特性 | 序列 | 支持策略 |
| --- | --- | --- |
| 16 色 / 256 色 / 24 位 truecolor | SGR 30-37,90-97 / `38;5;n` / `38;2;r;g;b`（背景 48） | Cell 存结构化颜色，序列化时按能力降级（见 §3.4） |
| 粗体/暗色/斜体/反白/隐藏/删除线/闪烁 | SGR 1,2,3,7,8,9,5 | Cell attrs 位标志，全量支持 |
| 下划线样式：单/双/卷曲/点/虚线 | SGR `4:0..4` | Cell 存 underlineStyle；终端不支持时降级为单下划线 |
| 下划线颜色 | SGR `58;5;n` / `58;2;r;g;b` | 支持，随色级降级；`59` 复位 |
| 上划线 | SGR 53 | 支持（宽终端字符绘制用） |
| OSC 8 超链接（含 id 参数） | `ESC]8;id=..;url BEL` | Cell 存 link 与 linkId；连续同 linkId 的格子序列化为一个链接段 |
| 宽字符（CJK/emoji 占 2 列） | — | Cell 主格 + 续格（continuation），规则见 §2.3 |
| grapheme cluster（ZWJ/组合字符/VS16/国旗） | — | 沿用字符串层的 Intl.Segmenter 分割，cluster 整体占格，绝不拆散 |
| 同步输出（防撕裂） | DEC private mode `?2026h/l` | 每次 flush 包裹；不支持则直接输出（见 §3.4） |
| 备用屏幕 / 光标隐藏 | `?1049h/l`、`?25l/h` | Screen 进入/退出时管理（现状已有，收敛进 Screen） |

### 1.2 输入侧（后续阶段，本文档仅预留接口）

| 特性 | 价值 | 阶段 |
| --- | --- | --- |
| Kitty keyboard protocol（`CSI > flags u`） | 可靠区分 shift+←/→ 等组合键（当前横向滚动键位在部分终端不可靠的根治方案） | Phase D |
| SGR 鼠标（现状已有）+ 像素级坐标 | 已有，保留 | — |
| OSC 52 剪贴板 | 复制的终端内回退通道 | Phase D |
| 焦点事件 `?1004` | 窗口失焦时暂停重绘节能 | Phase D |

### 1.3 明确不做

- 图形协议（sixel / kitty image / iTerm2 inline image）：TUI 是构建日志工具，无位图需求。
- 八色以下的黑白终端特化（`colorLevel 0` 一律纯文本，chalk 已兜底的语义沿用）。

## 2. Cell 模型

### 2.1 类型定义

```js
/** 颜色：null=默认；{mode:'idx',n} 0-255 调色板；{mode:'rgb',r,g,b} 真彩 */
/** @typedef {null | {mode:'idx', n:number} | {mode:'rgb', r:number, g:number, b:number}} Color */

/** 样式属性（Cell.attrs 位标志） */
const A = {
  BOLD: 1, DIM: 2, ITALIC: 4, UNDERLINE: 8, BLINK: 16,
  INVERSE: 32, HIDDEN: 64, STRIKE: 128, OVERLINE: 256,
};

/** 下划线样式（attrs 含 UNDERLINE 时有效） */
const U = { SINGLE: 0, DOUBLE: 1, CURLY: 2, DOTTED: 3, DASHED: 4 };

/**
 * @typedef {Object} Cell
 * @property {string} text      - grapheme cluster 原文；续格恒为 ''
 * @property {number} w         - 1 | 2（主格）；0（续格，占位用）
 * @property {Color} fg
 * @property {Color} bg
 * @property {number} attrs     - A.* 位或
 * @property {number} underline - U.* （仅 attrs 含 UNDERLINE 有意义）
 * @property {?Color} ulColor   - 下划线颜色（SGR 58）
 * @property {?string} link     - OSC 8 URL
 * @property {?string} linkId   - OSC 8 id（相同 id 的格子属于同一链接块）
 */
```

设计要点：

- **样式与文本分离**：样式比较（`sameStyle(a, b)`）与文本比较分开，为差量渲染的 run 合并服务。
- **颜色结构化**：不存 ANSI 字符串，才能做降级与相等比较。
- **默认 Cell 是单例** `BLANK`（空格、无样式），清空 = 填 BLANK，避免逐格分配。

### 2.2 样式状态机（SGR 解析/序列化）

`lib/term/sgr.cjs`：

```
parseSgr(seq, styleState)  → 把一个 SGR 序列作用到 StyleState（原地修改）
  覆盖：0 复位；1,2,3,5,7,8,9,53；4 / 4:0..4；21（按双下划线，现代终端语义）；
       22,23,24,25,27,28,29,55 单项复位；
       30-37,38(2/5),39；40-47,48(2/5),49；90-97,100-107；58(2/5),59
styleToAnsi(style)         → StyleState 序列化为最小 SGR 串（空样式 → ''）
sameStyle(a, b)            → 深度相等（fg/bg/attrs/underline/ulColor/link/linkId）
degradeStyle(style, caps)  → 按能力降级：rgb→256→16；curly/dotted/dashed→SINGLE；
                             无 OSC 8 时剥 link；blink 可选剥除
```

字符串层 `core.tokenize` 目前只追踪「最后一个 SGR 原文」，升级为驱动 `parseSgr` 维护完整 `StyleState`——这是「raw 字符串 → Cell」转换的基础，也让 §2.3 的 `Buffer.write` 成为一遍扫描。

### 2.3 Buffer（二维网格）

`lib/term/buffer.cjs`：

```
class TermBuffer {
  constructor(cols, rows)
  resize(cols, rows)                  // 保留左上角重叠区
  clear()
  set(x, y, cell)                     // 越界静默丢弃（统一裁剪兜底）
  get(x, y)                           // 越界返回 BLANK
  write(x, y, raw, maxW?)             // 解析 raw 落格，返回结束列；越界自动裁剪
  writeWrapped(x, y, raw, w, h?)      // 先 core.wrap 再逐行 write
  fillRect(x, y, w, h, stylePatch)    // 只改样式不动文本（焦点行/选区高亮的正解）
  drawText 已含于 write；drawBox/drawHLine 等图元按需后补
  blit(src, sx, sy, w, h, dx, dy)     // 区域拷贝（横向滚动：全量树缓冲 + 视口 blit）
  toRawLines() → string[]             // 整缓冲序列化（测试/inline 回退）
  dirty 比较由 Screen 负责，Buffer 本身不记录脏区（保持简单）
}
```

**宽字符规则**（tcell 同款，必须严格执行，否则画面腐蚀）：

1. 写入 w=2 的 cluster：主格放 `(x,y)`，`(x+1,y)` 置续格（text='', w=0，样式随主格）。
2. 覆盖某个格子时，若该格是**主格且 w=2**，先把 `(x+1,y)` 恢复为 BLANK；若该格是**续格**，先把 `(x-1,y)` 主格恢复为 BLANK。
3. 行尾只剩 1 列放不下 w=2 cluster：整个 cluster 裁剪（write）或换行（writeWrapped），不画半个字。
4. cluster 永远不可分割（§1.1 grapheme 策略的延续）。

### 2.4 Screen（差量渲染出口）

`lib/term/screen.cjs`：

```
class Screen {
  constructor(out /* process.stdout */)
  enter()                             // 备用屏幕 + 隐藏光标 + 清屏（接管现有 tui-app 初始化）
  exit()                              // 还原
  resize(cols, rows)
  frame(draw: (buf: TermBuffer) => void)   // 关键 API：拿后台缓冲给调用方绘制
  flush()                             // diff front/back → 最小 ANSI 输出
}
```

**diff 算法**（v1 从简，行粒度）：

1. 逐行比较 front/back：完全相同跳过；行不同则定位行内首个/末个差异格，形成 `[x0, x1)` 脏区间。
2. 脏区间内按 `sameStyle` 合并 run：光标定位一次 + 一段样式 + 连续文本。
3. 行间光标移动：相邻行用 `\n`（或 `CUD`），跳行用绝对定位 `CSI row;col H`。
4. 降级阈值：脏行超过 ~70% 时整帧重绘（`HOME` + 全量），避免大量零碎定位反而更慢。
5. 全程包裹 `?2026h … ?2026l`（终端支持时），消除绘制过程中的撕裂帧——**这直接回应此前 24fps 录屏才能抓到的异常帧问题**。

**性能**：同一坐标反复 `frame()` 不产生输出；稳态下（只有计时器/计数变化）每帧输出从整屏（数十 KB）降到几十字节，CPU 与终端带宽同步下降。

## 3. 能力检测与降级

### 3.1 `lib/term/caps.cjs`

```
detectCaps(env = process.env, out = process.stdout) → {
  colorLevel,        // 0|1(16)|2(256)|3(truecolor)：委托 chalk 的 supports-color（已是依赖）
  osc8,              // boolean：TERM_PROGRAM 白名单（iTerm2/WezTerm/kitty/foot/WindowsTerminal/vscode）
                     //   + CI 环境默认关；OSC8 已是现状行为，检测逻辑从 wrap-urls 收敛过来
  syncOutput,        // boolean：?2026 支持（同白名单策略；未知终端假定为 false，安全）
  underlineStyles,   // boolean：4:x 扩展下划线（kitty/wezterm/foot/ghostty…）
  underlineColor,    // boolean：SGR 58
  kittyKeyboard,     // boolean：Phase D 用
}
```

检测结果进程级缓存；`htb doctor` 打印能力报告（顺带排障）。

### 3.2 降级规则

- 颜色：`rgb → 256 → 16 → 无色`。rgb→256 用标准 xterm 立方体/灰阶公式；256→16 查表。只在序列化边界做一次（Screen flush / toRawLines），Buffer 内永远存原始颜色。
- 下划线样式：不支持 `4:x` 时 CURLY/DOTTED/DASHED/DOUBLE → SINGLE。
- OSC 8：不支持时剥掉 link/linkId（文本照常显示）。
- `?2026`：不支持不发送（无需降级逻辑，只是不包裹）。
- blink：低色终端通常仍支持；若 `colorLevel === 0` 连同样式全剥（纯文本）。

## 4. 与现有字符串 API 的关系

| 层 | 模块 | 职责 | 变化 |
| --- | --- | --- | --- |
| 行内文本层（保留） | `lib/term/core.cjs` | raw 字符串的 width/plain/wrap/slice/… | tokenizer 升级为驱动完整 StyleState（行为兼容，现有测试保持全绿） |
| 样式层（保留） | `lib/term/style.cjs` | chalk 链式 + link/task/status | 新增返回结构化样式的入口（供组件直接构造 StyleState，跳过字符串往返） |
| **格子层（新增）** | `lib/term/cell.cjs` / `sgr.cjs` | Cell 类型、SGR 状态机、降级 | 新增 |
| **缓冲层（新增）** | `lib/term/buffer.cjs` | 二维网格 + 绘制原语 | 新增 |
| **出口层（新增）** | `lib/term/screen.cjs` / `caps.cjs` | 差量 flush、能力检测 | 新增 |

`tui-app/utils/term.mjs` 转发层同步暴露新模块（ESM 消费）。inline 模式（`--no-tui`、非 TTY）不走 Screen，继续用字符串层直接写行——**日志落盘、管道输出零影响**。

## 5. TUI 重构方案

### Phase A：格子层基础设施（无行为变化，纯新增 + 测试）

1. `cell.cjs`：类型、BLANK、A/U 常量、sameStyle、degradeStyle。
2. `sgr.cjs`：parseSgr / styleToAnsi，round-trip 测试（语料库：现有 term.test.mjs 全部夹具串 + chalk 全样式 + 4:x/58/53 扩展序列）。
3. `core.cjs` tokenizer 升级：StyleState 全程追踪（sgr 原文 → 结构化），wrap/slice/truncate 行为不变（现有测试作回归网）。
4. `buffer.cjs`：write/set/fillRect/blit/toRawLines；宽字符规则 1-4 的专项测试（半字覆盖、行尾裁剪、续格清理）。
5. `caps.cjs` + `screen.cjs`：diff flush 单测用 fake tty（捕获输出流），断言「单格变化 → 输出只含一次定位 + 一个 run」。

### Phase B：渲染出口切换（行为不变，闪烁消失）

6. `tui-app/index.mjs` 的 buildFrame 改造：`page: string[]` → `Screen.frame(buf => page.forEach((l, y) => buf.write(0, y, l)))`。
   - **底部溢出一类问题在出口被结构性消灭**：多画的行/列被缓冲裁剪，不再顶掉 footer。
   - 整帧重绘 → 差量 flush，`?2026` 包裹，抓拍的异常帧消除。
7. 冒烟：htb build 实跑对比（目验 + 录屏）。

### Phase C：布局与横向滚动迁移到缓冲（吸收进行中的左右布局改造）

8. makePage 不再拼装字符串行，改为在后台缓冲上划分区域直接绘制：
   - 树区：内容绘制进独立的「全宽树缓冲」（宽 = contentW，高 = 可见行），再以视口 `blit(treeBuf, treeX, 0, treeW, bodyH, 0, 1)` 上屏——**横向滚动从字符串 slice 变成纯拷贝**，边缘指示器用 `set` 覆写首末格。
   - 日志区：`log-space` 照旧产出字符串行（带边框），`buf.write(treeW + GAP, 1, line)` 落格；折行宽度计算不变。
   - 焦点/选区高亮：`fillRect(rect, {bg})` 直接改样式，不再对字符串做区间注入——`highlight.mjs` 从「字符串手术」退化为「算矩形」。
9. `flex2.mjs` 删除（左右布局由区域划分常量直接表达，不再需要通用上下分栏）。
10. 树点击/焦点列计算从「原始串列 − treeX」改为「视口列 + treeX」，语义更直白（输入事件层已完成 shift+滚轮/shift+←→，无需再动）。

### Phase D：组件 draw 化与输入侧现代协议（可选，按收益排序）

11. 组件接口演进：`render(): string` → `draw(buf, rect)`，过渡期 Screen 同时支持两种（write raw）。优先迁移：tree（已有全宽缓冲）、log-space（选区变 fillRect）、status-bar。
12. Kitty keyboard protocol opt-in（检测到支持时启用 CSI u 上报）：根治 shift+方向键在部分终端不可达的问题（横向滚动键位可靠性）。
13. OSC 52 复制回退；`?1004` 焦点事件节能。

### 阶段完成标准

- Phase A：`node --test tui-app/tests/` 全绿（新增 cell/sgr/buffer/screen 用例 ≥ 40 条）。
- Phase B：TUI 实跑无闪烁/无残影；`--no-tui` 输出与现状逐字节一致（diff 测试）。
- Phase C：左右布局 + 横向滚动功能对齐原字符串方案的设计（链展开、边缘指示、点击列补偿），且无宽度溢出告警。
- Phase D：逐项独立验收，可整体跳过不影响主线。

## 6. 测试策略

- **round-trip 黄金测试**：`raw → Buffer.write → toRawLines` 与 `raw` 渲染等价（plain 相同、逐格样式相同）。
- **降级矩阵**：同一 StyleState 在 colorLevel 3/2/1/0 下的序列化快照。
- **diff 最小性**：fake tty 断言变化一格时输出字节数上界（如 ≤ 40B）。
- **宽字符腐蚀回归**：覆盖写、行尾写、blit 切割宽字三组场景。
- 现有 101 条测试全程保持绿（tokenizer 升级阶段的回归网）。

## 7. 实施步骤（每步独立可提交）

1. Phase A · cell + sgr + tokenizer 升级（§5.A1-A3）
2. Phase A · buffer + caps + screen（§5.A4-A5）
3. Phase B · 渲染出口切换（§5.B6-B7）
4. Phase C · 左右布局与横向滚动迁移（§5.C8-C10）
5. Phase D · 组件 draw 化 / kitty 键盘 / OSC52（§5.D11-D13，可选）

### 风险与对策

- **tokenizer 升级回归**：StyleState 化改变 sgr 原文记忆方式（如 `\x1b[1;31m` 拆成属性对）。对策：序列化确定性（固定属性顺序）+ 现有测试作为行为锚点，快照差异人工核对。
- **diff 渲染在异常终端的兼容**：定位序列只用最保守的 `CUP/CUD/EL`，不用 insert/delete line；不支持 `?2026` 的终端只是回到逐帧全量（现状）。
- **内存**：Cell 网格 80×24 ≈ 2k 对象/缓冲，双缓冲 + 树全宽缓冲 < 10k 对象，可忽略；行复用数组避免每帧分配。
