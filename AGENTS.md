# WB 样本配平工具 — 项目说明（供 AI 编程代理阅读）

供 AI 编码代理阅读的项目说明。假设读者对本项目一无所知。

## 项目概述

**WB 样本配平工具**（wb-balancer）：一个**纯前端**的 Western blot 配平计算器。支持四种配平模式（见下），对浓度无效、可用体积不足、取样体积小于 0.5 µL（自动建议预稀释）等情况给出提示。

四种模式（`state.workflowMode`）：

- `equalize` **变性后重新配平**：样本已变性且体积一致，以最低浓度为目标，加入 1× Loading 将各样本稀释至等浓度。支持"各样本体积不同"逐样本填写体积。
- `perWell` **上样配平**：按每孔目标蛋白量和各样本浓度计算取样体积，用 1× Loading 补足到统一上样体积。
- `rebalance` **ImageJ 配平**：以 ImageJ 内参值作为相对浓度，以最低值为参考按比值修正取样体积；可填写"上轮取样体积"作为基准。
- `prep` **未变性样品配平**：同时计算样品、Loading Buffer（2× / 4× / 5× / 6×）和补液体积。

关键特性：

- **无构建步骤、无依赖**：纯 HTML + CSS + 原生 JavaScript，没有 `package.json`、没有打包器、没有框架。
- **无后端**：所有计算在浏览器本地完成，数据通过 `localStorage`（键名 `wb-balancer-v4`）保存，不上传任何服务器。每个模式的样本数据分开保存（`state.samplesByMode`），切换模式互不影响。
- 支持粘贴数据导入（制表符分隔，从 Excel 复制）、复制结果到剪贴板（制表符分隔）。
- 界面与文档语言为**简体中文**（`lang="zh-CN"`），代码注释和面向用户的文本均使用中文。

## 技术栈与运行时架构

- HTML5 / CSS3 / 原生 JavaScript（ES2020+，使用了 `replaceAll`、可选链等语法）。
- 两个 JS 文件均以 `defer` 方式加载：`calculator.js`（纯计算）先于 `app.js`（UI 控制器）执行。`calculator.js` 的函数暴露为全局变量，`app.js` 直接调用。
- 部署目标为 **Cloudflare Pages**（纯静态托管），由 `wrangler.toml` 和 `_headers` 配置。
- 浏览器 API 依赖：`localStorage`、`navigator.clipboard`（带 `window.prompt` 降级方案）。
- 视觉风格对齐姊妹项目 elisa-curve-tool：背景 `#F7F4EE`、主色 teal-600 `#0d9488`、卡片白底圆角 14px + `shadow-sm`、`ui-sans-serif` 系统字体栈 + 衬线品牌字（仅 "YDchen" 一词为衬线）。

## 文件结构与模块划分

```text
.
├── index.html       # 页面结构：三个步骤卡片（参数设置 / 样本录入 / 配平结果）+ 使用说明
├── styles.css       # 全部样式：CSS 变量主题（仅 light）、卡片布局、状态色
├── calculator.js    # 所有纯计算逻辑（约 486 行），见下
├── app.js           # UI 控制器（约 684 行），见下
├── tests/
│   ├── test-calculator.js  # 计算函数测试（129 项），导入 calculator.js
│   └── test-ui-state.js    # 状态恢复、无障碍标记与结果展示测试（36 项），用 vm 隔离执行 app.js
├── wrangler.toml    # Cloudflare Pages 配置：name = "wb-balancer"，pages_build_output_dir = "."
├── _headers         # Cloudflare Pages 安全响应头（含严格的 CSP，style-src 'self' 不允许内联样式）
├── .gitignore       # 忽略 .wrangler/、.dev.vars、node_modules/、系统文件
└── README.md        # 面向用户的说明（中文）
```

`calculator.js`（纯函数，无 DOM 依赖，可脱离浏览器在 Node 中测试）：

1. 工具函数：`toFiniteNumber()` / `suggestPreDilution()` / `validateLossMargin()`（0%–50%）/ `isSampleNumericallyValid()`（仅看数字字段，用于参考值计算）/ `isSampleComplete()`（含名称，目前仅导出未在 UI 使用）
2. 各模式共用辅助：`createMessages()`（收集消息并决定 severity）/ `multiplyFinite()`（理论体积 × 放大系数）/ `scaledTotal()`（最终体积 × 放大系数）/ `applyPreDilution()`（预稀释建议）/ `warnMissingName()` / `warnSmallLoading()` / `errorIfNotEnoughAvailable()` / `warnPreDilution()` / `allPositive()`（范围错误检测）
3. 各模式计算：`calculateEqualize()` / `calculatePerWell()` / `calculateRebalance()` / `calculatePrep()`——统一返回 `{ results, reference, summary }`
4. 计算链：理论体积 → 损耗余量同比放大 → 预稀释检查 → Loading/补液。不做移液取整。
5. 预稀释场景中：`originalConsumed` 记录原液消耗量（用于检查库存），`sampleVolume` 为稀释后移液体积
6. 末端 `module.exports` 块用于 Node 测试，浏览器环境忽略

