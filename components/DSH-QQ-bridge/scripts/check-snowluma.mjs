#!/usr/bin/env node
/**
 * 开机自检：SnowLuma 注入 / OneBot / 桥接上游，一行一结论。
 *
 *   node scripts/check-snowluma.mjs            # 给人手动跑：缺东西退出码 1、连不上 2
 *   node scripts/check-snowluma.mjs --wait=30  # 等桥接与 OneBot 起来（启动脚本用）
 *   node scripts/check-snowluma.mjs --warn-only --wait=30
 *   node scripts/check-snowluma.mjs --json
 *
 * 只读：不写配置、不重启任何进程。
 * 数据来源：桥接 /api/status 的 snowluma 段（connected/accountOnline/good/lastPacketAgoMs）
 *          + 本机 TCP 探测 3000/3001（OneBot reverse/正向 ws）与 5099（SnowLuma WebUI）。
 */
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG = process.env.QQ_BRIDGE_CONFIG || path.join(ROOT, 'config.json');

// ---- 可选：把这次输出追加到 state/boot-check.log（开机脚本用 --log）----
if (process.argv.includes('--log') && !process.argv.includes('--json')) {
  const LOG_FILE = process.env.BOOT_CHECK_LOG || path.join(ROOT, 'state', 'boot-check.log');
  const LOG_TAG = "bot";
  const lines = [];
  const origLog = console.log.bind(console);
  console.log = (...a) => { const s = a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '); lines.push(s); origLog(s); };
  const origErr = console.error.bind(console);
  console.error = (...a) => { const s = a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '); lines.push(s); origErr(s); };
  process.on('exit', () => {
    try {
      const MAX = 512 * 1024;
      let body = '', rotated = false;
      if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > MAX) {
        rotated = true;
        const old = fs.readFileSync(LOG_FILE, 'utf8');
        const cut = old.slice(-Math.floor(MAX / 2.5));
        const i = cut.indexOf('--- ');
        body = i >= 0 ? cut.slice(i) : '';
      }
      const stamp = new Date().toISOString();
      const block = ['--- ' + stamp + ' ' + LOG_TAG + ' ---', ...lines, ''].join('\n');
      fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
      if (rotated) fs.writeFileSync(LOG_FILE, body + block, 'utf8'); else fs.appendFileSync(LOG_FILE, block, 'utf8');
    } catch { /* 日志失败不影响诊断 */ }
  });
}

const AS_JSON = process.argv.includes('--json');
const WARN_ONLY = process.argv.includes('--warn-only');
const WAIT_SEC = Number((process.argv.find((a) => a.startsWith('--wait=')) || '').split('=')[1] || 0);
const DOT = ' · ';

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG, 'utf8').replace(/^\uFEFF/, ''));
  } catch (e) {
    console.error(`读不到配置：${CONFIG}\n${e.message}`);
    process.exit(WARN_ONLY ? 0 : 2);
  }
}

function probePort(port, timeoutMs = 700) {
  return new Promise((resolve) => {
    const sock = net.connect({ host: '127.0.0.1', port });
    let done = false;
    const finish = (state) => {
      if (done) return;
      done = true;
      sock.destroy();
      resolve(state);
    };
    sock.setTimeout(timeoutMs);
    sock.once('connect', () => finish('open'));
    sock.once('timeout', () => finish('blocked'));
    sock.once('error', (e) => finish(e && e.code === 'ECONNREFUSED' ? 'closed' : 'blocked'));
  });
}

async function api(base, token, p) {
  const res = await fetch(base + p, { headers: { 'x-console-token': token } });
  if (!res.ok) throw new Error(`${p} → ${res.status}`);
  return res.json();
}

