// 记忆日终引擎（A2）：DSMP 成为写者后，窗口账本之外的日终派生
// （情境段 / 条目抽取 / 归档 / 轮转 / 到期提醒）也必须有人跑。
//
// 设计要点：
// 1. 不用 engine.startMaintenance() 的自带定时器——那是 bridge 的用法。DSMP 自己
//    按 60s 巡检，每次 tick 前先确认租约仍在本地，丢租约就停手（绝不双跑）。
// 2. 不新增任何数据目录：一律写 memoryWriteDir(settings)，与账本/卡同源。
// 3. 模块内不写相对 import（data: URL 热重载下会 ERR_INVALID_URL），
//    需要什么由 configureMemoryEngine 注入。

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const CHECK_MS = 60000;
const FIRST_DELAY_MS = 15000;

const CONFIG = {
  vendorDir: '',
  dir: '',
  getSettings: () => ({}),
  canWrite: () => false,
  getOwnerKey: () => '',
  getSessionId: () => '',
  isBusy: () => false,
  createEngine: null,
  logger: () => {}
};

let engine = null;
let engineDir = '';
let timer = null;
let started = false;
let ticking = false;
const stats = {
  startedAt: 0,
  ticks: 0,
  dailyRuns: 0,
  skipped: '',
  lastTickAt: 0,
  lastTickOk: null,
  lastError: '',
  lastResult: null,
  lastDailyAt: 0
};

const MODULE_CACHE = new Map();

function log(...args) {
  try {
    CONFIG.logger(...args);
  } catch {
    /* 日志失败不影响调度 */
  }
}

function vendorUrl(name) {
  if (!CONFIG.vendorDir) throw new Error('memory-engine: vendorDir 未配置');
  const file = path.join(CONFIG.vendorDir, name);
  const base = pathToFileURL(file).href;
  // Cache-bust by mtime: a bundle off/on reloads this file, but Node would keep
  // the previously imported engine modules cached otherwise.
  try {
    return `${base}?v=${fs.statSync(file).mtimeMs}`;
  } catch {
    return base;
  }
}

async function vendorModule(name) {
  if (MODULE_CACHE.has(name)) return MODULE_CACHE.get(name);
  const mod = await import(vendorUrl(name));
  MODULE_CACHE.set(name, mod);
  return mod;
}

function settingsNow() {
  try {
    return CONFIG.getSettings() || {};
  } catch {
    return {};
  }
}

/**
 * 给引擎的配置视图。
 * 轮转只能由 bridge 执行（退役旧 DSH 会话、下一次消息建新会话）；DSMP 侧把
 * minRotateTokens 抬到引擎允许的上限（5,000,000，远大于 1M 窗口的 70% 阈值），
 * tick 里的 rotate() 永远不会 due，避免「记忆侧转了、DSH 会话没换」。
 */
function engineConfig(dir) {
  const memory = settingsNow().memory || {};
  const rotation = memory.rotation && typeof memory.rotation === 'object' ? memory.rotation : {};
  return { ...memory, dir, rotation: { ...rotation, minRotateTokens: 5000000 } };
}

function writerOn() {
  try {
    const settings = settingsNow();
    const owner = String((settings.memory && settings.memory.owner) || 'bridge');
    if (owner !== 'dsmp') return false;
    return CONFIG.canWrite() === true;
  } catch (error) {
    log('租约检查失败：', error && error.message ? error.message : error);
    return false;
  }
}

/** 只读状态，给 /api/dsmp/status 与设置页用。 */
export function engineStatus() {
  const settings = settingsNow();
  return {
    running: started && Boolean(timer),
    writable: writerOn(),
    dir: engineDir || CONFIG.dir || '',
    owner: String((settings.memory && settings.memory.owner) || 'bridge'),
    checkMs: CHECK_MS,
    startedAt: stats.startedAt || null,
    ticks: stats.ticks,
    dailyRuns: stats.dailyRuns,
    lastTickAt: stats.lastTickAt || null,
    lastTickOk: stats.lastTickOk,
    lastError: stats.lastError || '',
    lastDailyAt: stats.lastDailyAt || null,
    skipped: stats.skipped || ''
  };
}

/** index.js 在设置变更/目录变更后调用；dir 变化会丢弃旧 engine。 */
export function configureMemoryEngine(patch = {}) {
  const nextDir = typeof patch.dir === 'string' ? patch.dir : CONFIG.dir;
  Object.assign(CONFIG, patch, { dir: nextDir });
  if (engine && nextDir !== engineDir) {
    engine = null;
    engineDir = '';
    log(`记忆引擎目录变化，已丢弃旧实例：${nextDir}`);
  }
}

