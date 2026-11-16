import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/**
 * 单写者租约：DSMP 与 qq-bridge 之间约定「同一时刻只有一个人写记忆」。
 *
 * 文件：<memoryDir>/state/engine-lease.json
 * 形状：{ owner, instanceId, pid, startedAt, heartbeatAt, ttlMs, fencing, version }
 *
 * 规则：
 * - 租约未过期且不是本实例 → 不抢，降级只读。
 * - 租约过期 → 可以接管（fencing +1，记下 from 便于排查）。
 * - 心跳 15s 刷新 heartbeatAt；ttlMs 默认 60s。
 * - 所有变更都在 <lease>.lock 的排他区里完成：读取、判断、写入是一个原子段。
 * - 身份 = owner + instanceId（每次进程启动随机生成）；pid 只用于存活判断，
 *   不能作为身份，因为 Windows 会复用 pid。
 */

export const LEASE_VERSION = 2;
export const DEFAULT_TTL_MS = 60_000;
export const HEARTBEAT_MS = 15_000;
const LOCK_TIMEOUT_MS = 3_000;
const LOCK_RETRY_MS = 15;

const INSTANCE_KEY = Symbol.for('dsmp.lease.instanceId');

/** 本进程的租约实例 id；可用 DSMP_LEASE_INSTANCE 固定（测试/演练用）。 */
export function leaseInstanceId() {
  if (!globalThis[INSTANCE_KEY]) {
    globalThis[INSTANCE_KEY] = String(process.env.DSMP_LEASE_INSTANCE || '').trim()
      || crypto.randomBytes(8).toString('hex');
  }
  return globalThis[INSTANCE_KEY];
}

/** 测试专用：把实例 id 固定成指定值。 */
export function _setLeaseInstanceIdForTests(id = '') {
  globalThis[INSTANCE_KEY] = String(id || '');
}

export function leaseFilePath(memoryDir) {
  return path.join(String(memoryDir || ''), 'state', 'engine-lease.json');
}

function sleepSync(ms) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    /* 极端环境没有 SharedArrayBuffer 时退化为忙等 */
  }
}

function processAlive(pid) {
  const n = Number(pid) || 0;
  if (!n || n === process.pid) return n === process.pid;
  try {
    process.kill(n, 0);
    return true;
  } catch (err) {
    return err && err.code === 'EPERM';
  }
}

/** 在租约锁保护下执行 fn：读取-判断-写入必须整体原子。 */
function withLeaseLock(memoryDir, fn) {
  const file = leaseFilePath(memoryDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lockFile = `${file}.lock`;
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  // Publish fully initialized metadata atomically. A fresh empty/partial legacy
  // lock may still be initializing: never infer death from parse failure or age.
  const nonce = crypto.randomUUID();
  const candidate = `${lockFile}.candidate-${nonce}`;
  fs.writeFileSync(candidate, JSON.stringify({ pid: process.pid, at: Date.now(), nonce }), { flag: 'wx' });
  const read = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
  const removeOwn = (p) => { if (read(p)?.nonce === nonce) fs.unlinkSync(p); };
  let held = false;
  try {
  while (!held) {
    try {
      fs.linkSync(candidate, lockFile);
      held = true;
    } catch (err) {
      if (!err || err.code !== 'EEXIST') throw err;
      const observed = read(lockFile);
      if (observed?.pid && !processAlive(observed.pid)) {
        // Serialize reclaimers. Without this second exclusion two reclaimers
        // could delete a newly acquired live lock after inspecting the dead one.
        const reclaim = `${lockFile}.reclaim`;
        let reaping = false;
        try {
          fs.linkSync(candidate, reclaim); reaping = true;
          const current = read(lockFile);
          if (current?.pid && !processAlive(current.pid)) fs.unlinkSync(lockFile);
        } catch (e) {
          if (!['EEXIST', 'ENOENT'].includes(e.code)) throw e;
        } finally { if (reaping) removeOwn(reclaim); }
      }
      if (Date.now() > deadline) {
        const e = new Error('租约锁等待超时');
        e.code = 'DSMP_LEASE_LOCK_TIMEOUT';
        throw e;
      }
      sleepSync(LOCK_RETRY_MS);
    }
  }
  return fn();
  } finally {
    if (held) removeOwn(lockFile);
    try { fs.unlinkSync(candidate); } catch { /* process exit cleanup */ }
  }
}

export function readLease(memoryDir) {
  const file = leaseFilePath(memoryDir);
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return null;
    return {
      owner: String(data.owner || ''),
      instanceId: String(data.instanceId || ''),
      pid: Number(data.pid) || 0,
      startedAt: Number(data.startedAt) || 0,
      heartbeatAt: Number(data.heartbeatAt) || 0,
      ttlMs: Number(data.ttlMs) || DEFAULT_TTL_MS,
      fencing: Number(data.fencing) || 0,
      version: Number(data.version) || LEASE_VERSION,
      file
    };
  } catch {
    return null;
  }
}

