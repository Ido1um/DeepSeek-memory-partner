import path from 'node:path';
import { pathToFileURL } from 'node:url';
import crypto from 'node:crypto';

/**
 * M6：DSMP 作为记忆主写者时的窗口记账。
 *
 * 只做「bridge 转发过来的那一轮」的账本写入：begin → noteSpoken（可多次）→ finish。
 * 真正的写入函数来自 vendor/memory/src/window.mjs（与桥接同一套），
 * 但**是否允许写**由宿主注入的 allowed() 决定（租约 + settings.memory.owner）。
 */

let VENDOR_SRC = '';
let allowed = () => false;
let guardToken = () => '';
let writeDir = '';
const cache = new Map();
// 本进程内已经开过的轮次。bridge 也会观察 session/event 并在回合结束时调
// finish-turn；面板直连的轮次它没有 begin 过，若照单全收就会多写一条空轮，
// 所以没有 open 记录的 finish 一律拒绝。
const openTurns = new Map();
const stats = { begun: 0, finished: 0, spoken: 0, skipped: 0, errors: 0, lastAt: 0, lastError: '' };

/**
 * A panel message reaches the bridge wrapped in instructions. The ledger must
 * keep what the owner actually typed, otherwise every later recall/injection
 * reads back the wrapper as if he had said it.
 */
export function ownerTextOf(promptText) {
  const raw = String(promptText || '');
  const mark = '【面板消息】';
  const at = raw.lastIndexOf(mark);
  if (at >= 0) return raw.slice(at + mark.length).trim();
  return raw.trim();
}

function vendorUrl(name) {
  if (VENDOR_SRC) return pathToFileURL(path.join(VENDOR_SRC, name)).href;
  return new URL(`../vendor/memory/src/${name}`, import.meta.url).href;
}

async function vendor(name) {
  if (!cache.has(name)) cache.set(name, await import(vendorUrl(name)));
  return cache.get(name);
}

export function configureMemoryWriter({ vendorDir, allowed: isAllowed, dir, guard } = {}) {
  if (vendorDir) VENDOR_SRC = String(vendorDir);
  if (typeof isAllowed === 'function') allowed = isAllowed;
  if (typeof guard === 'function') guardToken = guard;
  if (dir !== undefined) writeDir = String(dir || '');
}

function currentRoot() {
  if (!writeDir) return '';
  const resolved = path.resolve(writeDir);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}
function stillCurrent(opened) {
  return opened && openTurns.get(opened.sessionKey) === opened && opened.root === currentRoot() && opened.guard === guardToken() && allowed();
}
async function retireLost(sessionKey, opened) {
  const win = await vendor('window.mjs');
  if (openTurns.get(sessionKey) === opened) {
    openTurns.delete(sessionKey);
    if (win.getDraft(sessionKey)?.turnId === opened.fingerprint) win.dropTurn(sessionKey);
  }
  return leaseLost();
}
function sourceOf(payload) { return String(payload.source || 'bridge'); }
function conflict() { return { ok: false, code: 'DSMP_TURN_IN_PROGRESS', error: '此会话已有未结束轮次，请等待收尾' }; }

function leaseLost() {
  stats.skipped += 1;
  return { ok: false, skipped: 'lease-lost', code: 'DSMP_LEASE_LOST', error: '写租约代次已变化，本轮写入被拒绝' };
}

export function memoryWriterStats() {
  return { ...stats, writer: allowed() };
}

function targetDir(_payload) {
  // 目录只认宿主配置：payload.dir 来自 HTTP 入参，放它直通等于给了任意目录写权限。
  return String(writeDir || '');
}

function fail(err) {
  stats.errors += 1;
  stats.lastError = String(err?.message || err || '');
  return { ok: false, error: stats.lastError, code: 'DSMP_WRITER_FAILED' };
}

