import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * M6：DSMP 作为记忆主写者时的窗口记账。
 *
 * 只做「bridge 转发过来的那一轮」的账本写入：begin → noteSpoken（可多次）→ finish。
 * 真正的写入函数来自 vendor/memory/src/window.mjs（与桥接同一套），
 * 但**是否允许写**由宿主注入的 allowed() 决定（租约 + settings.memory.owner）。
 */

let VENDOR_SRC = '';
let allowed = () => false;
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

export function configureMemoryWriter({ vendorDir, allowed: isAllowed, dir } = {}) {
  if (vendorDir) VENDOR_SRC = String(vendorDir);
  if (typeof isAllowed === 'function') allowed = isAllowed;
  if (dir) writeDir = String(dir);
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
  try {
    const win = await vendor('window.mjs');
    const draft = win.beginTurn({
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
    openTurns.set(String(payload.sessionId || ''), { at: Date.now(), source: String(payload.source || '') });
    return { ok: true, sessionId: String(payload.sessionId || ''), hasDraft: Boolean(draft), at: draft?.at || 0 };
  } catch (err) {
    return fail(err);
  }
}

export async function noteSpoken(payload = {}) {
  if (!allowed()) {
    stats.skipped += 1;
    return { ok: false, skipped: 'not-writer', code: 'DSMP_NOT_WRITER' };
  }
  try {
    const win = await vendor('window.mjs');
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
  if (opened.source && payload.source && opened.source !== payload.source) {
    stats.skipped += 1;
    return { ok: false, skipped: 'other-driver', code: 'DSMP_NO_DRAFT' };
  }
  const dir = targetDir(payload);
  if (!dir) return { ok: false, code: 'DSMP_WRITER_NO_DIR', error: '没有写入目录' };
  try {
    const win = await vendor('window.mjs');
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
