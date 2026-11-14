// GPT-SoVITS 本地 TTS 客户端。
//
// 为什么单独一个模块：
// - qq_tts 工具和桥接的 TTS 端点共用同一套文本/时长/体积限制，避免两边口径漂移；
// - 参考音频、参考文本、语言只从 config.json 读取，**不接受模型传入任意路径**，
//   防止 prompt injection 让 TTS 去读本机其它音频或把任意文本合成外发。
//
// GPT-SoVITS v2/v2Pro 的 api_v2.py 通常同时支持：
//   POST /tts  (JSON body) 和 GET /tts?...（查询参数）
// 这里先 POST，404/405 再回退 GET，兼容不同打包版本。
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'config.json');

export const TTS_DIR = path.join(ROOT, 'audio', 'tts');

const DEFAULT_API = 'http://127.0.0.1:9880';
const MAX_TEXT_CHARS = 1000;

function loadConfig() {
  try {
    let text = fs.readFileSync(CONFIG_PATH, 'utf8');
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function ttsCfg() {
  const c = loadConfig().socialV2?.tts ?? {};
  return {
    enabled: c.enabled !== false,
    baseUrl: String(c.baseUrl || DEFAULT_API).replace(/\/+$/, ''),
    refAudioPath: String(c.refAudioPath || '').trim(),
    promptText: String(c.promptText || '').trim(),
    promptLang: String(c.promptLang || 'zh'),
    textLang: String(c.textLang || 'zh'),
    timeoutMs: Math.min(300000, Math.max(30000, Number(c.timeoutMs) || 180000)),
    maxChars: Math.min(MAX_TEXT_CHARS, Math.max(1, Number(c.maxChars) || 300)),
    maxBytes: Math.min(20 * 1024 * 1024, Math.max(1024 * 1024, Number(c.maxBytes) || 20 * 1024 * 1024)),
    speedFactor: Math.min(2, Math.max(0.5, Number(c.speedFactor) || 1)),
    autoLifecycle: c.autoLifecycle !== false,
    idleStopMs: Math.min(24 * 3600 * 1000, Math.max(60_000, Number(c.idleStopMs) || 600_000)),
    startTimeoutMs: Math.min(300_000, Math.max(5_000, Number(c.startTimeoutMs) || 120_000)),
    startScript: String(c.startScript || path.join('scripts', 'start-tts-api.cmd')),
    stopScript: String(c.stopScript || path.join('scripts', 'stop-tts-api.cmd')),
    maxConcurrent: Math.min(2, Math.max(1, Number(c.maxConcurrent) || 1)),
    maxQueue: Math.min(5, Math.max(0, Number(c.maxQueue) || 2))
  };
}

function assertLocalApi(baseUrl) {
  let u;
  try { u = new URL(baseUrl); } catch { throw new Error('socialV2.tts.baseUrl 不是合法 URL'); }
  const host = u.hostname.toLowerCase();
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
    throw new Error('只允许连接本机 GPT-SoVITS API（socialV2.tts.baseUrl 必须是 127.0.0.1/localhost）');
  }
}

// ── 资源限制 / 空闲停 API ───────────────────────────────────────────────────
// GPT-SoVITS v1 CPU 进程常驻约 3GB 内存。用户不用语音时没必要一直占着；
// 但停掉后第一次合成要重新拉起 API，所以默认空闲 10 分钟才停。
const ttsWaiters = [];
let ttsInflight = 0;
let ttsLastUsedAt = 0;
let ttsIdleTimer = null;
let ttsStarting = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ttsHostPort(baseUrl) {
  const u = new URL(baseUrl);
  return { host: u.hostname, port: Number(u.port || 80) };
}

function isTtsPortOpen(baseUrl, timeoutMs = 1200) {
  let hostPort;
  try { hostPort = ttsHostPort(baseUrl); } catch { return Promise.resolve(false); }
  return new Promise((resolve) => {
    const socket = net.connect({ host: hostPort.host, port: hostPort.port });
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

function resolveScript(scriptPath) {
  const resolved = path.isAbsolute(scriptPath) ? scriptPath : path.join(ROOT, scriptPath);
  if (!fs.existsSync(resolved)) throw new Error(`脚本不存在：${resolved}`);
  if (!/\.cmd$/i.test(resolved)) throw new Error(`只允许运行 .cmd 脚本：${resolved}`);
  return resolved;
}

function spawnTtsScript(scriptPath) {
  const script = resolveScript(scriptPath);
  const child = spawn('cmd.exe', ['/c', script], {
    cwd: ROOT,
    detached: true,
    stdio: 'ignore',
    windowsHide: true
  });
  child.unref();
}

async function ensureTtsApi(cfg) {
  if (await isTtsPortOpen(cfg.baseUrl)) return;
  if (!cfg.autoLifecycle) {
    throw new Error(`GPT-SoVITS API 未启动（${cfg.baseUrl}）；socialV2.tts.autoLifecycle=false，请手动启动`);
  }
  if (!ttsStarting) {
    ttsStarting = (async () => {
      spawnTtsScript(cfg.startScript);
      const deadline = Date.now() + cfg.startTimeoutMs;
      while (Date.now() < deadline) {
        if (await isTtsPortOpen(cfg.baseUrl)) return;
        await sleep(2000);
      }
      throw new Error(`GPT-SoVITS API 启动超时（${Math.round(cfg.startTimeoutMs / 1000)}s）：检查 ${cfg.startScript}`);
    })();
    try {
      await ttsStarting;
    } finally {
      ttsStarting = null;
    }
    return;
  }
  await ttsStarting;
}

function acquireTtsSlot(cfg) {
  if (ttsInflight < cfg.maxConcurrent) {
    ttsInflight += 1;
    return Promise.resolve();
  }
  if (ttsWaiters.length >= cfg.maxQueue) {
    return Promise.reject(new Error(`语音合成队列已满（最多 ${cfg.maxQueue} 个等待任务）`));
  }
  return new Promise((resolve) => ttsWaiters.push(resolve));
}

function releaseTtsSlot() {
  const next = ttsWaiters.shift();
  if (next) next();
  else ttsInflight = Math.max(0, ttsInflight - 1);
}

async function stopTtsIfIdle() {
  const cfg = ttsCfg();
  if (!cfg.autoLifecycle || ttsInflight > 0) return;
  if (!ttsLastUsedAt) {
    // 进程启动时 API 可能已经在跑（上次遗留/手动启动）；从此刻开始计空闲。
    if (await isTtsPortOpen(cfg.baseUrl)) ttsLastUsedAt = Date.now();
    return;
  }
  if (Date.now() - ttsLastUsedAt < cfg.idleStopMs) return;
  if (!(await isTtsPortOpen(cfg.baseUrl))) {
    ttsLastUsedAt = 0;
    return;
  }
  try {
    spawnTtsScript(cfg.stopScript);
  } catch {
    // 停脚本缺失/权限失败时不要影响下一轮合成；保留 lastUsed 以便下个周期重试。
    return;
  }
  ttsLastUsedAt = 0;
}

function startTtsIdleWatch() {
  if (ttsIdleTimer) return;
  ttsIdleTimer = setInterval(() => { void stopTtsIfIdle(); }, 60_000);
  ttsIdleTimer.unref?.();
}

function buildPayload(cfg, text, speedFactor) {
  return {
    text,
    text_lang: cfg.textLang,
    ref_audio_path: cfg.refAudioPath,
    prompt_text: cfg.promptText,
    prompt_lang: cfg.promptLang,
    top_k: 5,
    top_p: 1,
    temperature: 1,
    text_split_method: 'cut5',
    batch_size: 1,
    speed_factor: speedFactor,
    media_type: 'wav',
    streaming_mode: false
  };
}

function looksLikeAudio(buf) {
  if (!buf || buf.length < 4) return false;
  const s = buf.subarray(0, 4).toString('latin1');
  if (s === 'RIFF' || s === 'OggS' || s === 'fLaC' || s === 'ID3') return true;
  // MP3 frame sync (0xFFEx / 0xFFFx)
  if (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) return true;
  // MP4/M4A (ftyp)
  if (buf.length >= 12 && buf.subarray(4, 8).toString('latin1') === 'ftyp') return true;
  return false;
}

function responseError(text) {
  const s = String(text || '').trim();
  if (!s) return 'TTS 服务没有返回音频';
  try {
    const j = JSON.parse(s);
    return String(j.message || j.error || j.detail || s).slice(0, 500);
  } catch {
    return s.slice(0, 500);
  }
}

async function requestTts(cfg, payload) {
  const post = await fetch(`${cfg.baseUrl}/tts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(cfg.timeoutMs)
  });
  if (post.ok || (post.status !== 404 && post.status !== 405)) return post;

  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(payload)) q.set(k, String(v));
  return fetch(`${cfg.baseUrl}/tts?${q.toString()}`, {
    method: 'GET',
    signal: AbortSignal.timeout(cfg.timeoutMs)
  });
}

export function ensureTtsDir() {
  fs.mkdirSync(TTS_DIR, { recursive: true });
}

/**
 * 把文字合成为语音文件，返回 { path, relativePath, bytes, mimeType }。
 * 只读取 config.socialV2.tts 的参考音频；文本、语速做上限约束。
 */
async function synthesizeSpeechUnlocked({ text, speedFactor } = {}) {
  const cfg = ttsCfg();
  if (!cfg.enabled) throw new Error('语音合成功能已关闭（socialV2.tts.enabled=false）');
  assertLocalApi(cfg.baseUrl);

  const input = String(text ?? '').trim();
  if (!input) throw new Error('text 不能为空');
  if (input.length > cfg.maxChars) throw new Error(`text 太长（最多 ${cfg.maxChars} 字）`);

  if (!cfg.refAudioPath) throw new Error('未配置参考音频（socialV2.tts.refAudioPath）');
  if (!fs.existsSync(cfg.refAudioPath) || !fs.statSync(cfg.refAudioPath).isFile()) {
    throw new Error(`参考音频不存在：${path.basename(cfg.refAudioPath)}`);
  }
  if (!cfg.promptText) throw new Error('未配置参考文本（socialV2.tts.promptText）');

  const speed = Math.min(2, Math.max(0.5, Number(speedFactor) || cfg.speedFactor));
  const payload = buildPayload(cfg, input, speed);
  await ensureTtsApi(cfg);
  let res;
  for (let attempt = 0; ; attempt += 1) {
    try {
      res = await requestTts(cfg, payload);
      break;
    } catch (error) {
      const message = String(error?.message ?? error);
      const connectionLost = /ECONNREFUSED|ECONNRESET|fetch failed|socket hang up/i.test(message);
      if (attempt === 0 && connectionLost) {
        await ensureTtsApi(cfg);
        continue;
      }
      if (error?.name === 'TimeoutError' || /aborted|timeout/i.test(message)) {
        throw new Error(`TTS 服务超时（${Math.round(cfg.timeoutMs / 1000)}s）：检查 GPT-SoVITS API 是否已启动`);
      }
      throw new Error(`无法连接 GPT-SoVITS API（${cfg.baseUrl}）：${message}`);
    }
  }

  const buf = Buffer.from(await res.arrayBuffer());
  const contentType = String(res.headers.get('content-type') || '').toLowerCase();
  if (!res.ok) throw new Error(`TTS 服务返回 HTTP ${res.status}：${responseError(buf.toString('utf8').slice(0, 2000))}`);
  if (!buf.length) throw new Error('TTS 服务返回了空响应');
  if (contentType.includes('json') || contentType.startsWith('text/')) {
    throw new Error(`TTS 服务返回的不是音频：${responseError(buf.toString('utf8').slice(0, 2000))}`);
  }
  if (buf.length > cfg.maxBytes) throw new Error(`TTS 音频太大（${buf.length}B，上限 ${cfg.maxBytes}B）`);
  if (!looksLikeAudio(buf)) throw new Error('TTS 服务返回的内容不是可识别的音频（缺少 RIFF/MP3/OGG 头）');

  ensureTtsDir();
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const rand = Math.random().toString(36).slice(2, 8);
  const name = `tts-${stamp}-${rand}.wav`;
  const file = path.join(TTS_DIR, name);
  await fs.promises.writeFile(file, buf);
  ttsLastUsedAt = Date.now();
  startTtsIdleWatch();
  return {
    path: file,
    relativePath: path.posix.join('tts', name),
    bytes: buf.length,
    mimeType: contentType || 'audio/wav'
  };
}

/**
 * 对外入口：限制同时合成数量，并在空闲时停掉 GPT-SoVITS API 释放内存。
 * 注意：这里只在“桥接进程”内排队；多个 DSH/MCP 客户端仍共享同一个 9880 服务。
 */
export async function synthesizeSpeech(options = {}) {
  const cfg = ttsCfg();
  await acquireTtsSlot(cfg);
  try {
    return await synthesizeSpeechUnlocked(options);
  } finally {
    releaseTtsSlot();
  }
}

// 进程启动即开始空闲检查：API 可能是上一轮遗留下来的，不应永久常驻。
startTtsIdleWatch();
