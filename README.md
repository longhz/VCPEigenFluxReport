# VCPEigenFluxReport

**版本**: 0.1.3  
**插件类型**: synchronous  
**通信协议**: stdio  
**定位**: VCPEigenFlux + JikeScraper 的只读情报消费层、融合早报生成器与固定模板发布流水线。

---

## 1. 项目定位

VCPEigenFluxReport 是 VCP 体系中的情报消费层插件。

它不负责采集，不访问 EigenFlux API，不保存 token，也不修改 JikeScraper。它只读取已有归档数据，完成：

- 多源情报读取
- 标准化与去重
- 评分与 Tag 归一化
- 双源融合早报候选生成
- 固定模板日报渲染
- 审稿批准闸门
- 自动生成 VCP 论坛 Markdown 文件

数据来源：

```text
VCPEigenFlux 多账号归档
JikeScraper daily-archive
```

---

## 2. 当前核心流程

```text
VCPEigenFlux / JikeScraper 采集归档
  ↓
EFReportFusionBrief 生成 FusionBrief JSON
  ↓
EFReportRenderBrief / daily-brief-renderer.js 渲染固定模板草稿
  ↓
Nova / 主人审稿
  ↓
daily-brief-approve.js 写入 approval 闸门文件
  ↓
daily-brief-publisher.js 定时读取 approval 并发布论坛 md
  ↓
approval 回写 published:true，防止重复发布
```

核心原则：

> Renderer 管模板，Approval 管闸门，Publisher 管发布，Nova 管审稿判断。

---

## 3. 插件命令

| 命令 | 功能 |
|---|---|
| `EFReportInspect` | 检查 VCPEigenFlux 归档与索引状态 |
| `EFReportDigest` | 生成 EigenFlux Top N 情报摘要 |
| `EFReportDaily` | 生成 EigenFlux 单源 Markdown 日报草稿 |
| `EFReportVault` | 生成 Obsidian 风格知识库 |
| `EFReportHealth` | 汇总 health-log.jsonl 与账号状态 |
| `EFReportReviewQueue` | 生成 must_read / worth_scan / archive_only 待复核队列 |
| `EFReportMorningBrief` | 生成 EigenFlux 单源早间初审草稿 |
| `EFReportFusionBrief` | 生成 Jike + EigenFlux 双源融合早报 JSON / Markdown |
| `EFReportRenderBrief` | 将 FusionBrief JSON 渲染为固定模板 HTML/Markdown 日报 |

---

## 4. 关键脚本

### 4.1 固定模板渲染器

文件：

```text
daily-brief-renderer.js
```

职责：

- 读取 `data/reports/fusion-brief/{dataDate}-fusion-brief.json`
- 使用固定 HTML/CSS 模板渲染日报
- 输出 Markdown 与 HTML
- 支持数据窗口日期 `dataDate` 与版面显示日期 `displayDate` 分离

当前模板定版：

- 参考 2026-05-22 双栏要闻风格
- 宽版容器：`width:100%; max-width:980px`
- 结构：标题区 / 主编手记 / 筛选口径 / 头条要闻 / 双栏要闻 / Footer
- 内容数量：1 条头条 + 10 条双栏要闻
- Footer 标注数据窗口，避免数据日期与发布日期混淆

示例：

```bash
node daily-brief-renderer.js --date 2026-05-23 --displayDate 2026-05-24 --vol 44
```

输出：

```text
data/reports/rendered-brief/2026-05-23-jike-brief-rendered.md
data/reports/rendered-brief/2026-05-23-jike-brief-rendered.html
```

---

### 4.2 审稿批准脚本

文件：

```text
daily-brief-approve.js
```

职责：

- 不生成日报内容
- 不发布论坛
- 只写入审批闸门文件

approval 文件路径：

```text
data/reports/approved-brief/{publishDate}-approved.json
```

示例：

```bash
node daily-brief-approve.js \
  --publishDate 2026-05-24 \
  --dataDate 2026-05-23 \
  --vol 44 \
  --approvedBy Nova \
  --notes template-final-980px-1plus10
```

approval 结构示例：

```json
{
  "status": "approved",
  "board": "即刻简报",
  "maid": "Nova",
  "publishDate": "2026-05-24",
  "dataDate": "2026-05-23",
  "vol": "44",
  "title": "[即刻简报] 2026-05-24 科技与AI热点速递 (早报)",
  "renderedFile": "/u01/VCPToolBox/Plugin/VCPEigenFluxReport/data/reports/rendered-brief/2026-05-23-jike-brief-rendered.md",
  "approvedAt": "...",
  "approvedBy": "Nova",
  "published": false,
  "notes": "template-final-980px-1plus10"
}
```

---

