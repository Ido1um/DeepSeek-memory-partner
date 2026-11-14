import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';

/**
 * TCP probe, duplicated from probe.js on purpose: this module is loaded through
 * the dev-reload data-URL loader, where relative imports cannot be resolved.
 */
function probePort(host, port, timeoutMs = 500) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const finish = (state) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(state);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish('open'));
    socket.once('timeout', () => finish('timeout'));
    socket.once('error', (err) => {
      const code = err && err.code;
      if (code === 'ECONNREFUSED') finish('refused');
      else if (code === 'ETIMEDOUT') finish('timeout');
      else finish('blocked');
    });
    try {
      socket.connect(port, host);
    } catch {
      finish('blocked');
    }
  });
}

/**
 * Local service control for the panel.
 *
 * Everything here is "start/stop a script that already exists". No service is
 * modified, and the scripts themselves are idempotent (they print "already
 * running" and exit) — the panel only decides which one to call.
 */

export const SERVICE_DEFS = [
  {
    name: 'qq',
    label: 'QQ 机器人',
    hint: 'SnowLuma + qq-bridge',
    port: 3100,
    start: 'start-bot.cmd',
    stop: 'stop-bot.cmd',
    kind: 'bot'
  },
  {
    name: 'draw',
    label: 'ComfyUI',
    hint: 'ComfyUI API · 8188',
    port: 8188,
    start: path.join('scripts', 'start-comfy-api.cmd'),
    stop: path.join('scripts', 'stop-comfy-api.cmd'),
    kind: 'engine'
  },
  {
    name: 'tts',
    label: 'GPT-SoVITS',
    hint: '语音合成 API · 9880',
    port: 9880,
    start: path.join('scripts', 'start-tts-api.cmd'),
    stop: path.join('scripts', 'stop-tts-api.cmd'),
    kind: 'engine'
  },
  {
    name: 'workbench',
    label: '记忆工作台',
    hint: '完整前端 · 7351',
    port: 7351,
    start: path.join('workbench', 'start.cmd'),
    stop: path.join('workbench', 'stop.cmd'),
    kind: 'tool',
    root: 'plugin'
  }
];

let PLUGIN_ROOT = '';
/** index.js passes its own root: this module has no reliable import.meta.url under the data: loader. */
export function configureServices({ pluginRoot }) {
  PLUGIN_ROOT = String(pluginRoot || '');
}

const startedAt = new Map();
const lastAction = new Map();

function bridgeRoot(settings) {
  const bridge = (settings && settings.bridge) || {};
  if (bridge.dir) return String(bridge.dir);
  if (bridge.tokenFile) return path.dirname(path.dirname(String(bridge.tokenFile)));
  return '';
}

function defOf(name) {
  return SERVICE_DEFS.find((item) => item.name === name) || null;
}

function scriptPath(settings, service, which) {
  const rel = String(service[which] || '');
  if (path.isAbsolute(rel)) return rel;
  const root = service.root === 'plugin' ? PLUGIN_ROOT : bridgeRoot(settings);
  if (!root) return '';
  return path.join(root, rel);
}

/** dsmpHome() is inlined: this module is loaded through the data-URL loader. */
function logDir() {
  const home = process.env.DSH_HOME || path.join(process.env.USERPROFILE || '.', '.dsh');
  const dir = path.join(home, 'dsmp', 'logs');
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    /* best effort */
  }
  return dir;
}

/**
 * The scripts call `powershell` a lot, and they must keep working when the
 * panel spawns them from the Electron host, whose environment block can be an
 * older snapshot than the user's shell. So: absolute cmd.exe, an explicit PATH
 * with both the legacy and the PowerShell 7 folders, and output written to a
 * file (the sandbox forbids piped stdio, and swallowing it hid real errors).
 */