`app.js` 内部分层（从上到下）：

1. DOM 引用集中在 `elements` 对象中
2. 格式化函数：`formatVolume()` / `formatNumber()` / `formatConcentration()` / `formatIntensity()` / `escapeHtml()`
3. 结果列定义（纯函数）：`RESULT_COLUMNS` 按模式声明每列的表格表头、复制表头、HTML 单元格与复制文本（含 `loading-col` 类）；`resultHeaders()` / `resultTableHtml()` / `resultCopyRows()` 供渲染与复制共用——**表头和列定义只维护这一份**
4. 状态管理：`getDefaultState()` / `loadState()` / `saveState()`（localStorage，对 `state` 做浅拷贝后移除 `samples` 引用避免重复存储）/ `loadModeSamples()`（`state.samples` 直接引用 `state.samplesByMode[mode]`，不再双写）
5. `syncControlsFromState()`：按当前模式显示/隐藏对应设置项，prep 模式下显示目标蛋白量和最终体积
6. `calculate()`：读取设置 → 委托对应 calculator 函数 → `renderResults()` + `saveState()`
7. 渲染：`renderSampleRows()`（按模式显示不同列）、`renderResults()`（统计卡片 + 提示条 + 结果表格）
8. `pasteData()`：按模式列映射（equalize: name/concentration/availableVolume；perWell: name/concentration/availableVolume；rebalance: name/imageIntensity/availableVolume/prevVolume；prep: name/concentration/availableVolume）
9. `copyResults()`（剪贴板 API 失败时降级为 `window.prompt`）
10. `bindEvents()` + 文件末尾的初始化调用（单次 `calculate()`）

## 计算公式（修改逻辑时勿改错）

展示理论体积，不做移液取整——用户自行判断实际移液量。

```text
equalize：目标浓度 = min(所有数值有效样本浓度)；总蛋白量 = 浓度 × 体积；
          最终体积 = 总蛋白量 ÷ 目标浓度；需加 1× Loading = 最终体积 − 当前体积
          样品名称不影响参考值计算
perWell：scaleFactor = 1 / (1 − 预计损耗率)；
         样品体积 = 目标蛋白量 ÷ 浓度 × scaleFactor；
         预稀释（体积 < 0.5 µL 时）→ 样品体积 = 理论 × 倍数；
         1× Loading = 上样体积 × scaleFactor − 样品体积；
         校验：样品体积 × 浓度 × (1 − 损耗率) ≈ 目标蛋白量
rebalance：
  - 无上轮体积：参考值 = min(ImageJ 值)；样品体积 = 总上样体积 × scaleFactor × (参考值 ÷ ImageJ 值)
  - 有上轮体积：相对浓度 = ImageJ ÷ 上轮体积；参考值 = min(相对浓度)；
    样品体积 = 总上样体积 × scaleFactor × (参考值 ÷ 当前相对浓度)
  - 上轮体积必须全部填写或全部留空，部分填写 → error
prep：scaleFactor = 1 / (1 − 预计损耗率)；
      样品体积 = 目标蛋白量 ÷ 浓度 × scaleFactor；
      预稀释（体积 < 0.5 µL 时）→ 样品体积 = 理论 × 倍数；
      Loading Buffer = 终体积 × scaleFactor ÷ Buffer 倍数；
      补液 = 终体积 × scaleFactor − 样品体积 − Loading Buffer；
      校验：样品体积 × 浓度 × (1 − 损耗率) ≈ 目标蛋白量
```

公共规则：
- 预计损耗率（`lossMargin`，0%–50%）使用严格补偿公式：`scaleFactor = 1/(1−lossMargin/100)`
  保证 `配制量 × (1 − 损耗率) = 目标量`（例如 10% 损耗 → 1/0.9 ≈ 1.111×）
- 样品名称仅用于显示，不影响任何数值计算（`isSampleNumericallyValid` 用于参考值）
- 预稀释后：`sampleVolume` = 稀释液移液体积，`originalConsumed` = 原液实际消耗量
- 数值上 1 mg/mL = 1 µg/µL

## 构建与运行命令

没有构建步骤。测试从 calculator.js 直接导入生产代码（不复制算法）：

