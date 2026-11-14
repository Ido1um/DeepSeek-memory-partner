/**
 * D 健壮性：写接口令牌、乐观锁 etag、诊断快照、启动自检。
 *
 * 注意：本模块会被开发期 `loadModule()` 以 `data:text/javascript` 加载，
 * 因此**不能**使用相对 import（data: URL 不是层级 scheme）。需要的探测全部
 * 在本文件里自带最小实现。
 */
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import crypto from 'node:crypto';

export const TOKEN_FILE = 'api-token';
export const TOKEN_RE = /^[0-9a-f]{32}$/;
/** 浏览器不在这些路径上走 token，而是靠同源标记；保持向后兼容。 */
export const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function ensureWriteToken(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, TOKEN_FILE);
  try {
    const current = fs.readFileSync(file, 'utf8').trim();
    if (TOKEN_RE.test(current)) return { ok: true, file, token: current, created: false };
  } catch {
    /* missing or unreadable: create below */
  }
  const token = crypto.randomBytes(16).toString('hex');
  fs.writeFileSync(file, `${token}\n`, { mode: 0o600 });
  return { ok: true, file, token, created: true };
}

export function readWriteToken(dir) {
  try {
    const value = fs.readFileSync(path.join(dir, TOKEN_FILE), 'utf8').trim();
    return TOKEN_RE.test(value) ? value : '';
  } catch {
    return '';
  }
}

/**
 * 写路由守卫。
 *
 * 放行条件（任一）：
 * 1) 安全方法（GET/HEAD/OPTIONS）；
 * 2) `x-dsmp-token` 与令牌文件一致；
 * 3) 浏览器同源请求（`Sec-Fetch-Site: same-origin`）——CSRF 的页面跨站时由浏览器
 *    自动标成 cross-site，伪造不了；这条让面板无需保存令牌也能写；
 * 4) 内部通道路径 + `x-dsmp-internal: bridge`（bridge 回调，非浏览器无法预检）。
 *
 * 诚实边界：同一用户下的本机进程可以读令牌文件，也能伪造这些头。这道锁防的是
 * CSRF、误调用与跨站脚本，不是本机提权。
 */
export function guardWrite(routePath, handler, { token, internalPaths = [] } = {}) {
  const internal = new Set(internalPaths);
  return async function guarded(req, res) {
    const method = String(req.method || 'GET').toUpperCase();
    if (SAFE_METHODS.has(method)) return handler(req, res);
    const headers = req.headers || {};
    if (internal.has(routePath) && String(headers['x-dsmp-internal'] || '') === 'bridge') {
      return handler(req, res);
    }
    const given = String(headers['x-dsmp-token'] || '').trim();
    if (token && given && given === token) return handler(req, res);
    if (String(headers['sec-fetch-site'] || '') === 'same-origin') return handler(req, res);
    // Electron renderers and custom-protocol windows often omit Sec-Fetch-Site.
    // Origin/Referer host comparison is the same protection: a cross-site page
    // cannot forge either header.
    const host = String(headers.host || '').toLowerCase();
    const sameHost = (value) => {
      if (!host || !value) return false;
      try {
        return new URL(String(value)).host.toLowerCase() === host;
      } catch {
        return false;
      }
    };
    if (sameHost(headers.origin) || sameHost(headers.referer)) return handler(req, res);
    sendJson(res, 403, {
      ok: false,
      code: 'DSMP_WRITE_FORBIDDEN',
      error: '写操作需要 x-dsmp-token（或同源请求）'
    });
    return undefined;
  };
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body)
  });
  res.end(body);
}

/** facts/history 共用的数据指纹：文件 mtime+size 的短哈希。 */
export function etagOfDir(dir) {
  const files = ['state/longterm.jsonl', 'state/claims.jsonl', 'state/topics.jsonl', 'activation.json'];
  const parts = [];
  for (const rel of files) {
    try {
      const st = fs.statSync(path.join(dir, rel));
      parts.push(`${rel}:${Math.round(st.mtimeMs)}:${st.size}`);
    } catch {
      parts.push(`${rel}:-`);
    }
  }
  return crypto.createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 16);
}

