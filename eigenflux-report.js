#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const childProcess = require('child_process');
const briefRenderer = require('./daily-brief-renderer');

const PLUGIN_DIR = __dirname;

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return {};
  const out = {};
  const text = fs.readFileSync(file, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return out;
}

const fileEnv = loadEnvFile(path.join(PLUGIN_DIR, 'config.env'));
const cfg = {
  sourceDir: resolvePath(process.env.EFREPORT_SOURCE_DIR || fileEnv.EFREPORT_SOURCE_DIR || '../VCPEigenFlux/data'),
  jikeArchiveDir: resolvePath(process.env.EFREPORT_JIKE_DIR || fileEnv.EFREPORT_JIKE_DIR || '../JikeScraper/data/daily-archive'),
  jikeArchiveScript: resolvePath(process.env.EFREPORT_JIKE_ARCHIVE_SCRIPT || fileEnv.EFREPORT_JIKE_ARCHIVE_SCRIPT || '../JikeScraper/jike-daily-archive.js'),
  outputDir: resolvePath(process.env.EFREPORT_OUTPUT_DIR || fileEnv.EFREPORT_OUTPUT_DIR || 'data/reports'),
  vaultDir: resolvePath(process.env.EFREPORT_VAULT_DIR || fileEnv.EFREPORT_VAULT_DIR || 'data/reports/vault'),
  reportLogMaxBytes: Number(process.env.EFREPORT_LOG_MAX_BYTES || fileEnv.EFREPORT_LOG_MAX_BYTES || 5 * 1024 * 1024),
  defaultAccounts: splitList(process.env.EFREPORT_DEFAULT_ACCOUNTS || fileEnv.EFREPORT_DEFAULT_ACCOUNTS || 'technical,creative,business,news,research'),
  defaultTopN: Number(process.env.EFREPORT_DEFAULT_TOPN || fileEnv.EFREPORT_DEFAULT_TOPN || 20)
};

function resolvePath(p) {
  if (path.isAbsolute(p)) return p;
  return path.resolve(PLUGIN_DIR, p);
}

function splitList(v) {
  if (Array.isArray(v)) return v.map(String).map(s => s.trim()).filter(Boolean);
  return String(v || '').split(',').map(s => s.trim()).filter(Boolean);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson(file, fallback = null) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return fallback;
  }
}

function atomicWriteText(file, text) {
  ensureDir(path.dirname(file));
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, file);
}

function writeJson(file, data) {
  atomicWriteText(file, JSON.stringify(data, null, 2));
}

function writeText(file, text) {
  atomicWriteText(file, text);
}

function createRunId(prefix = 'run') {
  return `${prefix}-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${Math.random().toString(36).slice(2, 8)}`;
}

function rotateLogIfNeeded(file, maxBytes) {
  try {
    if (!maxBytes || maxBytes <= 0 || !fs.existsSync(file)) return;
    const st = fs.statSync(file);
    if (st.size < maxBytes) return;
    const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
    fs.renameSync(file, `${file}.${stamp}.bak`);
  } catch (_) {}
}

function appendLog(event) {
  const file = path.join(cfg.outputDir, 'report-log.jsonl');
  ensureDir(path.dirname(file));
  rotateLogIfNeeded(file, cfg.reportLogMaxBytes);
  fs.appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), ...event }) + '\n', 'utf8');
}

function getAccounts(args = {}) {
  const requested = splitList(args.accounts || args.account || '');
  return requested.length ? requested : cfg.defaultAccounts;
}

function archivePathFor(account, date) {
  const [y, m] = date.split('-');
  if (account === 'technical') {
    return path.join(cfg.sourceDir, 'feed-archive', y, m, `${date}-eigenflux-feed.json`);
  }
  return path.join(cfg.sourceDir, 'accounts', account, 'feed-archive', y, m, `${date}-eigenflux-feed.json`);
}

function statePathFor(account) {
  if (account === 'technical') return path.join(cfg.sourceDir, 'eigenflux-state.json');
  return path.join(cfg.sourceDir, 'accounts', account, 'eigenflux-state.json');
}

function latestPathFor(account) {
  if (account === 'technical') return path.join(cfg.sourceDir, 'latest-feed.json');
  return path.join(cfg.sourceDir, 'accounts', account, 'latest-feed.json');
}

function accountDisplayName(account, globalState) {
  const hit = globalState && Array.isArray(globalState.accounts)
    ? globalState.accounts.find(a => a.accountId === account)
    : null;
  return hit ? hit.displayName : account;
}

function validateEigenArchive(json) {
  const warnings = [];
  if (!json || typeof json !== 'object') {
    warnings.push('archive_not_object_or_missing');
    return warnings;
  }
  if (!Array.isArray(json.items)) warnings.push('items_not_array');
  if (json.date && typeof json.date === 'string' && !/^\\d{4}-\\d{2}-\\d{2}$/.test(json.date)) warnings.push('date_format_unexpected');
  if (json.totalItems !== undefined && Number(json.totalItems) < 0) warnings.push('totalItems_negative');
  return warnings;
}

function loadArchive(account, date) {
  const file = archivePathFor(account, date);
  const json = readJson(file, null);
  const warnings = validateEigenArchive(json);
  return {
    account,
    file,
    exists: !!json,
    archive: json,
    items: json && Array.isArray(json.items) ? json.items : [],
    warnings
  };
}

function str(v) {
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) return v.join(', ');
  return String(v);
}