- 运行计算测试：`node tests/test-calculator.js`（应输出 `129 passed, 0 failed`）
- 运行状态测试：`node tests/test-ui-state.js`（应输出 `36 passed, 0 failed`）
- 语法检查：`node --check calculator.js && node --check app.js && node --check tests/test-calculator.js && node --check tests/test-ui-state.js`
- 本地预览（任选其一）：
  - 直接双击打开 `index.html`；
  - `python -m http.server 8000` 后访问 `http://localhost:8000`；
  - `npx wrangler pages dev .`（模拟 Cloudflare Pages 环境，会应用 `_headers`）。
- 部署：
  - 推荐 Cloudflare Pages 连接 GitHub 仓库自动部署（Framework preset 选 `None`，build command 留空或 `exit 0`，输出目录 `.`）；
  - 或命令行：`npx wrangler login` 一次，然后 `npx wrangler pages deploy . --project-name wb-balancer`（项目名须与 `wrangler.toml` 一致）。

## 验证改动的方式

1. `node tests/test-calculator.js`（129 passed, 0 failed）、`node tests/test-ui-state.js`（36 passed, 0 failed）和全部 JS 文件 `node --check` 通过；
2. 用上述任一方式在浏览器打开页面，四种模式各切换一次，确认设置项和表格列随模式正确显隐；prep 模式下目标蛋白量可见且可编辑；
3. 输入/修改样本浓度或 ImageJ 值，确认各体积按公式变化、组分之和等于总体积（守恒）、校验消息和状态徽章正确；
4. 测试粘贴数据（各模式列映射正确，只填充该模式的有效列）和复制结果；
5. 刷新页面确认状态（含各模式各自的样本）从 localStorage 恢复；点"恢复默认"确认重置；
6. 打开浏览器控制台确认无报错、无 CSP 违规。

## 代码风格与约定

- 文件顶部 `'use strict';`；函数声明式（`function name()`），无类、无模块系统；现状使用 `var`，新增代码保持与周围一致。
- 纯计算逻辑（公式、校验）写入 `calculator.js`；展示逻辑（格式化、DOM 操作、localStorage）写入 `app.js`。计算函数必须是纯函数，不访问 DOM。
- `saveState()` 对 `state` 做浅拷贝后删除拷贝中的 `samples`（它是 `samplesByMode[mode]` 的引用，避免重复存储），原对象不受影响。
- 数值处理统一走 `toFiniteNumber()`（空值返回 `null`）；显示格式化统一走 `formatVolume()` / `formatConcentration()` / `formatNumber()`。
- 比较浮点数时使用 `1e-9` 容差，不要改成严格相等。
- 动态拼接 HTML 时，用户输入必须经过 `escapeHtml()` 转义。
- 面向用户的文本（按钮、提示、校验消息）使用中文；复制结果的表头也是中文。
- 所有内联 `style="..."` 属性必须改用 CSS 类（CSP `style-src 'self'` 不允许内联样式）。
- 新增样本相关字段时，需同步：`blankSamples()`、`renderSampleRows()` 列显隐、`updateSampleFromInput()`、粘贴导入的列映射（`pasteData()`）、`copyResults()`。新增结果列时只需在 `RESULT_COLUMNS` 增加一项（表格与复制自动生效）。新增设置项时需同步：`getDefaultState()`、`syncControlsFromState()`（显隐 + 回写值）、`readSettings()`、`bindEvents()` 的监听。
- `calculator.js` 新增函数时，同步更新 `tests/test-calculator.js` 和 `calculator.js` 末尾的 `module.exports`。

## 安全注意事项

- 这是零信任边界的纯静态应用：不引入网络请求（CSP 中 `connect-src 'none'`），改动时**不要**添加任何外链脚本、字体、统计或 CDN 资源——`_headers` 中的 CSP（`script-src 'self'; style-src 'self'`）会阻止它们，且违背"数据不出浏览器"的隐私承诺。
- 若新增内联脚本或内联样式，必须先调整 CSP，尽量不要这样做。
- 用户输入渲染进 HTML 前必须转义。
- 不要读取或提交 `.dev.vars` 等本地机密文件（已在 `.gitignore` 中）。

---

## AI 维护提醒

> **⚠️ 任何修改此项目的 AI 代理（包括未来的你自己）都必须遵守：**
>
> - **修改代码后必须同步更新本 AGENTS.md 与 README.md** — 新增文件、架构变更、功能增删、部署方式变更都需要在两份文档中体现
> - README.md 面向**人类用户**（功能介绍、运行方法、部署步骤），AGENTS.md 面向 **AI 代理**（架构、代码组织、测试策略、开发约定）
> - 两份文件**不可互相替代**，各有所众
> - 项目的实际文件结构必须与 AGENTS.md 中列出的文件清单保持一致