### 4.3 自动发布脚本

文件：

```text
daily-brief-publisher.js
```

职责：

- 读取 approval 文件
- 只有 `status === "approved"` 且 `published !== true` 才发布
- 读取 rendered Markdown
- 剥离 rendered Markdown 内自带 H1，避免论坛头部重复
- 自动生成 VCP 论坛 Markdown 文件
- 成功后回写 approval：`published:true`、`publishedAt`、`outputPath`、`uid`

示例：

```bash
node daily-brief-publisher.js --date 2026-05-24
```

行为：

| 状态 | 行为 |
|---|---|
| approval 文件不存在 | skipped |
| status 不是 approved | skipped |
| published 已为 true | skipped / already_published |
| renderedFile 不存在 | 报错 |
| approved 且未发布 | 写入 VCP论坛 md，并回写 published:true |

论坛输出目录：

```text
/u01/VCPToolBox/dailynote/VCP论坛/
```

---

## 5. 推荐每日操作

### 5.1 生成融合数据

```text
EFReportFusionBrief
```

常用参数：

```json
{
  "command": "EFReportFusionBrief",
  "date": "2026-05-23",
  "jikeTopN": 10,
  "efTopN": 10,
  "writeFile": true
}
```

### 5.2 渲染固定模板

```text
EFReportRenderBrief
```

或直接运行：

```bash
node daily-brief-renderer.js --date 2026-05-23 --displayDate 2026-05-24 --vol 44
```

### 5.3 审稿通过后批准

```bash
node daily-brief-approve.js --publishDate 2026-05-24 --dataDate 2026-05-23 --vol 44 --approvedBy Nova
```

### 5.4 定时发布脚本执行

```bash
node daily-brief-publisher.js --date 2026-05-24
```

实际部署时可以每天固定时间运行 publisher。它只在 approval 存在且未发布时发帖，因此安全。

---

## 6. 数据目录

```text
data/reports/
├── digest/
├── daily/
├── fusion-brief/
├── rendered-brief/
├── approved-brief/
├── review-queue/
├── vault/
└── report-log.jsonl
```

说明：

- `fusion-brief/`：融合早报结构化数据
- `rendered-brief/`：固定模板渲染结果
- `approved-brief/`：审稿批准与发布状态机
- `vault/`：Obsidian 风格知识库导出
- `report-log.jsonl`：插件执行日志

默认 `.gitignore` 会忽略 `data/`，避免提交日报数据、审批状态和运行缓存。

---

## 7. 评分系统摘要

### EigenFlux 评分

- 基线 35
- 分桶封顶：topic / source / account / action
- 惩罚：短摘要、无 URL、纯新闻无技术深度
- 上限 98

### Jike 评分 v0.1.2+

- 基线 38
- 强化社交信号：赞评数代表社区共识
- 圈子分级：AI探索站 / 人工智能讨论组 / JitHub程序员等高价值圈子加权
- 长文加分
- 作者先验
- 噪声热帖惩罚

### 分层

| 层级 | 条件 |
|---|---|
| `must_read` | ≥ 90 |
| `worth_scan` | ≥ 78 |
| `archive_only` | < 78 |

---

## 8. Tag 体系

### primaryTags

AI-Agent、多智能体、RAG、MCP、Agent安全、LLM评测、AIGC工作流、开发者工具、商业产品、研究论文、知识管理、科技新闻

### secondaryTags

任务编排、插件架构、上下文管理、凭证安全、权限控制、工具调用、文档解析、检索评测、LLM-as-Judge、ComfyUI、视频生成、3D生成、云端推理、SaaS、产品验证、定价策略、创业融资、社区热度、即刻观察、EigenFlux情报

### sourceTags

source/EigenFlux、source/Jike、account/technical、account/creative、account/business、account/news、account/research

---

## 9. 定时任务建议

建议每天设置两个阶段：

### 阶段一：生成草稿

由现有任务或 Agent 调用：

```text
EFReportFusionBrief
EFReportRenderBrief
```

### 阶段二：发布闸门

每天固定时间运行：

```bash
cd /u01/VCPToolBox/Plugin/VCPEigenFluxReport
node daily-brief-publisher.js
```

publisher 不会自行批准内容。只有 approval 文件存在且状态正确时才发布。

---

## 10. 防重复发布机制

`daily-brief-publisher.js` 发布成功后会回写：

```json
{
  "published": true,
  "publishedAt": "...",
  "outputPath": "...",
  "uid": "...",
  "publisher": "daily-brief-publisher.js"
}
```

之后再次执行：

```bash
node daily-brief-publisher.js --date 2026-05-24
```

会返回：

```json
{
  "status": "skipped",
  "reason": "already_published"
}
```

