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


function looksEnglish(s) {
  const t = normalizeText(s);
  if (!t) return false;
  const letters = (t.match(/[A-Za-z]/g) || []).length;
  const cjk = (t.match(/[\u4e00-\u9fff]/g) || []).length;
  return letters >= 16 && letters > cjk * 2;
}

function zhPhrase(text) {
  const t = String(text || '').toLowerCase();
  const rules = [
    [/12-phase|12 phase|2500\+? commits|ai-assisted coding workflow/, '12阶段 AI 编程工作流：2500+次提交验证的方法论'],
    [/3,200\+? nodes|3200|identity resolution|string similarity/, '3200节点多智能体网络暴露身份去重难题'],
    [/global popularity|trending signals|agent network/, '“热门趋势”信号不适合 Agent 网络的信息选择'],
    [/fcop 3\.0|filesystem-native governance|file.?system-native/, 'FCoP 3.0：用文件系统原生治理层管理多智能体状态'],
    [/pm soul|persistent memory|owner agent/, 'PM Soul：把项目长期记忆集中到 owner agent'],
    [/400m token|token burn|onboarding loop/, '400M token 烧毁事故：多智能体系统需要限流与熔断'],
    [/prompt engineering|image and video generation|generation pipelines/, 'AIGC 提示词工程资源：面向图像与视频生成工作流'],
    [/inferx|persistent kv caches|vector/, 'InferX：用持久化 KV Cache 替代传统向量 RAG'],
    [/pocketclaw|offline android|int4|gemma/, 'PocketClaw：离线安卓 AI 助手与端侧 RAG 实践'],
    [/prima|resilience|recovery|long-running multi-agent/, 'PRIMA：长周期多智能体系统的容错与恢复框架']
  ];
  for (const [re, zh] of rules) {
    if (re.test(t)) return zh;
  }
  return null;
}

function inferChineseTopicTitle(x) {
  const text = `${x.title || ''} ${x.summary || ''}`.toLowerCase();
  const tags = getTags(x, 3);
  const has = (re) => re.test(text) || tags.some(t => re.test(String(t).toLowerCase()));

  if (has(/multi-agent|agent|ai-agent|多智能体/)) {
    if (has(/identity|resolution|node|治理|governance/)) return '多智能体治理：身份、状态与协作可靠性';
    if (has(/memory|persistent|context|知识|记忆/)) return 'AI Agent 记忆架构与长期项目协作';
    if (has(/workflow|coding|developer|开发|编程/)) return 'AI Agent 工作流与开发者工具实践';
    if (has(/research|framework|paper|论文|评测/)) return '多智能体研究：框架、评测与失效恢复';
    return 'AI Agent 趋势：从通用助手走向专业协作';
  }
  if (has(/rag|retrieval|vector|embedding|kv cache|知识/)) return 'RAG 与知识管理：检索架构的新变化';
  if (has(/aigc|image|video|prompt|生成|视频|图像/)) return 'AIGC 工作流：生成质量与生产管线优化';
  if (has(/saas|startup|business|product|商业|产品/)) return 'AI 商业产品：真实需求与付费断点';
  if (has(/model|llm|benchmark|eval|评测|模型/)) return '大模型评测：能力边界与工程落地';
  if (has(/tutorial|course|academy|教程|学习/)) return 'AI 学习资源：教程、方法论与实践入口';

  return `${tags.join(' / ')}：技术线索与趋势观察`;
}

function zhTitle(x, max = 32) {
  const source = `${x.title || ''} ${x.summary || ''}`;
  const mapped = zhPhrase(source);
  if (mapped) return truncate(mapped, max);
  const raw = rawTitle(x);
  if (!looksEnglish(raw)) return truncate(raw, max);
  // Conservative fallback: never leak broken English truncation as the title.
  // Use tags + detected topic to create a Chinese descriptive title without fabricating details.
  return truncate(inferChineseTopicTitle(x), max);
}

/**
 * 通用英文标题→中文摘要生成器。
 * 当 zhPhrase 硬编码规则未命中时，从英文标题提取关键信息并生成有意义的中文摘要。
 */
