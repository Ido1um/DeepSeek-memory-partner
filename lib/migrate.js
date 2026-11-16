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
export async function runMigration({ sourceDir, targetDir, journalFile, dryRun = false, skip = [], keepSourceDays = 7, onSwitch, log = () => {} }) {
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
    // copyTree 已包含 agent/；旧代码这里会再复制一遍同一棵子树。
    const verified = await verifyTree(sourceDir, targetDir, { skip });
    note('verify', verified);
    if (!verified.ok) {
      return { ok: false, phase: 'verify', journal, verified };
    }
    note('switch', { applied: false, note: '需要调用方提交配置与会话索引切换' });
    if (typeof onSwitch !== 'function') {
      // F04：没有切换实现时绝不 rename 源目录、绝不返回 done，否则应用仍指向旧路径。
      return {
        ok: false,
        phase: 'switch',
        needsSwitch: true,
        journal,
        verified,
        message: '迁移已复制并校验，但配置/会话索引切换尚未执行；源目录保持原样。提供 onSwitch 回调完成切换后才会 cleanup。'
      };
    }
    let switched;
    try {
      switched = await onSwitch({ sourceDir, targetDir, journal, note });
    } catch (err) {
      switched = { ok: false, error: String(err && err.message ? err.message : err) };
    }
    if (!switched || switched.ok === false) {
      note('error', { phase: 'switch', message: (switched && switched.error) || 'switch 未完成' });
      return {
        ok: false,
        phase: 'switch',
        journal,
        verified,
        switch: switched || null,
        error: '配置/会话索引切换失败，源目录保持原样'
      };
    }
    note('switch', { applied: true, result: switched });
    const moved = `${sourceDir}.migrated-${stamp()}`;
    fs.renameSync(sourceDir, moved);
    note('cleanup', { movedTo: moved, keepDays: keepSourceDays });
    note('done', { targetDir });
    return { ok: true, phase: 'done', journal, verified, movedTo: moved, switch: switched };
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

const ZSTD_MAGIC = 0xfd2fb528;
const SKIPPABLE_MAGIC = 0x184d2a50;
const SKIPPABLE_MASK = 0xfffffff0;

function sessionLogError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

/** 带 checksum 的单帧压缩：header 帧与 DSH 写出的帧保持同一形状。 */
function compressSessionFrame(buffer) {
  const constants = zlib.constants || {};
  const flag = constants.ZSTD_c_checksumFlag;
  if (flag !== undefined) {
    try {
      return zlib.zstdCompressSync(buffer, { params: { [flag]: 1 } });
    } catch {
      // 老版本 Node 不支持 params 时退回普通压缩（解压不受影响）。
    }
  }
  return zlib.zstdCompressSync(buffer);
}

/**
 * 扫描多帧 zstd 日志的帧边界。只做结构解析，不改字节。
 * 返回 { frames: [{start,end,skippable?}], truncated }。
 * truncated=true 表示尾部有未写完的帧；损坏帧直接抛 DSMP_SESSION_LOG_CORRUPT。
 */
export function scanSessionFrames(buffer) {
  const frames = [];
  let pos = 0;
  while (pos < buffer.length) {
    if (pos + 4 > buffer.length) return { frames, truncated: true };
    const magic = buffer.readUInt32LE(pos);
    if ((magic & SKIPPABLE_MASK) === SKIPPABLE_MAGIC) {
      if (pos + 8 > buffer.length) return { frames, truncated: true };
      const size = buffer.readUInt32LE(pos + 4);
      const end = pos + 8 + size;
      if (end > buffer.length) return { frames, truncated: true };
      frames.push({ start: pos, end, skippable: true });
      pos = end;
      continue;
    }
    if (magic !== ZSTD_MAGIC) {
      throw sessionLogError('DSMP_SESSION_LOG_CORRUPT', `会话日志在偏移 ${pos} 处不是 zstd 帧`);
    }
    let q = pos + 4;
    if (q + 1 > buffer.length) return { frames, truncated: true };
    const fhd = buffer[q];
    q += 1;
    const fcsFlag = (fhd >> 6) & 3;
    const singleSegment = (fhd >> 5) & 1;
    const hasChecksum = (fhd >> 2) & 1;
    const dictIdFlag = fhd & 3;
    if (!singleSegment) q += 1;
    q += [0, 1, 2, 4][dictIdFlag];
    q += fcsFlag === 0 ? (singleSegment ? 1 : 0) : [0, 2, 4, 8][fcsFlag];
    if (q > buffer.length) return { frames, truncated: true };
    let done = false;
    let corrupt = false;
    while (q + 3 <= buffer.length) {
      const header = buffer[q] | (buffer[q + 1] << 8) | (buffer[q + 2] << 16);
      const last = header & 1;
      const type = (header >> 1) & 3;
      const size = header >>> 3;
      q += 3;
      if (type === 3) {
        corrupt = true;
        break;
      }
      // RLE 块（type=1）的 blockSize 是解压后的重复长度，payload 只有 1 字节。
      const payload = type === 1 ? 1 : size;
      if (q + payload > buffer.length) return { frames, truncated: true };
      q += payload;
      if (last) {
        done = true;
        break;
      }
    }
    if (corrupt) throw sessionLogError('DSMP_SESSION_LOG_CORRUPT', `会话日志帧块类型非法（偏移 ${pos}）`);
    if (!done) return { frames, truncated: true };
    if (hasChecksum) {
      if (q + 4 > buffer.length) return { frames, truncated: true };
      q += 4;
    }
    frames.push({ start: pos, end: q });
    pos = q;
  }
  return { frames, truncated: false };
}

/** Split a multi-frame session log into its JSON lines（遇到未写完/损坏帧会抛错）。 */
export function decodeSessionFrames(buffer) {
  const { frames, truncated } = scanSessionFrames(buffer);
  if (truncated) {
    throw sessionLogError('DSMP_SESSION_LOG_TRUNCATED', '会话日志尾部有未写完的帧');
  }
  const lines = [];
  for (const frame of frames) {
    if (frame.skippable) continue;
    const text = zlib.zstdDecompressSync(buffer.subarray(frame.start, frame.end)).toString('utf8');
    for (const line of text.split('\n')) if (line.trim()) lines.push(line);
  }
  return lines;
}

/**
 * Rewrite the `cwd` of an existing session log.
 * 只重压第一帧（header），其余帧原始字节原样保留；先备份、写临时文件、原子替换。
 * 尾部存在未写完的帧时拒绝改写（返回的错误码 DSMP_SESSION_LOG_TRUNCATED），不动原文件。
 */
export function rewriteSessionCwd(file, nextCwd, { backup = true } = {}) {
  const raw = fs.readFileSync(file);
  const { frames, truncated } = scanSessionFrames(raw);
  if (truncated) {
    throw sessionLogError('DSMP_SESSION_LOG_TRUNCATED', '会话日志尾部有未写完的帧（DSH 可能仍在写），已拒绝改写');
  }
  const headerFrame = frames.find((frame) => !frame.skippable);
  if (!headerFrame) {
    throw sessionLogError('DSMP_SESSION_LOG_EMPTY', '会话日志里没有可解析的帧');
  }
  let header;
  try {
    const text = zlib.zstdDecompressSync(raw.subarray(headerFrame.start, headerFrame.end)).toString('utf8');
    const headerLines = text.split('\n').filter((line) => line.trim());
    if (headerLines.length !== 1) throw new Error('header frame must hold exactly one line');
    header = JSON.parse(headerLines[0]);
  } catch {
    throw sessionLogError('DSMP_SESSION_LOG_HEADER', '会话日志首帧不是单独一行的 JSON header');
  }
  if (!header || typeof header !== 'object' || Array.isArray(header)) {
    throw sessionLogError('DSMP_SESSION_LOG_HEADER', '会话日志首帧不是 JSON 对象');
  }
  const before = header.cwd;
  header.cwd = nextCwd;
  const headerBytes = compressSessionFrame(Buffer.from(`${JSON.stringify(header)}\n`, 'utf8'));
  const prefix = raw.subarray(0, headerFrame.start);
  const suffix = raw.subarray(headerFrame.end);
  const bak = backup ? `${file}.bak-${stamp()}` : '';
  if (backup) fs.copyFileSync(file, bak);
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  try {
    fs.writeFileSync(tmp, Buffer.concat([prefix, headerBytes, suffix]));
    fs.renameSync(tmp, file);
  } catch (err) {
    try {
      fs.unlinkSync(tmp);
    } catch {}
    throw err;
  }
  return {
    ok: true,
    file,
    before,
    after: nextCwd,
    frames: frames.length,
    headerBytes: headerBytes.length,
    suffixBytes: suffix.length,
    bak
  };
}

export { PHASES };
