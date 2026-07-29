# AGENTS.md

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

- HTML5 / CSS3 / 原生 JavaScript（ES2020+，使用了 `replaceAll`、可选链等语法），`app.js` 以 `defer` 方式加载。
- 部署目标为 **Cloudflare Pages**（纯静态托管），由 `wrangler.toml` 和 `_headers` 配置。
- 浏览器 API 依赖：`localStorage`、`navigator.clipboard`（带 `window.prompt` 降级方案）。
- 视觉风格对齐姊妹项目 elisa-curve-tool：背景 `#F7F4EE`、主色 teal-600 `#0d9488`、卡片白底圆角 14px + `shadow-sm`、`ui-sans-serif` 系统字体栈 + 衬线品牌字（仅 "YDchen" 一词为衬线）。

## 文件结构与模块划分

```text
.
├── index.html       # 页面结构：三个步骤卡片（参数设置 / 样本录入 / 配平结果）+ 使用说明
├── styles.css       # 全部样式：CSS 变量主题（仅 light）、卡片布局、状态色
├── app.js           # 全部逻辑（单文件，约 680 行），见下
├── tests/
│   └── test-calculator.js  # 自包含的纯函数测试（node 直接运行）
├── wrangler.toml    # Cloudflare Pages 配置：name = "wb-balancer"，pages_build_output_dir = "."
├── _headers         # Cloudflare Pages 安全响应头（含严格的 CSP）
├── .gitignore       # 忽略 .wrangler/、.dev.vars、node_modules/、系统文件
└── README.md        # 面向用户的说明（中文）
```

`app.js` 内部分层（从上到下）：

1. DOM 引用集中在一个 `elements` 对象中；
2. 状态管理：`getDefaultState()` / `loadState()` / `saveState()`（localStorage 持久化）、`saveCurrentSamples()` / `loadModeSamples()`（按模式存取样本）；
3. 工具函数：`toFiniteNumber()` / `formatVolume()` / `formatNumber()` / `formatConcentration()` / `escapeHtml()` / `roundToStep()` / `suggestPreDilution()`；
4. `syncControlsFromState()`：按当前模式显示/隐藏对应设置项，并把状态写回控件（**新增设置项时别忘了在这里同步**）；
5. 计算核心 `calculate()`：读取设置 → 按模式分支计算各样本体积 → 生成校验消息与严重级别（ok / warning / error）→ `renderResults()` + `saveState()`；
6. 渲染：`renderSampleRows()`（样本行由 `<template id="sampleRowTemplate">` 克隆，按模式显示不同列）、`renderResults()`（统计卡片 + 提示条 + 结果表格，表头按模式生成）；
7. `pasteData()`（制表符分隔粘贴导入，**列映射按模式不同**：rebalance 模式第二列是 ImageJ 内参值，其余模式是蛋白浓度）、`copyResults()`（剪贴板 API 失败时降级为 `window.prompt`）；
8. `bindEvents()` + 文件末尾的初始化调用（`loadState()` → `syncControlsFromState()` → `renderSampleRows()` → `bindEvents()` → `calculate()`）。

## 计算公式（修改逻辑时勿改错）

```text
equalize：目标浓度 = min(所有有效浓度)；总蛋白量 = 浓度 × 体积；
          最终体积 = 总蛋白量 ÷ 目标浓度；需加 1× Loading = 最终体积 − 当前体积
perWell：理论取样 = 目标蛋白量 ÷ 浓度；1× Loading = 上样体积 × (1 + 损耗) − 理论取样
rebalance：参考值 = min(ImageJ 内参值)；基准体积 = 上轮取样体积 × (1 + 损耗)，未填则为上样体积 × (1 + 损耗)；
          修正样本体积 = 基准体积 × (参考值 ÷ ImageJ 值)；1× Loading = 上样体积 × (1 + 损耗) − 修正样本体积
prep：样品体积 = 目标蛋白量 ÷ 浓度；Loading Buffer = 终体积 × (1 + 损耗) ÷ 倍数；
      补液 = 终体积 × (1 + 损耗) − 样品体积 − Loading Buffer
```

公共规则：建议实取体积由 `roundToStep()`（步长 0.1 µL、最小 0.5 µL）得出；理论体积 < 0.5 µL 时由 `suggestPreDilution()` 给出预稀释建议。损耗余量（`lossMargin`，百分比）在 perWell / rebalance / prep 模式生效。数值上 1 mg/mL = 1 µg/µL。

## 构建与运行命令

没有构建步骤。测试为自包含脚本（不依赖 app.js，是被测函数的拷贝，改动计算逻辑时需同步更新）：

- 运行测试：`node tests/test-calculator.js`（应输出 `54 passed, 0 failed`）
- 语法检查：`node --check app.js`
- 本地预览（任选其一）：
  - 直接双击打开 `index.html`；
  - `python -m http.server 8000` 后访问 `http://localhost:8000`；
  - `npx wrangler pages dev .`（模拟 Cloudflare Pages 环境，会应用 `_headers`）。
- 部署：
  - 推荐 Cloudflare Pages 连接 GitHub 仓库自动部署（Framework preset 选 `None`，build command 留空或 `exit 0`，输出目录 `.`）；
  - 或命令行：`npx wrangler login` 一次，然后 `npx wrangler pages deploy . --project-name wb-balancer`（项目名须与 `wrangler.toml` 一致）。

## 验证改动的方式

1. `node tests/test-calculator.js` 和 `node --check app.js` 通过；
2. 用上述任一方式在浏览器打开页面，四种模式各切换一次，确认设置项和表格列随模式正确显隐；
3. 输入/修改样本浓度或 ImageJ 值，确认各体积按公式变化、校验消息和状态徽章正确；
4. 测试粘贴数据（各模式列含义不同）和复制结果；
5. 刷新页面确认状态（含各模式各自的样本）从 localStorage 恢复；点"恢复默认"确认重置；
6. 打开浏览器控制台确认无报错。

## 代码风格与约定

- 文件顶部 `'use strict';`；函数声明式（`function name()`），无类、无模块系统；现状使用 `var`，新增代码保持与周围一致。
- 数值处理统一走 `toFiniteNumber()`（空值返回 `null`）；显示格式化统一走 `formatVolume()` / `formatConcentration()` / `formatNumber()`。
- 比较浮点数时使用 `1e-9` 容差，不要改成严格相等。
- 动态拼接 HTML 时，用户输入必须经过 `escapeHtml()` 转义（`renderResults` 中已有范例）。
- 面向用户的文本（按钮、提示、校验消息）使用中文；复制结果的表头也是中文。
- 新增样本相关字段时，需同步处理：`blankSamples()` 与状态默认值、`saveCurrentSamples()` / `loadModeSamples()`（localStorage 读写）、`renderSampleRows()` 的列显隐、`updateSampleFromInput()`、粘贴导入的列映射、`copyResults()` 这几条路径。新增设置项时需同步：`getDefaultState()`、`syncControlsFromState()`（显隐 + 回写值）、`readSettings()`、`bindEvents()` 的监听。

## 安全注意事项

- 这是零信任边界的纯静态应用：不引入网络请求（CSP 中 `connect-src 'none'`），改动时**不要**添加任何外链脚本、字体、统计或 CDN 资源——`_headers` 中的 CSP（`script-src 'self'; style-src 'self'`）会阻止它们，且违背"数据不出浏览器"的隐私承诺。
- 若新增内联脚本或内联样式，必须先调整 CSP，尽量不要这样做。
- 用户输入渲染进 HTML 前必须转义。
- 不要读取或提交 `.dev.vars` 等本地机密文件（已在 `.gitignore` 中）。
