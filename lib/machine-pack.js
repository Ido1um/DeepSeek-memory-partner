// 一键换机的记忆包：把「记忆目录 + QQ 工作区 + DSH 会话树 + 人设卡 + 插件设置」
// 收成一个 zip，换机时导入到新机器并改写所有绝对路径。
//
// 与 archive.js 的区别：archive.js 只搬记忆（可选一个绑定会话），这里搬整台机器的
// 那份「她」——包括会话日志、machine.json、工作区索引，导入后可以直接接着聊。
//
// zip 与 cwd 重写都由外部注入：开发期 data: URL 热重载下模块不能相对 import。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';

let zipImpl = null;
let rewriter = null;

export function configureMachinePack({ zip, rewriteCwd } = {}) {
  if (zip) zipImpl = zip;
  if (rewriteCwd) rewriter = rewriteCwd;
}

function zipper() {
  if (!zipImpl) throw new Error('machine-pack: 未注入 zip 实现（configureMachinePack）');
  return zipImpl;
}

const PACK_KIND = 'dsmp-machine-pack';
const PACK_VERSION = 1;
const EXCLUDED_TOP = new Set(['backup', 'sessions', 'node_modules', 'scratch', 'shadow', '.git']);
const EXCLUDED_FILES = new Set(['.exporting', '.importing', 'machine-heartbeat.json']);

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function stamp(now = new Date()) {
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
}

/**
 * DSH 的会话目录名：`C:\<工作盘>\a b` → `--C-<工作盘>-a~0020~b--`
 * 规则：冒号丢弃、斜杠变 `-`、空格与非 ASCII 字符按 UTF-16 码元写成 `~XXXX~`。
 * 这个推导必须与真实目录一致，所以 test/machine-pack.test.mjs 用真实目录名对拍。
 */
export function escapeCwd(dir) {
  const text = String(dir || '').replace(/[:/\\]/g, (m) => (m === ':' ? '' : '-'));
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0);
    // 真实目录名是「~ + 四位大写十六进制」，没有收尾的 ~：
    // 「03生产」→ `03~751F~4EA7`，「a b」→ `a~0020b`。
    if (ch === ' ' || code > 0x7e || code < 0x20) out += `~${code.toString(16).toUpperCase().padStart(4, '0')}`;
    else out += ch;
  }
  return `--${out}--`;
}

function walk(root, prefix, out = [], top = true) {
  let dirs = [];
  try {
    dirs = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const item of dirs) {
    if (top && item.isDirectory() && EXCLUDED_TOP.has(item.name)) continue;
    if (top && EXCLUDED_FILES.has(item.name)) continue;
    const full = path.join(root, item.name);
    const name = `${prefix}${item.name}`;
    if (item.isDirectory()) walk(full, `${name}/`, out, false);
    else if (item.isFile()) out.push({ file: full, name });
  }
  return out;
}

