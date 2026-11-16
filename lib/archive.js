import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
// zip helpers are injected: under the dev data: URL reloader a relative import
// has no hierarchical base to resolve against.
let zipImpl = null;
export function configureZip(impl) {
  zipImpl = impl;
}
function zipper() {
  if (!zipImpl) throw new Error('archive: 未注入 zip 实现（configureZip）');
  return zipImpl;
}

/**
 * Memory-pack export / import.
 *
 * Layout inside the zip:
 *   manifest.json              ← version, counts, per-file sha256, bound session
 *   memory/…                   ← the memory data (backup/ and agent/ excluded by default)
 *   workspace/agent/…          ← optional: the QQ agent workspace
 *   sessions/<dir>/<sid>/…     ← optional: the bound DSH session log
 *   roles/<name>.md            ← optional: role cards
 *   dsmp/settings.json         ← optional: plugin settings (secrets stripped)
 */

const EXCLUDED_DIRS = new Set(['backup', 'node_modules', 'scratch', 'shadow', '.git']);

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function normalize(rel) {
  return rel.replace(/\\/g, '/');
}

/**
 * Validate a zip entry name and return its canonical form (forward slashes),
 * or null when the name could escape the extraction root.
 */
export function safeRelative(name) {
  if (typeof name !== 'string' || !name) return null;
  if (name.includes('\u0000')) return null;
  const norm = name.replace(/\\/g, '/');
  if (norm.startsWith('/')) return null;
  if (/^[a-zA-Z]:/.test(norm)) return null;
  const parts = norm.split('/');
  for (const part of parts) {
    if (!part || part === '.' || part === '..') return null;
    if (part.endsWith('.') || part.endsWith(' ')) return null;
    if (/[\u0000-\u001f<>:"|?*]/.test(part)) return null;
  }
  return norm;
}

/** Resolve `rel` under `root`, refusing anything that escapes root. */
export function resolveInside(root, rel) {
  const safe = safeRelative(rel);
  if (!safe) return null;
  const base = path.resolve(root);
  const target = path.resolve(base, safe);
  if (target !== base && !target.startsWith(base + path.sep)) return null;
  return target;
}

/** Reject duplicate names and case/slash-normalized collisions. */
export function entryNameProblems(entries, { skipManifest = true } = {}) {
  const problems = [];
  const seen = new Map();
  for (const entry of entries) {
    if (skipManifest && entry.name === 'manifest.json') continue;
    const safe = safeRelative(entry.name);
    if (!safe) {
      problems.push(`非法条目名：${JSON.stringify(entry.name)}`);
      continue;
    }
    const key = safe.toLowerCase();
    const prev = seen.get(key);
    if (prev !== undefined) problems.push(`重复或冲突条目：${JSON.stringify(prev)} / ${JSON.stringify(entry.name)}`);
    else seen.set(key, entry.name);
  }
  return problems;
}

export function collectFiles(root, { prefix = '', excludeTop = [] } = {}) {
  const out = [];
  const skip = new Set(excludeTop);
  const walk = (dir, rel) => {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const next = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (EXCLUDED_DIRS.has(entry.name)) continue;
        if (!rel && skip.has(entry.name)) continue;
        walk(full, next);
      } else if (entry.isFile()) {
        out.push({ file: full, name: `${prefix}${next}` });
      }
    }
  };
  walk(root, '');
  return out;
}

/**
 * @param {object} options
 * @param {string} options.memoryDir
 * @param {string} [options.rolesDir]
 * @param {string} [options.settingsFile]
 * @param {boolean} [options.includeWorkspace]
 * @param {string} [options.boundSessionId]
 * @param {string} [options.sessionsRoot]
 */
