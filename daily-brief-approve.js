#!/usr/bin/env node
'use strict';

/**
 * daily-brief-approve.js
 *
 * 审稿通过闸门脚本：
 * - 不负责生成日报内容
 * - 不负责发布论坛
 * - 只写入 approved-brief/{publishDate}-approved.json
 *
 * 典型用法：
 *   node daily-brief-approve.js --publishDate 2026-05-24 --dataDate 2026-05-23 --vol 44
 */

const fs = require('fs');
const path = require('path');

const PLUGIN_DIR = __dirname;
const REPORT_DIR = path.join(PLUGIN_DIR, 'data/reports');
const APPROVED_DIR = path.join(REPORT_DIR, 'approved-brief');
const RENDERED_DIR = path.join(REPORT_DIR, 'rendered-brief');

function todayLocal() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function yesterdayLocal() {
  const d = new Date(Date.now() - 24 * 3600 * 1000);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson(file, fallback = null) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
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

function main() {
  const args = parseArgs(process.argv);

  const publishDate = String(args.publishDate || args['publish-date'] || todayLocal());
  const dataDate = String(args.dataDate || args['data-date'] || yesterdayLocal());
  const vol = args.vol || args.volume || '';
  const board = String(args.board || '即刻简报');
  const maid = String(args.maid || 'Nova');
  const title = String(args.title || `[即刻简报] ${publishDate} 科技与AI热点速递 (早报)`);
  const renderedFile = path.resolve(
    String(args.renderedFile || args['rendered-file'] || path.join(RENDERED_DIR, `${dataDate}-jike-brief-rendered.md`))
  );

  if (!fs.existsSync(renderedFile)) {
    throw new Error(`renderedFile not found: ${renderedFile}`);
  }

  const approvalFile = path.join(APPROVED_DIR, `${publishDate}-approved.json`);
  const old = readJson(approvalFile, {});

  if (old.published === true && !args.force) {
    throw new Error(`approval already published; use --force to overwrite approval metadata: ${approvalFile}`);
  }

  const approval = {
    status: 'approved',
    board,
    maid,
    publishDate,
    dataDate,
    vol,
    title,
    renderedFile,
    approvedAt: new Date().toISOString(),
    approvedBy: String(args.approvedBy || args['approved-by'] || 'Nova'),
    published: false,
    notes: String(args.notes || ''),
    previous: old && Object.keys(old).length ? {
      approvalFile,
      wasPublished: !!old.published,
      publishedAt: old.publishedAt || null,
      outputPath: old.outputPath || null,
      uid: old.uid || null
    } : undefined
  };

  writeJson(approvalFile, approval);

  process.stdout.write(JSON.stringify({
    status: 'success',
    message: 'Brief approved',
    approvalFile,
    approval
  }, null, 2));
}

try {
  main();
} catch (e) {
  process.stderr.write(String(e && e.stack || e) + '\n');
  process.exit(1);
}