function fmtAgo(ms) {
  if (!Number.isFinite(ms)) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s 前`;
  if (s < 3600) return `${Math.round(s / 60)}m 前`;
  return `${Math.round(s / 3600)}h 前`;
}

const cfg = readConfig();
const port = Number(cfg.consolePort) || 3100;
const token = String(cfg.consoleToken || '');
const base = `http://127.0.0.1:${port}`;

const out = {
  bridge: base,
  bridgeOk: false,
  snowluma: null,
  onebot: { 3000: '?', 3001: '?' },
  webui: '?',
  problems: [],
};

async function collect() {
  const status = await api(base, token, '/api/status');
  out.bridgeOk = true;
  out.snowluma = status.snowluma || null;
  out.mode = status.mode || '';
  out.onebot = { 3000: await probePort(3000), 3001: await probePort(3001) };
  out.webui = await probePort(5099);
}

// 启动脚本里桥接 / SnowLuma 可能还在起：先等 OneBot + 桥接都可用（最多 WAIT_SEC）
async function waitReady(seconds) {
  if (!(seconds > 0)) return false;
  const deadline = Date.now() + seconds * 1000;
  for (;;) {
    const ob = await probePort(3000);
    const ob2 = await probePort(3001);
    let bridgeOk = false;
    try {
      await api(base, token, '/api/status');
      bridgeOk = true;
    } catch {
      bridgeOk = false;
    }
    if (bridgeOk && (ob === 'open' || ob2 === 'open')) return true;
    if (Date.now() > deadline) return false;
    await new Promise((r) => setTimeout(r, 1000));
  }
}

let waited = false;
try {
  await collect();
} catch (e) {
  waited = await waitReady(WAIT_SEC);
  if (waited) {
    try {
      await collect();
    } catch (e2) {
      console.error(`连不上桥接（${base}）：${e2.message}`);
      process.exit(WARN_ONLY ? 0 : 2);
    }
  } else {
    console.error(`连不上桥接（${base}）：${e.message}`);
    if (WAIT_SEC > 0) console.error(`（等了 ${WAIT_SEC}s，桥接还没起来；启动脚本里这不算失败）`);
    process.exit(WARN_ONLY ? 0 : 2);
  }
}

const sl = out.snowluma || {};
const onebotUp = out.onebot[3000] === 'open' || out.onebot[3001] === 'open';

if (out.webui !== 'open') out.problems.push('SnowLuma WebUI 5099 没在监听（进程没起，或还没注入成功）');
if (!onebotUp) out.problems.push('OneBot 3000/3001 都没有监听（SnowLuma 没注入到 QQ，或 UIN 不对）');
if (!sl.connected) out.problems.push('桥接没连上 OneBot（SnowLuma 没把事件推给桥接，检查 reverse ws 与 token）');
if (sl.connected && sl.accountOnline === false) out.problems.push('账号显示离线（小号掉线或未登录）');
if (sl.connected && sl.good === false) out.problems.push(`上游不健康：${sl.hint || sl.goodError || sl.goodSource || '未知'}`);
if (sl.silent) out.problems.push('上游静默（长时间没有心跳/事件）');
if (sl.degraded) out.problems.push(`上游降级：${sl.hint || '见桥接日志'}`);

if (AS_JSON) {
  out.ok = out.problems.length === 0;
  console.log(JSON.stringify(out, null, 2));
  process.exit(out.ok ? 0 : WARN_ONLY ? 0 : 1);
}

const yn = (v) => (v ? '✓' : '✗');
console.log(`桥接      ${out.bridge}（模式 ${out.mode || '?'}）`);
console.log(`SnowLuma  ${out.webui === 'open' ? 'WebUI 5099 ✓' : 'WebUI 5099 ✗'}`);
console.log(`OneBot    3000 ${out.onebot[3000] === 'open' ? '✓' : out.onebot[3000]} · 3001 ${out.onebot[3001] === 'open' ? '✓' : out.onebot[3001]}`);
if (!sl.connected) {
  console.log(`桥接上游  ✗ 未连接${sl.lastPacketAgoMs ? `（最近包 ${fmtAgo(sl.lastPacketAgoMs)}）` : ''}`);
} else {
  console.log(
    `桥接上游  ${yn(sl.good)} connected${DOT}账号${sl.accountOnline ? '在线' : '离线'}${DOT}` +
      `${sl.good ? 'good' : 'not-good'}(${sl.goodSource || '?'})${DOT}最近包 ${fmtAgo(sl.lastPacketAgoMs)}` +
      `${sl.lastPacketKind ? `（${sl.lastPacketKind}）` : ''}`
  );
}
if (out.problems.length) {
  for (const p of out.problems) console.log(`  ! ${p}`);
  console.log('  → 依次检查：SnowLuma WebUI 的「进程注入」页是否已注入 UIN → OneBot 反向 ws 地址/token 是否与 config.json 一致 → 小号是否在线');
  process.exit(WARN_ONLY ? 0 : 1);
}
console.log('  ✓ 注入、OneBot、桥接上游都正常');
process.exit(0);
