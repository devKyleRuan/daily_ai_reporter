#!/usr/bin/env node

// ============================================================================
// Follow Builders - Save and Push Digest
// ============================================================================
// Persists a generated digest to reports/YYYY-MM-DD.md, commits it, and pushes
// the current branch to its upstream remote.
//
// Usage:
//   echo "digest text" | node save-and-push.js
//   node save-and-push.js --file /tmp/fb-digest.md
//   node save-and-push.js --file /tmp/fb-digest.md --date 2026-06-26
// ============================================================================

import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--file' || arg === '--date' || arg === '--repo-root') {
      args[arg.slice(2)] = argv[i + 1];
      i += 1;
    }
  }
  return args;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

function runGit(repoRoot, args, options = {}) {
  const result = spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf-8',
    stdio: options.stdio || 'pipe'
  });

  if (result.status !== 0) {
    const details = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    throw new Error(`git ${args.join(' ')} failed${details ? `:\n${details}` : ''}`);
  }

  return (result.stdout || '').trim();
}

function runGitStatus(repoRoot, args) {
  const result = spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf-8',
    stdio: 'pipe'
  });

  if (result.status > 1) {
    const details = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    throw new Error(`git ${args.join(' ')} failed${details ? `:\n${details}` : ''}`);
  }

  return result.status;
}

function todayLocalISODate() {
  const now = new Date();
  const offsetMs = now.getTimezoneOffset() * 60 * 1000;
  return new Date(now.getTime() - offsetMs).toISOString().slice(0, 10);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(args['repo-root'] || join(scriptDir, '..', '..'));
  const date = args.date || todayLocalISODate();

  const digestText = args.file
    ? await readFile(args.file, 'utf-8')
    : await readStdin();

  if (!digestText.trim()) {
    throw new Error('Digest text is empty; refusing to write an empty report.');
  }

  const reportsDir = join(repoRoot, 'reports');
  const reportPath = join(reportsDir, `${date}.md`);
  const reportRelativePath = `reports/${date}.md`;
  const content = digestText.endsWith('\n') ? digestText : `${digestText}\n`;

  await mkdir(reportsDir, { recursive: true });
  await writeFile(reportPath, content, 'utf-8');

  runGit(repoRoot, ['add', reportRelativePath]);

  const hasReportChanges = runGitStatus(repoRoot, ['diff', '--cached', '--quiet', '--', reportRelativePath]) === 1;
  if (!hasReportChanges) {
    console.log(JSON.stringify({
      status: 'ok',
      reportPath,
      committed: false,
      pushed: false,
      message: 'Report already matched the generated digest; nothing to commit.'
    }));
    return;
  }

  runGit(repoRoot, ['commit', '-m', `Add AI digest for ${date}`, '--', reportRelativePath]);
  runGit(repoRoot, ['push']);

  console.log(JSON.stringify({
    status: 'ok',
    reportPath,
    committed: true,
    pushed: true
  }));
}

main().catch(err => {
  console.error(JSON.stringify({
    status: 'error',
    message: err.message
  }));
  process.exit(1);
});
