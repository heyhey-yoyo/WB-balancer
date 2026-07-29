# WB 样本配平工具

一个纯前端的 Western blot 样本配平计算器。数据只在当前浏览器中处理，并通过 `localStorage` 保存，不会上传到服务器。

## 功能

四种配平模式，各模式的样本数据分别保存，切换互不影响。

### 变性后重新配平（等浓度稀释）

适用于已经完成变性的样本。以最低浓度样本为目标浓度，通过加入 1× Loading 将各样本稀释至同一浓度：

```text
目标浓度 = min(所有样本浓度)
总蛋白量 = 当前浓度 × 样本体积
最终体积 = 总蛋白量 ÷ 目标浓度
需加 1× Loading 体积 = 最终体积 − 样本体积
```

默认所有样本体积相同，通过全局"样本当前体积"设置。也可勾选"各样本体积不同"逐样本填写。

最低浓度样本无需加入 1× Loading。

### 上样配平

按每孔目标蛋白量和各样本浓度计算取样体积，用 1× Loading 补足到统一上样体积：

```text
样本体积 = 每孔目标蛋白量 ÷ 蛋白浓度
1× Loading 体积 = 统一上样体积 − 样本体积
```

理论取样体积小于 0.5 µL 时会给出预稀释建议；可设置损耗余量（%）按比例放大总体积。

### ImageJ 配平

适用于完成一次 WB 后，使用 ImageJ 对内参条带进行相对定量的情况。ImageJ 内参值即视为相对浓度，以最低 ImageJ 值为参考，按比值修正取样量：

```text
修正样本体积 = 统一上样体积 × (最低 ImageJ ÷ 样本 ImageJ)
1× Loading 体积 = 统一上样体积 − 修正样本体积
```

最低 ImageJ 样本占满统一上样体积，其余按比例缩减，样本体积永不超过统一上样体积。如各样本上一轮取样体积不同，可逐样本填写"上轮取样体积"作为修正基准。

### 未变性样品配平

适用于未变性的蛋白样品，同时计算三部分体积（支持 2× / 4× / 5× / 6× Loading Buffer）：

```text
样品体积 = 目标蛋白量 ÷ 蛋白浓度
Loading Buffer 体积 = 终体积 ÷ Buffer 倍数
补液体积 = 终体积 − 样品体积 − Loading Buffer 体积
```

### 数据导入与导出

- **粘贴数据**：从 Excel 复制数据（制表符分隔）后直接粘贴到页面。注意列含义随模式不同：ImageJ 配平模式下第二列是 ImageJ 内参值，其余模式下第二列是蛋白浓度。
- **复制结果**：将结果表以制表符分隔文本复制到剪贴板，可直接粘贴回 Excel。

## 本地预览与部署

没有构建步骤，任选其一本地预览：

- 直接双击打开 `index.html`；
- `python -m http.server 8000` 后访问 `http://localhost:8000`；
- `npx wrangler pages dev .`（模拟 Cloudflare Pages 环境）。

部署到 Cloudflare Pages：连接 GitHub 仓库自动部署（Framework preset 选 `None`，build command 留空，输出目录 `.`），或命令行 `npx wrangler pages deploy . --project-name wb-balancer`。

## 文件结构

```text
.
├── index.html       # 页面结构
├── styles.css       # 页面样式
├── app.js           # 配平与本地保存逻辑
├── tests/           # 计算函数测试（node tests/test-calculator.js）
├── wrangler.toml    # 项目配置
├── _headers         # 安全响应头
├── .gitignore
└── README.md
```

## 实验提示

本工具只负责体积计算。正式实验前，请结合试剂说明书和实验室 SOP，复核移液器量程、最小可靠移液体积、样本损耗以及修正后的总蛋白量是否符合实验设计。