function zhTitleFromEnglish(x, max = 160) {
  const title = String(x.title || '').replace(/\s+/g, ' ').trim();
  const tags = getTags(x, 3);
  const tagStr = tags.length ? tags.join(' / ') : '';

  // 模式→固定中文描述（优先匹配，不拼接英文尾巴）
  const P = [
    [/(?:comfyui|comfy ui) node builder/i, () => 'ComfyUI \u672c\u5730\u5f00\u6e90\u8282\u70b9\u6784\u5efa\u5de5\u5177\uff0c\u7528\u81ea\u7136\u8bed\u8a00\u63cf\u8ff0\u5373\u53ef\u751f\u6210\u81ea\u5b9a\u4e49\u8282\u70b9'],
    [/(?:comfyui|comfy ui) nodes? .*(?:integrat|leverag)/i, () => '\u5f00\u53d1\u8005\u5206\u4eab\u56db\u4e2a\u63a5\u5165 Dreamina \u4e91\u7aef API \u7684\u81ea\u5b9a\u4e49 ComfyUI \u8282\u70b9'],
    [/(?:codex|openai).*research.*agent/i, () => '\u57fa\u4e8e Codex \u7684\u7814\u7a76\u578b Agent \u52a0\u5165 EigenFlux \u63a2\u7d22\u591a\u667a\u80fd\u4f53\u901a\u4fe1'],
    [/context engineering layers?.*rag/i, () => '\u57fa\u51c6\u6d4b\u8bd5\u63ed\u793a\uff1aRAG \u7ba1\u7ebf\u53e0\u52a0\u4e0a\u4e0b\u6587\u5de5\u7a0b\u5c42\uff0cSonnet \u63d0\u5347 12%\uff0cHaiku \u4e0b\u964d 14%'],
    [/multi.?robot.*motion/i, () => 'SID\uff1a\u57fa\u4e8e\u6269\u6563\u6a21\u578b\u7684\u53bb\u4e2d\u5fc3\u5316\u591a\u673a\u5668\u4eba\u8fd0\u52a8\u89c4\u5212\u6846\u67b6'],
    [/(?:agent|platform).*self.?improv/i, () => 'Oido \u63a8\u51fa\u81ea\u6539\u8fdb\u578b AI Agent \u5e73\u53f0\uff0c\u7528\u540e\u5ba1 Agent \u81ea\u52a8\u66f4\u65b0\u6280\u80fd\u548c\u8bb0\u5fc6'],
    [/(?:targeted demand|seeking.*signal)/i, () => 'AI \u6295\u7814\u52a9\u624b\u5bfb\u6c42\u56fd\u5185 Agent/Science \u65e9\u671f\u878d\u8d44\u4fe1\u53f7'],
    [/team.?light.*startup/i, () => '2026 \u8d8b\u52bf\uff1a\u8f7b\u56e2\u961f AI \u539f\u751f\u521b\u4e1a\u6b63\u5728\u5d1b\u8d77'],
    [/(?:agent security|security survey)/i, () => '\u9996\u4efd AI Agent \u5b89\u5168\u7efc\u8ff0\u53d1\u5e03\uff0c\u7cfb\u7edf\u68b3\u7406\u653b\u51fb\u5411\u91cf\u4e0e\u9632\u5fa1\u6846\u67b6'],
    [/(?:first|comprehensive) survey/i, () => '\u9996\u4efd\u5168\u9762\u7efc\u8ff0\uff0c\u68b3\u7406\u5b89\u5168\u98ce\u9669\u4e0e\u9632\u5fa1\u7b56\u7565'],
    [/(\w+) (?:has )?launch(?:ed|es)/i, (m, p1) => {
      const name = p1.replace(/^(startup|company|team)\s+/i, '');
      return name + ' \u63a8\u51fa\u65b0\u5e73\u53f0';
    }],
    [/(?:this (?:article|post|analysis|study) )?(?:announces?|introduces?|presents?|reveals?) that (.+)/i, null],
    [/(?:this (?:article|post|analysis|study) )?(?:announces?|introduces?|presents?|reveals?) (?:the |a )?(.+)/i, null],
    [/(?:a |an |the )?developer (?:shares?|presents?|introduces?|builds?) (.+)/i, null],
    [/(?:a |an |the )?(?:bug|issue|problem) in (.+?) (?:caused|causes|leads?) (.+)/i, null],
    [/experimental benchmark(?:ing)? reveals? that (.+)/i, null],
    [/the (?:analysis|study) highlights? (.+)/i, null],
  ];

  // 词级翻译表
  const W = [
    [/bug/gi, '\u7f3a\u9677'], [/scheduler/gi, '\u8c03\u5ea6\u5668'], [/notification/gi, '\u901a\u77e5'],
    [/startup/gi, '\u521d\u521b'], [/platform/gi, '\u5e73\u53f0'], [/framework/gi, '\u6846\u67b6'],
    [/benchmark/gi, '\u57fa\u51c6\u6d4b\u8bd5'], [/survey/gi, '\u7efc\u8ff0'], [/security/gi, '\u5b89\u5168'],
    [/pipeline/gi, '\u7ba1\u7ebf'], [/workflow/gi, '\u5de5\u4f5c\u6d41'], [/developer/gi, '\u5f00\u53d1\u8005'],
    [/research/gi, '\u7814\u7a76'], [/paper/gi, '\u8bba\u6587'], [/open.?source/gi, '\u5f00\u6e90'],
    [/tool/gi, '\u5de5\u5177'], [/model/gi, '\u6a21\u578b'], [/node/gi, '\u8282\u70b9'],
    [/multi.?agent/gi, '\u591a\u667a\u80fd\u4f53'], [/multi.?robot/gi, '\u591a\u673a\u5668\u4eba'],
    [/context/gi, '\u4e0a\u4e0b\u6587'], [/token/gi, 'Token'], [/embedding/gi, '\u5411\u91cf\u5d4c\u5165'],
    [/inference/gi, '\u63a8\u7406'], [/training/gi, '\u8bad\u7ec3'], [/fine.?tun/gi, '\u5fae\u8c03'],
    [/orchestrat/gi, '\u7f16\u6392'], [/automat/gi, '\u81ea\u52a8\u5316'], [/generat/gi, '\u751f\u6210'],
    [/integrat/gi, '\u96c6\u6210'], [/deploy/gi, '\u90e8\u7f72'], [/optimiz/gi, '\u4f18\u5316'],
    [/community/gi, '\u793e\u533a'], [/enterprise/gi, '\u4f01\u4e1a'], [/production/gi, '\u751f\u4ea7'],
    [/self.?improv/gi, '\u81ea\u6539\u8fdb'], [/memory/gi, '\u8bb0\u5fc6'], [/retriev/gi, '\u68c0\u7d22'],
    [/agent/gi, 'Agent'], [/rag\b/gi, 'RAG'], [/llm/gi, 'LLM'], [/api/gi, 'API'],
    [/comfyui/gi, 'ComfyUI'], [/diffusion/gi, '\u6269\u6563\u6a21\u578b'],
    [/multimodal/gi, '\u591a\u6a21\u6001'], [/analysis/gi, '\u5206\u6790'], [/highlights?/gi, '\u6307\u51fa'],
    [/reveals?/gi, '\u63ed\u793a'], [/announces?/gi, '\u53d1\u5e03'], [/introduces?/gi, '\u4ecb\u7ecd'],
    [/shares?/gi, '\u5206\u4eab'], [/builds?/gi, '\u6784\u5efa'], [/creates?/gi, '\u521b\u5efa'],
    [/improv/gi, '\u6539\u8fdb'], [/degrad/gi, '\u9000\u5316'], [/enabl/gi, '\u8d4b\u80fd'],
    [/reduc/gi, '\u964d\u4f4e'], [/leverag/gi, '\u5229\u7528'], [/utiliz/gi, '\u8fd0\u7528'],
    [/shift/gi, '\u8f6c\u53d8'], [/trend/gi, '\u8d8b\u52bf'], [/rise/gi, '\u5d1b\u8d77'],
    [/insight/gi, '\u6d1e\u5bdf'], [/guide/gi, '\u6307\u5357'], [/tutorial/gi, '\u6559\u7a0b'],
    [/assistant/gi, '\u52a9\u624b'], [/client/gi, '\u5ba2\u6237\u7aef'], [/browser/gi, '\u6d4f\u89c8\u5668'],
    [/interface/gi, '\u63a5\u53e3'], [/database/gi, '\u6570\u636e\u5e93'], [/server/gi, '\u670d\u52a1\u5668'],
  ];

  // 1. 先试固定模式匹配（不拼接英文）
  for (const [re, handler] of P) {
    if (!handler) continue;
    const m = title.match(re);
    if (m) {
      const result = typeof handler === 'function' ? handler(...m) : handler;
      if (result && result.length > 4) return truncate(tagStr ? result + '\u3002\u9886\u57df\uff1a' + tagStr : result, max);
    }
  }

  // 2. 词级翻译全文（兜底所有情况，包括模式匹配返回 null 的）
  let zh = title;
  for (const [re, cn] of W) { zh = zh.replace(re, cn); }
  zh = zh.replace(/^(?:The|A|An|This)\s+/i, '').trim();

  const cjkRatio = (zh.match(/[\u4e00-\u9fff]/g) || []).length / Math.max(zh.length, 1);
  if (cjkRatio > 0.12) return truncate(tagStr ? zh + '\u3002' + tagStr : zh, max);

  // 3. 兜底：tags
  if (tagStr) return truncate('\u6765\u81ea EigenFlux \u7684\u6280\u672f\u60c5\u62a5\uff0c\u6db5\u76d6' + tagStr + '\u7b49\u9886\u57df\u3002', max);
  return truncate('\u6765\u81ea EigenFlux \u7684\u6280\u672f\u60c5\u62a5\uff0c\u8be6\u60c5\u8bf7\u67e5\u770b\u539f\u59cb\u6765\u6e90\u3002', max);
}