export function leaseAge(lease, now = Date.now()) {
  if (!lease) return Infinity;
  return now - lease.heartbeatAt;
}

export function leaseLive(lease, now = Date.now()) {
  if (!lease || !lease.owner) return false;
  return leaseAge(lease, now) <= lease.ttlMs;
}

function sameInstance(lease, owner, instanceId) {
  if (!lease) return false;
  if (lease.owner !== owner) return false;
  // Legacy leases must be explicitly acquired before they can be used.
  if (!lease.instanceId || !instanceId) return false;
  return lease.instanceId === instanceId;
}

/** 兼容旧调用：第三个参数可以是 now 数字，也可以是 { now, instanceId }。 */
function normOpts(opts, fallbackInstanceId = '') {
  if (typeof opts === 'number') return { now: opts, instanceId: fallbackInstanceId };
  const o = opts && typeof opts === 'object' ? opts : {};
  return {
    now: Number(o.now) || Date.now(),
    instanceId: String(o.instanceId || fallbackInstanceId || '')
  };
}

export function leaseOwnedBy(memoryDir, owner, opts = {}) {
  const { now, instanceId } = normOpts(opts, leaseInstanceId());
  const lease = readLease(memoryDir);
  return Boolean(lease?.instanceId && sameInstance(lease, owner, instanceId) && leaseLive(lease, now));
}