---

## 11. 版本历史

### v0.1.3

- 新增 `EFReportRenderBrief`
- 新增固定双栏日报模板 `daily-brief-renderer.js`
- 新增审稿批准脚本 `daily-brief-approve.js`
- 新增自动发布脚本 `daily-brief-publisher.js`
- 模板定版为 980px 宽版、1 头条 + 10 双栏
- 支持 `displayDate` 与 `dataDate` 分离
- approval 文件成为发布闸门
- publisher 成功后回写 `published:true` 防重复发布

### v0.1.2

- Jike 评分校准
- 搜索流社交信号修复
- 圈子分级、作者先验、噪声惩罚
- 自动化任务配置

### v0.1.1

- 双源融合早报核心链路
- 三层 Tag 体系
- ReviewQueue 与 FusionBrief

### v0.1.0

- 初版 EigenFlux 只读消费层
- Inspect / Digest / Daily / Vault / Health 基础命令



### v0.1.5 可靠性补丁说明

为降低无人值守运行风险，v0.1.5 补充以下工程韧性：

- 关键 JSON / Markdown 输出改为 temp + rename 原子写入，降低进程崩溃导致文件半写入的风险。
- `daily-brief-publisher.js` 增加 approval lock 文件：同一 publishDate 同时只能有一个 publisher 执行。
- scheduler 明确日期语义：`dataDate` 表示情报数据所属日期，`publishDate/displayDate` 表示论坛展示发布日期。
- `initialize()` / `shutdown()` 增加幂等保护，适配 hybridservice 热重载或双重 shutdown 场景。
- Jike 归档脚本和论坛输出目录支持配置覆盖：`EFREPORT_JIKE_ARCHIVE_SCRIPT`、`EFREPORT_FORUM_DIR`。
\n## v0.1.4：hybridservice 内置心跳调度器

从 v0.1.4 开始，VCPEigenFluxReport 不再依赖 VCPTaskAssistant 派发 Agent 执行确定性 shell 命令，而是升级为 `hybridservice/direct` 插件。

### 启动方式

插件随 VCP 主服务加载：

```text
VCP 主服务启动
  ↓
PluginManager require VCPEigenFluxReport/eigenflux-report.js
  ↓
initialize()
  ↓
startScheduler()
  ↓
每 60 秒执行一次 scheduler tick
```

对应 manifest：

```json
{
  "pluginType": "hybridservice",
  "entryPoint": {
    "script": "eigenflux-report.js"
  },
  "communication": {
    "protocol": "direct",
    "timeout": 60000
  }
}
```

### 调度规则

内置调度器状态文件：

```text
data/reports/scheduler-state.json
```

任务窗口：

| jobId | 时间窗口 | 职责 | 防重复策略 |
|---|---|---|---|
| `jike_archive` | 01:30 ~ 06:00 | 执行 JikeScraper 夜间归档 | 当天成功后不重复执行 |
| `fusion_render` | 06:00 ~ 11:00 | 生成昨日数据窗口的 FusionBrief，并渲染今日显示日期的固定模板早报 | 当天成功后不重复执行 |
| `publisher` | 07:05 之后 | 持续检查今日 approval 文件，存在且未发布时自动发布 | `success` / `already_published` 后当天不再频繁检查 |

### 审批闸门不变

调度器只会自动生成草稿、自动渲染模板、自动检查 publisher。发布仍必须满足：

```json
{
  "status": "approved",
  "published": false
}
```

也就是说：

```text
自动生成草稿
  ↓
Nova / 主人审稿
  ↓
daily-brief-approve.js 写入 approval
  ↓
内置 scheduler 发现 approval
  ↓
daily-brief-publisher.js 发布论坛 md
  ↓
approval 回写 published:true
```

Agent 的职责回到审稿、判断与批准；确定性命令由插件心跳负责执行。

### 新增命令

| 命令 | 用途 |
|---|---|
| `EFReportSchedulerStatus` | 查看调度器启用状态、运行状态、状态文件与最近执行历史 |
| `EFReportSchedulerTick` | 手动触发一次 tick，用于测试时间窗口、补偿逻辑和 publisher 状态 |

stdio 调试示例：

```bash
printf '%s\n' '{"command":"EFReportSchedulerStatus"}' | node eigenflux-report.js
printf '%s\n' '{"command":"EFReportSchedulerTick","reason":"manual-test"}' | node eigenflux-report.js
```

### 配置项

```env
EFREPORT_SCHEDULER_ENABLED=true
EFREPORT_SCHEDULER_INTERVAL_MS=60000
```

如需临时关闭内置调度器，可在 `config.env` 中设置：

```env
EFREPORT_SCHEDULER_ENABLED=false
```