export function probePort(host, port, timeoutMs = 400) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;
    const finish = (state) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(state);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish('open'));
    socket.once('timeout', () => finish('timeout'));
    socket.once('error', (err) => {
      const code = err && err.code;
      finish(code === 'ECONNREFUSED' ? 'refused' : code === 'ETIMEDOUT' ? 'timeout' : 'blocked');
    });
    try {
      socket.connect(port, host || '127.0.0.1');
    } catch {
      finish('blocked');
    }
  });
}

export function pidAlive(pid) {
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch {
    return false;
  }
}

/** 残留面板锁：返回 {file, sessionId, ageMs, pid, alive}。 */
export function scanLocks(dsmpDir, { now = Date.now() } = {}) {
  const out = [];
  let names = [];
  try {
    names = fs.readdirSync(dsmpDir);
  } catch {
    return out;
  }
  for (const name of names) {
    if (!/^panel-lock-.*\.json$/.test(name)) continue;
    const file = path.join(dsmpDir, name);
    let info = null;
    try {
      info = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      info = null;
    }
    const at = Number(info && info.at) || 0;
    const pid = Number(info && info.pid) || 0;
    out.push({ file: name, sessionId: String((info && info.sessionId) || ''), ageMs: at ? now - at : null, pid, alive: pid ? pidAlive(pid) : false });
  }
  return out.sort((a, b) => (b.ageMs || 0) - (a.ageMs || 0));
}

/** 清理超过 5 分钟、持有进程已死的面板锁；返回清掉的个数。 */
export function cleanStaleLocks(dsmpDir, { now = Date.now(), maxAgeMs = 300000 } = {}) {
  let removed = 0;
  for (const row of scanLocks(dsmpDir, { now })) {
    if (row.alive) continue;
    if (row.ageMs !== null && row.ageMs < maxAgeMs) continue;
    try {
      fs.unlinkSync(path.join(dsmpDir, row.file));
      removed += 1;
    } catch {
      /* raced */
    }
  }
  return removed;
}

/** 迁移/导入/导出留下的临时标记。 */
export function scanTransient(memoryDir, dsmpDir) {
  const flags = [];
  for (const [label, file] of [
    ['导出中', path.join(memoryDir, '.exporting')],
    ['导入中', path.join(memoryDir, '.importing')]
  ]) {
    if (fs.existsSync(file)) flags.push({ label, file });
  }
  try {
    const journal = JSON.parse(fs.readFileSync(path.join(dsmpDir, 'migration', 'journal.json'), 'utf8'));
    if (journal && journal.phase && journal.phase !== 'done') {
      flags.push({ label: `迁移 ${journal.phase}`, file: path.join(dsmpDir, 'migration', 'journal.json') });
    }
  } catch {
    /* no journal */
  }
  return flags;
}

