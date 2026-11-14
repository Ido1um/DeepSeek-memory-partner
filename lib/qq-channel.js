// qq-channel.js - DSMP side of the QQ channel: gateway state, probe, switch,
// boot/halt. Pure-ish helpers (fs + child_process) so they can be unit-tested
// without a Cordis host; the HTTP routes in index.js are thin wrappers.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const ROOTS = { dsmpRoot: '' };
const GATEWAY = { api: null };
export function configureQQChannel({ dsmpRoot, gateway }) { ROOTS.dsmpRoot = dsmpRoot; GATEWAY.api = gateway || GATEWAY.api; }
export function channelRoots() {
  const root = ROOTS.dsmpRoot;
  const components = path.join(root, 'components');
  return {
    dsmpRoot: root,
    components,
    bridgeDir: path.join(components, 'DSH-QQ-bridge'),
    snowlumaDir: path.join(components, 'SnowLuma'),
    gatewayFile: GATEWAY.api.gatewayPath(root),
    bootScript: path.join(components, 'qq-boot.ps1'),
    haltScript: path.join(components, 'qq-halt.ps1'),
  };
}

function readText(file, fallback = '') { try { return fs.readFileSync(file, 'utf8').trim(); } catch { return fallback; } }
function portOf(url) { try { return new URL(url).port ? Number(new URL(url).port) : 0; } catch { return 0; } }

function bridgeToken(settings = {}) {
  const candidates = [];
  if (settings.bridge && settings.bridge.tokenFile) candidates.push(settings.bridge.tokenFile);
  const roots = channelRoots();
  candidates.push(path.join(roots.bridgeDir, 'state', 'console-token'));
  for (const f of candidates) { const t = readText(f, ''); if (t) return t; }
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(roots.bridgeDir, 'config.json'), 'utf8'));
    return String(cfg.consoleToken || '');
  } catch { return ''; }
}

export function bridgeConfig(settings = {}) {
  const roots = channelRoots();
  try { return JSON.parse(fs.readFileSync(path.join(roots.bridgeDir, 'config.json'), 'utf8')); } catch { return null; }
}

