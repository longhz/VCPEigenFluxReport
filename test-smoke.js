#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');

const ROOT = __dirname;

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function runNode(args, input) {
  return childProcess.execFileSync(process.execPath, args, {
    cwd: ROOT,
    input,
    encoding: 'utf8',
    timeout: 120000
  });
}

function parseJson(text, label) {
  try { return JSON.parse(text); }
  catch (e) { throw new Error(`${label} is not valid JSON: ${e.message}\n${text.slice(0, 500)}`); }
}

function main() {
  const manifest = parseJson(fs.readFileSync(path.join(ROOT, 'plugin-manifest.json'), 'utf8'), 'plugin-manifest.json');
  assert(manifest.pluginType === 'hybridservice', 'manifest pluginType must be hybridservice');
  assert(manifest.communication && manifest.communication.protocol === 'direct', 'manifest communication.protocol must be direct');

  runNode(['--check', 'eigenflux-report.js']);
  runNode(['--check', 'daily-brief-publisher.js']);
  runNode(['--check', 'daily-brief-approve.js']);

  const publisherSource = fs.readFileSync(path.join(ROOT, 'daily-brief-publisher.js'), 'utf8');
  assert(publisherSource.includes('## 评论区'), 'publisher must emit VCP forum comment section anchor');
  assert(publisherSource.includes('ReplyPost 虽会真实追加楼层'), 'publisher must document comment anchor compatibility guard');


  const mod = require('./eigenflux-report.js');
  for (const key of ['initialize', 'shutdown', 'handleToolCall', 'processToolCall', 'runSchedulerTick']) {
    assert(typeof mod[key] === 'function', `missing export function: ${key}`);
  }

  const statusText = runNode(['eigenflux-report.js'], '{"command":"EFReportSchedulerStatus"}\n');
  const status = parseJson(statusText, 'EFReportSchedulerStatus');
  assert(status.status === 'success', 'scheduler status command failed');
  assert(status.result && status.result.enabled === true, 'scheduler should be enabled in default config');

  const inspectText = runNode(['eigenflux-report.js'], '{"command":"EFReportInspect","date":"2026-05-23","accounts":"technical","includeSamples":"false"}\n');
  const inspect = parseJson(inspectText, 'EFReportInspect');
  assert(inspect.status === 'success', 'inspect command failed');

  const pubText = runNode(['daily-brief-publisher.js', '--date', '2026-05-24']);
  const pub = parseJson(pubText, 'daily-brief-publisher');
  assert(pub.status === 'skipped' && pub.reason === 'already_published', 'publisher should be already_published for 2026-05-24 fixture');

  console.log(JSON.stringify({
    status: 'success',
    message: 'VCPEigenFluxReport smoke tests passed',
    manifestVersion: manifest.version,
    checks: ['manifest', 'syntax', 'exports', 'stdio-status', 'stdio-inspect', 'publisher-idempotency']
  }, null, 2));
}

main();