function safeRelative(name) {
  if (typeof name !== 'string' || !name || name.includes('\u0000')) return null;
  const rel = name.replace(/\\/g, '/');
  if (rel.startsWith('/') || /^[a-zA-Z]:/.test(rel)) return null;
  for (const part of rel.split('/')) {
    if (!part || part === '.' || part === '..') return null;
    if (part.endsWith('.') || part.endsWith(' ')) return null;
    if (/[\u0000-\u001f<>:"|?*]/.test(part)) return null;
  }
  return rel;
}

/** 拒绝重复名与大小写/分隔符归一后的冲突，并检查 manifest 哈希表的键。 */
function entryNameProblems(entries, manifest) {
  const problems = [];
  const seen = new Map();
  for (const entry of entries) {
    if (entry.name === 'manifest.json') continue;
    const rel = safeRelative(entry.name);
    if (!rel) {
      problems.push(`非法条目名：${JSON.stringify(entry.name)}`);
      continue;
    }
    const key = rel.toLowerCase();
    const prev = seen.get(key);
    if (prev !== undefined) problems.push(`重复或冲突条目：${JSON.stringify(prev)} / ${JSON.stringify(entry.name)}`);
    else seen.set(key, entry.name);
  }
  for (const name of Object.keys((manifest && manifest.hashes) || {})) {
    if (!safeRelative(name)) problems.push(`manifest 哈希表含非法条目名：${JSON.stringify(name)}`);
  }
  return problems;
}

export function buildMachinePack(options) {
  const {
    memoryDir,
    sessionsRoot = '',
    rolesDir = '',
    settingsFile = '',
    sessionIds = [],
    dsmpVersion = '',
    memoryVersion = '',
    log = () => {}
  } = options;
  if (!memoryDir || !fs.existsSync(memoryDir)) {
    const err = new Error(`记忆目录不存在：${memoryDir}`);
    err.code = 'DSMP_EXPORT_SOURCE';
    throw err;
  }

  const freeze = path.join(memoryDir, '.exporting');
  if (fs.existsSync(freeze)) {
    const err = new Error('另一个导出正在进行（.exporting 存在），请稍后再试');
    err.code = 'DSMP_EXPORT_BUSY';
    throw err;
  }
  fs.writeFileSync(freeze, JSON.stringify({ at: new Date().toISOString(), pid: process.pid }), 'utf8');

  try {
    const entries = [];
    const hashes = {};
    let bytes = 0;
    const push = (name, data, mtime) => {
      entries.push({ name, data, mtime: mtime || new Date() });
      hashes[name] = sha256(data);
      bytes += data.length;
    };

    for (const item of walk(memoryDir, 'memory/')) {
      push(item.name, fs.readFileSync(item.file), fs.statSync(item.file).mtime);
    }
    // 记忆根里的 machine.json 单独放一份到 machine.json，导入时先读它再覆盖。
    const machineSource = path.join(memoryDir, 'machine.json');
    if (fs.existsSync(machineSource)) push('machine.json', fs.readFileSync(machineSource));

    const wanted = new Set((sessionIds || []).filter(Boolean).map(String));
    const movedSessions = [];
    if (sessionsRoot && fs.existsSync(sessionsRoot)) {
      for (const dir of fs.readdirSync(sessionsRoot, { withFileTypes: true })) {
        if (!dir.isDirectory()) continue;
        for (const sid of fs.readdirSync(path.join(sessionsRoot, dir.name), { withFileTypes: true })) {
          if (!sid.isDirectory() || !sid.name.startsWith('session-')) continue;
          if (!wanted.has(sid.name)) continue;
          if (movedSessions.includes(sid.name)) continue;
          const sessionDir = path.join(sessionsRoot, dir.name, sid.name);
          for (const item of walk(sessionDir, `sessions/${sid.name}/`, [], false)) {
            push(item.name, fs.readFileSync(item.file), fs.statSync(item.file).mtime);
          }
          movedSessions.push(sid.name);
        }
      }
    }

    if (rolesDir && fs.existsSync(rolesDir)) {
      for (const name of fs.readdirSync(rolesDir)) {
        if (!name.toLowerCase().endsWith('.md')) continue;
        push(`roles/${name}`, fs.readFileSync(path.join(rolesDir, name)), fs.statSync(path.join(rolesDir, name)).mtime);
      }
    }

    if (settingsFile && fs.existsSync(settingsFile)) {
      push('dsmp/settings.json', fs.readFileSync(settingsFile));
    }

    const header = readSessionHeader(sessionsRoot, movedSessions[0] || '');
    const manifest = {
      kind: PACK_KIND,
      version: PACK_VERSION,
      createdAt: new Date().toISOString(),
      sourceMachine: process.env.COMPUTERNAME || process.env.HOSTNAME || 'unknown',
      memoryDir,
      cwd: header.cwd || '',
      sessionIds: movedSessions,
      boundSessionId: options.boundSessionId || '',
      dsmpVersion,
      memoryVersion,
      fileCount: entries.length + 1,
      bytes,
      hashes
    };
    entries.unshift({ name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'), mtime: new Date() });
    log(`换机包：${entries.length} 个文件，${bytes} 字节，会话 ${movedSessions.length} 个`);
    return { buffer: zipper().createZip(entries), manifest, files: entries.length };
  } finally {
    try {
      fs.rmSync(freeze, { force: true });
    } catch {
      /* ignore */
    }
  }
}

function readSessionHeader(sessionsRoot, sid) {
  if (!sessionsRoot || !sid) return {};
  try {
    for (const dir of fs.readdirSync(sessionsRoot, { withFileTypes: true })) {
      if (!dir.isDirectory()) continue;
      const file = path.join(sessionsRoot, dir.name, sid, 'session.v4.jsonl.zstd');
      if (!fs.existsSync(file)) continue;
      const decoded = decodeOneFrame(fs.readFileSync(file));
      if (decoded) return JSON.parse(decoded.split('\n')[0]);
    }
  } catch {
    /* ignore */
  }
  return {};
}

function decodeOneFrame(buffer) {
  try {
    const p = 0;
    if (buffer.readUInt32LE(p) !== 0xfd2fb528) return '';
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
      const h = buffer[q] | (buffer[q + 1] << 8) | (buffer[q + 2] << 16);
      const last = h & 1;
      const type = (h >> 1) & 3;
      const size = h >>> 3;
      q += 3;
      if (type === 1) q += 1;
      else q += size;
      if (last) break;
    }
    if (hasChecksum) q += 4;
    return zlib.zstdDecompressSync(buffer.subarray(0, q)).toString('utf8');
  } catch {
    return '';
  }
}

export function verifyMachinePack(buffer) {
  let entries;
  try {
    entries = zipper().readZip(buffer);
  } catch (err) {
    return { ok: false, problems: [`包已损坏或不是 zip：${err.message}`] };
  }
  const manifestEntries = entries.filter((entry) => entry.name === 'manifest.json');
  if (!manifestEntries.length) return { ok: false, problems: ['包里没有 manifest.json'] };
  if (manifestEntries.length > 1) return { ok: false, problems: ['包里 manifest.json 重复'] };
  const manifestEntry = manifestEntries[0];
  let manifest;
  try {
    manifest = JSON.parse(manifestEntry.data.toString('utf8'));
  } catch {
    return { ok: false, problems: ['manifest.json 不是合法 JSON'] };
  }
  if (manifest.kind !== PACK_KIND) return { ok: false, problems: [`不是换机包（kind=${manifest.kind}）`] };
  if (Number(manifest.version) > PACK_VERSION) return { ok: false, problems: [`包版本 ${manifest.version} 比插件新，先升级 DSMP`] };

  const nameProblems = entryNameProblems(entries, manifest);
  if (nameProblems.length) return { ok: false, problems: nameProblems.slice(0, 20), manifest, entries };

  const problems = [];
  const mismatched = [];
  for (const [name, hash] of Object.entries(manifest.hashes || {})) {
    const entry = entries.find((item) => item.name === name);
    if (!entry) {
      mismatched.push(`缺失 ${name}`);
      continue;
    }
    if (sha256(entry.data) !== hash) mismatched.push(`哈希不符 ${name}`);
  }
  if (mismatched.length) problems.push(`${mismatched.length} 个文件缺失或哈希不符`);
  const extras = entries
    .map((entry) => entry.name)
    .filter((name) => name !== 'manifest.json' && !(manifest.hashes || {})[name]);
  if (extras.length) problems.push(`manifest 之外多出 ${extras.length} 个文件`);
  return { ok: problems.length === 0, problems, manifest, entries, mismatched: mismatched.slice(0, 20) };
}

export function planMachineImport({ buffer, targetDir, sessionsRoot = '', workspaceFile = '', bridgeDir = '', settingsFile = '' }) {
  const checked = verifyMachinePack(buffer);
  if (!checked.ok) return { ok: false, phase: 'verify', problems: checked.problems };
  const manifest = checked.manifest;
  const entries = checked.entries.filter((entry) => entry.name !== 'manifest.json');
  const plan = {
    phase: 'preview',
    targetDir,
    newCwd: path.join(targetDir, 'agent'),
    oldCwd: manifest.cwd || '',
    sourceMachine: manifest.sourceMachine,
    sessions: (manifest.sessionIds || []).length,
    files: entries.length,
    memoryFiles: entries.filter((entry) => entry.name.startsWith('memory/')).length,
    roleFiles: entries.filter((entry) => entry.name.startsWith('roles/')).length,
    hasSettings: entries.some((entry) => entry.name === 'dsmp/settings.json'),
    targetExists: fs.existsSync(targetDir) && fs.readdirSync(targetDir).length > 0,
    sessionsRoot,
    workspaceFile,
    bridgeDir,
    settingsFile
  };
  return { ok: true, plan, manifest };
}

/**
 * Apply a verified machine pack. Order matters:
 *   backup target → write memory (temp + rename) → sessions (rewrite cwd) →
 *   workspace index → bridge config → dsmp settings → machine.json
 * Any failure restores the backup and removes what this call created.
 */
export function importMachinePack(options) {
  const {
    buffer,
    targetDir,
    sessionsRoot = '',
    workspaceFile = '',
    bridgeDir = '',
    settingsFile = '',
    dryRun = false,
    overwrite = false,
    newMachineName = '',
    log = () => {}
  } = options;

  const planned = planMachineImport({ buffer, targetDir, sessionsRoot, workspaceFile, bridgeDir, settingsFile });
  if (!planned.ok) return planned;
  const { manifest, plan } = planned;
  if (dryRun) return { ok: true, dryRun: true, ...plan };
  if (plan.targetExists && !overwrite) {
    return { ok: false, phase: 'preflight', problems: [`目标目录不是空的：${targetDir}（需要 overwrite=true）`] };
  }

  const entries = verifyMachinePack(buffer).entries.filter((entry) => entry.name !== 'manifest.json');
  const stampText = stamp();
  const backupDir = `${targetDir}.before-import-${stampText}`;
  const staging = `${targetDir}.importing-${process.pid}`;
  const backups = [];
  let movedAside = false;
  let createdTarget = false;
  const createdSessions = [];

  try {
    // 1. 记忆树：先写到 staging，再整体换位，避免半个目录。
    fs.rmSync(staging, { recursive: true, force: true });
    fs.mkdirSync(staging, { recursive: true });
    for (const entry of entries) {
      if (!entry.name.startsWith('memory/')) continue;
      const rel = safeRelative(entry.name.slice('memory/'.length));
      if (!rel) continue;
      const file = path.join(staging, rel);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, entry.data);
    }
    const memoryFiles = walk(staging, '', []).length;

    if (fs.existsSync(targetDir)) {
      if (fs.readdirSync(targetDir).length) {
        fs.renameSync(targetDir, backupDir);
        backups.push({ what: 'memory', from: targetDir, to: backupDir });
        movedAside = true;
      } else {
        fs.rmdirSync(targetDir);
      }
    }
    fs.renameSync(staging, targetDir);
    createdTarget = true;

    // 2. 会话树：目录名必须是 sessionId，日志头 cwd 改成新路径。
    const newCwd = path.join(targetDir, 'agent');
    const destRoot = sessionsRoot ? path.join(sessionsRoot, escapeCwd(newCwd)) : '';
    let sessionFiles = 0;
    let rewritten = 0;
    if (destRoot) {
      fs.mkdirSync(destRoot, { recursive: true });
      for (const sid of manifest.sessionIds || []) {
        const files = entries.filter((entry) => entry.name.startsWith(`sessions/${sid}/`));
        if (!files.length) continue;
        const dest = path.join(destRoot, sid);
        const existed = fs.existsSync(dest);
        if (existed) {
          const aside = `${dest}.before-import-${stampText}`;
          fs.renameSync(dest, aside);
          backups.push({ what: 'session', from: dest, to: aside });
        }
        fs.mkdirSync(dest, { recursive: true });
        if (!existed) createdSessions.push(dest);
        for (const entry of files) {
          const rel = safeRelative(entry.name.slice(`sessions/${sid}/`.length));
          if (!rel) continue;
          const file = path.join(dest, rel);
          fs.mkdirSync(path.dirname(file), { recursive: true });
          fs.writeFileSync(file, entry.data);
          sessionFiles += 1;
        }
        const logFile = path.join(dest, 'session.v4.jsonl.zstd');
        if (rewriter && fs.existsSync(logFile)) {
          // 换机导入是落到全新位置：原日志仍在包内，不需要在目标会话目录里留 .bak。
          const out = rewriter(logFile, newCwd, { backup: false });
          if (out && out.before !== newCwd) rewritten += 1;
        }
      }
    }

    // 3. 工作区索引：把旧 cwd 的那条改成新路径（只改路径与时间，不新增条目）。
    if (workspaceFile && fs.existsSync(workspaceFile)) {
      const raw = fs.readFileSync(workspaceFile, 'utf8');
      const data = JSON.parse(raw);
      let touched = 0;
      for (const item of Object.values(data?.tables?.workspaces || {})) {
        if (!item || !item.path) continue;
        if (path.resolve(item.path) !== path.resolve(plan.oldCwd || manifest.memoryDir)) continue;
        item.path = newCwd;
        item.updatedAt = new Date().toISOString();
        touched += 1;
      }
      if (touched) {
        backupFile(workspaceFile, backups, stampText);
        fs.writeFileSync(workspaceFile, JSON.stringify(data, null, 2), 'utf8');
      }
      plan.workspaces = touched;
    }

    // 4. bridge：sessionCwd 跟着搬；sessions.json 里的会话 id 不变。
    if (bridgeDir) {
      const configFile = path.join(bridgeDir, 'config.json');
      if (fs.existsSync(configFile)) {
        const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
        config.sessionCwd = newCwd;
        backupFile(configFile, backups, stampText);
        fs.writeFileSync(configFile, JSON.stringify(config, null, 2), 'utf8');
        plan.bridge = 'updated';
      } else plan.bridge = 'missing';
    }

    // 5. DSMP 设置：先按白名单吸收包内设置（F16），再重写所有机器相关路径。
    const packSettingsEntry = entries.find((entry) => entry.name === 'dsmp/settings.json');
    let packSettings = null;
    if (packSettingsEntry) {
      try { packSettings = JSON.parse(packSettingsEntry.data.toString('utf8')); } catch { packSettings = null; }
    }
    const settingsExists = Boolean(settingsFile && fs.existsSync(settingsFile));
    if (settingsExists || (settingsFile && packSettings)) {
      const settings = settingsExists ? JSON.parse(fs.readFileSync(settingsFile, 'utf8')) : {};
      // 可迁移的配置白名单：只收与机器无关的行为项；路径/租约身份/测试目录一律以目标机为准。
      if (packSettings) {
        for (const key of ['channel', 'inject', 'chat', 'panel', 'media', 'workbench', 'ui']) {
          if (packSettings[key] !== undefined) settings[key] = packSettings[key];
        }
        if (packSettings.memory && typeof packSettings.memory === 'object') {
          const memory = { ...packSettings.memory };
          for (const drop of ['dir', 'owner', 'leaseTtlMs', 'heartbeatMs']) delete memory[drop];
          settings.memory = { ...(settings.memory || {}), ...memory };
        }
        if (packSettings.backup && typeof packSettings.backup === 'object') {
          settings.backup = { ...(settings.backup || {}), keep: packSettings.backup.keep ?? (settings.backup || {}).keep };
        }
      }
      settings.memoryDir = targetDir;
      settings.session = settings.session || {};
      settings.session.liveCwd = newCwd;
      // 绑定会话必须明确切换：包里有绑定就用包里的，没有就清空旧机器留下的 id，
      // 避免旧 liveId 和新 liveCwd 拼在一起（F16）。
      const bound = String(manifest.boundSessionId || '');
      settings.session.liveId = bound;
      settings.session.boundId = bound;
      if (!bound) settings.session.via = settings.session.via || 'auto';
      backupFile(settingsFile, backups, stampText);
      fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
      fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2), 'utf8');
      plan.settings = settingsExists ? 'updated' : 'created';
      plan.settingsFromPack = Boolean(packSettings);
    }

    // 5b. 独立角色：只写进记忆目录内部（roles.dir 指向外部路径时不越界写）。
    const roleEntries = entries.filter((entry) => /^roles\/[^/]+\.md$/.test(entry.name));
    if (roleEntries.length) {
      const current = settingsExists || (settingsFile && packSettings) ? JSON.parse(fs.readFileSync(settingsFile, 'utf8')) : {};
      const wanted = String((current.roles && current.roles.dir) || '').trim();
      const resolved = wanted ? path.resolve(wanted) : path.join(targetDir, 'roles');
      const root = path.resolve(targetDir);
      if (resolved === root || resolved.startsWith(root + path.sep)) {
        fs.mkdirSync(resolved, { recursive: true });
        for (const entry of roleEntries) {
          fs.writeFileSync(path.join(resolved, path.basename(entry.name)), entry.data);
        }
        plan.roles = { imported: roleEntries.length, dir: resolved };
      } else {
        plan.roles = { imported: 0, dir: resolved, skipped: 'roles.dir 在记忆目录之外，未写入' };
      }
    }

    // 6. machine.json：新机器收养，旧 id 进 history。
    const machine = adoptMachineFor(targetDir, {
      importedFrom: manifest.sourceMachine || '',
      cwd: newCwd,
      boundSessionId: manifest.boundSessionId || '',
      dsmpVersion: manifest.dsmpVersion || '',
      memoryVersion: manifest.memoryVersion || '',
      name: newMachineName
    });

    log(`换机包导入完成：${memoryFiles} 个记忆文件、${sessionFiles} 个会话文件、改写 ${rewritten} 个会话 cwd`);
    return {
      ok: true,
      phase: 'done',
      targetDir,
      newCwd,
      memoryFiles,
      sessionFiles,
      rewritten,
      backups: backups.map((item) => item.to),
      machine
    };
  } catch (err) {
    // 回滚：删除本次新建的 target / 会话目录，再把备份改回来。
    const rollbackFailures = [];
    const attempt = (label, fn) => {
      try {
        fn();
      } catch (rollbackErr) {
        rollbackFailures.push(`${label}: ${rollbackErr.message}`);
      }
    };
    attempt('清理 staging', () => fs.rmSync(staging, { recursive: true, force: true }));
    if (movedAside && fs.existsSync(backupDir)) {
      attempt('恢复记忆目录', () => {
        if (fs.existsSync(targetDir)) fs.rmSync(targetDir, { recursive: true, force: true });
        fs.renameSync(backupDir, targetDir);
      });
    } else if (createdTarget) {
      attempt('删除新建记忆目录', () => fs.rmSync(targetDir, { recursive: true, force: true }));
    }
    for (const item of [...backups].reverse()) {
      if (item.what === 'session') {
        attempt(`恢复会话 ${item.from}`, () => {
          if (fs.existsSync(item.from)) fs.rmSync(item.from, { recursive: true, force: true });
          if (fs.existsSync(item.to)) fs.renameSync(item.to, item.from);
        });
      } else if (item.what === 'file') {
        attempt(`恢复文件 ${item.from}`, () => {
          if (fs.existsSync(item.to)) fs.copyFileSync(item.to, item.from);
        });
      }
    }
    for (const dir of [...createdSessions].reverse()) {
      attempt(`删除新建会话 ${dir}`, () => fs.rmSync(dir, { recursive: true, force: true }));
    }
    if (rollbackFailures.length) log(`换机包导入失败：${err.message}；回滚告警 ${rollbackFailures.length} 项`);
    return { ok: false, phase: 'apply', error: err.message, backups: backups.map((item) => item.to), rollbackFailures };
  }
}

