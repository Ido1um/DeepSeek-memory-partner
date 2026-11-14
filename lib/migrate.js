import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';

/**
 * Journal-driven directory migration.
 *
 * Phases: copy → verify → switch → cleanup → done. The source is never deleted:
 * `cleanup` renames it to `<name>.migrated-<stamp>` and that copy stays for 7 days.
 * Every phase is recorded in the journal so an interrupted run can be inspected
 * (and rolled back) instead of leaving a half-moved tree.
 */

const PHASES = ['copy', 'verify', 'switch', 'cleanup', 'done'];

export function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(file);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

export function walk(dir, base = dir, out = []) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, base, out);
    else if (entry.isFile()) out.push({ file: full, rel: path.relative(base, full).replace(/\\/g, '/'), size: fs.statSync(full).size });
  }
  return out;
}

export function dirStats(dir) {
  const files = walk(dir);
  const bytes = files.reduce((sum, item) => sum + item.size, 0);
  return { files: files.length, bytes, list: files };
}

export function freeBytesOf(dir) {
  try {
    const probe = fs.existsSync(dir) ? dir : path.dirname(dir);
    const stat = fs.statfsSync(probe);
    return Number(stat.bavail) * Number(stat.bsize);
  } catch {
    return -1;
  }
}

export function readJournal(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

export function writeJournal(file, journal) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(journal, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

/** Preflight: target must be absent or empty, source readable, space enough. */
export function preflight({ sourceDir, targetDir }) {
  const problems = [];
  if (!sourceDir || !fs.existsSync(sourceDir)) problems.push(`源目录不存在：${sourceDir}`);
  if (!targetDir) problems.push('缺少目标目录');
  if (sourceDir && targetDir) {
    const src = path.resolve(sourceDir);
    const dst = path.resolve(targetDir);
    if (src === dst) problems.push('目标目录与源目录相同');
    if (dst.startsWith(src + path.sep)) problems.push('目标目录不能位于源目录内部');
    if (src.startsWith(dst + path.sep)) problems.push('源目录不能位于目标目录内部');
    if (fs.existsSync(dst)) {
      const entries = fs.readdirSync(dst);
      if (entries.length) problems.push(`目标目录不是空的（${entries.length} 项）`);
    }
  }
  const stats = sourceDir && fs.existsSync(sourceDir) ? dirStats(sourceDir) : { files: 0, bytes: 0, list: [] };
  const free = targetDir ? freeBytesOf(targetDir) : -1;
  const needed = Math.ceil(stats.bytes * 1.2);
  if (free >= 0 && free < needed) problems.push(`目标盘空间不足：需要约 ${needed} B，可用 ${free} B`);
  return {
    ok: problems.length === 0,
    problems,
    sourceDir,
    targetDir,
    files: stats.files,
    bytes: stats.bytes,
    neededBytes: needed,
    freeBytes: free,
    agentDir: path.join(sourceDir || '', 'agent'),
    agentExists: Boolean(sourceDir && fs.existsSync(path.join(sourceDir, 'agent')))
  };
}

function copyTree(src, dst, { skip = [] } = {}) {
  const stats = dirStats(src);
  const skipSet = new Set(skip.map((item) => item.replace(/\\/g, '/')));
  let copied = 0;
  let bytes = 0;
  for (const item of stats.list) {
    if (skipSet.has(item.rel)) continue;
    const target = path.join(dst, item.rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(item.file, target);
    const st = fs.statSync(item.file);
    fs.utimesSync(target, st.atime, st.mtime);
    copied += 1;
    bytes += item.size;
  }
  return { copied, bytes, total: stats.files };
}

async function verifyTree(src, dst, { skip = [] } = {}) {
  const skipSet = new Set(skip.map((item) => item.replace(/\\/g, '/')));
  const srcStats = dirStats(src);
  const dstStats = dirStats(dst);
  const srcList = srcStats.list.filter((item) => !skipSet.has(item.rel));
  const dstSet = new Set(dstStats.list.map((item) => item.rel));
  const missing = [];
  const mismatched = [];
  for (const item of srcList) {
    if (!dstSet.has(item.rel)) {
      missing.push(item.rel);
      continue;
    }
    const dstFile = path.join(dst, item.rel);
    const [a, b] = await Promise.all([sha256File(item.file), sha256File(dstFile)]);
    if (a !== b) mismatched.push(item.rel);
  }
  return {
    ok: missing.length === 0 && mismatched.length === 0,
    sourceFiles: srcList.length,
    targetFiles: dstStats.list.length,
    missing: missing.slice(0, 20),
    mismatched: mismatched.slice(0, 20)
  };
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

/**
 * Run the migration. `dryRun` stops after preflight.
 * `skip` lists relative paths excluded from copy/verify (e.g. a journal file).
 */
export async function runMigration({ sourceDir, targetDir, journalFile, dryRun = false, skip = [], keepSourceDays = 7, log = () => {} }) {
  const plan = preflight({ sourceDir, targetDir });
  const journal = {
    version: 1,
    sourceDir,
    targetDir,
    startedAt: new Date().toISOString(),
    phase: 'preflight',
    dryRun,
    keepSourceDays,
    plan,
    steps: []
  };
  const note = (phase, detail = {}) => {
    journal.phase = phase;
    journal.steps.push({ phase, at: new Date().toISOString(), ...detail });
    if (journalFile) writeJournal(journalFile, journal);
    log(`${phase} ${JSON.stringify(detail)}`);
  };

  note('preflight', { ok: plan.ok, problems: plan.problems });
  if (!plan.ok) return { ok: false, phase: 'preflight', journal };
  if (dryRun) return { ok: true, dryRun: true, phase: 'preflight', journal };

  try {
    note('copy', copyTree(sourceDir, targetDir, { skip }));
    if (plan.agentExists) note('workspace', copyTree(path.join(sourceDir, 'agent'), path.join(targetDir, 'agent')));
    const verified = await verifyTree(sourceDir, targetDir, { skip });
    note('verify', verified);
    if (!verified.ok) {
      return { ok: false, phase: 'verify', journal, verified };
    }
    note('switch', { applied: false, note: '配置切换由调用方执行（settings / workspace.json / 会话头）' });
    const moved = `${sourceDir}.migrated-${stamp()}`;
    fs.renameSync(sourceDir, moved);
    note('cleanup', { movedTo: moved, keepDays: keepSourceDays });
    note('done', { targetDir });
    return { ok: true, phase: 'done', journal, verified, movedTo: moved };
  } catch (err) {
    note('error', { message: String(err && err.message ? err.message : err) });
    return { ok: false, phase: journal.phase, journal, error: String(err && err.message ? err.message : err) };
  }
}

/** Undo a finished or interrupted migration by moving the old directory back. */
export function rollbackMigration({ journalFile, journal, deleteTarget = false }) {
  const data = journal || (journalFile ? readJournal(journalFile) : null);
  if (!data) return { ok: false, error: '找不到迁移日志' };
  const moved = [...(data.steps || [])].reverse().find((step) => step.movedTo);
  const source = data.sourceDir;
  if (!source) return { ok: false, error: '日志里没有源目录' };
  if (moved && fs.existsSync(moved.movedTo)) {
    if (fs.existsSync(source)) return { ok: false, error: `源目录已存在，拒绝覆盖：${source}` };
    fs.renameSync(moved.movedTo, source);
    return { ok: true, restored: source, from: moved.movedTo };
  }
  if (deleteTarget && data.targetDir && fs.existsSync(data.targetDir)) {
    fs.rmSync(data.targetDir, { recursive: true, force: true });
    return { ok: true, deletedTarget: data.targetDir };
  }
  return { ok: false, error: '没有可回滚的改名记录' };
}

/** Split a multi-frame session log into its JSON lines. */
export function decodeSessionFrames(buffer) {
  const lines = [];
  let p = 0;
  while (p + 8 <= buffer.length) {
    if (buffer.readUInt32LE(p) === 0x184d2a50) {
      const size = buffer.readUInt32LE(p + 4);
      p += 8 + size;
      continue;
    }
    if (buffer.readUInt32LE(p) !== 0xfd2fb528) break;
    const fhd = buffer[p + 4];
    const fcsFlag = (fhd >> 6) & 3;
    const singleSegment = (fhd >> 5) & 1;
    const hasChecksum = (fhd >> 2) & 1;
    const dictIdFlag = fhd & 3;
    let q = p + 5;
    if (!singleSegment) q += 1;
    q += [0, 1, 2, 4][dictIdFlag];
    q += fcsFlag === 0 ? (singleSegment ? 1 : 0) : [0, 2, 4, 8][fcsFlag];
    while (q + 3 <= buffer.length) {
      const header = buffer[q] | (buffer[q + 1] << 8) | (buffer[q + 2] << 16);
      const last = header & 1;
      const type = (header >> 1) & 3;
      const size = header >>> 3;
      q += 3;
      if (type === 3) {
        q = buffer.length;
        break;
      }
      if (type === 1) q += 1;
      else q += size;
      if (last) break;
    }
    if (hasChecksum && q + 4 <= buffer.length) q += 4;
    try {
      const text = zlib.zstdDecompressSync(buffer.subarray(p, q)).toString('utf8');
      for (const line of text.split('\n')) if (line.trim()) lines.push(line);
    } catch {
      break;
    }
    p = q;
  }
  return lines;
}

/**
 * Rewrite the `cwd` of an existing session log and re-frame it line by line.
 * Whole-file recompression into one frame makes DSH treat the session as empty.
 */
export function rewriteSessionCwd(file, nextCwd) {
  const raw = fs.readFileSync(file);
  const lines = decodeSessionFrames(raw);
  if (!lines.length) {
    const err = new Error('会话日志里没有可解析的行');
    err.code = 'DSMP_SESSION_LOG_EMPTY';
    throw err;
  }
  let header;
  try {
    header = JSON.parse(lines[0]);
  } catch {
    const err = new Error('会话日志首帧不是 JSON');
    err.code = 'DSMP_SESSION_LOG_HEADER';
    throw err;
  }
  const before = header.cwd;
  header.cwd = nextCwd;
  lines[0] = JSON.stringify(header);

  const frames = lines.map((line) => zlib.zstdCompressSync(Buffer.from(`${line}\n`, 'utf8')));
  fs.writeFileSync(file, Buffer.concat(frames));
  return { ok: true, file, before, after: nextCwd, lines: lines.length, frames: frames.length };
}

export { PHASES };