async function makeEngine() {
  if (CONFIG.createEngine) {
    engine = await CONFIG.createEngine({
      dir: CONFIG.dir,
      getConfig: () => engineConfig(CONFIG.dir),
      log
    });
    engineDir = CONFIG.dir;
    return engine;
  }
  const { createMemoryEngine } = await vendorModule('engine.mjs');
  const settings = settingsNow();
  const dir = CONFIG.dir;
  const ownerKey = CONFIG.getOwnerKey() || '';
  engine = createMemoryEngine({
    getConfig: () => engineConfig(dir),
    host: {
      log: (...args) => log(...args),
      listSessions: () => (ownerKey ? [ownerKey] : []),
      getSessionId: (key) => (key === ownerKey ? CONFIG.getSessionId() || '' : ''),
      retireSession: (key) => log(`记忆引擎请求退役会话 ${key}（面板侧只记录）`),
      isBusy: (key) => Boolean(CONFIG.isBusy(key)),
      isDshReady: () => true,
      getOwnerKey: () => ownerKey,
      pressureTokens: () => 0,
      afterRotate: (key) => log(`记忆引擎轮转完成：${key}`)
    },
    onReminders: (list) => {
      const count = Array.isArray(list) ? list.length : 0;
      if (count) log(`记忆引擎到期提醒 ${count} 条（面板不发 QQ，交由 bridge/下次对话处理）`);
    }
  });
  engineDir = dir;
  log(`记忆引擎已创建：${dir}`);
  return engine;
}

/**
 * 单次巡检。tick 内部会自己判断「今天是否已做日终」，所以 60s 一次不会重复跑日终。
 * 返回 {ok, skipped} 或 {ok:true, result}。
 */
export async function tickNow({ force = false } = {}) {
  if (!writerOn()) {
    stats.skipped = 'not-writer';
    return { ok: false, skipped: 'not-writer' };
  }
  if (ticking) {
    stats.skipped = 'busy';
    return { ok: false, skipped: 'busy' };
  }
  ticking = true;
  stats.lastTickAt = Date.now();
  try {
    // 把 store 的默认目录钉到 CONFIG.dir：引擎内部有一部分逻辑不走 dataDir()，
    // 只按 config/env 解析目录；不绑定就会出现「租约查 A、归档写 B」的双根。
    // 测试注入 createEngine 时 vendor 目录可能不存在，绑定失败不影响巡检。
    if (!CONFIG.createEngine) {
      try {
        const storeMod = await vendorModule('store.mjs');
        if (storeMod && typeof storeMod.setActiveDir === 'function') storeMod.setActiveDir(CONFIG.dir);
      } catch {
        /* vendor 未就绪时保持原解析顺序 */
      }
    }
    const instance = engine && engineDir === CONFIG.dir ? engine : await makeEngine();
    const result = force && typeof instance.runDailyMaintenance === 'function'
      ? await instance.runDailyMaintenance(Date.now(), { force: true })
      : await instance.tick(Date.now());
    stats.ticks += 1;
    if (force) {
      stats.dailyRuns += 1;
      stats.lastDailyAt = Date.now();
    }
    stats.lastTickOk = true;
    stats.lastResult = result ?? null;
    stats.lastError = '';
    stats.skipped = '';
    return { ok: true, forced: Boolean(force), result: result ?? null };
  } catch (error) {
    stats.lastTickOk = false;
    stats.lastError = String((error && error.message) || error);
    log('记忆引擎巡检失败：', stats.lastError);
    return { ok: false, error: stats.lastError };
  } finally {
    ticking = false;
  }
}

/** 启动巡检；重复调用是幂等的。 */
export function startEngine() {
  if (started && timer) return engineStatus();
  started = true;
  stats.startedAt = stats.startedAt || Date.now();
  const loop = () => {
    void tickNow().catch(() => {});
  };
  const first = setTimeout(loop, FIRST_DELAY_MS);
  first.unref?.();
  timer = setInterval(loop, CHECK_MS);
  timer.unref?.();
  log(`记忆引擎巡检已启动（首跑 ${FIRST_DELAY_MS}ms，周期 ${CHECK_MS}ms）`);
  return engineStatus();
}

export function stopEngine() {
  if (timer) clearInterval(timer);
  timer = null;
  started = false;
  return engineStatus();
}

/** 测试用：清掉模块内状态，避免用例互相污染。 */
export function resetMemoryEngine() {
  stopEngine();
  engine = null;
  engineDir = '';
  stats.startedAt = 0;
  stats.ticks = 0;
  stats.dailyRuns = 0;
  stats.skipped = '';
  stats.lastTickAt = 0;
  stats.lastTickOk = null;
  stats.lastError = '';
  stats.lastResult = null;
  stats.lastDailyAt = 0;
  MODULE_CACHE.clear();
}

export const ENGINE_CHECK_MS = CHECK_MS;