function zhSummary(x, max = 160) {
  const source = `${x.title || ''} ${x.summary || ''}`;
  const mapped = zhPhrase(source);
  if (mapped) {
    if (/12-phase|12 phase|2500\+? commits/i.test(source)) return truncate('\u5f00\u53d1\u8005\u590d\u76d8\u4e00\u5957\u7ecf\u8fc7\u4e24\u4e2a\u751f\u4ea7\u9879\u76ee\u30012500+\u6b21\u63d0\u4ea4\u9a8c\u8bc1\u7684 AI \u8f85\u52a9\u7f16\u7a0b\u6d41\u7a0b\uff0c\u5f3a\u8c03\u610f\u56fe\u9a71\u52a8\u3001\u53cd\u8df3\u7ea7\u89c4\u5219\u548c\u4eba\u5de5\u5ba1\u67e5\u5173\u5361\u3002', max);
    if (/global popularity|trending signals/i.test(source)) return truncate('\u8be5\u89c2\u70b9\u8ba4\u4e3a\uff0c\u9762\u5411\u4eba\u7c7b\u7684\u70ed\u5ea6/\u6d41\u884c\u5ea6\u4fe1\u53f7\u4e0e Agent \u7f51\u7edc\u7684\u4fe1\u606f\u9700\u6c42\u5e76\u4e0d\u5339\u914d\uff0cAgent \u66f4\u4f9d\u8d56\u76ee\u6807\u4e0a\u4e0b\u6587\u548c\u4efb\u52a1\u76f8\u5173\u6027\u3002', max);
    if (/3,200\+? nodes|3200|identity resolution/i.test(source)) return truncate('\u5927\u89c4\u6a21\u591a\u667a\u80fd\u4f53\u7f51\u7edc\u7684\u8eab\u4efd\u89e3\u6790\u4e0d\u80fd\u53ea\u9760\u5b57\u7b26\u4e32\u76f8\u4f3c\u5ea6\uff0c\u5426\u5219\u5bb9\u6613\u51fa\u73b0\u8bef\u5408\u5e76\u548c\u8bef\u5224\uff0c\u9700\u8981\u5f15\u5165\u884c\u4e3a\u6307\u7eb9\u4e0e\u4e0a\u4e0b\u6587\u6821\u9a8c\u3002', max);
    if (/fcop 3\.0/i.test(source)) return truncate('FCoP 3.0 \u8bd5\u56fe\u628a agent \u72b6\u6001\u3001\u6743\u9650\u548c\u6cbb\u7406\u4fe1\u606f\u843d\u5230\u6587\u4ef6\u7cfb\u7edf\u5c42\uff0c\u63d0\u5347\u591a\u667a\u80fd\u4f53\u7cfb\u7edf\u7684\u53ef\u89c2\u6d4b\u6027\u548c\u53ef\u5ba1\u8ba1\u6027\u3002', max);
    if (/pm soul/i.test(source)) return truncate('\u8be5\u67b6\u6784\u628a\u9879\u76ee\u6301\u4e45\u8bb0\u5fc6\u96c6\u4e2d\u5728\u4e00\u4e2a owner agent \u4e2d\uff0c\u518d\u5411\u5176\u4ed6 agent \u63d0\u4f9b\u987e\u95ee\u5f0f\u4ea4\u63a5\uff0c\u9002\u5408\u957f\u671f\u9879\u76ee\u534f\u4f5c\u3002', max);
    if (/400m token/i.test(source)) return truncate('\u4e00\u6b21 onboarding loop bug \u5728\u7f51\u7edc\u4e0d\u7a33\u5b9a\u65f6\u89e6\u53d1\u5faa\u73af\uff0c\u5bfc\u81f4 400M token \u6210\u672c\u4e8b\u6545\uff0c\u63d0\u793a\u591a\u667a\u80fd\u4f53\u7cfb\u7edf\u5fc5\u987b\u6709\u9884\u7b97\u3001\u9650\u6d41\u548c\u7194\u65ad\u3002', max);
    if (/prompt engineering|image and video generation/i.test(source)) return truncate('\u4f5c\u8005\u5728\u5bfb\u627e\u9002\u5408\u56fe\u50cf/\u89c6\u9891\u751f\u6210\u7ba1\u7ebf\u7684\u63d0\u793a\u8bcd\u6a21\u677f\u4e0e\u5de5\u4f5c\u6d41\u8d44\u6e90\uff0c\u6307\u5411 AIGC \u5de5\u7a0b\u5316\u4e2d\u7684\u9ad8\u9891\u75db\u70b9\u3002', max);
    if (/inferx|persistent kv caches/i.test(source)) return truncate('InferX \u5c55\u793a\u4e86\u4e00\u79cd\u7528\u6301\u4e45\u5316 KV Cache \u53d6\u4ee3 embedding \u4e0e\u5411\u91cf\u5e93\u7684 RAG \u67b6\u6784\uff0c\u9002\u5408\u89c2\u5bdf\u5927\u4e0a\u4e0b\u6587\u65f6\u4ee3\u7684\u68c0\u7d22\u6f14\u8fdb\u3002', max);
    if (/pocketclaw/i.test(source)) return truncate('PocketClaw \u662f\u5b8c\u5168\u79bb\u7ebf\u7684\u5b89\u5353 AI \u52a9\u624b\uff0c\u4f7f\u7528 1.5GB INT4 \u91cf\u5316\u6a21\u578b\u548c\u672c\u5730 sqlite-vector\uff0c\u4ee3\u8868\u7aef\u4fa7 AI \u7684\u53ef\u884c\u8def\u5f84\u3002', max);
    if (/prima/i.test(source)) return truncate('PRIMA \u9762\u5411\u957f\u65f6\u95f4\u8fd0\u884c\u7684\u591a\u667a\u80fd\u4f53\u7814\u7a76\u7cfb\u7edf\uff0c\u52a0\u5165\u6062\u590d\u3001\u97e7\u6027\u548c\u8eab\u4efd\u6d3e\u751f\u673a\u5236\uff0c\u964d\u4f4e\u590d\u6742\u534f\u4f5c\u4e2d\u7684\u5931\u6548\u98ce\u9669\u3002', max);
    return truncate(mapped, max);
  }
  const raw = normalizeText(x.summary || x.title || '');
  if (!looksEnglish(raw)) return truncate(raw, max);
  return zhTitleFromEnglish(x, max);
}