function backupFile(file, list, stampText) {
  const copy = `${file}.before-import-${stampText}`;
  fs.copyFileSync(file, copy);
  list.push({ what: 'file', from: file, to: copy });
}

function adoptMachineFor(dir, info) {
  // 与 machine.js 同构，但这里不直接依赖它，保持本模块可单测。
  const file = path.join(dir, 'machine.json');
  let previous = null;
  try {
    previous = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    previous = null;
  }
  const machine = {
    machineId: crypto.randomUUID(),
    name: info.name || process.env.COMPUTERNAME || 'unknown',
    createdAt: new Date().toISOString(),
    memoryVersion: info.memoryVersion || '',
    dsmpVersion: info.dsmpVersion || '',
    boundSessionId: info.boundSessionId || '',
    cwd: info.cwd || '',
    importedFrom: info.importedFrom || '',
    previousMachineId: previous?.machineId || ''
  };
  fs.mkdirSync(path.join(dir, 'state'), { recursive: true });
  if (previous?.machineId) {
    fs.appendFileSync(
      path.join(dir, 'state', 'machine-history.jsonl'),
      `${JSON.stringify({
        at: machine.createdAt,
        action: 'adopt',
        fromMachineId: previous.machineId,
        fromMachine: machine.importedFrom,
        toMachineId: machine.machineId,
        cwd: machine.cwd
      })}\n`,
      'utf8'
    );
  }
  fs.writeFileSync(file, JSON.stringify(machine, null, 2), 'utf8');
  return machine;
}