export function buildExport(options) {
  const { memoryDir, rolesDir, settingsFile, includeWorkspace = false, boundSessionId = '', sessionsRoot = '' } = options;
  if (!memoryDir || !fs.existsSync(memoryDir)) {
    const err = new Error(`记忆目录不存在：${memoryDir}`);
    err.code = 'DSMP_EXPORT_SOURCE';
    throw err;
  }

  const entries = [];
  const hashes = {};
  let bytes = 0;
  const memoryFiles = collectFiles(memoryDir, {
    prefix: 'memory/',
    excludeTop: includeWorkspace ? [] : ['agent']
  });
  for (const item of memoryFiles) {
    const data = fs.readFileSync(item.file);
    entries.push({ name: item.name, data, mtime: fs.statSync(item.file).mtime });
    hashes[item.name] = sha256(data);
    bytes += data.length;
  }

  if (includeWorkspace) {
    const agentDir = path.join(memoryDir, 'agent');
    if (fs.existsSync(agentDir)) {
      for (const item of collectFiles(agentDir, { prefix: 'workspace/agent/' })) {
        const data = fs.readFileSync(item.file);
        entries.push({ name: item.name, data, mtime: fs.statSync(item.file).mtime });
        hashes[item.name] = sha256(data);
        bytes += data.length;
      }
    }
  }

  if (boundSessionId && sessionsRoot && fs.existsSync(sessionsRoot)) {
    for (const dir of fs.readdirSync(sessionsRoot, { withFileTypes: true })) {
      if (!dir.isDirectory()) continue;
      const sessionDir = path.join(sessionsRoot, dir.name, boundSessionId);
      if (!fs.existsSync(sessionDir)) continue;
      for (const item of collectFiles(sessionDir, { prefix: `sessions/${dir.name}/${boundSessionId}/` })) {
        const data = fs.readFileSync(item.file);
        entries.push({ name: item.name, data, mtime: fs.statSync(item.file).mtime });
        hashes[item.name] = sha256(data);
        bytes += data.length;
      }
    }
  }

  if (rolesDir && fs.existsSync(rolesDir)) {
    for (const name of fs.readdirSync(rolesDir)) {
      if (!name.toLowerCase().endsWith('.md')) continue;
      const data = fs.readFileSync(path.join(rolesDir, name));
      entries.push({ name: `roles/${name}`, data, mtime: fs.statSync(path.join(rolesDir, name)).mtime });
      hashes[`roles/${name}`] = sha256(data);
      bytes += data.length;
    }
  }

  if (settingsFile && fs.existsSync(settingsFile)) {
    const data = fs.readFileSync(settingsFile);
    entries.push({ name: 'dsmp/settings.json', data, mtime: new Date() });
    hashes['dsmp/settings.json'] = sha256(data);
    bytes += data.length;
  }

  const manifest = {
    kind: 'dsmp-memory-pack',
    version: 1,
    createdAt: new Date().toISOString(),
    sourceMachine: process.env.COMPUTERNAME || process.env.HOSTNAME || 'unknown',
    memoryDir,
    includeWorkspace,
    boundSessionId,
    fileCount: entries.length,
    bytes,
    hashes
  };
  entries.unshift({
    name: 'manifest.json',
    data: Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'),
    mtime: new Date()
  });

  const buffer = zipper().createZip(entries);
  return { buffer, manifest, files: entries.length };
}

/** Parse a pack and verify every entry against the manifest hashes. */
export function verifyArchive(buffer) {
  const entries = zipper().readZip(buffer);
  const manifestEntries = entries.filter((entry) => entry.name === 'manifest.json');
  if (!manifestEntries.length) return { ok: false, problems: ['包里没有 manifest.json'], entries };
  if (manifestEntries.length > 1) return { ok: false, problems: ['包里 manifest.json 重复'], entries };
  const manifestEntry = manifestEntries[0];
  let manifest;
  try {
    manifest = JSON.parse(manifestEntry.data.toString('utf8'));
  } catch {
    return { ok: false, problems: ['manifest.json 不是合法 JSON'] };
  }
  if (manifest.kind !== 'dsmp-memory-pack') return { ok: false, problems: ['manifest.kind 不是 dsmp-memory-pack'] };

  const problems = [];
  const missing = [];
  const mismatched = [];
  const nameProblems = entryNameProblems(entries);
  for (const name of Object.keys(manifest.hashes || {})) {
    if (!safeRelative(name)) nameProblems.push(`manifest 哈希表含非法条目名：${JSON.stringify(name)}`);
  }
  if (nameProblems.length) {
    return {
      ok: false,
      problems: nameProblems.slice(0, 20),
      manifest,
      entries,
      missing: [],
      mismatched: [],
      extras: []
    };
  }
  for (const [name, hash] of Object.entries(manifest.hashes || {})) {
    const entry = entries.find((item) => item.name === name);
    if (!entry) {
      missing.push(name);
      continue;
    }
    if (sha256(entry.data) !== hash) mismatched.push(name);
  }
  if (missing.length) problems.push(`缺少 ${missing.length} 个文件`);
  if (mismatched.length) problems.push(`${mismatched.length} 个文件哈希不符`);

  const extras = entries
    .map((entry) => entry.name)
    .filter((name) => name !== 'manifest.json' && !(manifest.hashes || {})[name]);
  if (extras.length) problems.push(`manifest 之外多出 ${extras.length} 个文件`);

  return {
    ok: problems.length === 0,
    problems,
    manifest,
    entries,
    missing: missing.slice(0, 20),
    mismatched: mismatched.slice(0, 20),
    extras: extras.slice(0, 20)
  };
}

