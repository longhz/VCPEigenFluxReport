#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const PLUGIN_DIR = __dirname;
const DEFAULT_INPUT = path.join(PLUGIN_DIR, 'data/reports/fusion-brief');
const DEFAULT_OUTPUT = path.join(PLUGIN_DIR, 'data/reports/rendered-brief');
const DEFAULT_INSIGHTS = path.join(PLUGIN_DIR, 'data/reports/insight-overrides');

function today() {
  return new Date().toISOString().slice(0, 10);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function atomicWriteText(file, text) {
  ensureDir(path.dirname(file));
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, file);
}

function writeText(file, text) {
  atomicWriteText(file, text);
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function stripMd(s) {
  return String(s ?? '')
    .replace(/\*\*/g, '')
    .replace(/#/g, '')
    .replace(/\[(.*?)\]\(.*?\)/g, '$1')
    .trim();
}

function normalizeText(s) {
  return stripMd(s).replace(/\s+/g, ' ').trim();
}

function truncate(s, max) {
  const raw = normalizeText(s);
  return raw.length > max ? raw.slice(0, max - 1) + '…' : raw;
}

function sourceName(x) {
  return x.source === 'Jike' ? 'Jike' : 'EigenFlux';
}

function sourceBadge(x) {
  return x.source === 'Jike' ? '🧡 Jike' : '⛓️ EigenFlux';
}

function sourceMeta(x) {
  if (x.source === 'Jike') {
    const hot = [];
    if (Number(x.likeCount || 0) > 0) hot.push(`❤️${x.likeCount}`);
    if (Number(x.commentCount || 0) > 0) hot.push(`💬${x.commentCount}`);
    return `${x.nickname || '即刻社区'}${hot.length ? ' · ' + hot.join(' · ') : ''}`;
  }
  return `${x.account || 'unknown'}${x.url ? ' · 原始链接' : ''}`;
}

function getTags(x, limit = 3) {
  const tags = [...(x.primaryTags || []), ...(x.secondaryTags || [])]
    .filter(Boolean)
    .filter((v, i, arr) => arr.indexOf(v) === i)
    .slice(0, limit);
  return tags.length ? tags : [sourceName(x)];
}

function rawTitle(x) {
  return normalizeText(x.title || x.summary || '未命名条目');
}

function smartTitle(x, max = 32) {
  const t = rawTitle(x);
  const s = `${x.title || ''} ${x.summary || ''}`.toLowerCase();

  const manual = [
    [/blockchain-enabled three-layer architecture|behavior tracing|reputation evaluation|malicious activity/i, '区块链三层架构：为 AI Agent 建立可问责秩序'],
    [/gpbench|general practitioners/i, 'GPBench：医疗 AI 离自主执业还很远'],
    [/lmr-bench|reproduce nlp research code/i, 'LMR-BENCH：论文代码复现评测'],
    [/kflxai|influencer research|campaign evaluation/i, 'kflxai：AI 网红营销研究与 ROI 评估 SaaS'],
    [/hyperemo-rag|multimodal emotion/i, 'HyperEmo-RAG：多模态情绪识别'],
    [/faceless youtube|viewer retention|visual inconsistencies|stock footage/i, '无脸 YouTube 频道：AI视觉一致性成为留存瓶颈'],
    [/midnight phantom|synth-pop|acestep/i, 'AI 合成音乐：80年代 synth-pop LoRA 实验'],
    [/agency-agents|9 万|9万|ai 员工|ai员工/i, 'agency-agents：9万星 AI 员工矩阵'],
    [/anthropic academy/i, 'Anthropic Academy：18门免费 AI 课程开放'],
    [/产品经理.*skill|100多个 skill|write-skill/i, '100+ Skill 开源：产品经理的工作流武器库'],
    [/产品经理这个岗位/i, 'AI 之后，产品经理岗位会怎样变化？'],
    [/youtube|信息差|视频情绪曲线|workflow 都可以被agent化/i, '从 YouTube 工作流里找 Agent 化机会'],
    [/riley brown|codex/i, 'Riley Brown：适合 AI 初学者的免费教程源'],
    [/字节前员工|黄埔军校/i, '字节系 AI 人才外溢：黄埔军校叙事再起']
  ];

  for (const [re, out] of manual) {
    if (re.test(s)) return out;
  }

  if (/[a-zA-Z]{12,}/.test(t) && x.source !== 'Jike') {
    return truncate(t.replace(/^An?\s+/i, '').replace(/^The\s+/i, ''), max);
  }
  return truncate(t, max);
}

function shortSummary(x, max = 150) {
  const s = normalizeText(x.summary || '');
  const text = `${x.title || ''} ${x.summary || ''}`.toLowerCase();

  const manual = [
    [/blockchain-enabled three-layer architecture|behavior tracing|reputation evaluation|malicious activity/i, '论文提出区块链三层架构，为 LLM 驱动的自主多智能体系统加入行为追踪、动态信誉评估和恶意行为预测。'],
    [/gpbench|general practitioners/i, 'GPBench 用真实临床标准评测 10 个顶尖 LLM 的全科医生能力，结论是当前模型仍不适合无人监督部署。'],
    [/lmr-bench|reproduce nlp research code/i, 'UT Dallas 发布 EMNLP 2025 基准，评测 LLM Agent 从遮蔽代码库中复现 NLP 论文实现的能力。'],
    [/kflxai|influencer research|campaign evaluation/i, 'AI 驱动的网红营销 SaaS，整合创作者搜索、内容质量分析、受众匹配和 campaign ROI 估算。'],
    [/hyperemo-rag|multimodal emotion/i, '使用双曲嵌入、层级检索和树感知注意力做多模态情绪识别，是 RAG 方法侧的研究线索。'],
    [/agency-agents|9 万|9万|ai 员工|ai员工/i, '每个 AI 员工都有独立人格、工作流程和交付标准，前端、后端、UI、市场、法务各司其职。'],
    [/anthropic academy/i, 'Anthropic Academy 提供 18 门免费课程，覆盖非技术用户到 Agent 开发者，学完可获得官方证书。'],
    [/产品经理.*skill|100多个 skill|write-skill/i, '一位产品经理开源 100+ 个高频 Skill，覆盖写作、画图、信息获取和产品经理日常工作流。'],
    [/产品经理这个岗位/i, '原型和文档生产时间被 AI 大幅压缩后，产品经理的重心会转向策略、商业判断和 PMF。'],
    [/youtube|信息差|视频情绪曲线|workflow 都可以被agent化/i, '海外创作者把方法论、视频情绪曲线和内容营销 pattern 讲透，这些流程都有被 Agent 化的机会。']
  ];

  for (const [re, out] of manual) {
    if (re.test(text)) return out;
  }
  return truncate(s, max);
}

function inferInsight(item) {
  const text = `${item.title || ''} ${item.summary || ''}`.toLowerCase();
  const tags = new Set([...(item.primaryTags || []), ...(item.secondaryTags || [])]);

  if (/blockchain|accountability|reputation|问责|自治/.test(text)) {
    return '当 Agent 具备自主决策能力时，真正稀缺的不是能力，而是可追责、可审计、可治理的秩序。';
  }
  if (/gpbench|clinical|medical|医生|医疗/.test(text)) {
    return '医疗 AI 的核心启发不是“模型能不能答对”，而是“系统是否允许它在无人监督下犯错”。';
  }
  if (/lmr-bench|benchmark|pass@1|评测|复现/.test(text)) {
    return '评测类信号适合校准预期：Agent 很强，但复杂工程复现仍然需要人类监督与工具链补强。';
  }
  if (/agency-agents|ai员工|专业化|岗位/.test(text)) {
    return '这是“组织结构”向 AI 迁移的信号：未来不是一个万能助手，而是一组专业角色协作。';
  }
  if (/faceless youtube|viewer retention|visual inconsistencies|stock footage|视觉一致性/.test(text)) {
    return 'AIGC 内容生产的瓶颈正在从“能不能生成”转向“能不能稳定保持风格一致”。';
  }
  if (/saas|product hunt|roi|营销|商业/.test(text) || tags.has('商业产品')) {
    return '商业产品要重点看是否卡住真实付费断点，而不是只看它用了多少 AI 概念。';
  }
  if (/academy|课程|youtube|教程|学习/.test(text)) {
    return '学习资源的普惠化正在加速，后续可以筛选成 VCP 内部知识库的长期入口。';
  }
  if (/skill|workflow|工作流|产品经理/.test(text)) {
    return '值得纳入 VCP Skill 观察清单：真正有价值的 AI 工具，往往先从高频工作流里长出来。';
  }
  if (/rag|retrieval|embedding|知识库/.test(text) || tags.has('RAG')) {
    return 'RAG 类研究可进入技术雷达，重点观察它是否能改善检索质量、结构化记忆或上下文控制。';
  }
  return '这条适合作为线索归档，后续结合来源可信度、可行动价值和社区反馈再决定是否深读。';
}


function normalizeInsightOverrides(overrides) {
  if (!overrides || typeof overrides !== 'object') return {};
  const raw = overrides.items || overrides.insights || {};
  const out = {};
  for (const [id, value] of Object.entries(raw)) {
    if (!id) continue;
    if (typeof value === 'string') out[id] = value;
    else if (value && typeof value === 'object' && value.insight) out[id] = String(value.insight);
  }
  return out;
}

function getItemInsight(item, opts = {}) {
  const overrides = normalizeInsightOverrides(opts.insightOverrides || opts.insights || {});
  const keys = [item && item.id, item && item.item_id, item && item.url, item && item.title].filter(Boolean).map(String);
  for (const key of keys) {
    if (overrides[key]) return overrides[key];
  }
  return inferInsight(item);
}

function pickTheme(data) {
  const r = data.resonance || [];
  const hasAgent = r.includes('AI-Agent') || (data.candidates || []).some(x => (x.primaryTags || []).includes('AI-Agent'));
  const hasDev = r.includes('开发者工具') || (data.candidates || []).some(x => (x.primaryTags || []).includes('开发者工具'));

  if (hasAgent && hasDev) {
    return {
      title: 'AI Agent 正从“通用助手”转向“专业岗位”',
      text: '今日科技叙事的主旋律，是专业化分工与可治理基础设施的并行进化。从多智能体问责架构，到 AI 员工矩阵和产品经理 Skill 工作流，行业正在从“让一个 AI 干所有事”，走向“让专业 AI 协作完成复杂任务”。'
    };
  }

  return {
    title: 'AI 工具链继续向真实工作流深处渗透',
    text: '本期信号集中在工具、评测、学习与商业产品化上。值得关注的不是某一个模型的参数变化，而是 AI 如何进入岗位、流程和组织结构。'
  };
}

function splitItems(candidates) {
  const clean = (candidates || []).filter(x => x && x.title && x.summary);
  return {
    headline: clean[0] || null,
    grid: clean.slice(1, 11)
  };
}

function renderTags(item) {
  return getTags(item, 3).map(t => `<span class="jike-tag">${esc(t)}</span>`).join('');
}

function renderHtml(data, opts = {}) {
  const date = opts.displayDate || data.displayDate || data.date || today();
  const vol = opts.vol || '';
  const theme = pickTheme(data);
  const { headline, grid } = splitItems(data.candidates || []);
  const sources = data.sources || {};
  const efCount = sources.eigenflux?.totalItems ?? 0;
  const jikeCount = sources.jike?.totalItems ?? 0;
  const resonance = data.resonance || [];
  const titleVol = vol ? `第${esc(vol)}期` : '固定模板版';

  return `<style>
.jike-brief-root{
  background:#151820;
  color:#d1d5db;
  font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif;
  border-radius:16px;
  padding:24px;
  line-height:1.65;
  width:100%;
  max-width:980px;
  margin:0 auto;
}
.jike-brief-root *{box-sizing:border-box}
.jike-header{text-align:center;margin-bottom:24px}
.jike-title{color:#fff;font-size:28px;font-weight:900;letter-spacing:.03em;margin:0}
.jike-title .accent{color:#fbbf24;text-shadow:0 0 18px rgba(251,191,36,.24)}
.jike-meta{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-top:14px;color:#9ca3af;font-size:13px;flex-wrap:wrap}
.jike-widget{background:rgba(251,191,36,.12);color:#fbbf24;border:1px solid rgba(251,191,36,.22);border-radius:999px;padding:6px 12px}
.jike-divider{display:flex;align-items:center;gap:12px;color:#fbbf24;font-size:12px;font-weight:800;letter-spacing:.14em;margin:22px 0}
.jike-divider:before,.jike-divider:after{content:"";height:1px;flex:1;background:linear-gradient(90deg,transparent,rgba(251,191,36,.55))}
.jike-divider:after{background:linear-gradient(90deg,rgba(251,191,36,.55),transparent)}
.jike-card{background:#1e232e;border:1px solid rgba(255,255,255,.05);border-radius:12px;padding:18px;margin-bottom:18px;box-shadow:0 12px 30px rgba(0,0,0,.22)}
.jike-editor{font-style:italic;font-size:15px;line-height:1.8;margin:0}
.jike-editor strong{color:#fbbf24}
.jike-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px}
.jike-news-title{display:flex;align-items:center;flex-wrap:wrap;gap:8px;color:#fff;font-size:16px;font-weight:800;margin:0 0 10px}
.jike-index{color:#fbbf24;font-weight:900;min-width:20px}
.jike-tag-row{display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap}
.jike-tag{background:rgba(251,191,36,.14);color:#fbbf24;border:1px solid rgba(251,191,36,.22);border-radius:999px;padding:2px 8px;font-size:11px}
.jike-source{color:#8ec5fc;font-size:12px;margin:0 0 8px}
.jike-summary{color:#d1d5db;font-size:14px;margin:8px 0}
.jike-insight{background:#11141a;border-left:3px solid #fbbf24;border-radius:8px;padding:12px;color:#9ca3af;font-size:13px;margin-top:12px}
.jike-insight strong{color:#fbbf24}
.jike-data-strip{display:flex;gap:8px;flex-wrap:wrap;justify-content:center;margin-top:12px}
.jike-data-pill{background:rgba(142,197,252,.09);color:#8ec5fc;border:1px solid rgba(142,197,252,.18);border-radius:999px;padding:3px 9px;font-size:11px}
.jike-footer{color:#9ca3af;font-size:13px}
@media(max-width:768px){
  .jike-grid{grid-template-columns:1fr}
  .jike-brief-root{padding:16px}
  .jike-title{font-size:23px}
  .jike-meta{justify-content:center;text-align:center}
}
</style>

<div class="jike-brief-root">
  <div class="jike-header">
    <h1 class="jike-title">即刻简报 · <span class="accent">科技与AI热点速递</span></h1>
    <div class="jike-meta">
      <span>📅 ${esc(date)} · 早报 · ${titleVol}</span>
      <span class="jike-widget">🌤️ AI晴 · 双源融合</span>
    </div>
    <div class="jike-data-strip">
      <span class="jike-data-pill">⛓️ EigenFlux ${esc(efCount)} 条</span>
      <span class="jike-data-pill">🧡 Jike ${esc(jikeCount)} 条</span>
      <span class="jike-data-pill">候选 ${esc(data.totalCandidates || 0)} 条</span>
      ${resonance.length ? `<span class="jike-data-pill">共振 ${esc(resonance.join(' / '))}</span>` : ''}
    </div>
  </div>

  <div class="jike-divider">✦ EDITOR'S NOTE · 主编手记 ✦</div>
  <div class="jike-card">
    <p class="jike-editor">
      ${esc(theme.text).replace(esc(theme.title), `<strong>${esc(theme.title)}</strong>`)}
    </p>
  </div>

  <div class="jike-divider">✦ METHOD · 筛选口径 ✦</div>
  <div class="jike-card">
    <p class="jike-summary">
      本期从 EigenFlux 技术情报与 Jike AI/科技社区内容中筛选，优先考虑技术前瞻性、社区共识度、可行动价值与 VCP 相关性。评分只作为排序辅助，最终呈现经过编辑化压缩。
    </p>
  </div>

  ${headline ? `<div class="jike-divider">✦ HEADLINE · 头条要闻 ✦</div>
  <div class="jike-card">
    <div class="jike-news-title">
      <span class="jike-index">📌</span>
      <span>${esc(smartTitle(headline, 48))}</span>
    </div>
    <div class="jike-tag-row">
      ${renderTags(headline)}
      <span class="jike-tag">${esc(headline.score)}分</span>
      <span class="jike-tag">${esc(headline.tier || 'must_read')}</span>
    </div>
    <p class="jike-source">${esc(sourceBadge(headline))} · ${esc(sourceMeta(headline))}</p>
    <p class="jike-summary">${esc(shortSummary(headline, 210))}</p>
    <div class="jike-insight">
      <strong>Nova洞察：</strong>${esc(getItemInsight(headline, opts))}
    </div>
  </div>` : ''}

  <div class="jike-divider">✦ TOP NEWS · 双栏要闻 ✦</div>
  <div class="jike-grid">
    ${grid.map((item, idx) => `<div class="jike-card">
      <div class="jike-news-title">
        <span class="jike-index">${idx + 1}</span>
        <span>${esc(smartTitle(item, 38))}</span>
      </div>
      <div class="jike-tag-row">
        ${renderTags(item)}
        <span class="jike-tag">${esc(item.score)}分</span>
      </div>
      <p class="jike-source">${esc(sourceBadge(item))} · ${esc(sourceMeta(item))}</p>
      <p class="jike-summary">${esc(shortSummary(item, 155))}</p>
      <div class="jike-insight">
        <strong>Nova洞察：</strong>${esc(getItemInsight(item, opts))}
      </div>
    </div>`).join('\n')}
  </div>

  <div class="jike-divider">✦ FOOTER · 底部信息 ✦</div>
  <div class="jike-card">
    <div class="jike-footer">
      <p style="margin:0 0 8px"><strong style="color:#fbbf24">🎯 今日金句：</strong><em>「专业化不是把 AI 变窄，而是让 AI 真正进入组织协作。」</em></p>
      <p style="margin:0 0 8px"><strong style="color:#fbbf24">📊 推荐强度：</strong><span style="color:#fbbf24">A</span> · 技术趋势清晰，双源共振明显，可行动条目较多</p>
      <p style="margin:0 0 8px"><strong style="color:#fbbf24">📡 数据来源：</strong>VCPEigenFluxReport FusionBrief（EigenFlux + Jike）</p>
      <p style="margin:0"><strong style="color:#fbbf24">⚠️ 说明：</strong>本简报基于公开信息与社区讨论整理，重点在趋势判断与线索提示；具体项目信息请以官方页面为准。</p>
    </div>
  </div>
</div>`;
}

function renderMarkdownPost(data, opts = {}) {
  const date = opts.displayDate || data.displayDate || data.date || today();
  const title = opts.title || `[即刻简报] ${date} 科技与AI热点速递 (早报)`;
  return `# ${title}

${renderHtml(data, opts)}
`;
}

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) args[key] = true;
      else {
        args[key] = next;
        i++;
      }
    }
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv);
  const date = args.date || today();
  const input = args.input || path.join(DEFAULT_INPUT, `${date}-fusion-brief.json`);
  const outputDir = args.outputDir || DEFAULT_OUTPUT;
  const data = readJson(input);
  const vol = args.vol || args.volume || '';
  const displayDate = args.displayDate || args['display-date'] || '';
  const insightFile = args.insightFile || args['insight-file'] || path.join(DEFAULT_INSIGHTS, `${date}-nova-insights.json`);
  const insightOverrides = fs.existsSync(insightFile) ? readJson(insightFile) : null;
  const renderOpts = { vol, title: args.title, displayDate, insightOverrides };
  const rendered = renderMarkdownPost(data, renderOpts);
  ensureDir(outputDir);
  const outFile = args.output || path.join(outputDir, `${date}-jike-brief-rendered.md`);
  const htmlOnlyFile = path.join(outputDir, `${date}-jike-brief-rendered.html`);
  writeText(outFile, rendered);
  writeText(htmlOnlyFile, renderHtml(data, renderOpts));
  console.log(JSON.stringify({
    status: 'success',
    date,
    input,
    output: outFile,
    htmlOnly: htmlOnlyFile,
    insightFile: insightOverrides ? insightFile : null,
    insightOverridesApplied: !!insightOverrides,
    bytes: Buffer.byteLength(rendered, 'utf8')
  }, null, 2));
}

if (require.main === module) {
  main();
}

module.exports = { renderHtml, renderMarkdownPost, inferInsight, getItemInsight, normalizeInsightOverrides };