export function tail(file, lines = 20, maxBytes = 64 * 1024) {
  try {
    const st = fs.statSync(file);
    const start = Math.max(0, st.size - maxBytes);
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(st.size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    const rows = buf.toString('utf8').split(/\r?\n/);
    return rows.slice(-lines).join('\n');
  } catch (err) {
    return `(读不到：${String(err && err.message ? err.message : err)})`;
  }
}

/**
 * 启动自检。全部是本地、快速检查；bridge 在线与否由调用方传入（不阻塞启动）。
 * 返回 [{id, label, ok, detail}]。
 */
export function selfCheck({
  memoryDir,
  dsmpDir,
  devMode = false,
  lease = null,
  bridgeOnline = null,
  tokenFile = '',
  now = Date.now()
} = {}) {
  const items = [];
  const push = (id, label, ok, detail = '') => items.push({ id, label, ok: Boolean(ok), detail: String(detail) });

  let memoryOk = false;
  let memoryDetail = memoryDir || '(未配置)';
  if (memoryDir && fs.existsSync(memoryDir)) {
    try {
      fs.accessSync(memoryDir, fs.constants.W_OK);
      memoryOk = true;
    } catch (err) {
      memoryDetail = `${memoryDir}（不可写：${String(err && err.code ? err.code : err)}）`;
    }
  } else if (memoryDir) {
    memoryDetail = `${memoryDir}（不存在）`;
  }
  push('memory-dir', '记忆目录可写', memoryOk, memoryDetail);

  const leaseLive = Boolean(lease && lease.live);
  const leaseMine = Boolean(lease && lease.mine);
  push('lease', '记忆租约归本机', leaseMine, lease ? `owner=${lease.owner || '?'} live=${leaseLive} age=${lease.ageMs == null ? '?' : Math.round(lease.ageMs / 1000) + 's'}` : '无租约信息');

  push('bridge', 'QQ bridge 在线（不阻塞）', bridgeOnline === null ? true : Boolean(bridgeOnline), bridgeOnline === null ? '启动时未探测' : bridgeOnline ? '在线' : '不可达（本地聊天仍可用）');

  const locks = scanLocks(dsmpDir, { now });
  const stale = locks.filter((row) => !row.alive && (row.ageMs === null || row.ageMs >= 300000));
  push('locks', '没有死锁残留', stale.length === 0, stale.length ? `${stale.length} 个残留（下次写入口会自动抢占）` : `${locks.length} 个活动锁`);

  // 开发标记的有无是「模式信息」，不是故障：两种状态都算通过，避免面板把它
  // 当成待处理项（用户看到「生产模式」却标红会以为坏了）。
  push('dev-reload', devMode ? '开发热重载（存在 dev-reload.flag）' : '生产模式', true, devMode ? '开发标记存在，正式发布前删除' : '无 dev-reload.flag（正常）');

  const tokenOk = Boolean(tokenFile) && fs.existsSync(tokenFile);
  push('write-token', '写接口令牌已生成', tokenOk, tokenFile || '(未知路径)');

  return items;
}

export function checkFailed(items) {
  return (items || []).filter((row) => row && row.ok === false);
}

/** 诊断快照：端口、租约、锁、临时标记、日志尾部、自检。 */
export async function diagnostics({
  memoryDir,
  dsmpDir,
  bridgeDir = '',
  logsDir = '',
  lease = null,
  selfCheckItems = [],
  ports = [3100, 7351, 8188, 9880],
  now = Date.now()
} = {}) {
  const portRows = [];
  for (const port of ports) {
    portRows.push({ port, state: await probePort('127.0.0.1', port) });
  }
  const logs = [];
  const candidates = [];
  if (logsDir) {
    try {
      for (const name of fs.readdirSync(logsDir)) {
        if (/^(service-.*|dsmp-.*)\.log$/.test(name)) candidates.push(path.join(logsDir, name));
      }
    } catch {
      /* no logs dir */
    }
  }
  if (bridgeDir) {
    candidates.push(path.join(bridgeDir, 'state', 'bridge.log'));
    candidates.push(path.join(bridgeDir, 'state', 'boot-check.log'));
  }
  for (const file of candidates.slice(0, 8)) {
    if (!fs.existsSync(file)) continue;
    let at = '';
    try {
      at = new Date(fs.statSync(file).mtimeMs).toISOString();
    } catch {
      at = '';
    }
    logs.push({ name: path.basename(file), file, at, tail: tail(file, 20) });
  }
  return {
    ok: true,
    at: new Date(now).toISOString(),
    ports: portRows,
    lease: lease || null,
    locks: scanLocks(dsmpDir, { now }),
    transient: scanTransient(memoryDir, dsmpDir),
    logs,
    selfCheck: selfCheckItems
  };
}