/**
 * Import a verified pack into `targetDir`.
 * `dryRun` verifies only; `overwrite` must be true when the target already exists.
 */
export function importArchive({ buffer, targetDir, dryRun = false, overwrite = false, includeWorkspace = true }) {
  const checked = verifyArchive(buffer);
  if (!checked.ok) return { ok: false, phase: 'verify', problems: checked.problems };

  const plan = { targetDir, files: checked.entries.length, memoryFiles: 0, workspaceFiles: 0, sessionFiles: 0, roleFiles: 0 };
  for (const entry of checked.entries) {
    if (entry.name.startsWith('memory/')) plan.memoryFiles += 1;
    else if (entry.name.startsWith('workspace/')) plan.workspaceFiles += 1;
    else if (entry.name.startsWith('sessions/')) plan.sessionFiles += 1;
    else if (entry.name.startsWith('roles/')) plan.roleFiles += 1;
  }
  if (dryRun) return { ok: true, dryRun: true, phase: 'verify', plan, manifest: checked.manifest };

  if (fs.existsSync(targetDir) && fs.readdirSync(targetDir).length && !overwrite) {
    return { ok: false, phase: 'preflight', problems: [`目标目录不是空的：${targetDir}（需要 overwrite=true）`] };
  }

  const targets = [];
  for (const entry of checked.entries) {
    if (entry.name === 'manifest.json') continue;
    let rel = entry.name;
    if (rel.startsWith('workspace/agent/')) {
      if (!includeWorkspace) continue;
      rel = `agent/${rel.slice('workspace/agent/'.length)}`;
    } else if (rel.startsWith('memory/')) {
      rel = rel.slice('memory/'.length);
    } else if (rel.startsWith('sessions/') || rel.startsWith('roles/') || rel.startsWith('dsmp/')) {
      // Not part of the memory tree; callers handle these explicitly.
      continue;
    }
    const target = resolveInside(targetDir, rel);
    if (!target) {
      return { ok: false, phase: 'preflight', problems: [`条目路径越界：${entry.name}`], plan, manifest: checked.manifest };
    }
    targets.push({ rel: path.relative(path.resolve(targetDir), target), data: entry.data });
  }
  // 覆盖导入必须是一次提交：先写同盘 staging，全部成功后再把旧树改名备份、整体换位。
  // 中途失败只清理 staging，绝不让目标目录出现新旧混合（F03）；目标本身是链接时拒绝（F20）。
  if (fs.existsSync(targetDir)) {
    try {
      if (fs.lstatSync(targetDir).isSymbolicLink()) {
        return { ok: false, phase: 'preflight', problems: [`目标目录是链接，拒绝覆盖导入：${targetDir}`], plan, manifest: checked.manifest };
      }
    } catch {
      /* 已不存在则按新建处理 */
    }
  }
  const parent = path.dirname(path.resolve(targetDir));
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
  const staging = path.join(parent, `.${path.basename(targetDir)}.importing-${process.pid}-${Math.random().toString(16).slice(2, 8)}`);
  try {
    for (const item of targets) {
      const abs = path.join(staging, item.rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, item.data);
    }
  } catch (err) {
    try { fs.rmSync(staging, { recursive: true, force: true }); } catch { /* 清理失败不掩盖主错误 */ }
    return {
      ok: false,
      phase: 'write',
      problems: [`写入 staging 失败，目标目录未改动：${(err && err.message) || err}`],
      plan,
      manifest: checked.manifest
    };
  }
  let backupDir = '';
  try {
    if (fs.existsSync(targetDir)) {
      let candidate = `${targetDir}.before-import-${stamp}`;
      let index = 2;
      while (fs.existsSync(candidate)) { candidate = `${targetDir}.before-import-${stamp}-${index}`; index += 1; }
      fs.renameSync(targetDir, candidate);
      backupDir = candidate;
    }
    fs.renameSync(staging, targetDir);
  } catch (err) {
    try { fs.rmSync(staging, { recursive: true, force: true }); } catch { /* ignore */ }
    if (backupDir) {
      try {
        if (fs.existsSync(targetDir)) fs.rmSync(targetDir, { recursive: true, force: true });
        fs.renameSync(backupDir, targetDir);
        backupDir = '';
      } catch {
        /* 回滚也失败时把 backupDir 返回，调用方仍能找到旧数据 */
      }
    }
    return {
      ok: false,
      phase: 'commit',
      problems: [`落位失败，已回滚：${(err && err.message) || err}`],
      plan,
      manifest: checked.manifest,
      backupDir
    };
  }
  return { ok: true, phase: 'done', written: targets.length, plan, manifest: checked.manifest, backupDir };
}