function getEditorNotes(overrides) {
  return overrides && typeof overrides === 'object' && overrides.editorNotes ? overrides.editorNotes : {};
}

function getGoldenQuote(data, opts = {}) {
  const o = opts.insightOverrides || {};
  return o.goldenQuote || data.goldenQuote || '专业化不是把 AI 变窄，而是让 AI 真正进入组织协作。';
}

function getRecommendation(data, opts = {}) {
  const o = opts.insightOverrides || {};
  return {
    grade: o.recommendationGrade || data.recommendationGrade || 'A',
    reason: o.recommendationReason || '技术趋势清晰，双源共振明显，可行动条目较多'
  };
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
  // v0.1.2: support the real review file schema:
  // { editorNotes, itemInsights, goldenQuote, recommendationGrade, recommendationReason }
  // Keep backward compatibility with older { items } / { insights } formats.
  let raw;
  const hasItems = overrides.items || overrides.insights || overrides.itemInsights;
  if (hasItems) {
    raw = Object.assign(
      {},
      overrides.items || {},
      overrides.insights || {},
      overrides.itemInsights || {}
    );
  } else {
    // Already a flat map (already normalized) or unknown schema:
    // treat the root object itself as the insight map.
    raw = overrides;
  }
  const out = {};
  for (const [id, value] of Object.entries(raw)) {
    if (!id) continue;
    // Skip meta keys that are not insight keys
    if (['editorNotes', 'goldenQuote', 'recommendationGrade', 'recommendationReason', 'date', 'runId'].includes(id)) continue;
    if (typeof value === 'string') out[String(id)] = value;
    else if (value && typeof value === 'object' && value.insight) out[String(id)] = String(value.insight);
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

function pickTheme(data, opts = {}) {
  const editorNotes = getEditorNotes(opts.insightOverrides || {});
  if (editorNotes.headline) {
    return {
      title: '今日主线',
      text: String(editorNotes.headline)
    };
  }
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
  const theme = pickTheme(data, opts);
  const editorNotes = getEditorNotes(opts.insightOverrides || {});
  const methodNote = editorNotes.methodNote || '本期从 EigenFlux 技术情报与 Jike AI/科技社区内容中筛选，优先考虑技术前瞻性、社区共识度、可行动价值与 VCP 相关性。评分只作为排序辅助，最终呈现经过编辑化压缩。';
  const dataDate = opts.dataDate || data.dataDate || data.date || date;
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
      <span>📅 ${esc(date)} · 早报 · ${titleVol} · 数据窗口 ${esc(dataDate)}</span>
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
      ${esc(methodNote)}
    </p>
  </div>

  ${headline ? `<div class="jike-divider">✦ HEADLINE · 头条要闻 ✦</div>
  <div class="jike-card">
    <div class="jike-news-title">
      <span class="jike-index">📌</span>
      <span>${esc(zhTitle(headline, 48))}</span>
    </div>
    <div class="jike-tag-row">
      ${renderTags(headline)}
      <span class="jike-tag">${esc(headline.score)}分</span>
      <span class="jike-tag">${esc(headline.tier || 'must_read')}</span>
    </div>
    <p class="jike-source">${esc(sourceBadge(headline))} · ${esc(sourceMeta(headline))}</p>
    <p class="jike-summary">${esc(zhSummary(headline, 210))}</p>
    <div class="jike-insight">
      <strong>Nova洞察：</strong>${esc(getItemInsight(headline, opts))}
    </div>
  </div>` : ''}

  <div class="jike-divider">✦ TOP NEWS · 双栏要闻 ✦</div>
  <div class="jike-grid">
    ${grid.map((item, idx) => `<div class="jike-card">
      <div class="jike-news-title">
        <span class="jike-index">${idx + 1}</span>
        <span>${esc(zhTitle(item, 38))}</span>
      </div>
      <div class="jike-tag-row">
        ${renderTags(item)}
        <span class="jike-tag">${esc(item.score)}分</span>
      </div>
      <p class="jike-source">${esc(sourceBadge(item))} · ${esc(sourceMeta(item))}</p>
      <p class="jike-summary">${esc(zhSummary(item, 155))}</p>
      <div class="jike-insight">
        <strong>Nova洞察：</strong>${esc(getItemInsight(item, opts))}
      </div>
    </div>`).join('\n')}
  </div>

  <div class="jike-divider">✦ FOOTER · 底部信息 ✦</div>
  <div class="jike-card">
    <div class="jike-footer">
      <p style="margin:0 0 8px"><strong style="color:#fbbf24">🎯 今日金句：</strong><em>「${esc(getGoldenQuote(data, opts))}」</em></p>
      <p style="margin:0 0 8px"><strong style="color:#fbbf24">📊 推荐强度：</strong><span style="color:#fbbf24">${esc(getRecommendation(data, opts).grade)}</span> · ${esc(getRecommendation(data, opts).reason)}</p>
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
  const insightFile = args.insightFile || args['insight-file'] || path.join(DEFAULT_INSIGHTS, `${date}-insight-overrides.json`);
  const insightOverrides = fs.existsSync(insightFile) ? readJson(insightFile) : null;
  const renderOpts = { vol, title: args.title, displayDate, dataDate: args.dataDate || args['data-date'] || data.dataDate || data.date, insightOverrides };
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