export async function bridgeStatus(settings = {}, timeoutMs = 3000) {
  const cfg = bridgeConfig(settings);
  const port = Number(cfg && cfg.consolePort) || 3100;
  const token = bridgeToken(settings);
  const out = { port, alive: false, httpStatus: 0, mode: '', role: '', dshReady: null, snowluma: null };
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/status`, { headers: token ? { 'x-console-token': token } : {}, signal: AbortSignal.timeout(timeoutMs) });
    out.httpStatus = res.status;
    if (res.ok) {
      const j = await res.json();
      out.alive = true;
      out.mode = j.mode || '';
      out.role = j.role || '';
      out.dshReady = j.dshReady ?? null;
      if (j.snowluma) out.snowluma = { connected: !!j.snowluma.connected, accountOnline: !!j.snowluma.accountOnline, good: !!j.snowluma.good, lastPacketKind: j.snowluma.lastPacketKind || '' };
    }
  } catch { }
  return out;
}

export async function gatewayStatus(settings = {}) {
  const roots = channelRoots();
  const read = GATEWAY.api.readGateway(roots.dsmpRoot);
  const gateway = read.ok ? read.gateway : { profiles: {}, active: '', current: '' };
  const bridge = await bridgeStatus(settings);
  const profiles = Object.entries(gateway.profiles || {}).map(([name, p]) => ({
    name,
    kind: p.kind || name,
    label: p.label || name,
    httpUrl: p.httpUrl || '',
    wsUrl: p.wsUrl || '',
    webuiUrl: p.webuiUrl || '',
    tokenRef: p.tokenRef || 'bridge',
    homeDir: p.homeDir || '',
    startable: !!p.startScript && fs.existsSync(p.startScript),
    stoppable: !!p.stopScript && fs.existsSync(p.stopScript),
    capabilities: p.capabilities || {},
  }));
  const active = gateway.active || '';
  const current = gateway.current || '';
  const activeProfile = profiles.find(p => p.name === active);
  return {
    ok: true,
    roots: { components: roots.components, bridgeDir: roots.bridgeDir, gatewayFile: roots.gatewayFile },
    componentsPresent: fs.existsSync(roots.bridgeDir) && fs.existsSync(roots.gatewayFile),
    active,
    current,
    gatewayError: read.ok ? '' : (read.code || 'GATEWAY_UNAVAILABLE'),
    activePort: activeProfile ? portOf(activeProfile.httpUrl) : 0,
    profiles,
    lastSwitch: gateway.lastSwitch || null,
    lastHalt: gateway.lastHalt || null,
    bridge,
    tokenSet: !!bridgeToken(settings),
  };
}

function gatewayToken(profile, settings) {
  if (profile && profile.accessToken) return String(profile.accessToken);
  if (profile && profile.tokenRef === 'bridge') {
    const cfg = bridgeConfig(settings);
    const t = cfg && cfg.snowluma && cfg.snowluma.accessToken;
    if (t) return String(t);
  }
  return '';
}

export async function probeProfile(settings, name, { timeoutMs = 5000 } = {}) {
  const roots = channelRoots();
  const read = GATEWAY.api.readGateway(roots.dsmpRoot);
  if (!read.ok) return { ok: false, name, error: read.code || 'GATEWAY_UNAVAILABLE' };
  let p;
  try { p = GATEWAY.api.profileOf(read.gateway, name); } catch (error) { return { ok: false, name, error: 'unknown profile' }; }
  // 占位 profile（例如 NapCat 未安装）没有 homeDir/启动脚本，httpUrl 往往直接沿用
  // 当前网关的端口；直接探测会拿 SnowLuma 的结果冒充它，必须拒绝。
  const active = read.gateway.profiles[read.gateway.active] || {};
  const placeholder = (!p.profile.homeDir && !p.profile.startScript && !p.profile.stopScript)
    || (!!p.profile.httpUrl && !!active.httpUrl && p.profile.httpUrl === active.httpUrl && p.profile.kind !== active.kind);
  if (placeholder) {
    return { ok: false, name, kind: p.profile.kind || name, httpUrl: p.profile.httpUrl || '', code: 'GATEWAY_NOT_INSTALLED', error: '该网关未安装', detail: null };
  }
  const token = gatewayToken(p.profile, settings) || bridgeToken(settings);
  const result = await GATEWAY.api.contract(p.profile, { token, timeoutMs });
  return { ok: !!result.ok, name, kind: p.profile.kind || name, httpUrl: p.profile.httpUrl || '', detail: result };
}

export function setActive(settings, name) {
  const roots = channelRoots();
  const read = GATEWAY.api.readGateway(roots.dsmpRoot);
  if (!read.ok) return { ok: false, error: read.code || 'GATEWAY_UNAVAILABLE' };
  const gateway = read.gateway;
  try { GATEWAY.api.profileOf(gateway, name); } catch { return { ok: false, error: `unknown profile: ${name}` }; }
  gateway.active = name;
  GATEWAY.api.writeGateway(roots.dsmpRoot, gateway);
  return { ok: true, active: name, current: gateway.current || '', note: 'active is desired state; run boot to switch' };
}

function powershell() {
  const pwsh7 = 'C:\\Program Files\\PowerShell\\7\\pwsh.exe';
  return fs.existsSync(pwsh7) ? pwsh7 : path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

function runToCompletion(script, args, logFile) {
  const roots = channelRoots();
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const fd = fs.openSync(logFile, 'a');
  try {
    const child = spawn(powershell(), ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, ...args], {
      cwd: roots.components, stdio: ['ignore', fd, fd], windowsHide: true,
    });
    return new Promise((resolve) => {
      child.on('error', (error) => resolve({ ok: false, pid: child.pid, logFile, error: String(error.message) }));
      child.on('close', (code) => resolve({ ok: code === 0, code, pid: child.pid, logFile }));
    });
  } finally {
    fs.closeSync(fd);
  }
}

async function waitFor(fn, { timeoutMs = 180000, intervalMs = 1000 } = {}) {
  const start = Date.now();
  let last = null;
  while (Date.now() - start < timeoutMs) {
    try { last = await fn(); if (last && last.ok) return { ok: true, waitedMs: Date.now() - start, state: last }; } catch { }
    await new Promise(r => setTimeout(r, intervalMs));
  }
  return { ok: false, waitedMs: Date.now() - start, state: last };
}

export async function bootGateway(settings, { to, timeoutMs = 180000 } = {}) {
  const roots = channelRoots();
  if (!fs.existsSync(roots.bootScript)) return { ok: false, error: 'qq-boot.ps1 missing' };
  const args = ['-Root', roots.dsmpRoot];
  if (to) args.push('-To', to);
  const logFile = path.join(roots.dsmpRoot, 'logs', `qq-boot-${Date.now()}.log`);
  const spawned = await runToCompletion(roots.bootScript, args, logFile);
  const result = await waitFor(async () => {
    const read = GATEWAY.api.readGateway(roots.dsmpRoot);
    const gw = read.ok ? read.gateway : { active: '', current: '' };
    const want = to || gw.active;
    const bridge = await bridgeStatus(settings);
    if (gw.current === want && bridge.alive && bridge.httpStatus === 200) return { ok: true, gateway: gw.current, bridge };
    return { ok: false, gateway: gw.current };
  }, { timeoutMs: Math.max(15000, Math.min(timeoutMs, 30000)) });
  const tail = readText(logFile, '').split(/\r?\n/).slice(-12).join('\n');
  return { ok: result.ok, scriptOk: spawned.ok, scriptCode: spawned.code, waitedMs: result.waitedMs, to: to || '', logFile, tail, state: result.state || null, pid: spawned.pid };
}

export async function haltGateway(settings, { timeoutMs = 60000 } = {}) {
  const roots = channelRoots();
  if (!fs.existsSync(roots.haltScript)) return { ok: false, error: 'qq-halt.ps1 missing' };
  const logFile = path.join(roots.dsmpRoot, 'logs', `qq-halt-${Date.now()}.log`);
  const spawned = await runToCompletion(roots.haltScript, ['-Root', roots.dsmpRoot], logFile);
  const result = await waitFor(async () => {
    const bridge = await bridgeStatus(settings, 1000);
    if (!bridge.alive) return { ok: true, bridge };
    return { ok: false };
  }, { timeoutMs });
  const tail = readText(logFile, '').split(/\r?\n/).slice(-12).join('\n');
  return { ok: result.ok, scriptOk: spawned.ok, scriptCode: spawned.code, waitedMs: result.waitedMs, logFile, tail, pid: spawned.pid };
}