export async function beginTurn(payload = {}) {
  if (!allowed()) {
    stats.skipped += 1;
    return { ok: false, skipped: 'not-writer', code: 'DSMP_NOT_WRITER' };
  }
  // F06：把当前租约代次钉在这一轮上，写入口在每次落盘前复核；换写者/恢复/换树后旧任务不能继续写。
  const token = guardToken();
  const sessionKey = String(payload.sessionId || '');
  if (!sessionKey) return { ok: false, code: 'DSMP_NO_SESSION', error: '缺少 sessionId' };
  const source = sourceOf(payload);
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify({ ...payload, source })).digest('hex');
  const prior = openTurns.get(sessionKey);
  if (prior) {
    if (!stillCurrent(prior)) return retireLost(sessionKey, prior);
    if (prior.pending) return conflict();
    const win = await vendor('window.mjs');
    if (openTurns.get(sessionKey) !== prior) return conflict();
    if (!win.getDraft(sessionKey)) {
      openTurns.delete(sessionKey);
    } else {
      if (prior.source !== source || prior.fingerprint !== fingerprint) return conflict();
      return { ok: true, sessionId: sessionKey, hasDraft: true, duplicate: true, at: prior.at };
    }
  }
  const opened = { sessionKey, at: Date.now(), source, fingerprint, guard: token, root: currentRoot(), pending: true };
  openTurns.set(sessionKey, opened);
  try {
    const win = await vendor('window.mjs');
    if (!stillCurrent(opened)) return retireLost(sessionKey, opened);
    const draft = win.beginTurn({
      source,
      turnId: fingerprint,
      key: String(payload.key || ''),
      sessionId: String(payload.sessionId || ''),
      userRaw: ownerTextOf(payload.userRaw || payload.promptText || ''),
      msgIds: Array.isArray(payload.msgIds) ? payload.msgIds : [],
      windowText: ownerTextOf(payload.windowText || payload.userRaw || ''),
      blocks: Array.isArray(payload.blocks) ? payload.blocks : [],
      media: Array.isArray(payload.media) ? payload.media : [],
      model: String(payload.model || ''),
      mode: String(payload.mode || ''),
      at: payload.at || Date.now()
    });
    stats.begun += 1;
    stats.lastAt = Date.now();
    opened.pending = false;
    opened.at = draft?.at || opened.at;
    return { ok: true, sessionId: String(payload.sessionId || ''), hasDraft: Boolean(draft), at: draft?.at || 0 };
  } catch (err) {
    if (openTurns.get(sessionKey) === opened) openTurns.delete(sessionKey);
    if (err.code === 'DSMP_TURN_IN_PROGRESS') return conflict();
    return fail(err);
  }
}

export async function noteSpoken(payload = {}) {
  if (!allowed()) {
    stats.skipped += 1;
    return { ok: false, skipped: 'not-writer', code: 'DSMP_NOT_WRITER' };
  }
  const opened = openTurns.get(String(payload.sessionId || ''));
  if (!opened) return { ok: false, code: 'DSMP_NO_DRAFT', skipped: 'no-draft' };
  if (opened.source !== sourceOf(payload)) return { ok: false, code: 'DSMP_NO_DRAFT', skipped: 'other-driver' };
  if (!stillCurrent(opened)) return retireLost(opened.sessionKey, opened);
  try {
    const win = await vendor('window.mjs');
    if (!stillCurrent(opened)) return retireLost(opened.sessionKey, opened);
    const ok = win.noteSpoken({
      key: String(payload.key || ''),
      sessionId: String(payload.sessionId || ''),
      tool: String(payload.tool || ''),
      text: String(payload.text || ''),
      feels: Array.isArray(payload.feels) ? payload.feels : []
    });
    if (ok) stats.spoken += 1;
    return { ok: Boolean(ok) };
  } catch (err) {
    return fail(err);
  }
}

export async function finishTurn(payload = {}) {
  if (!allowed()) {
    stats.skipped += 1;
    return { ok: false, skipped: 'not-writer', code: 'DSMP_NOT_WRITER' };
  }
  const sessionKey = String(payload.sessionId || '');
  const opened = openTurns.get(sessionKey);
  if (!opened) {
    stats.skipped += 1;
    return { ok: false, skipped: 'no-draft', code: 'DSMP_NO_DRAFT' };
  }
  // 同一个会话可能有两个驱动者：面板直连（DSMP）和 QQ（bridge 转发）。
  // 谁的 begin 谁收尾；另一边来收尾必须拒绝，否则会多写一条空 user 的轮次。
  if (opened.source !== sourceOf(payload)) {
    stats.skipped += 1;
    return { ok: false, skipped: 'other-driver', code: 'DSMP_NO_DRAFT' };
  }
  if (!stillCurrent(opened)) return retireLost(sessionKey, opened);
  const dir = targetDir(payload);
  if (!dir) return { ok: false, code: 'DSMP_WRITER_NO_DIR', error: '没有写入目录' };
  try {
    const win = await vendor('window.mjs');
    if (!stillCurrent(opened) || dir !== targetDir(payload)) return retireLost(sessionKey, opened);
    const res = win.finishTurn({
      dir,
      key: String(payload.key || ''),
      sessionId: String(payload.sessionId || ''),
      reply: String(payload.reply || ''),
      reason: String(payload.reason || ''),
      pressureTokens: Number(payload.pressureTokens) || 0,
      contextWindow: Number(payload.contextWindow) || 0,
      elapsedMs: Number(payload.elapsedMs) || 0,
      incomplete: payload.incomplete === true,
      model: String(payload.model || ''),
      mode: String(payload.mode || '')
    });
    openTurns.delete(sessionKey);
    stats.finished += 1;
    stats.lastAt = Date.now();
    return { ok: true, turn: res };
  } catch (err) {
    return fail(err);
  }
}

/** 面板/设置页要知道「现在是不是我在写」。 */
export async function writerStatus() {
  return {
    writer: allowed(),
    dir: writeDir,
    stats: memoryWriterStats()
  };
}
