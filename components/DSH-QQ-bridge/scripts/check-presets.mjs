#!/usr/bin/env node
// check-presets.mjs —— 一条命令看清「preset 到底能不能用」。
//
// 为什么单独写：DSH 每次重启都会换 Web 端口，而"当前那个实例有没有装 qq 插件"
// 并不由桥接决定。历史上出现过：DSH 重启后落到一个只有 4 个内置 preset 的实例，
// 桥接于是拒绝给群聊回退默认 preset（避免把本地工具暴露给群），日志里只有一行 ⛔。
// 这个脚本把三件事一次问清楚：
//   1. 桥接连的是哪个 DSH、它看见几个 preset、有没有要求的那个；
//   2. 每个已映射会话实际挂的是哪个 preset；
//   3. 缺失时给出一条能照着做的修法。
//
// 用法：
//   node scripts/check-presets.mjs
//   node scripts/check-presets.mjs --json
//
// 退出码：0 全部就绪；1 有缺失；2 连不上桥接。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CONFIG = process.env.QQ_BRIDGE_CONFIG || path.join(ROOT, 'config.json');

// ---- 可选：把这次输出追加到 state/boot-check.log（开机脚本用 --log）----
if (process.argv.includes('--log') && !process.argv.includes('--json')) {
  const LOG_FILE = process.env.BOOT_CHECK_LOG || path.join(ROOT, 'state', 'boot-check.log');
  const LOG_TAG = "presets";
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

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG, 'utf8').replace(/^\uFEFF/, ''));
  } catch (e) {
    console.error(`读不到配置：${CONFIG}\n${e.message}`);
    process.exit(WARN_ONLY ? 0 : 2);
  }
}

async function api(base, token, pathname) {
  const res = await fetch(`${base}${pathname}`, {
    headers: { 'x-console-token': token },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`${pathname} → HTTP ${res.status}`);
  return res.json();
}

const cfg = readConfig();
const base = `http://127.0.0.1:${cfg.consolePort || 3100}`;
const token = cfg.consoleToken || '';
const required = [
  cfg.agentPreset,
  cfg.socialV2?.agentPreset,
].filter(Boolean);

const out = { bridge: base, dsh: '', required: [...new Set(required)], available: [], sessions: [], missing: [], ok: false };

async function waitForBridge(seconds) {
  if (!(seconds > 0)) return true;
  const deadline = Date.now() + seconds * 1000;
  for (;;) {
    try {
      await api(base, token, '/api/status');
      return true;
    } catch {
      if (Date.now() > deadline) return false;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

try {
  const status = await api(base, token, '/api/status');
  out.dsh = status.dshBaseUrl || status.dsh?.baseUrl || cfg.dsh?.baseUrl || '(未知)';
  out.dshReady = Boolean(status.dshReady);
  out.mode = status.mode || '';
  const presetRes = await api(base, token, '/api/presets');
  out.available = (presetRes.presets || []).map((p) => (typeof p === 'string' ? p : p.id)).filter(Boolean);
} catch (e) {
  if (await waitForBridge(WAIT_SEC)) {
    // 等到了，重跑一次上面的拉取
    try {
      const status = await api(base, token, '/api/status');
      out.dsh = status.dshBaseUrl || status.dsh?.baseUrl || cfg.dsh?.baseUrl || '(未知)';
      out.dshReady = Boolean(status.dshReady);
      out.mode = status.mode || '';
      const presetRes = await api(base, token, '/api/presets');
      out.available = (presetRes.presets || []).map((p) => (typeof p === 'string' ? p : p.id)).filter(Boolean);
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

const available = new Set(out.available);
out.missing = out.required.filter((name) => !available.has(name));

// 会话映射：state/sessions.json 里 sessionPolicies 记的是 [模式, preset, ...]
try {
  const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'state', 'sessions.json'), 'utf8'));
  for (const [key, sid] of Object.entries(raw.sessions || {})) {
    let policy = null;
    try {
      const parsed = JSON.parse(raw.sessionPolicies?.[key] || 'null');
      policy = Array.isArray(parsed) ? parsed[1] : null;
    } catch { /* 老格式没有策略，忽略 */ }
    out.sessions.push({ key, sessionId: sid, preset: policy, usable: policy ? available.has(policy) : null });
  }
} catch (e) {
  out.sessionsError = e.message;
}

out.ok = out.missing.length === 0 && out.sessions.every((s) => s.usable !== false);

if (AS_JSON) {
  console.log(JSON.stringify(out, null, 2));
} else {
  console.log(`桥接      ${out.bridge}${out.mode ? `（模式 ${out.mode}）` : ''}`);
  console.log(`DSH       ${out.dsh}${out.dshReady ? ' · 已就绪' : ' · 未就绪'}`);
  console.log(`可用 preset ${out.available.length} 个：${out.available.join(', ') || '(空)'}`);
  console.log(`需要 preset ${out.required.join(', ') || '(未配置)'}${out.missing.length ? ` → 缺 ${out.missing.join(', ')}` : ' → 都在'}`);
  if (out.sessions.length) {
    for (const s of out.sessions) {
      const flag = s.usable === false ? '✗' : s.usable === null ? '-' : '✓';
      console.log(`  ${flag} ${s.key} → ${s.preset || '(未记录)'}  ${s.sessionId}`);
    }
  } else {
    console.log('  （还没有映射会话）');
  }
  if (!out.ok) {
    console.log('');
    console.log('修法（按顺序试）：');
    console.log('  1) 确认桌面 profile 里挂了 qq 预设 bundle：');
    console.log('     C:\\Users\\<你>\\.dsh\\profiles\\desktop\\package.json 应有 qq-agent-presets: link:...');
    console.log('  2) 重装一次：node scripts/setup-dsh.mjs desktop');
    console.log('  3) 重启 DSH（会让 preset 列表重新加载），再跑一次本脚本');
    console.log('  4) 本机同时开着多个 DSH 时，桥接会挑带 qq 插件的那一个；');
    console.log('     若它挑错了，先把多余实例关掉再重启桥接。');
  }
}

process.exit(out.ok || WARN_ONLY ? 0 : 1);