function slugify(s, fallback = 'item') {
  const raw = String(s || fallback);
  const safe = raw
    .replace(/[\\/:*?"<>|#^[\]]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 96);
  return safe || fallback;
}

function normalizeTagName(tag) {
  const s = String(tag || '').trim();
  if (!s) return '';
  const lower = s.toLowerCase().replace(/[_\s]+/g, '-');

  const map = [
    [/^(ai|artificial-intelligence|artificial intelligence|llm|llms|large-language-models?)$/, 'AI'],
    [/^(ai-agents?|agentic-ai|agents?|agent-systems?|ai-agent|ai agents|ai-agents)$/i, 'AI-Agent'],
    [/^(multi-agent.*|multi agent.*|multi-agent-systems?|multi-agent systems)$/i, '多智能体'],
    [/^(rag|retrieval-augmented-generation|retrieval augmented generation)$/i, 'RAG'],
    [/^(mcp|model-context-protocol)$/i, 'MCP'],
    [/^(a2a|agent2agent|agent-to-agent)$/i, 'A2A'],
    [/^(open-source|opensource|open source)$/i, '开源'],
    [/^(developer-tools?|developer tools|devtools)$/i, '开发者工具'],
    [/^(software-development|software engineering|software-engineering)$/i, '软件工程'],
    [/^(security|cybersecurity|ai-security)$/i, '安全'],
    [/^(devops|ci-cd|cicd)$/i, 'DevOps'],
    [/^(research|paper|arxiv|machine-learning|machine learning)$/i, '研究论文'],
    [/^(business|startups?|venture-capital|venture capital|saas|product-growth)$/i, '商业产品'],
    [/^(creative|aigc|image-generation|video-generation|music-generation)$/i, '创作工具'],
    [/^(technology|tech|ai-news|news)$/i, '科技新闻'],
    [/^(automation|workflow-automation)$/i, '自动化'],
    [/^(knowledge-management|knowledge management)$/i, '知识管理']
  ];

  for (const [re, out] of map) {
    if (re.test(s) || re.test(lower)) return out;
  }

  return s
    .replace(/[_]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
}

function unique(arr) {
  return [...new Set(arr.filter(Boolean))];
}

function hasAny(text, rules) {
  return rules.some(re => re.test(text));
}

function buildTagBundle(raw, account, source = 'EigenFlux') {
  const domains = Array.isArray(raw.domains) ? raw.domains.map(String) : [];
  const keywords = Array.isArray(raw.keywords) ? raw.keywords.map(String) : [];
  const topics = Array.isArray(raw.topics) ? raw.topics.map(String) : [];
  const rawKeywords = unique([...domains, ...keywords, ...topics, raw.source_type, raw.broadcast_type].map(normalizeTagName));
  const text = `${str(raw.summary)} ${str(raw.suggestion)} ${str(raw.content)} ${str(raw.title)} ${str(raw.url)} ${domains.join(' ')} ${keywords.join(' ')} ${topics.join(' ')}`.toLowerCase();

  const primary = [];
  const secondary = [];
  const sourceTags = [];

  sourceTags.push(`source/${source}`);
  if (account) sourceTags.push(`account/${account}`);

  // Stable primary tags: few, durable, useful for Obsidian indexes and board routing.
  if (hasAny(text, [/agent|agentic|multi-agent|agent2agent|a2a|autonomous agent/])) primary.push('AI-Agent');
  if (hasAny(text, [/multi-agent|multi agent|agent2agent|a2a|agent-to-agent/])) primary.push('多智能体');
  if (hasAny(text, [/rag|retrieval-augmented|retrieval augmented|vector|embedding|citation/])) primary.push('RAG');
  if (hasAny(text, [/mcp|model context protocol/])) primary.push('MCP');
  if (hasAny(text, [/credential revocation|access control|policy-as-code|security hardening|data exposure|zombie agent|ai.?security|agent.?security|restricted leakage|hbhc|cerbos/])) primary.push('Agent安全');
  if (hasAny(text, [/llm.?evaluation|llm-as-a-judge|model calibration|eval pipeline|pass rate|retrieval accuracy|gpbench|financebench|evaluation harness|golden set/])) primary.push('LLM评测');
  if (hasAny(text, [/comfyui|aigc|video generation|image generation|3d generation|blender|creative|dreamina|stable diffusion|sdxl/])) primary.push('AIGC工作流');
  if (hasAny(text, [/developer tool|sdk|api|framework|open-source|github|plugin|cli|node builder|search api/])) primary.push('开发者工具');
  if (hasAny(text, [/saas|pricing|product-market|product validation|startup|funding|venture|business model|growth|go-to-market|revenue/])) primary.push('商业产品');
  if (hasAny(text, [/arxiv|paper|research|scientific|benchmark|methodology/])) primary.push('研究论文');
  if (hasAny(text, [/memory|knowledge|obsidian|context|document parsing|ocr|knowledge base/])) primary.push('知识管理');
  if (hasAny(text, [/policy|ministry|launch|release|news|global ai center|big tech/])) primary.push('科技新闻');

  // Account priors, only if not already implied.
  if (account === 'technical') primary.push('AI-Agent');
  if (account === 'creative') primary.push('AIGC工作流');
  if (account === 'business') primary.push('商业产品');
  if (account === 'news') primary.push('科技新闻');
  if (account === 'research') primary.push('研究论文');

  // Secondary tags: more specific but still normalized, not raw keyword spam.
  if (hasAny(text, [/orchestration|workflow|pipeline|scheduler|planner|worker|dag|task/])) secondary.push('任务编排');
  if (hasAny(text, [/plugin|extension|node|custom node|architecture|framework|sdk/])) secondary.push('插件架构');
  if (hasAny(text, [/memory|context window|context decay|handoff|state layer/])) secondary.push('上下文管理');
  if (hasAny(text, [/credential revocation|heartbeat-bound|hbhc|zombie agent|token expir|token ttl|otp renewal/])) secondary.push('凭证安全');
  if (hasAny(text, [/access control|policy-as-code|restricted leakage|forbidden document|cerbos|authorization polic/])) secondary.push('权限控制');
  if (hasAny(text, [/tool calling|tool-call|tools|api|mcp|search router/])) secondary.push('工具调用');
  if (hasAny(text, [/document parsing|ocr|llamaparse|docparser|html parsing|context extraction/])) secondary.push('文档解析');
  if (hasAny(text, [/citation coverage|retrieval accuracy|pass rate|restricted leakage count|golden set|evaluation harness|retrieval metric/])) secondary.push('检索评测');
  if (hasAny(text, [/llm-as-a-judge|llm as a judge|judge calibration|self-reported accuracy|ground truth|dual-judge/])) secondary.push('LLM-as-Judge');
  if (hasAny(text, [/comfyui|comfy ui/])) secondary.push('ComfyUI');
  if (hasAny(text, [/video generation|image-to-video|text-to-image|ltx-video|veo|dreamina/])) secondary.push('视频生成');
  if (hasAny(text, [/3d|blender|room generation|texturing|controlnet|ip-adapter/])) secondary.push('3D生成');
  if (hasAny(text, [/cloud inference|cloud-based|gpu|comfy cloud/])) secondary.push('云端推理');
  if (hasAny(text, [/saas|subscription|recurring revenue|free-to-paid/])) secondary.push('SaaS');
  if (hasAny(text, [/product validation|positioning|product-market|founder feedback/])) secondary.push('产品验证');
  if (hasAny(text, [/pricing|price|cost|budget|token usage/])) secondary.push('定价策略');
  if (hasAny(text, [/funding|venture|valuation|seed|investor/])) secondary.push('创业融资');
  if (hasAny(text, [/community|jike|即刻|ai next|现场|体验|活动/])) secondary.push('社区热度');
  if (source === 'Jike') secondary.push('即刻观察');
  if (source === 'EigenFlux') secondary.push('EigenFlux情报');

  const primaryTags = unique(primary).slice(0, 5);
  const secondaryTags = unique(secondary).slice(0, 7);
  const finalSourceTags = unique(sourceTags).slice(0, 3);
  const tags = unique([...primaryTags, ...secondaryTags, ...finalSourceTags]).slice(0, 14);

  return {
    tags,
    primaryTags,
    secondaryTags,
    sourceTags: finalSourceTags,
    rawKeywords: rawKeywords.slice(0, 24)
  };
}

function deriveTags(raw, account, source = 'EigenFlux') {
  return buildTagBundle(raw, account, source).tags;
}

function scoreItem(raw, account, item) {
  // v0.1.1 scoring: keep useful gradients instead of making every strong item hit 100.
  // Philosophy: relevance first, then actionability, then source quality. Cap each bucket to reduce keyword pile-up.
  const text = `${str(raw.summary)} ${str(raw.suggestion)} ${str(raw.keywords)} ${str(raw.domains)} ${str(raw.url)}`.toLowerCase();
  let score = 35;

  const topicRules = [
    [/agent|multi-agent|agentic|a2a|agent2agent|mcp/, 12],
    [/rag|memory|context|knowledge|obsidian|vector|embedding/, 9],
    [/security|credential|token|auth|policy|revocation|permission|authorization/, 9],
    [/workflow|orchestration|pipeline|automation|scheduler/, 8],
    [/benchmark|latency|production|case study|architecture|framework/, 8],
    [/arxiv|paper|research|method|evaluation|experiment/, 7],
    [/open-source|github|sdk|protocol|api|repository/, 7],
    [/startup|funding|venture|market|product|saas|pricing/, 6],
    [/comfyui|aigc|video-generation|image-generation|creative/, 6]
  ];

  let topicScore = 0;
  let topicHits = 0;
  for (const [re, v] of topicRules) {
    if (re.test(text)) { topicScore += v; topicHits++; }
  }
  // Diminishing returns: if too many topic rules fire, cap harder to avoid pile-up.
  if (topicHits >= 5) topicScore = Math.round(topicScore * 0.7);
  else if (topicHits >= 3) topicScore = Math.round(topicScore * 0.85);
  score += Math.min(30, topicScore);

  let sourceScore = 0;
  if (raw.source_type === 'original') sourceScore += 7;
  if (raw.expected_response === 'reply') sourceScore += 4;
  if (raw.url) sourceScore += 4;
  if (Array.isArray(raw.keywords) && raw.keywords.length >= 5) sourceScore += 2;
  if (Array.isArray(raw.domains) && raw.domains.length >= 3) sourceScore += 2;
  if (item && Number(item.seenCount) > 1) sourceScore += Math.min(3, Number(item.seenCount));
  score += Math.min(14, sourceScore);

  let accountScore = 0;
  if (account === 'technical' && /agent|mcp|a2a|rag|memory|protocol|architecture/.test(text)) accountScore += 9;
  if (account === 'research' && /arxiv|paper|benchmark|method|framework|evaluation/.test(text)) accountScore += 9;
  if (account === 'business' && /startup|funding|venture|market|product|saas|pricing/.test(text)) accountScore += 9;
  if (account === 'creative' && /image|video|music|aigc|creative|comfy|blender|3d/.test(text)) accountScore += 9;
  if (account === 'news' && /launch|release|news|policy|platform|center|ministry/.test(text)) accountScore += 6;
  score += Math.min(10, accountScore);

  let actionScore = 0;
  if (/evaluate|integrate|benchmark|audit|deploy|implement|review|compile|configure|update your/.test(text)) actionScore += 7;
  if (/human-in-the-loop|human oversight|safety|security|revocation|data exposure/.test(text)) actionScore += 5;
  if (/vcp|eigenflux/.test(text)) actionScore += 6;
  score += Math.min(10, actionScore);

  // Penalize thin items and vague market/news-only items.
  if (!raw.url && raw.source_type !== 'original') score -= 4;
  if (str(raw.summary).length < 120) score -= 5;
  if (/announced|funding|policy/.test(text) && !/agent|rag|benchmark|architecture|framework|security|workflow/.test(text)) score -= 4;

  return Math.max(0, Math.min(98, Math.round(score)));
}

function inferTitle(raw) {
  const summary = str(raw.summary).trim();
  if (!summary) return raw.item_id ? `EigenFlux Item ${raw.item_id}` : 'Untitled EigenFlux Item';
  const first = summary.split(/[。.!?]\s/)[0].trim();
  return first.length > 90 ? first.slice(0, 88) + '…' : first;
}

function normalizeItem(account, displayName, item, date) {
  const raw = item.raw || {};
  const id = str(raw.item_id || item.item_id || item.id || `${account}-${date}-${Math.random().toString(36).slice(2)}`);
  const tagBundle = buildTagBundle(raw, account, 'EigenFlux');
  const tags = tagBundle.tags;
  const score = scoreItem(raw, account, item);
  const title = inferTitle(raw);
  const suggestedActions = [];
  if (score >= 70) suggestedActions.push('read_later');
  if (score >= 84) suggestedActions.push('possible_vcp_idea');
  if (score >= 88 && (tags.includes('AI-Agent') || tags.includes('多智能体') || tags.includes('RAG') || tags.includes('MCP') || tags.includes('A2A'))) suggestedActions.push('consider_for_forum');
  if (score >= 80 && (tags.includes('研究论文') || tags.includes('安全') || tags.includes('知识管理'))) suggestedActions.push('consider_for_knowledge_note');
  if (score >= 90) suggestedActions.push('morning_brief_candidate');

  return {
    id,
    item_id: id,
    date,
    account,
    accountDisplayName: displayName,
    title,
    score,
    tags,
    primaryTags: tagBundle.primaryTags,
    secondaryTags: tagBundle.secondaryTags,
    sourceTags: tagBundle.sourceTags,
    rawKeywords: tagBundle.rawKeywords,
    suggestedActions: unique(suggestedActions),
    summary: str(raw.summary),
    suggestion: str(raw.suggestion),
    url: str(raw.url),
    source_type: str(raw.source_type),
    broadcast_type: str(raw.broadcast_type),
    domains: Array.isArray(raw.domains) ? raw.domains : [],
    keywords: Array.isArray(raw.keywords) ? raw.keywords : [],
    firstSeenAt: item.firstSeenAt || '',
    lastSeenAt: item.lastSeenAt || '',
    seenCount: item.seenCount || 1,
    raw
  };
}

function loadItems(date, accounts) {
  const globalState = readJson(path.join(cfg.sourceDir, 'eigenflux-accounts-state.json'), {});
  const rows = [];
  const archives = [];

  for (const account of accounts) {
    const displayName = accountDisplayName(account, globalState);
    const arch = loadArchive(account, date);
    archives.push({
      account,
      displayName,
      file: arch.file,
      exists: arch.exists,
      totalItems: arch.archive ? arch.archive.totalItems : 0,
      heartbeatCount: arch.archive ? arch.archive.heartbeatCount : 0,
      updatedAt: arch.archive ? arch.archive.updatedAt : null,
      warnings: arch.warnings || []
    });
    for (const item of arch.items) rows.push(normalizeItem(account, displayName, item, date));
  }

  const seen = new Map();
  for (const row of rows) {
    const key = row.id || `${row.account}:${row.url}:${row.summary.slice(0, 80)}`;
    if (!seen.has(key) || seen.get(key).score < row.score) seen.set(key, row);
  }

  return { items: [...seen.values()], archives, globalState };
}

function commandInspect(args) {
  const date = args.date || today();
  const accounts = getAccounts(args);
  const includeSamples = String(args.includeSamples || 'false') === 'true';
  const { items, archives, globalState } = loadItems(date, accounts);

  const result = {
    date,
    sourceDir: cfg.sourceDir,
    accountCount: accounts.length,
    totalItems: items.length,
    globalIndex: {
      exists: fs.existsSync(path.join(cfg.sourceDir, 'eigenflux-accounts-state.json')),
      updatedAt: globalState.updatedAt || null,
      totalSeenItems: globalState.totalSeenItems || 0,
      enabledAccountCount: globalState.enabledAccountCount || 0
    },
    archives,
    fieldCompleteness: calcCompleteness(items),
    samples: includeSamples ? items.slice(0, 3) : undefined
  };

  return ok('VCPEigenFluxReport Inspect complete', result);
}

function calcCompleteness(items) {
  const fields = ['id', 'summary', 'suggestion', 'url', 'domains', 'keywords', 'tags'];
  const out = {};
  for (const f of fields) {
    let n = 0;
    for (const item of items) {
      const v = item[f];
      if (Array.isArray(v) ? v.length : !!v) n++;
    }
    out[f] = items.length ? Number((n / items.length).toFixed(3)) : 0;
  }
  return out;
}

function digestData(args) {
  const date = args.date || today();
  const accounts = getAccounts(args);
  const topN = Number(args.topN || args.limit || cfg.defaultTopN);
  const { items, archives } = loadItems(date, accounts);
  const sorted = items.sort((a, b) => b.score - a.score).slice(0, topN);
  return {
    date,
    accounts,
    topN,
    totalItems: items.length,
    returnedItems: sorted.length,
    archives,
    items: sorted
  };
}

function commandDigest(args) {
  const data = digestData(args);
  if (String(args.writeFile || 'false') === 'true') {
    const file = path.join(cfg.outputDir, 'digest', `${data.date}-digest.json`);
    writeJson(file, data);
    data.outputFile = file;
  }
  return ok('VCPEigenFluxReport Digest complete', data);
}

function dailyMarkdown(data) {
  const lines = [];
  lines.push('---');
  lines.push(`date: ${data.date}`);
  lines.push('type: eigenflux-daily');
  lines.push(`accounts: [${data.accounts.join(', ')}]`);
  lines.push(`totalItems: ${data.totalItems}`);
  lines.push(`topN: ${data.topN}`);
  lines.push('tags: [EigenFlux, 情报日报, 自动草稿]');
  lines.push('status: draft');
  lines.push('---');
  lines.push('');
  lines.push(`# EigenFlux 情报日报草稿 ${data.date}`);
  lines.push('');
  lines.push('> 自动生成的资料整理草稿，仅用于前期预处理；是否采纳、发布、写入知识库由主人和 Agent 二次判断。');
  lines.push('');
  lines.push('## 总览');
  lines.push('');
  lines.push(`- 覆盖账号：${data.accounts.join(', ')}`);
  lines.push(`- 归档素材数：${data.totalItems}`);
  lines.push(`- 入选 Top Signals：${data.returnedItems}`);
  lines.push('');
  lines.push('## Top Signals');
  lines.push('');
  data.items.forEach((item, idx) => {
    lines.push(`### ${idx + 1}. ${item.title}`);
    lines.push('');
    lines.push(`- 分数：${item.score}`);
    lines.push(`- 账号：[[${item.account}]]`);
    lines.push(`- 标签：${item.tags.map(t => '#' + t).join(' ')}`);
    if (item.url) lines.push(`- 链接：${item.url}`);
    lines.push('');
    lines.push(`摘要：${item.summary || '无摘要'}`);
    if (item.suggestion) {
      lines.push('');
      lines.push(`建议：${item.suggestion}`);
    }
    if (item.suggestedActions.length) {
      lines.push('');
      lines.push(`待判断动作：${item.suggestedActions.join(', ')}`);
    }
    lines.push('');
  });
  lines.push('## 待人工判断');
  lines.push('');
  lines.push('- [ ] 是否有内容值得进入 VCP 行动计划');
  lines.push('- [ ] 是否有内容值得写入知识日记');
  lines.push('- [ ] 是否有内容值得发论坛讨论');
  lines.push('- [ ] 是否有内容需要继续追踪源链接');
  lines.push('');
  return lines.join('\n');
}

function commandDaily(args) {
  const data = digestData(args);
  const md = dailyMarkdown(data);
  const result = { ...data, markdown: md };
  if (String(args.writeFile || 'true') === 'true') {
    const file = path.join(cfg.outputDir, 'daily', `${data.date}-eigenflux-daily.md`);
    writeText(file, md);
    result.outputFile = file;
  }
  return ok('VCPEigenFluxReport Daily complete', result);
}

function frontmatterValue(v) {
  if (Array.isArray(v)) return `[${v.map(x => JSON.stringify(String(x))).join(', ')}]`;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(String(v || ''));
}

function itemMarkdown(item) {
  const lines = [];
  lines.push('---');
  const fm = {
    id: item.id,
    type: 'eigenflux-item',
    date: item.date,
    account: item.account,
    source: 'EigenFlux',
    score: item.score,
    tags: item.tags,
    status: 'auto',
    firstSeenAt: item.firstSeenAt,
    lastSeenAt: item.lastSeenAt,
    seenCount: item.seenCount,
    url: item.url
  };
  for (const [k, v] of Object.entries(fm)) lines.push(`${k}: ${frontmatterValue(v)}`);
  lines.push('---');
  lines.push('');
  lines.push(`# ${item.title}`);
  lines.push('');
  lines.push('<!-- AUTO-GENERATED:START -->');
  lines.push('');
  lines.push('## 摘要');
  lines.push('');
  lines.push(item.summary || '无摘要。');
  lines.push('');
  if (item.suggestion) {
    lines.push('## 推荐理由 / 建议');
    lines.push('');
    lines.push(item.suggestion);
    lines.push('');
  }
  lines.push('## 元数据');
  lines.push('');
  lines.push(`- 分数：${item.score}`);
  lines.push(`- 账号：[[${item.account}]]`);
  lines.push(`- 日期：[[${item.date}]]`);
  lines.push(`- 标签：${item.tags.map(t => '#' + t).join(' ')}`);
  if (item.url) lines.push(`- 原始链接：${item.url}`);
  if (item.domains.length) lines.push(`- domains：${item.domains.join(', ')}`);
  if (item.keywords.length) lines.push(`- keywords：${item.keywords.join(', ')}`);
  if (item.suggestedActions.length) lines.push(`- 待判断动作：${item.suggestedActions.join(', ')}`);
  lines.push('');
  lines.push('<!-- AUTO-GENERATED:END -->');
  lines.push('');
  lines.push('## 人工笔记');
  lines.push('');
  lines.push('<!-- 手动批注区：自动更新不会覆盖此段以下内容。 -->');
  lines.push('');
  return lines.join('\n');
}

function preserveManual(oldText, newText) {
  const marker = '## 人工笔记';
  if (!oldText || !oldText.includes(marker)) return newText;
  const manual = oldText.slice(oldText.indexOf(marker));
  const idx = newText.indexOf(marker);
  if (idx < 0) return newText + '\n\n' + manual;
  return newText.slice(0, idx) + manual;
}

function writeItemCard(item) {
  const file = path.join(cfg.vaultDir, 'Items', `${slugify(item.id)}.md`);
  const next = itemMarkdown(item);
  const old = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  writeText(file, preserveManual(old, next));
  return file;
}

function writeVaultIndexes(date, data) {
  const itemLinks = data.items.map(item => ({ item, link: `[[${slugify(item.id)}]]` }));

  const tagMap = new Map();
  for (const item of data.items) {
    for (const tag of item.tags) {
      if (!tagMap.has(tag)) tagMap.set(tag, []);
      tagMap.get(tag).push(item);
    }
  }

  for (const [tag, items] of tagMap.entries()) {
    const lines = [];
    lines.push('---');
    lines.push(`type: eigenflux-tag-index`);
    lines.push(`tag: ${frontmatterValue(tag)}`);
    lines.push(`updatedAt: ${frontmatterValue(new Date().toISOString())}`);
    lines.push('---');
    lines.push('');
    lines.push(`# #${tag}`);
    lines.push('');
    lines.push('## 相关素材');
    lines.push('');
    lines.push('| 日期 | 标题 | 账号 | 分数 |');
    lines.push('|---|---|---|---:|');
    for (const item of items.sort((a, b) => b.score - a.score)) {
      lines.push(`| [[${item.date}]] | [[${slugify(item.id)}|${escapePipe(item.title)}]] | [[${item.account}]] | ${item.score} |`);
    }
    lines.push('');
    writeText(path.join(cfg.vaultDir, 'Tags', `${slugify(tag)}.md`), lines.join('\n'));
  }

  const accountMap = new Map();
  for (const item of data.items) {
    if (!accountMap.has(item.account)) accountMap.set(item.account, []);
    accountMap.get(item.account).push(item);
  }

  for (const [account, items] of accountMap.entries()) {
    const lines = [];
    lines.push('---');
    lines.push('type: eigenflux-account-index');
    lines.push(`account: ${frontmatterValue(account)}`);
    lines.push('---');
    lines.push('');
    lines.push(`# ${account}`);
    lines.push('');
    lines.push('| 日期 | 标题 | 分数 | 标签 |');
    lines.push('|---|---|---:|---|');
    for (const item of items.sort((a, b) => b.score - a.score)) {
      lines.push(`| [[${item.date}]] | [[${slugify(item.id)}|${escapePipe(item.title)}]] | ${item.score} | ${item.tags.map(t => '#' + t).join(' ')} |`);
    }
    lines.push('');
    writeText(path.join(cfg.vaultDir, 'Accounts', `${slugify(account)}.md`), lines.join('\n'));
  }

  writeText(path.join(cfg.vaultDir, 'Daily', `${date}.md`), dailyMarkdown(data));

  const index = [];
  index.push('# EigenFlux Intelligence Vault');
  index.push('');
  index.push(`更新时间：${new Date().toISOString()}`);
  index.push('');
  index.push('## 入口');
  index.push('');
  index.push('- [[Daily/' + date + '|' + date + ' 日报]]');
  index.push('- Tags/');
  index.push('- Accounts/');
  index.push('- Items/');
  index.push('');
  index.push('## 最新素材');
  index.push('');
  for (const { item } of itemLinks.slice(0, 30)) {
    index.push(`- [[${slugify(item.id)}|${item.title}]] · ${item.score} · [[${item.account}]] · ${item.tags.map(t => '#' + t).join(' ')}`);
  }
  index.push('');
  writeText(path.join(cfg.vaultDir, 'Index.md'), index.join('\n'));

  writeText(path.join(cfg.vaultDir, 'Sources', 'EigenFlux.md'), '# EigenFlux\n\n本目录由 VCPEigenFluxReport 自动生成，用于整理 VCPEigenFlux 采集到的多账号情报归档。\n');
}

function escapePipe(s) {
  return String(s || '').replace(/\|/g, '｜');
}

function commandVault(args) {
  const mode = args.mode || 'daily';
  const data = digestData({ ...args, topN: args.topN || args.limit || 50 });
  ensureDir(cfg.vaultDir);
  const files = [];
  for (const item of data.items) files.push(writeItemCard(item));
  writeVaultIndexes(data.date, data);
  const result = {
    date: data.date,
    mode,
    vaultDir: cfg.vaultDir,
    itemFiles: files.length,
    generatedFiles: files
  };
  return ok('VCPEigenFluxReport Vault export complete', result);
}

function classifyCandidate(item) {
  const tags = item.tags || [];
  if (item.score >= 90) return 'must_read';
  if (item.score >= 78) return 'worth_scan';
  return 'archive_only';
}

function suggestBoard(item) {
  const tags = item.tags || [];
  if (tags.includes('创作工具')) return 'VCP技术板块';
  if (tags.includes('商业产品')) return '经验分享';
  if (tags.includes('研究论文') || tags.includes('安全') || tags.includes('AI-Agent') || tags.includes('RAG') || tags.includes('多智能体')) return 'VCP技术板块';
  return '即刻简报';
}

function commandReviewQueue(args) {
  const data = digestData(args);
  const candidates = data.items.map(item => ({
    id: item.id,
    title: item.title,
    score: item.score,
    tier: classifyCandidate(item),
    account: item.account,
    tags: item.tags,
    suggestedActions: item.suggestedActions,
    suggestedBoard: suggestBoard(item),
    reason: item.suggestion || item.summary,
    url: item.url
  }));

  const queue = {
    date: data.date,
    generatedAt: new Date().toISOString(),
    totalCandidates: candidates.length,
    tiers: {
      must_read: candidates.filter(x => x.tier === 'must_read').length,
      worth_scan: candidates.filter(x => x.tier === 'worth_scan').length,
      archive_only: candidates.filter(x => x.tier === 'archive_only').length
    },
    publishPlan: buildPublishPlan(candidates),
    candidates
  };
  if (String(args.writeFile || 'true') === 'true') {
    const file = path.join(cfg.outputDir, 'review-queue', `${data.date}.json`);
    writeJson(file, queue);
    queue.outputFile = file;
  }
  return ok('VCPEigenFluxReport ReviewQueue complete', queue);
}

function buildPublishPlan(candidates) {
  const must = candidates.filter(x => x.tier === 'must_read');
  const tech = must.filter(x => x.suggestedBoard === 'VCP技术板块');
  const exp = must.filter(x => x.suggestedBoard === '经验分享');
  return {
    mainBrief: {
      board: '即刻简报',
      recommended: true,
      maxItems: 10,
      items: candidates.slice(0, 10).map(x => x.id)
    },
    optionalTechPost: {
      board: 'VCP技术板块',
      recommended: tech.length >= 3,
      reason: tech.length >= 3 ? '今日技术/Agent/RAG/安全信号密集，适合单独专题讨论。' : '技术信号不足 3 条，建议并入主早报。',
      items: tech.slice(0, 10).map(x => x.id)
    },
    optionalExperiencePost: {
      board: '经验分享',
      recommended: exp.length >= 3,
      reason: exp.length >= 3 ? '今日商业化/工程经验信号密集，适合沉淀经验帖。' : '经验类信号不足 3 条，建议只归档。',
      items: exp.slice(0, 10).map(x => x.id)
    }
  };
}

// --- Jike data layer ---

function jikeArchivePath(date) {
  return path.join(cfg.jikeArchiveDir, `${date}-jike-feeds.json`);
}

function validateJikeArchive(json) {
  const warnings = [];
  if (!json || typeof json !== 'object') {
    warnings.push('archive_not_object_or_missing');
    return warnings;
  }
  if (!Array.isArray(json.items)) warnings.push('items_not_array');
  if (json.totalItems !== undefined && Number(json.totalItems) < 0) warnings.push('totalItems_negative');
  if (json.fetchedAt && Number.isNaN(Date.parse(json.fetchedAt))) warnings.push('fetchedAt_invalid');
  return warnings;
}

function loadJikeArchive(date) {
  const file = jikeArchivePath(date);
  const json = readJson(file, null);
  const warnings = validateJikeArchive(json);
  if (!json || !Array.isArray(json.items)) return { exists: false, file, items: [], totalItems: 0, warnings };
  return { exists: true, file, items: json.items, totalItems: json.totalItems || json.items.length, fetchedAt: json.fetchedAt, warnings };
}

function normalizeJikeItem(item, date) {
  const raw = {
    summary: str(item.content),
    suggestion: '',
    url: item.id ? `https://web.okjike.com/post/${item.id}` : '',
    domains: item.topics || [],
    keywords: [item.topicName, item.nickname, item._source].filter(Boolean),
    source_type: 'jike',
    broadcast_type: 'social',
    content: str(item.content),
    title: str(item.content).slice(0, 90),
  };
  const tagBundle = buildTagBundle(raw, null, 'Jike');
  const score = scoreJikeItem(item, raw);
  const title = str(item.content).split(/[。.!?\n]/)[0].trim().slice(0, 90) || 'Jike Post';
  const suggestedActions = [];
  if (score >= 70) suggestedActions.push('read_later');
  if (score >= 84) suggestedActions.push('possible_vcp_idea');
  if (score >= 88 && (tagBundle.primaryTags.includes('AI-Agent') || tagBundle.primaryTags.includes('RAG'))) suggestedActions.push('consider_for_forum');
  if (score >= 90) suggestedActions.push('morning_brief_candidate');

  return {
    id: `jike-${item.id || Date.now()}`,
    item_id: item.id || '',
    date,
    source: 'Jike',
    account: 'jike',
    accountDisplayName: '即刻社区',
    title,
    score,
    tags: tagBundle.tags,
    primaryTags: tagBundle.primaryTags,
    secondaryTags: tagBundle.secondaryTags,
    sourceTags: tagBundle.sourceTags,
    rawKeywords: tagBundle.rawKeywords,
    suggestedActions: unique(suggestedActions),
    summary: str(item.content),
    suggestion: '',
    url: raw.url,
    source_type: 'jike',
    broadcast_type: 'social',
    domains: raw.domains,
    keywords: raw.keywords,
    nickname: item.nickname || '',
    topicName: item.topicName || '',
    likeCount: item.likeCount || 0,
    commentCount: item.commentCount || 0,
    createdAt: item.createdAt || '',
    _jikeSource: item._source || '',
  };
}

function scoreJikeItem(item, raw) {
  // v0.1.2 Jike calibration:
  // Jike's value anchor is social consensus + field experience + creator/product insight.
  // It lacks EigenFlux's structured source fields, so its baseline and social/community signals need stronger weight.
  const text = `${str(item.content)} ${str(item.topicName)} ${str(item.nickname)} ${str(item._source)} ${str(item._searchKeyword)}`.toLowerCase();
  const topicName = str(item.topicName).toLowerCase();
  const sourceType = str(item._sourceType || '').toLowerCase();
  let score = 38;

  const topicRules = [
    [/agent|multi-agent|agentic|a2a|mcp|coding agent|craft agent|opencode|智能体/, 12],
    [/rag|memory|context|knowledge|vector|embedding|知识库|上下文|记忆/, 9],
    [/comfyui|aigc|video generation|image generation|stable diffusion|midjourney|豆包|skill|skills|生图|视频生成/, 8],
    [/open-source|github|开源|框架|sdk|api|repository|仓库|star/, 8],
    [/arxiv|paper|论文|研究|benchmark|评测/, 7],
    [/startup|融资|创业|saas|产品|商业|pmf|增长|定价|收费/, 7],
    [/workflow|automation|orchestration|pipeline|自动化|工作流/, 8],
    [/security|auth|credential|安全|权限|token|鉴权/, 6],
    [/vcp|eigenflux/, 10],
    [/codex|claude|anthropic|chatgpt|openai|大模型|llm/, 7],
    [/产品经理|原型|设计文档|用户体验|产品岗位/, 6],
  ];

  let topicScore = 0;
  let topicHits = 0;
  for (const [re, v] of topicRules) {
    if (re.test(text)) { topicScore += v; topicHits++; }
  }
  if (topicHits >= 5) topicScore = Math.round(topicScore * 0.72);
  else if (topicHits >= 3) topicScore = Math.round(topicScore * 0.88);
  score += Math.min(32, topicScore);

  // Social signals: in Jike, 100+ likes often means strong consensus from a high-density tech/product community.
  const likes = Number(item.likeCount || 0);
  const comments = Number(item.commentCount || 0);
  if (likes >= 200) score += 12;
  else if (likes >= 100) score += 10;
  else if (likes >= 50) score += 7;
  else if (likes >= 20) score += 4;
  else if (likes >= 10) score += 2;

  if (comments >= 100) score += 10;
  else if (comments >= 50) score += 8;
  else if (comments >= 20) score += 6;
  else if (comments >= 10) score += 3;
  else if (comments >= 5) score += 1;

  // Search stream often lacks social fields. Give a small provenance bonus only when it also hits relevant topics.
  if (sourceType === 'search' && topicScore >= 10) score += 3;

  // Content quality signals
  const contentLen = str(item.content).length;
  if (contentLen >= 800) score += 7;
  else if (contentLen >= 500) score += 5;
  else if (contentLen >= 200) score += 3;
  else if (contentLen >= 100) score += 1;

  if (contentLen < 50) score -= 6;
  if (contentLen < 30) score -= 10;

  // Community/topic relevance. Jike topic is a strong filter and should be treated as an independent signal.
  if (/ai探索站|人工智能讨论组|jithub程序员/.test(topicName)) score += 8;
  else if (/科技圈大小事|产品经理的日常|独立开发者|创业者/.test(topicName)) score += 5;
  else if (/财经圈大小事|你不知道的行业内幕|读书会|浴室沉思|一个想法不一定对/.test(topicName)) score += 2;

  if (/记一件小事|小散户|职场那些事|喵星人的日常|水果爱好者协会|去过的好玩的地方|此刻的天空|这么过分一定发即刻|恰好喜欢男生/.test(topicName)) score -= 5;

  // Author priors: lightweight, only for repeatedly useful AI/product creators seen in the archive.
  if (/歸藏|技术人说|空格_|ai柿子|阑夕|alchian花生|indie-fox|潦草学者/.test(str(item.nickname))) score += 3;

  // Penalize social-hot but off-topic posts so raw popularity does not dominate the fusion brief.
  const isRelevant = topicScore >= 8 || /ai探索站|人工智能讨论组|jithub程序员|科技圈大小事|产品经理的日常/.test(topicName);
  if (!isRelevant && (likes >= 100 || comments >= 50)) score -= 10;

  return Math.max(0, Math.min(98, Math.round(score)));
}

function loadJikeItems(date, topN = 10) {
  const archive = loadJikeArchive(date);
  if (!archive.exists) return { items: [], archive };
  const normalized = archive.items.map(item => normalizeJikeItem(item, date));
  const sorted = normalized.sort((a, b) => b.score - a.score).slice(0, topN);
  return { items: sorted, archive };
}

// --- Fusion command ---

function commandFusionBrief(args) {
  const runId = args.runId || createRunId('fusion');
  const date = args.date || today();
  const jikeTopN = Number(args.jikeTopN || 10);
  const efTopN = Number(args.efTopN || 10);
  const accounts = getAccounts(args);

  // Load both sources
  const efData = digestData({ ...args, topN: efTopN, accounts: accounts.join(',') });
  const jikeData = loadJikeItems(date, jikeTopN);

  // Merge and re-sort
  const allItems = [...efData.items, ...jikeData.items];
  const sorted = allItems.sort((a, b) => b.score - a.score);

  // Detect cross-source resonance
  const efTagSet = new Set();
  for (const item of efData.items) for (const t of (item.primaryTags || [])) efTagSet.add(t);
  const jikeTagSet = new Set();
  for (const item of jikeData.items) for (const t of (item.primaryTags || [])) jikeTagSet.add(t);
  const resonance = [...efTagSet].filter(t => jikeTagSet.has(t));

  // Build candidates with tier and board
  const candidates = sorted.map(item => ({
    id: item.id,
    title: item.title,
    score: item.score,
    tier: classifyCandidate(item),
    source: item.source || (item.account === 'jike' ? 'Jike' : 'EigenFlux'),
    account: item.account,
    primaryTags: item.primaryTags,
    secondaryTags: item.secondaryTags,
    sourceTags: item.sourceTags,
    suggestedBoard: suggestBoard(item),
    suggestedActions: item.suggestedActions,
    summary: (item.summary || '').slice(0, 300),
    url: item.url,
    nickname: item.nickname || '',
    likeCount: item.likeCount || 0,
    commentCount: item.commentCount || 0,
  }));

  const plan = buildPublishPlan(candidates);

  // Generate markdown
  const lines = [];
  lines.push('---');
  lines.push(`date: ${date}`);
  lines.push('type: fusion-brief-draft');
  lines.push('sources: [EigenFlux, Jike]');
  lines.push('status: draft');
  lines.push('---');
  lines.push('');
  lines.push(`# Nova 融合早报草稿 ${date}`);
  lines.push('');
  lines.push('> Jike 社区热度 + EigenFlux 结构化情报，双源融合。');
  lines.push('');
  lines.push('## 数据概览');
  lines.push('');
  lines.push(`- EigenFlux 素材：${efData.totalItems} 条，入选 Top ${efData.returnedItems}`);
  lines.push(`- Jike 素材：${jikeData.archive.totalItems || 0} 条，入选 Top ${jikeData.items.length}`);
  lines.push(`- 融合候选：${candidates.length} 条`);
  if (resonance.length) lines.push(`- 跨源共振主题：${resonance.map(t => '#' + t).join(' ')}`);
  lines.push('');

  if (resonance.length) {
    lines.push('## 跨源共振');
    lines.push('');
    lines.push(`以下主题同时出现在 Jike 和 EigenFlux 两个来源中：${resonance.map(t => '**#' + t + '**').join('、')}`);
    lines.push('');
  }

  lines.push('## 融合 Top 候选');
  lines.push('');
  candidates.slice(0, 15).forEach((x, idx) => {
    const srcBadge = x.source === 'Jike' ? '[即刻]' : '[EF]';
    lines.push(`### ${idx + 1}. ${srcBadge} ${x.title}`);
    lines.push('');
    lines.push(`- 分数：${x.score} · 层级：${x.tier} · 来源：${x.source}/${x.account}`);
    lines.push(`- 建议板块：${x.suggestedBoard}`);
    lines.push(`- 标签：${(x.primaryTags || []).map(t => '#' + t).join(' ')}`);
    if (x.url) lines.push(`- 链接：${x.url}`);
    if (x.nickname) lines.push(`- 作者：${x.nickname}${x.likeCount ? ' · ❤️' + x.likeCount : ''}${x.commentCount ? ' · 💬' + x.commentCount : ''}`);
    lines.push('');
    lines.push(x.summary || '无摘要。');
    lines.push('');
  });

  lines.push('## 发布建议');
  lines.push('');
  lines.push(`- 主早报：${plan.mainBrief.recommended ? '建议生成' : '不建议'}`);
  lines.push(`- 技术专题：${plan.optionalTechPost.recommended ? '建议生成' : '暂不建议'}；${plan.optionalTechPost.reason}`);
  lines.push(`- 经验专题：${plan.optionalExperiencePost.recommended ? '建议生成' : '暂不建议'}；${plan.optionalExperiencePost.reason}`);
  lines.push('');
  lines.push('## 人工确认清单');
  lines.push('');
  lines.push('- [ ] 是否发布主早报到「即刻简报」');
  lines.push('- [ ] 是否额外发布技术专题到「VCP技术板块」');
  lines.push('- [ ] 是否额外发布经验专题到「经验分享」');
  lines.push('- [ ] 是否有素材需要联网二次核实');
  lines.push('- [ ] 是否有素材值得写入知识日记');
  lines.push('');

  const md = lines.join('\n');
  const inputWarnings = [
    ...((efData.archives || []).flatMap(a => (a.warnings || []).map(w => ({ source: 'EigenFlux', account: a.account, file: a.file, warning: w })))),
    ...((jikeData.archive.warnings || []).map(w => ({ source: 'Jike', file: jikeData.archive.file, warning: w })))
  ];

  const result = {
    runId,
    date,
    inputWarnings,
    sources: { eigenflux: { totalItems: efData.totalItems, selected: efData.returnedItems }, jike: { totalItems: jikeData.archive.totalItems || 0, selected: jikeData.items.length } },
    resonance,
    totalCandidates: candidates.length,
    tiers: { must_read: candidates.filter(x => x.tier === 'must_read').length, worth_scan: candidates.filter(x => x.tier === 'worth_scan').length, archive_only: candidates.filter(x => x.tier === 'archive_only').length },
    publishPlan: plan,
    candidates,
    markdown: md,
  };

  if (String(args.writeFile || 'true') === 'true') {
    const file = path.join(cfg.outputDir, 'fusion-brief', `${date}-fusion-brief.md`);
    writeText(file, md);
    const jsonFile = path.join(cfg.outputDir, 'fusion-brief', `${date}-fusion-brief.json`);
    writeJson(jsonFile, result);
    result.outputFile = file;
    result.outputJsonFile = jsonFile;
  }

  return ok('VCPEigenFluxReport FusionBrief complete', result);
}


function commandRenderBrief(args) {
  const date = args.date || today();
  const vol = args.vol || args.volume || '';
  const inputFile = args.inputFile || path.join(cfg.outputDir, 'fusion-brief', `${date}-fusion-brief.json`);
  const outputDir = args.outputDir || path.join(cfg.outputDir, 'rendered-brief');
  const displayDate = args.displayDate || args.display_date || args.publishDate || date;
  const postTitle = args.title || `[即刻简报] ${displayDate} 科技与AI热点速递 (早报)`;

  const data = readJson(inputFile, null);
  if (!data) return err(`FusionBrief JSON not found or invalid: ${inputFile}`);

  const rendered = briefRenderer.renderMarkdownPost(data, { vol, title: postTitle, displayDate });
  const htmlOnly = briefRenderer.renderHtml(data, { vol, title: postTitle, displayDate });

  ensureDir(outputDir);
  const mdFile = args.outputFile || path.join(outputDir, `${date}-jike-brief-rendered.md`);
  const htmlFile = args.htmlFile || path.join(outputDir, `${date}-jike-brief-rendered.html`);
  writeText(mdFile, rendered);
  writeText(htmlFile, htmlOnly);

  const result = {
    runId: data.runId || args.runId || '',
    date,
    inputFile,
    outputFile: mdFile,
    htmlFile,
    bytes: Buffer.byteLength(rendered, 'utf8'),
    htmlBytes: Buffer.byteLength(htmlOnly, 'utf8'),
    title: postTitle,
    preview: rendered.slice(0, 1200)
  };

  return ok('VCPEigenFluxReport RenderBrief complete', result);
}

function commandMorningBrief(args) {
  const data = digestData({ ...args, topN: args.topN || 10 });
  const candidates = data.items.map(item => ({
    id: item.id,
    title: item.title,
    score: item.score,
    tier: classifyCandidate(item),
    account: item.account,
    tags: item.tags,
    suggestedBoard: suggestBoard(item),
    summary: item.summary,
    suggestion: item.suggestion,
    url: item.url
  }));
  const plan = buildPublishPlan(candidates);
  const lines = [];
  lines.push('---');
  lines.push(`date: ${data.date}`);
  lines.push('type: morning-brief-draft');
  lines.push('sources: [EigenFlux]');
  lines.push(`topN: ${data.topN}`);
  lines.push('status: draft');
  lines.push('---');
  lines.push('');
  lines.push(`# Nova 早间融合初审草稿 ${data.date}`);
  lines.push('');
  lines.push('> 当前版本先接入 EigenFlux；后续会接入 JikeScraper 夜间采集结果，形成 Jike + EigenFlux 双源融合早报。');
  lines.push('');
  lines.push('## 今日最值得看');
  lines.push('');
  candidates.slice(0, 10).forEach((x, idx) => {
    lines.push(`### ${idx + 1}. ${x.title}`);
    lines.push('');
    lines.push(`- 分数：${x.score}`);
    lines.push(`- 层级：${x.tier}`);
    lines.push(`- 来源账号：${x.account}`);
    lines.push(`- 建议板块：${x.suggestedBoard}`);
    lines.push(`- 标签：${x.tags.map(t => '#' + t).join(' ')}`);
    if (x.url) lines.push(`- 链接：${x.url}`);
    lines.push('');
    lines.push(x.summary || '无摘要。');
    if (x.suggestion) {
      lines.push('');
      lines.push(`Nova 初步动作建议：${x.suggestion}`);
    }
    lines.push('');
  });
  lines.push('## 发布建议');
  lines.push('');
  lines.push(`- 主早报：${plan.mainBrief.recommended ? '建议生成' : '不建议'}`);
  lines.push(`- 技术专题：${plan.optionalTechPost.recommended ? '建议生成' : '暂不建议'}；${plan.optionalTechPost.reason}`);
  lines.push(`- 经验专题：${plan.optionalExperiencePost.recommended ? '建议生成' : '暂不建议'}；${plan.optionalExperiencePost.reason}`);
  lines.push('');
  lines.push('## 人工确认清单');
  lines.push('');
  lines.push('- [ ] 是否发布主早报到「即刻简报」');
  lines.push('- [ ] 是否额外发布技术专题到「VCP技术板块」');
  lines.push('- [ ] 是否有素材需要联网二次核实');
  lines.push('- [ ] 是否有素材值得写入知识日记');
  lines.push('');

  const result = { date: data.date, topN: data.topN, candidates, publishPlan: plan, markdown: lines.join('\n') };
  if (String(args.writeFile || 'true') === 'true') {
    const file = path.join(cfg.outputDir, 'morning-brief', `${data.date}-morning-brief.md`);
    writeText(file, result.markdown);
    result.outputFile = file;
  }
  return ok('VCPEigenFluxReport MorningBrief complete', result);
}


// --- Built-in daily brief scheduler (hybridservice heartbeat) ---
// Date semantics:
// - dataDate: the date of source intelligence data being consumed, normally yesterday.
// - publishDate/displayDate: the visible date of the morning brief, normally today.
// Scheduler always records both dates in scheduler-state.json detail to avoid silent off-by-one drift.

const SCHEDULER_STATE_FILE = path.join(cfg.outputDir, 'scheduler-state.json');
const SCHEDULER_INTERVAL_MS = Number(process.env.EFREPORT_SCHEDULER_INTERVAL_MS || fileEnv.EFREPORT_SCHEDULER_INTERVAL_MS || 60 * 1000);
const SCHEDULER_ENABLED = String(process.env.EFREPORT_SCHEDULER_ENABLED || fileEnv.EFREPORT_SCHEDULER_ENABLED || 'true') !== 'false';

let schedulerTimer = null;
let schedulerRunning = false;

function localDate(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function localYesterday(d = new Date()) {
  return localDate(new Date(d.getTime() - 24 * 3600 * 1000));
}

function minutesOfDay(d = new Date()) {
  return d.getHours() * 60 + d.getMinutes();
}

function hmToMinutes(hm) {
  const [h, m] = String(hm).split(':').map(Number);
  return h * 60 + m;
}

function readSchedulerState() {
  return readJson(SCHEDULER_STATE_FILE, { jobs: {}, history: [] }) || { jobs: {}, history: [] };
}

function writeSchedulerState(state) {
  state.lastHeartbeatAt = new Date().toISOString();
  writeJson(SCHEDULER_STATE_FILE, state);
}

function appendSchedulerHistory(state, event) {
  if (!Array.isArray(state.history)) state.history = [];
  state.history.push({ at: new Date().toISOString(), ...event });
  if (state.history.length > 200) state.history = state.history.slice(-200);
}

function shouldRunDailyJob(state, jobId, todayDate, startMin, catchUpUntilMin, nowMin) {
  const job = state.jobs[jobId] || {};
  if (job.lastRunDate === todayDate && job.lastStatus === 'success') return false;
  if (nowMin < startMin) return false;
  if (nowMin > catchUpUntilMin) return false;
  return true;
}

function markSchedulerJob(state, jobId, todayDate, status, detail) {
  state.jobs[jobId] = {
    lastRunDate: todayDate,
    lastRunAt: new Date().toISOString(),
    lastStatus: status,
    detail: detail || null
  };
}

function runNodeScript(scriptFile, args = [], options = {}) {
  const out = childProcess.execFileSync(process.execPath, [scriptFile, ...args], {
    cwd: options.cwd || PLUGIN_DIR,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: options.timeout || 10 * 60 * 1000
  });
  try { return JSON.parse(out); } catch (_) { return { raw: out }; }
}

function runJikeArchiveJob(todayDate, runId = createRunId('jike-archive')) {
  const script = cfg.jikeArchiveScript;
  if (!fs.existsSync(script)) throw new Error(`Jike archive script not found: ${script}`);
  const out = childProcess.execFileSync(process.execPath, [script], {
    cwd: path.dirname(script),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 10 * 60 * 1000
  });
  return { runId, date: todayDate, outputPreview: String(out || '').slice(0, 1200) };
}

function runFusionRenderJob(todayDate, runId = createRunId('fusion-render')) {
  // dataDate is intentionally yesterday: the morning brief published today summarizes yesterday's source window.
  const dataDate = localYesterday();
  const publishDate = todayDate;
  const fusion = commandFusionBrief({ command: 'EFReportFusionBrief', date: dataDate, writeFile: 'true', runId });
  const render = commandRenderBrief({ command: 'EFReportRenderBrief', date: dataDate, displayDate: publishDate, writeFile: 'true', runId });
  return {
    dataDate,
    publishDate,
    fusionStatus: fusion.status,
    renderStatus: render.status,
    renderedFile: render.result && render.result.outputFile
  };
}

function runPublisherJob(todayDate, runId = createRunId('publisher')) {
  const script = path.join(PLUGIN_DIR, 'daily-brief-publisher.js');
  if (!fs.existsSync(script)) throw new Error(`Publisher script not found: ${script}`);
  const detail = runNodeScript(script, ['--date', todayDate], { cwd: PLUGIN_DIR, timeout: 5 * 60 * 1000 });
  return { runId, ...detail };
}

async function runSchedulerTick(reason = 'interval') {
  if (!SCHEDULER_ENABLED) return { status: 'disabled' };
  if (schedulerRunning) return { status: 'skipped', reason: 'scheduler_running' };

  schedulerRunning = true;
  const now = new Date();
  const runId = createRunId(`scheduler-${reason}`);
  const todayDate = localDate(now);
  const nowMin = minutesOfDay(now);
  const state = readSchedulerState();
  state.enabled = true;
  state.intervalMs = SCHEDULER_INTERVAL_MS;
  state.lastRunId = runId;

  const results = [];

  try {
    const jobs = [
      { id: 'jike_archive', start: '01:30', until: '06:00', run: runJikeArchiveJob },
      { id: 'fusion_render', start: '06:00', until: '11:00', run: runFusionRenderJob }
    ];

    for (const job of jobs) {
      const startMin = hmToMinutes(job.start);
      const untilMin = hmToMinutes(job.until);
      if (!shouldRunDailyJob(state, job.id, todayDate, startMin, untilMin, nowMin)) continue;

      try {
        const detail = { runId, ...job.run(todayDate, runId) };
        markSchedulerJob(state, job.id, todayDate, 'success', detail);
        appendSchedulerHistory(state, { jobId: job.id, status: 'success', reason, detail });
        results.push({ jobId: job.id, status: 'success', detail });
      } catch (e) {
        const detail = { error: String(e && e.stack || e) };
        markSchedulerJob(state, job.id, todayDate, 'error', detail);
        appendSchedulerHistory(state, { jobId: job.id, status: 'error', reason, detail });
        results.push({ jobId: job.id, status: 'error', detail });
      }
    }

    // Publisher: after 07:05, keep checking until it publishes or sees already_published.
    if (nowMin >= hmToMinutes('07:05')) {
      const pubState = state.jobs.publisher || {};
      const alreadyFinal = pubState.lastRunDate === todayDate && (pubState.lastStatus === 'success' || pubState.lastStatus === 'already_published');
      if (!alreadyFinal) {
        try {
          const detail = runPublisherJob(todayDate, runId);
          const status = detail.status === 'success'
            ? 'success'
            : (detail.reason === 'already_published' ? 'already_published' : 'skipped');
          markSchedulerJob(state, 'publisher', todayDate, status, detail);
          appendSchedulerHistory(state, { jobId: 'publisher', status, reason, detail });
          results.push({ jobId: 'publisher', status, detail });
        } catch (e) {
          const detail = { error: String(e && e.stack || e) };
          markSchedulerJob(state, 'publisher', todayDate, 'error', detail);
          appendSchedulerHistory(state, { jobId: 'publisher', status: 'error', reason, detail });
          results.push({ jobId: 'publisher', status: 'error', detail });
        }
      }
    }

    try {
      writeSchedulerState(state);
    } catch (e) {
      appendLog({ ok: false, error: String(e && e.stack || e), scope: 'scheduler_state_write' });
      return { status: 'error', reason, runId, date: todayDate, results, error: String(e && e.message || e) };
    }
    return { status: 'success', reason, runId, date: todayDate, results };
  } finally {
    schedulerRunning = false;
  }
}

function startScheduler() {
  if (!SCHEDULER_ENABLED) {
    appendLog({ ok: true, message: 'VCPEigenFluxReport scheduler disabled' });
    return;
  }
  if (schedulerTimer) return;
  runSchedulerTick('boot').catch(e => appendLog({ ok: false, error: String(e && e.stack || e), scope: 'scheduler_boot' }));
  schedulerTimer = setInterval(() => {
    runSchedulerTick('interval').catch(e => appendLog({ ok: false, error: String(e && e.stack || e), scope: 'scheduler_interval' }));
  }, SCHEDULER_INTERVAL_MS);
  appendLog({ ok: true, message: 'VCPEigenFluxReport scheduler started', intervalMs: SCHEDULER_INTERVAL_MS });
}

function stopScheduler() {
  if (schedulerTimer) clearInterval(schedulerTimer);
  schedulerTimer = null;
  schedulerRunning = false;
  appendLog({ ok: true, message: 'VCPEigenFluxReport scheduler stopped' });
}

function commandSchedulerStatus(args = {}) {
  const state = readSchedulerState();
  return ok('VCPEigenFluxReport SchedulerStatus complete', {
    enabled: SCHEDULER_ENABLED,
    running: !!schedulerTimer,
    busy: schedulerRunning,
    intervalMs: SCHEDULER_INTERVAL_MS,
    stateFile: SCHEDULER_STATE_FILE,
    state
  });
}

async function commandSchedulerTick(args = {}) {
  const res = await runSchedulerTick(args.reason || 'manual');
  return ok('VCPEigenFluxReport SchedulerTick complete', res);
}

let lifecycleState = 'created';

async function initialize(config = {}, deps = {}) {
  if (lifecycleState === 'initialized') {
    return { status: 'success', message: 'VCPEigenFluxReport already initialized', schedulerEnabled: SCHEDULER_ENABLED };
  }
  lifecycleState = 'initialized';
  startScheduler();
  return { status: 'success', message: 'VCPEigenFluxReport initialized', schedulerEnabled: SCHEDULER_ENABLED };
}

async function shutdown() {
  if (lifecycleState === 'shutdown') {
    return { status: 'success', message: 'VCPEigenFluxReport already shutdown' };
  }
  lifecycleState = 'shutdown';
  stopScheduler();
  return { status: 'success', message: 'VCPEigenFluxReport shutdown complete' };
}

async function handleToolCall(input = {}) {
  return handle(input);
}

async function processToolCall(input = {}) {
  return handle(input);
}


function commandHealth(args) {
  const date = args.date || today();
  const accounts = getAccounts(args);
  const hours = Number(args.hours || 24);
  const since = Date.now() - hours * 3600 * 1000;
  const healthFile = path.join(cfg.sourceDir, 'health-log.jsonl');
  const globalState = readJson(path.join(cfg.sourceDir, 'eigenflux-accounts-state.json'), {});
  const events = [];

  if (fs.existsSync(healthFile)) {
    const lines = fs.readFileSync(healthFile, 'utf8').split(/\r?\n/).filter(Boolean);
    for (const line of lines) {
      try {
        const e = JSON.parse(line);
        const t = Date.parse(e.at || e.time || e.timestamp || '');
        if (!Number.isFinite(t) || t < since) continue;
        if (accounts.length && !accounts.includes(e.accountId)) continue;
        if (date && String(e.date || e.at || '').slice(0, 10) !== date && e.event === 'archive_feed') continue;
        events.push(e);
      } catch (_) {}
    }
  }

  const byAccount = {};
  for (const account of accounts) {
    byAccount[account] = { feed_poll: 0, archive_feed: 0, errors: 0, avgDurationMs: 0, durations: [] };
  }
  for (const e of events) {
    const a = e.accountId || 'unknown';
    if (!byAccount[a]) byAccount[a] = { feed_poll: 0, archive_feed: 0, errors: 0, avgDurationMs: 0, durations: [] };
    if (e.event === 'feed_poll') byAccount[a].feed_poll++;
    if (e.event === 'archive_feed') byAccount[a].archive_feed++;
    if (e.ok === false || e.error) byAccount[a].errors++;
    if (Number.isFinite(Number(e.durationMs))) byAccount[a].durations.push(Number(e.durationMs));
  }
  for (const a of Object.keys(byAccount)) {
    const ds = byAccount[a].durations;
    byAccount[a].avgDurationMs = ds.length ? Math.round(ds.reduce((x, y) => x + y, 0) / ds.length) : 0;
    delete byAccount[a].durations;
  }

  return ok('VCPEigenFluxReport Health complete', {
    date,
    hours,
    healthFile,
    events: events.length,
    accounts: byAccount,
    globalState: {
      updatedAt: globalState.updatedAt,
      enabledAccountCount: globalState.enabledAccountCount,
      totalSeenItems: globalState.totalSeenItems
    }
  });
}

function ok(message, result) {
  appendLog({ ok: true, message });
  return { status: 'success', message, result };
}

function err(error) {
  appendLog({ ok: false, error: String(error && error.stack || error) });
  return { status: 'error', error: String(error && error.message || error) };
}

async function handle(input) {
  const cmd = input.command;
  switch (cmd) {
    case 'EFReportInspect':
      return commandInspect(input);
    case 'EFReportDigest':
      return commandDigest(input);
    case 'EFReportDaily':
      return commandDaily(input);
    case 'EFReportVault':
      return commandVault(input);
    case 'EFReportHealth':
      return commandHealth(input);
    case 'EFReportReviewQueue':
      return commandReviewQueue(input);
    case 'EFReportMorningBrief':
      return commandMorningBrief(input);
    case 'EFReportFusionBrief':
      return commandFusionBrief(input);
    case 'EFReportRenderBrief':
      return commandRenderBrief(input);
    case 'EFReportSchedulerStatus':
      return commandSchedulerStatus(input);
    case 'EFReportSchedulerTick':
      return commandSchedulerTick(input);
    default:
      return err(`Unknown command: ${cmd}`);
  }
}

if (require.main === module) {
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  let handled = false;

  rl.on('line', async (line) => {
    if (handled) return;
    handled = true;
    try {
      const input = JSON.parse(line);
      const res = await handle(input);
      process.stdout.write(JSON.stringify(res));
    } catch (e) {
      process.stdout.write(JSON.stringify(err(e)));
    } finally {
      process.exit(0);
    }
  });
} else {
  module.exports = {
    initialize,
    shutdown,
    handleToolCall,
    processToolCall,
    handle,
    runSchedulerTick,
    commandSchedulerStatus
  };
}
