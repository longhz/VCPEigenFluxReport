#!/usr/bin/env node
'use strict';

/**
 * daily-brief-publisher.js
 *
 * 固定模板日报发布脚本：
 * - 只读取 approved-brief/{publishDate}-approved.json
 * - 只有 status=approved 且 published!==true 才发布
 * - 读取 renderedFile，自动写入 VCP论坛 md 文件
 * - 成功后回写 approval，标记 published=true，防止重复发布
 *
 * 典型用法：
 *   node daily-brief-publisher.js --date 2026-05-24
 *   node daily-brief-publisher.js              # 默认今天
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

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
const REPORT_DIR = path.join(PLUGIN_DIR, 'data/reports');
const APPROVED_DIR = path.join(REPORT_DIR, 'approved-brief');
const FORUM_DIR = path.resolve(String(process.env.EFREPORT_FORUM_DIR || fileEnv.EFREPORT_FORUM_DIR || path.resolve(PLUGIN_DIR, '../../dailynote/VCP论坛')));

function todayLocal() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
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

function writeJson(file, data) {
  atomicWriteText(file, JSON.stringify(data, null, 2) + '\n');
}

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) args[key] = true;
    else {
      args[key] = next;
      i++;
    }
  }
  return args;
}

function safeFilePart(s) {
  return String(s || '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\r?\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}

function timestampForFile(iso) {
  return iso.replace(/:/g, '-');
}

function stripLeadingTitle(md, title) {
  let text = String(md || '').trimStart();

  // 去掉 rendered md 里自带的一级标题，避免论坛头部重复。
  const lines = text.split(/\r?\n/);
  if (lines[0] && lines[0].startsWith('# ')) {
    lines.shift();
    if (lines[0] === '') lines.shift();
    text = lines.join('\n').trimStart();
  }

  // 兜底：如果仍然以同名标题开头，再剥一次。
  const h1 = `# ${title}`;
  if (text.startsWith(h1)) {
    text = text.slice(h1.length).trimStart();
  }

  return text.trim();
}

function buildForumMarkdown({ title, maid, uid, isoTime, body }) {
  const cleanBody = String(body || '').trim();

  // 必须保持与 VCPForum CreatePost 一致的评论区锚点。
  // 论坛前端/ReadPost 依赖 “## 评论区” 将正文和楼层分离；
  // 若自动发布器直接写 md 但缺少该块，ReplyPost 虽会真实追加楼层，前端却可能不显示评论。
  return `# ${title}

**作者:** ${maid}
**UID:** ${uid}
**时间戳:** ${isoTime}

---

${cleanBody}

---

## 评论区
---
`;
}

function main() {
  const args = parseArgs(process.argv);
  const publishDate = String(args.date || args.publishDate || args['publish-date'] || todayLocal());
  const approvalFile = path.resolve(String(args.approvalFile || args['approval-file'] || path.join(APPROVED_DIR, `${publishDate}-approved.json`)));

  if (!fs.existsSync(approvalFile)) {
    process.stdout.write(JSON.stringify({
      status: 'skipped',
      reason: 'approval_file_not_found',
      approvalFile
    }, null, 2));
    return;
  }

  const lockFile = `${approvalFile}.lock`;
  let lockFd = null;
  try {
    lockFd = fs.openSync(lockFile, 'wx');
  } catch (e) {
    if (e && e.code === 'EEXIST') {
      process.stdout.write(JSON.stringify({
        status: 'skipped',
        reason: 'publisher_locked',
        approvalFile,
        lockFile
      }, null, 2));
      return;
    }
    throw e;
  }

  try {
  const approval = readJson(approvalFile);

  if (approval.status !== 'approved') {
    process.stdout.write(JSON.stringify({
      status: 'skipped',
      reason: 'not_approved',
      approvalFile,
      currentStatus: approval.status || null
    }, null, 2));
    return;
  }

  if (approval.published === true && !args.force) {
    process.stdout.write(JSON.stringify({
      status: 'skipped',
      reason: 'already_published',
      approvalFile,
      outputPath: approval.outputPath || null,
      uid: approval.uid || null,
      publishedAt: approval.publishedAt || null
    }, null, 2));
    return;
  }

  const renderedFile = path.resolve(String(approval.renderedFile || ''));
  if (!renderedFile || !fs.existsSync(renderedFile)) {
    throw new Error(`renderedFile not found: ${renderedFile}`);
  }

  const title = String(approval.title || `[即刻简报] ${publishDate} 科技与AI热点速递 (早报)`);
  const maid = String(approval.maid || 'Nova');
  const board = String(approval.board || '即刻简报');
  const isoTime = new Date().toISOString();
  const uid = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

  const rendered = fs.readFileSync(renderedFile, 'utf8');
  const body = stripLeadingTitle(rendered, title);
  const forumMd = buildForumMarkdown({ title, maid, uid, isoTime, body });

  ensureDir(FORUM_DIR);
  const forumFileName = `[${safeFilePart(board)}][${safeFilePart(title)}][${safeFilePart(maid)}][${timestampForFile(isoTime)}][${uid}].md`;
  const outputPath = path.join(FORUM_DIR, forumFileName);

  if (fs.existsSync(outputPath) && !args.force) {
    throw new Error(`target forum file already exists: ${outputPath}`);
  }

  atomicWriteText(outputPath, forumMd);

  const nextApproval = {
    ...approval,
    published: true,
    publishedAt: isoTime,
    outputPath,
    uid,
    forumFileName,
    publisher: 'daily-brief-publisher.js'
  };
  writeJson(approvalFile, nextApproval);

  process.stdout.write(JSON.stringify({
    status: 'success',
    message: 'Brief published to VCP forum markdown',
    approvalFile,
    outputPath,
    uid,
    title,
    board,
    maid
  }, null, 2));
  } finally {
    if (lockFd !== null) {
      try { fs.closeSync(lockFd); } catch (_) {}
      try { fs.unlinkSync(lockFile); } catch (_) {}
    }
  }
}

try {
  main();
} catch (e) {
  process.stderr.write(String(e && e.stack || e) + '\n');
  process.exit(1);
}