function spawnEnv() {
  const sysroot = process.env.SystemRoot || 'C:\\Windows';
  const extra = [
    'C:\\Program Files\\PowerShell\\7',
    path.join(sysroot, 'System32', 'WindowsPowerShell', 'v1.0'),
    path.join(sysroot, 'System32'),
    sysroot
  ];
  const current = String(process.env.PATH || '');
  const seen = new Set();
  const parts = [];
  for (const item of [...extra, ...current.split(';')]) {
    const trimmed = String(item || '').trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    parts.push(trimmed);
  }
  return { ...process.env, PATH: parts.join(';'), PATHEXT: process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD', DSMP_NODE: process.execPath };
}

function tailOf(file, maxChars = 4000) {
  try {
    const stat = fs.statSync(file);
    const size = Math.min(stat.size, maxChars);
    const fd = fs.openSync(file, 'r');
    const buffer = Buffer.alloc(size);
    fs.readSync(fd, buffer, 0, size, stat.size - size);
    fs.closeSync(fd);
    return buffer.toString('utf8');
  } catch {
    return '';
  }
}

/** cmd.exe /c <script>; stdout+stderr go to <DSH_HOME>/dsmp/logs/service-<name>.log. */
function runScript(target, cwd, name, options = {}) {
  const wait = Boolean(options.wait);
  const timeoutMs = Number(options.timeoutMs) || 120000;
  return new Promise((resolve) => {
    const logFile = path.join(logDir(), `service-${name || 'unknown'}.log`);
    let fd;
    try {
      fd = fs.openSync(logFile, 'a');
      fs.writeSync(fd, `\n===== ${new Date().toISOString()} ${target} =====\n`);
    } catch (err) {
      resolve({ ok: false, error: `无法写入日志：${String((err && err.message) || err)}` });
      return;
    }
    const cmd = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'cmd.exe');
    let child;
    try {
      child = spawn(cmd, ['/c', target], {
        cwd,
        env: { ...spawnEnv(), DSMP_HEADLESS: '1' },
        // Never detach: DETACHED_PROCESS gives the child a brand-new console, and
        // every `powershell` the scripts start then flashes its own window. A
        // non-detached spawn with windowsHide uses CREATE_NO_WINDOW, so the whole
        // process tree shares one invisible console.
        detached: false,
        stdio: ['ignore', fd, fd],
        windowsHide: true
      });
    } catch (err) {
      try { fs.closeSync(fd); } catch {}
      resolve({ ok: false, error: String((err && err.message) || err), log: logFile });
      return;
    }
    let settled = false;
    const finish = (payload) => {
      if (settled) return;
      settled = true;
      try { fs.closeSync(fd); } catch {}
      resolve({ log: logFile, ...payload });
    };
    child.on('error', (err) => {
      finish({ ok: false, error: `无法启动 cmd.exe：${String((err && err.message) || err)}`, tail: tailOf(logFile) });
    });
    child.on('exit', (code) => {
      finish(code === 0
        ? { ok: true, code: 0, finished: true, pid: child.pid }
        : { ok: false, code, error: `脚本退出码 ${code}`, tail: tailOf(logFile), finished: true });
    });
    if (wait) {
      // stop-* scripts keep working for several seconds after the port closes;
      // returning early lets a following "start" race with them.
      setTimeout(() => {
        finish({ ok: false, error: `脚本超过 ${Math.round(timeoutMs / 1000)} 秒未退出`, tail: tailOf(logFile) });
      }, timeoutMs).unref();
      return;
    }
    child.unref();
    setTimeout(() => {
      finish({ ok: true, pid: child.pid });
    }, 700);
  });
}

function waitPort(port, wantOpen, timeoutMs, stepMs = 500) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const tick = async () => {
      const state = await probePort('127.0.0.1', port, 350);
      if ((state === 'open') === wantOpen) {
        resolve(true);
        return;
      }
      if (Date.now() >= deadline) {
        resolve(false);
        return;
      }
      setTimeout(tick, stepMs);
    };
    tick();
  });
}

