#!/usr/bin/env node
/**
 * 窗口账本体检 / 清理。
 *
 * 只做两件"确定是垃圾"的事（--fix 时）：
 *   1. empty-row    ：user / spoken / reply 全空，且不是 synthetic（轮转交接）的行；
 *   2. dup-reply    ：user 为空、reply 与上一轮完全相同且间隔 ≤ 60s（bridge 替补收尾留下的重复轮）。
 * 其余异常（reply-only 的主动性发言、重复 turn 号）只报告，不动——它们可能是真实的唤醒轮。
 *
 * 用法：
 *   node scripts/lint-window-ledger.mjs                # 体检（默认只读）
 *   node scripts/lint-window-ledger.mjs --json         # 机器可读
 *   node scripts/lint-window-ledger.mjs --fix          # 先整目录备份，再删上面两类
 *   node scripts/lint-window-ledger.mjs --fix --dir <记忆目录>
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * 默认记忆目录：优先 DSMP settings（memory.dir），其次环境变量，最后是本机惯用路径。
 * 不能用「相对脚本位置推」——脚本在插件里，插件目录与记忆目录没有固定相对关系
 * （曾经因 HERE/../../../03生产 算成 <DSH_WORKSPACE> 而误报「没有 window 目录」）。
 */
function defaultMemoryDir() {
  try {
    const home = process.env.DSH_HOME || path.join(process.env.USERPROFILE || '', '.dsh');
    const file = path.join(home, 'dsmp', 'settings.json');
    if (fs.existsSync(file)) {
      const s = JSON.parse(fs.readFileSync(file, 'utf8'));
      const dir = (s && s.memory && s.memory.dir) || (s && s.memoryDir) || '';
      if (dir) return dir;
    }
  } catch {
    /* 读不到就用兜底 */
  }
  return process.env.DSMP_MEMORY_DIR || '<DSMP_MEMORY_DIR>';
}

const DEFAULT_DIR = defaultMemoryDir();
const DUP_WINDOW_MS = 60000;

function argOf(argv, name, fallback) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
}

export function lintLedger(memoryDir) {
  const root = path.join(memoryDir, 'window');
  const sessions = [];
  if (!fs.existsSync(root)) return { ok: false, error: `没有 window 目录：${root}`, sessions };
  for (const sid of fs.readdirSync(root)) {
    const file = path.join(root, sid, 'turns.jsonl');
    if (!fs.existsSync(file)) continue;
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
    const rows = [];
    lines.forEach((line, idx) => {
      try {
        rows.push({ line, idx, turn: JSON.parse(line) });
      } catch {
        /* 坏行不参与判定，也不动 */
      }
    });
    const remove = new Set();
    const report = [];
    let prev = null;
    for (const row of rows) {
      const t = row.turn;
      if (t.quarantined) {
        prev = t;
        continue;
      }
      const user = String((t.userRaw && t.userRaw.text) || '').trim();
      const reply = String((t.reply && t.reply.text) || '').trim();
      const spoken = (t.spoken || []).length;
      const synthetic = Boolean(t.synthetic || (t.userRaw && t.userRaw.synthetic));
      if (!user && !reply && !spoken && !synthetic) {
        remove.add(row.idx);
        report.push({ turn: t.turn, kind: 'empty-row' });
      } else if (!user && reply && prev && String((prev.reply && prev.reply.text) || '').trim() === reply) {
        const dt = Math.abs(Date.parse(t.at || 0) - Date.parse(prev.at || 0));
        if (Number.isFinite(dt) && dt <= DUP_WINDOW_MS) {
          remove.add(row.idx);
          report.push({ turn: t.turn, kind: 'dup-reply', dtMs: dt });
        }
      }
      if (!user && reply && !remove.has(row.idx)) report.push({ turn: t.turn, kind: 'reply-only' });
      prev = t;
    }
    sessions.push({ sessionId: sid, file, lines: lines.length, remove: [...remove], report });
  }
  return { ok: true, root, sessions };
}

function backup(memoryDir, stamp) {
  const dest = path.join(memoryDir, 'backup', `ledger-${stamp}`);
  fs.mkdirSync(dest, { recursive: true });
  fs.cpSync(path.join(memoryDir, 'window'), path.join(dest, 'window'), { recursive: true });
  return dest;
}

function main() {
  const argv = process.argv.slice(2);
  const memoryDir = argOf(argv, '--dir', DEFAULT_DIR);
  const fix = argv.includes('--fix');
  const json = argv.includes('--json');
  const result = lintLedger(memoryDir);
  if (!result.ok) {
    console.error(result.error);
    process.exit(1);
  }
  const totalRemove = result.sessions.reduce((a, s) => a + s.remove.length, 0);
  const totalReport = result.sessions.reduce((a, s) => a + s.report.length, 0);

  if (!json) {
    for (const s of result.sessions) {
      if (!s.report.length) continue;
      console.log(`\n${s.sessionId}（${s.lines} 轮）`);
      for (const r of s.report) {
        const mark = s.remove.includes(r.turn ? r.turn : -1) ? '' : '';
        console.log(`  ${r.kind.padEnd(10)} turn=${r.turn}${r.dtMs != null ? ` dt=${r.dtMs}ms` : ''}${mark}`);
      }
    }
  }

  if (!fix) {
    if (json) console.log(JSON.stringify({ ok: true, totalRemove, totalReport, sessions: result.sessions }, null, 2));
    else console.log(`\n体检完成：可删 ${totalRemove} 行，仅报告 ${totalReport} 行（加 --fix 执行清理）`);
    return;
  }

  if (!totalRemove) {
    console.log('没有可清理的行。');
    return;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = backup(memoryDir, stamp);
  for (const s of result.sessions) {
    if (!s.remove.length) continue;
    const lines = fs.readFileSync(s.file, 'utf8').split('\n').filter(Boolean);
    const kinds = new Map(s.report.filter((r) => s.remove.includes(r.turn ? r.turn : -1) || r.kind === 'empty-row' || r.kind === 'dup-reply').map((r) => [r.turn, r.kind]));
    let changed = 0;
    const next = lines.map((line, idx) => {
      if (!s.remove.includes(idx)) return line;
      const t = JSON.parse(line);
      const kind = kinds.get(t.turn) || 'empty-row';
      t.quarantined = true;
      t.quarantineReason = kind;
      t.userRaw = { ...(t.userRaw || {}), text: '', chars: 0, synthetic: true };
      if (kind === 'dup-reply') {
        t.reply = { text: '', chars: 0 };
        t.spoken = [];
      }
      changed += 1;
      return JSON.stringify(t);
    });
    const tmp = `${s.file}.tmp`;
    fs.writeFileSync(tmp, `${next.join('\n')}\n`, 'utf8');
    fs.renameSync(tmp, s.file);
    console.log(`隔离 ${s.sessionId}：标记 ${changed} 行（保留行号，避免 turn 不连续）`);
  }
  console.log(`备份：${dest}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) main();