function nextFencing(memoryDir, current) {
  const file = `${leaseFilePath(memoryDir)}.fencing`;
  let prior = 0;
  try { prior = Number(fs.readFileSync(file, 'utf8')); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  if (!Number.isSafeInteger(prior) || prior < 0) throw new Error('租约 fencing 计数器损坏');
  const next = Math.max(prior, current?.fencing || 0) + 1;
  if (!Number.isSafeInteger(next)) throw new Error('租约 fencing 超出范围');
  const tmp = `${file}.tmp-${crypto.randomUUID()}`;
  fs.writeFileSync(tmp, String(next));
  fs.renameSync(tmp, file);
  return next;
}

function writeLeaseLocked(memoryDir, lease) {
  const file = leaseFilePath(memoryDir);
  const tmp = `${file}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  fs.writeFileSync(tmp, JSON.stringify({ ...lease, version: LEASE_VERSION }, null, 2), 'utf8');
  fs.renameSync(tmp, file);
  return { ...lease, version: LEASE_VERSION, file };
}

/** Standalone synchronous writes hold the same exclusion as acquire/heartbeat.
 * The body must already be received; no awaiting a network request inside it.
 */
export function withWriteLease({ memoryDir, owner = 'workbench', instanceId = leaseInstanceId() }, fn) {
  return withLeaseLock(memoryDir, () => {
    const current = readLease(memoryDir);
    if (current && leaseLive(current) && !sameInstance(current, owner, instanceId)) {
      throw Object.assign(new Error('记忆租约由其他实例持有，工作台当前只读'), { status: 409, code: 'DSMP_WORKBENCH_READONLY' });
    }
    const mine = writeLeaseLocked(memoryDir, {
      owner, instanceId, pid: process.pid, startedAt: Date.now(), heartbeatAt: Date.now(),
      ttlMs: DEFAULT_TTL_MS, fencing: nextFencing(memoryDir, current)
    });
    try {
      const result = fn();
      if (result && typeof result.then === 'function') throw new Error('withWriteLease requires synchronous writes');
      return result;
    } finally {
      const fresh = readLease(memoryDir);
      if (fresh?.instanceId === mine.instanceId && fresh.owner === owner && fresh.fencing === mine.fencing) fs.unlinkSync(leaseFilePath(memoryDir));
    }
  });
}

/**
 * 抢租约。成功返回 { ok:true, lease, tookOverFrom, fencing }。
 * 被另一个存活实例占着返回 { ok:false, reason:'held-by-other', lease }。
 */
export function acquireLease({
  memoryDir,
  owner = 'dsmp',
  instanceId = leaseInstanceId(),
  pid = process.pid,
  ttlMs = DEFAULT_TTL_MS,
  now = Date.now()
} = {}) {
  return withLeaseLock(memoryDir, () => {
    const current = readLease(memoryDir);
    const legacyUpgrade = current && !current.instanceId && current.owner === owner
      && (current.pid === process.pid || !processAlive(current.pid));
    if (current && leaseLive(current, now) && !sameInstance(current, owner, instanceId) && !legacyUpgrade) {
      return { ok: false, reason: 'held-by-other', lease: current };
    }
    const switched = current && (current.owner !== owner || (current.instanceId && current.instanceId !== instanceId));
    const fencing = nextFencing(memoryDir, current);
    const lease = writeLeaseLocked(memoryDir, {
      owner,
      instanceId,
      pid,
      startedAt: Number(now) || Date.now(),
      heartbeatAt: Number(now) || Date.now(),
      ttlMs: Math.max(1000, Number(ttlMs) || DEFAULT_TTL_MS),
      fencing
    });
    return { ok: true, lease, tookOverFrom: switched ? current.owner : '', fencing };
  });
}

export function heartbeatLease({
  memoryDir,
  owner = 'dsmp',
  instanceId = leaseInstanceId(),
  ttlMs,
  now = Date.now()
} = {}) {
  return withLeaseLock(memoryDir, () => {
    const current = readLease(memoryDir);
    if (!current || !sameInstance(current, owner, instanceId)) {
      return { ok: false, reason: 'not-owner', lease: current };
    }
    const lease = writeLeaseLocked(memoryDir, {
      ...current,
      instanceId: current.instanceId || instanceId,
      pid: process.pid,
      heartbeatAt: Number(now) || Date.now(),
      ttlMs: Math.max(1000, Number(ttlMs) || current.ttlMs || DEFAULT_TTL_MS),
      fencing: current.fencing || 1
    });
    return { ok: true, lease };
  });
}

export function releaseLease({ memoryDir, owner = 'dsmp', instanceId = leaseInstanceId() } = {}) {
  return withLeaseLock(memoryDir, () => {
    const current = readLease(memoryDir);
    if (!current || !sameInstance(current, owner, instanceId)) {
      return { ok: false, reason: 'not-owner', lease: current };
    }
    const file = leaseFilePath(memoryDir);
    try {
      fs.unlinkSync(file);
    } catch {
      /* 已不存在也算释放 */
    }
    return { ok: true, released: true, fencing: current.fencing || 0 };
  });
}

/** 给 /status 与设置页看的摘要。 */
export function leaseSummary(memoryDir, { owner = 'dsmp', instanceId = leaseInstanceId(), now = Date.now() } = {}) {
  const lease = readLease(memoryDir);
  const live = leaseLive(lease, now);
  const mine = Boolean(lease && sameInstance(lease, owner, instanceId) && live);
  return {
    file: leaseFilePath(memoryDir),
    present: Boolean(lease),
    owner: lease?.owner || '',
    instanceId: lease?.instanceId || '',
    live,
    mine,
    ageMs: lease ? leaseAge(lease, now) : null,
    ttlMs: lease?.ttlMs || DEFAULT_TTL_MS,
    heartbeatAt: lease?.heartbeatAt || 0,
    startedAt: lease?.startedAt || 0,
    pid: lease?.pid || 0,
    fencing: lease?.fencing || 0,
    thisInstance: instanceId
  };
}