function pidAlive(pid) {
  if (!pid || !Number.isFinite(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return Boolean(err && err.code === 'EPERM');
  }
}

function killPid(pid) {
  if (!pidAlive(pid)) return false;
  try {
    process.kill(pid, 'SIGKILL');
    return true;
  } catch {
    return false;
  }
}

/**
 * bridge.lock holds the pid that owns the bridge. If that pid is alive while 3100
 * is closed (a half-dead bridge, or one left over from a previous run), the next
 * start refuses with "已有实例在运行" and nothing listens — which is exactly how
 * "启动没成功" looked. Clear it explicitly.
 */
function clearStaleLock(root) {
  const lockFile = path.join(root, 'state', 'bridge.lock');
  if (!fs.existsSync(lockFile)) return { cleared: false };
  const raw = String(fs.readFileSync(lockFile, 'utf8') || '').trim();
  const pid = Number((raw.match(/\d+/) || [])[0] || 0);
  killPid(pid);
  try {
    fs.rmSync(lockFile, { force: true });
  } catch {
    /* best effort */
  }
  return { cleared: true, pid };
}

export function readServiceLog(name, maxChars = 20000) {
  const file = path.join(logDir(), `service-${name}.log`);
  if (!fs.existsSync(file)) return { ok: true, file, text: '', exists: false };
  return { ok: true, file, exists: true, text: tailOf(file, maxChars) };
}

export async function serviceList(settings) {
  const root = bridgeRoot(settings);
  const rows = [];
  for (const service of SERVICE_DEFS) {
    const tcp = await probePort('127.0.0.1', service.port, 350);
    const start = scriptPath(settings, service, 'start');
    rows.push({
      name: service.name,
      label: service.label,
      hint: service.hint,
      port: service.port,
      kind: service.kind,
      root,
      running: tcp === 'open',
      tcp,
      scriptExists: Boolean(start) && fs.existsSync(start),
      startScript: start,
      log: path.join(logDir(), `service-${service.name}.log`),
      startedAt: startedAt.get(service.name) || 0,
      lastAction: lastAction.get(service.name) || 0
    });
  }
  return { ok: true, root, services: rows, idleStopMs: idleStopMsOf(settings), at: Date.now() };
}

function idleStopMsOf(settings) {
  const raw = Number((settings && settings.services && settings.services.idleStopMs) || 0);
  if (Number.isFinite(raw) && raw >= 60000) return Math.min(raw, 24 * 3600 * 1000);
  return 600000;
}

export async function startService(settings, name) {
  const service = defOf(name);
  if (!service) return { ok: false, error: `未知服务：${name}` };
  const script = scriptPath(settings, service, 'start');
  const root = service.root === 'plugin' ? PLUGIN_ROOT : bridgeRoot(settings);
  if (!script) return { ok: false, error: '没有配置启动脚本' };
  if (!fs.existsSync(script)) return { ok: false, error: `启动脚本不存在：${script}` };
  if (name === 'qq') {
    const port = await probePort('127.0.0.1', 3100, 350);
    if (port === 'open') return { ok: true, already: true, note: 'qq-bridge 已在监听 3100' };
    clearStaleLock(root);
  }
  const run = await runScript(script, root || path.dirname(script), name);
  if (!run.ok) return { ...run, script };
  startedAt.set(name, Date.now());
  lastAction.set(name, Date.now());
  // The scripts start things in their own windows; report what actually happened
  // instead of "命令已发送" (which made a silent failure look like success).
  const up = await waitPort(service.port, true, name === 'qq' ? 90000 : name === 'workbench' ? 20000 : name === 'draw' ? 120000 : 60000);
  if (!up) {
    return {
      ok: false,
      script,
      log: run.log,
      error: `${service.label} 启动后 ${service.port} 仍未监听`,
      tail: tailOf(run.log || '', 4000)
    };
  }
  return { ok: true, started: true, running: true, pid: run.pid, script, log: run.log };
}

export async function stopService(settings, name) {
  const service = defOf(name);
  if (!service) return { ok: false, error: `未知服务：${name}` };
  const script = scriptPath(settings, service, 'stop');
  const root = service.root === 'plugin' ? PLUGIN_ROOT : bridgeRoot(settings);
  if (!script) return { ok: false, error: '没有配置停止脚本' };
  if (!fs.existsSync(script)) return { ok: false, error: `停止脚本不存在：${script}` };
  const run = await runScript(script, root || path.dirname(script), name, { wait: true, timeoutMs: 120000 });
  startedAt.delete(name);
  lastAction.set(name, Date.now());
  if (!run.ok) return { ...run, script };
  const closed = await waitPort(service.port, false, name === 'qq' ? 20000 : name === 'workbench' ? 15000 : 15000);
  if (!closed) {
    return {
      ok: false,
      script,
      log: run.log,
      error: `${service.label} 仍在监听 ${service.port}`,
      tail: tailOf(run.log || '', 4000)
    };
  }
  return { ok: true, stopped: true, running: false, script, log: run.log };
}

export function touchService(name) {
  lastAction.set(name, Date.now());
}

/**
 * Fallback idle shutdown. The bridge already stops its engines ten minutes
 * after the last generation / TTS request; this only covers engines the panel
 * started while the bridge is down (nobody can use them, so they would
 * otherwise stay up forever).
 */
export function startIdleWatch({ settings, bridgeUp, logger }) {
  const timer = setInterval(async () => {
    try {
      const current = typeof settings === 'function' ? settings() : settings;
      const limit = idleStopMsOf(current);
      const up = typeof bridgeUp === 'function' ? await bridgeUp() : Boolean(bridgeUp);
      if (up) return; // the bridge owns engine lifecycle
      for (const service of SERVICE_DEFS) {
        if (service.kind !== 'engine') continue;
        const started = startedAt.get(service.name) || 0;
        if (!started) continue;
        if (Date.now() - started < limit) continue;
        const tcp = await probePort('127.0.0.1', service.port, 350);
        if (tcp !== 'open') {
          startedAt.delete(service.name);
          continue;
        }
        await stopService(current, service.name);
        if (logger) logger(`空闲 ${Math.round(limit / 60000)} 分钟，已关闭 ${service.label}`);
      }
    } catch {
      /* the watch must never throw into the host timer */
    }
  }, 60 * 1000);
  if (typeof timer.unref === 'function') timer.unref();
  return () => clearInterval(timer);
}
