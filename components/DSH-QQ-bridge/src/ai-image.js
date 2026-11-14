// 画图客户端：支持两个后端 —— A1111/A绘世（/sdapi）与 ComfyUI（/prompt）。
//
// 为什么单独一个模块：
// - MCP 工具（qq_generate_image）和桥接的发图端点都要用同一套尺寸/步数/体积限制；
//   把 HTTP 调用和落盘集中在这里，避免两边各写一份、口径漂移。
// - 只允许本机 API，不把局域网/公网地址当模型可控参数，避免变成 SSRF 跳板。
// - 后端由 config.json 的 imageGen.backend 决定（'a1111' | 'comfy'），改配置即时生效；
//   显式写 'a1111' 就是回滚开关，不需要改代码。
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { comfyProbe, comfyFree, comfyGenerate, startComfyDetached } from './ai-image-comfy.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'config.json');
export const GENERATED_DIR = path.join(ROOT, 'data', 'generated');

const DEFAULT_API = 'http://127.0.0.1:7860';
const MAX_PROMPT_CHARS = 2000;
const MAX_NEGATIVE_CHARS = 1000;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_PIXELS = 64_000_000;

function loadConfig() {
  try {
    let text = fs.readFileSync(CONFIG_PATH, 'utf8');
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    return JSON.parse(text);
  } catch {
    return {};
  }
}

// 多引擎：QQ 默认只用一个模型（animagine），主人明确点名的才换。
// 这里的「引擎」= 一套完整工作流（SDXL 只要 checkpoint；Qwen-Image 2.1 需要 GGUF 主干 +
// Qwen3-VL 编码器 + 2.1 专属 VAE，且 cfg 固定 1、采样器 euler/simple），不能只换 ckpt_name。
const BUILTIN_ENGINES = {
  animagine: { type: 'sdxl', checkpoint: 'animagine-xl-4.0.safetensors', steps: 28, cfgScale: 5, width: 832, height: 1216 },
  illustrious: { type: 'sdxl', checkpoint: 'Illustrious-XL-v2.0.safetensors', steps: 28, cfgScale: 5, width: 832, height: 1216 },
  qwen: {
    type: 'qwen',
    unet: 'qwen_image_2.1_Q4_K_M.gguf',
    clip: 'qwen3vl_8b_int8_convrot.safetensors',
    vae: 'qwen_image_2.1_vae_bf16.safetensors',
    steps: 25,
    cfgScale: 1,
    sampler: 'euler',
    scheduler: 'simple',
    width: 1024,
    height: 1024
  }
};

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function buildEngines(imageGen = {}) {
  const source = imageGen.engines && typeof imageGen.engines === 'object' ? imageGen.engines : {};
  const out = {};
  for (const [id, def] of Object.entries(source)) {
    if (!def || typeof def !== 'object') continue;
    const base = BUILTIN_ENGINES[id] || {};
    const merged = { ...base, ...def };
    const type = String(merged.type || '').toLowerCase() === 'qwen' ? 'qwen' : 'sdxl';
    out[id] = {
      id,
      type,
      checkpoint: String(merged.checkpoint || BUILTIN_ENGINES.animagine.checkpoint),
      unet: String(merged.unet || BUILTIN_ENGINES.qwen.unet),
      clip: String(merged.clip || BUILTIN_ENGINES.qwen.clip),
      vae: String(merged.vae || BUILTIN_ENGINES.qwen.vae),
      steps: clampNumber(merged.steps, 1, 40, type === 'qwen' ? 25 : 28),
      cfgScale: clampNumber(merged.cfgScale, 1, 15, type === 'qwen' ? 1 : 5),
      width: clampNumber(merged.width, 256, 1536, type === 'qwen' ? 1024 : 832),
      height: clampNumber(merged.height, 256, 1536, type === 'qwen' ? 1024 : 1216),
      sampler: String(merged.sampler || (type === 'qwen' ? 'euler' : 'Euler a')).slice(0, 64),
      scheduler: String(merged.scheduler || '')
    };
  }
  for (const [id, base] of Object.entries(BUILTIN_ENGINES)) {
    if (!out[id]) out[id] = { ...base, id };
  }
  // comfy.checkpoint 仍是最直接的开关：没显式配 engines.animagine 时以它为准。
  if (!source.animagine && imageGen.comfy?.checkpoint) {
    out.animagine = { ...out.animagine, checkpoint: String(imageGen.comfy.checkpoint) };
  }
  return out;
}

function imageCfg() {
  const c = loadConfig().imageGen ?? {};
  return {
    baseUrl: String(c.baseUrl || DEFAULT_API).replace(/\/+$/, ''),
    timeoutMs: Math.min(600000, Math.max(30000, Number(c.timeoutMs) || 180000)),
    maxWidth: Math.min(1536, Math.max(256, Number(c.maxWidth) || 1024)),
    maxHeight: Math.min(1536, Math.max(256, Number(c.maxHeight) || 1024)),
    maxSteps: Math.min(40, Math.max(1, Number(c.maxSteps) || 30)),
    maxPixels: Math.min(4_000_000, Math.max(256 * 256, Number(c.maxPixels) || 1_600_000)),
    maxConcurrent: Math.min(2, Math.max(1, Number(c.maxConcurrent) || 1)),
    maxQueue: Math.min(5, Math.max(0, Number(c.maxQueue) || 2)),
    unloadOnIdle: c.unloadOnIdle !== false,
    idleUnloadMs: Math.min(24 * 3600 * 1000, Math.max(60_000, Number(c.idleUnloadMs) || 600_000)),
    autoLifecycle: c.autoLifecycle !== false,
    idleStopProcessMs: Math.min(24 * 3600 * 1000, Math.max(60_000, Number(c.idleStopProcessMs) || 600_000)),
    startTimeoutMs: Math.min(300_000, Math.max(30_000, Number(c.startTimeoutMs) || 120_000)),
    startScript: String(c.startScript || 'scripts\\start-ai-api.cmd'),
    stopScript: String(c.stopScript || 'scripts\\stop-ai-api.cmd'),
    defaultWidth: Math.min(1536, Math.max(256, Number(c.defaultWidth) || 512)),
    defaultHeight: Math.min(1536, Math.max(256, Number(c.defaultHeight) || 512)),
    defaultSteps: Math.min(40, Math.max(1, Number(c.defaultSteps) || 8)),
    defaultCfg: Math.min(15, Math.max(1, Number(c.defaultCfg) || 7)),
    defaultNegativePrompt: String(c.defaultNegativePrompt || '').slice(0, MAX_NEGATIVE_CHARS),
    maxBatch: 1,
    // 后端：'a1111'（A绘世，缺省，回滚用）或 'comfy'（ComfyUI）。写错值一律按 a1111 处理。
    backend: /^comfy(ui)?$/i.test(String(c.backend || '')) ? 'comfy' : 'a1111',
    comfy: {
      baseUrl: String(c.comfy?.baseUrl || 'http://127.0.0.1:8188').replace(/\/+$/, ''),
      checkpoint: String(c.comfy?.checkpoint || 'animagine-xl-4.0.safetensors'),
      scheduler: String(c.comfy?.scheduler || 'normal'),
      pollIntervalMs: Math.min(5000, Math.max(200, Number(c.comfy?.pollIntervalMs) || 600)),
      startupTimeoutMs: Math.min(600_000, Math.max(30_000, Number(c.comfy?.startupTimeoutMs) || 180_000)),
      startScript: String(c.comfy?.startScript || 'scripts\\start-comfy-api.cmd'),
      stopScript: String(c.comfy?.stopScript || 'scripts\\stop-comfy-api.cmd'),
      root: String(c.comfy?.root || '<LOCAL_TOOLS>\\ComfyUI'),
      pythonExe: String(c.comfy?.pythonExe || ''),
      mainPy: String(c.comfy?.mainPy || ''),
      logFile: String(c.comfy?.logFile || '')
    },
    // 引擎选择：QQ 会话里只有主人明确点名才换，默认 animagine。
    engine: String(c.engine || 'animagine').toLowerCase(),
    engines: buildEngines(c)
  };
}

// ── 资源限制 / 空闲卸载 ─────────────────────────────────────────────────────
// 8GB 显存上 SDXL 同时跑两张很容易 OOM，所以默认只允许 1 张在生成、最多 2 张排队。
const imageWaiters = [];
let imageInflight = 0;
let imageLastUsedAt = 0;
let imageUnloaded = false;
let imageIdleTimer = null;
let imageStartPromise = null;
let imageStopPromise = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function isImageApiUp(cfg) {
  if (cfg.backend === 'comfy') return comfyProbe(cfg.comfy.baseUrl, 2500);
  try {
    const res = await fetch(`${cfg.baseUrl}/sdapi/v1/options`, { signal: AbortSignal.timeout(2500) });
    return res.ok;
  } catch {
    return false;
  }
}

function scriptsOf(cfg) {
  return cfg.backend === 'comfy'
    ? { start: cfg.comfy.startScript, stop: cfg.comfy.stopScript }
    : { start: cfg.startScript, stop: cfg.stopScript };
}

function runImageScript(cfg, scriptPath) {
  const absolute = path.resolve(ROOT, scriptPath);
  if (!fs.existsSync(absolute)) throw new Error(`找不到画图引擎脚本：${absolute}`);
  const child = spawn('cmd.exe', ['/c', absolute], {
    cwd: ROOT,
    windowsHide: true,
    stdio: 'ignore'
  });
  child.unref();
  return child;
}

function parseHostPort(baseUrl) {
  try {
    const u = new URL(baseUrl);
    const port = Number(u.port || (u.protocol === 'https:' ? 443 : 80));
    if (!u.hostname || !Number.isFinite(port)) return null;
    return { host: u.hostname, port };
  } catch {
    return null;
  }
}

// 端口能连上不代表 API 就绪（ComfyUI 监听后还要加载自定义节点/权重索引），
// 但只要端口开了就说明「已经有个进程在起」，此时绝不能再 spawn 第二个抢端口。
function isPortOpen(host, port, timeoutMs = 1200) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      try { socket.destroy(); } catch {}
      resolve(value);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

function appendStartLog(line) {
  try {
    const dir = path.join(ROOT, 'logs');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'image-start.log'), `[${new Date().toISOString()}] ${line}\n`);
  } catch {}
}

function pidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function ensureImageApi(cfg) {
  // 如果空闲回收正在杀进程，先让它杀完再起，否则刚拉起来的 python 会被上一次 stop 的收尾循环带走，
  // 表现为「一直在启动、一直超时」（2026-11-14 真实故障）。
  if (imageStopPromise) {
    try { await imageStopPromise; } catch {}
  }
  if (await isImageApiUp(cfg)) return;
  if (!cfg.autoLifecycle) {
    throw new Error(cfg.backend === 'comfy'
      ? 'ComfyUI API 未启动，且 imageGen.autoLifecycle 已关闭'
      : 'A绘世 API 未启动，且 imageGen.autoLifecycle 已关闭');
  }
  const timeoutMs = cfg.backend === 'comfy'
    ? Math.max(cfg.startTimeoutMs, Number(cfg.comfy?.startupTimeoutMs) || 0)
    : cfg.startTimeoutMs;

  if (!imageStartPromise) {
    imageStartPromise = (async () => {
      const beganAt = Date.now();
      let spawnedPid = 0;
      let action = 'unknown';

      if (cfg.backend === 'comfy') {
        const hp = parseHostPort(cfg.comfy.baseUrl);
        const portBusy = hp ? await isPortOpen(hp.host, hp.port) : false;
        if (portBusy) {
          // 已经有人在起（上一次调用/手动启动/别的 MCP 进程），等它，不要再拉一个。
          action = 'port-open, waiting existing process';
        } else {
          try {
            const info = startComfyDetached(cfg.comfy);
            spawnedPid = Number(info?.pid) || 0;
            action = `spawned pid=${spawnedPid}`;
          } catch (err) {
            action = `detached spawn failed (${err?.message || err}), fallback script`;
            runImageScript(cfg, scriptsOf(cfg).start);
          }
        }
      } else {
        runImageScript(cfg, scriptsOf(cfg).start);
        action = 'script';
      }
      appendStartLog(`start backend=${cfg.backend} ${action} timeout=${timeoutMs}ms`);

      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        await sleep(1000);
        if (await isImageApiUp(cfg)) {
          appendStartLog(`ready backend=${cfg.backend} in ${Date.now() - beganAt}ms`);
          return;
        }
        // 我们自己拉起来的 python 十几秒就死了 → 不必等满超时，直接报可执行的错误。
        if (spawnedPid && Date.now() - beganAt > 15_000 && !pidAlive(spawnedPid)) {
          appendStartLog(`exited early backend=${cfg.backend} pid=${spawnedPid} after ${Date.now() - beganAt}ms`);
          throw new Error(`ComfyUI 启动后立刻退出（pid ${spawnedPid}），详见 logs\\comfy.log 末尾`);
        }
      }
      appendStartLog(`TIMEOUT backend=${cfg.backend} after ${Date.now() - beganAt}ms action=${action}`);
      throw new Error(`ComfyUI API 启动超时（${Math.round(timeoutMs / 1000)}s，${action}），详见 logs\\image-start.log 与 logs\\comfy.log`);
    })().finally(() => { imageStartPromise = null; });
  }
  await imageStartPromise;
}

async function stopImageProcess(cfg) {
  if (!imageStopPromise) {
    imageStopPromise = (async () => {
      if (await isImageApiUp(cfg)) {
        runImageScript(cfg, scriptsOf(cfg).stop);
        const deadline = Date.now() + 20_000;
        while (Date.now() < deadline) {
          if (!(await isImageApiUp(cfg))) break;
          await sleep(500);
        }
      }
      imageUnloaded = true;
    })().finally(() => { imageStopPromise = null; });
  }
  await imageStopPromise;
}

function acquireImageSlot(cfg) {
  if (imageInflight < cfg.maxConcurrent) {
    imageInflight += 1;
    return Promise.resolve();
  }
  if (imageWaiters.length >= cfg.maxQueue) {
    return Promise.reject(new Error(`画图队列已满（最多 ${cfg.maxQueue} 个等待任务）`));
  }
  return new Promise((resolve) => imageWaiters.push(resolve));
}

function releaseImageSlot() {
  const next = imageWaiters.shift();
  if (next) next();
  else imageInflight = Math.max(0, imageInflight - 1);
}

async function ensureImageModelLoaded(cfg) {
  if (!imageUnloaded) return;
  if (cfg.backend === 'comfy') {
    // ComfyUI 的 /free 只释放权重，进程留着；下次 /prompt 会自动重载，无需显式恢复。
    imageUnloaded = false;
    return;
  }
  // 新版 A1111 的 reload-checkpoint 只恢复配置；真正的 UNet 权重会在 txt2img 时按需懒加载。
  // 这里先尝试 reload，失败也继续交给 txt2img，避免把一次可恢复的卸载变成硬错误。
  try {
    await fetch(`${cfg.baseUrl}/sdapi/v1/reload-checkpoint`, {
      method: 'POST',
      signal: AbortSignal.timeout(30_000)
    });
  } catch {}
  imageUnloaded = false;
}

async function unloadImageIfIdle() {
  const cfg = imageCfg();
  if (!cfg.autoLifecycle && !cfg.unloadOnIdle) return;
  if (imageInflight > 0 || imageWaiters.length > 0 || imageStopPromise || imageStartPromise) return;
  if (!imageLastUsedAt) {
    // 进程刚启动时 A绘世可能已经加载着模型；先探活，从此刻开始计空闲，
    // 否则桥接/DSH 重启后就永远不会处理“上一次遗留”的模型/进程。
    if (await isImageApiUp(cfg)) imageLastUsedAt = Date.now();
    return;
  }
  const idleMs = Date.now() - imageLastUsedAt;

  // 第二级：整个进程停掉。只在真正空闲且生命周期开启时做，
  // 这样能释放 Python 堆、CPU 缓存和约 1.9GB 的 CUDA context。
  if (cfg.autoLifecycle && idleMs >= cfg.idleStopProcessMs) {
    await stopImageProcess(cfg);
    imageLastUsedAt = 0;
    return;
  }

  // 第一级：只卸模型，保留进程，回来时恢复更快。
  if (!cfg.unloadOnIdle || imageUnloaded || idleMs < cfg.idleUnloadMs) return;
  imageUnloaded = true;
  try {
    if (cfg.backend === 'comfy') {
      await comfyFree(cfg.comfy.baseUrl);
    } else {
      const res = await fetch(`${cfg.baseUrl}/sdapi/v1/unload-checkpoint`, {
        method: 'POST',
        signal: AbortSignal.timeout(30_000)
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    }
  } catch {
    // 引擎可能已被手动停止；下次生成会重新探测，不要把标志位永久锁死。
    imageUnloaded = false;
  }
}

function startImageIdleWatch() {
  if (imageIdleTimer) return;
  imageIdleTimer = setInterval(() => { void unloadImageIfIdle(); }, 30_000);
  imageIdleTimer.unref?.();
}

function assertLocalApi(baseUrl) {
  let u;
  try { u = new URL(baseUrl); } catch { throw new Error('imageGen.baseUrl 不是合法 URL'); }
  const host = u.hostname.toLowerCase();
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
    throw new Error('只允许连接本机 A绘世 API（imageGen.baseUrl 必须是 127.0.0.1/localhost）');
  }
}

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function normalizeSize(value, max, fallback) {
  const n = clampInt(value, 256, max, fallback);
  // A1111 对非 8 倍数尺寸会警告/裁切；统一到 64 的倍数。
  return Math.max(256, Math.min(max, Math.round(n / 64) * 64));
}

function safeFileName() {
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const rand = Math.random().toString(36).slice(2, 8);
  return `ai-${stamp}-${rand}.png`;
}

export function ensureGeneratedDir() {
  fs.mkdirSync(GENERATED_DIR, { recursive: true });
}

/**
 * 生成一张图并保存到 data/generated。
 * 参数全部做上限约束：尺寸 256~maxWidth/Height（64 倍数）、步数 1~maxSteps、CFG 1~15。
 * 返回的 path 是绝对路径，可直接交给 qq_send_image。
 */
async function generateImageUnlocked(input = {}) {
  const cfg = imageCfg();
  assertLocalApi(cfg.baseUrl);
  const prompt = String(input.prompt ?? '').trim();
  if (!prompt) throw new Error('prompt 不能为空');
  if (prompt.length > MAX_PROMPT_CHARS) throw new Error(`prompt 太长（最多 ${MAX_PROMPT_CHARS} 字）`);
  // 引擎：input.engine 显式指定 > config.imageGen.engine 默认（animagine）。
  // 认不出的值回落默认引擎并如实回报，避免主人说「用千问」却静默画了 Animagine。
  const requestedEngine = String(input.engine || input.model || '').trim().toLowerCase();
  const engine = cfg.engines[requestedEngine] || cfg.engines[cfg.engine] || cfg.engines.animagine;
  const negativePrompt = String(input.negativePrompt ?? input.negative_prompt ?? cfg.defaultNegativePrompt).trim();
  if (negativePrompt.length > MAX_NEGATIVE_CHARS) throw new Error(`negativePrompt 太长（最多 ${MAX_NEGATIVE_CHARS} 字）`);
  const width = normalizeSize(input.width, cfg.maxWidth, engine.width ?? cfg.defaultWidth);
  const height = normalizeSize(input.height, cfg.maxHeight, engine.height ?? cfg.defaultHeight);
  if (width * height > cfg.maxPixels) {
    throw new Error(`尺寸 ${width}x${height} 超过像素上限 ${cfg.maxPixels}（8GB 显存建议 832x1216）`);
  }
  const steps = clampInt(input.steps, 1, cfg.maxSteps, engine.steps ?? cfg.defaultSteps);
  const cfgScale = Math.min(15, Math.max(1, Number(input.cfgScale ?? input.cfg_scale ?? engine.cfgScale ?? cfg.defaultCfg) || cfg.defaultCfg));
  const seed = Number.isInteger(Number(input.seed)) ? Number(input.seed) : -1;
  const samplerName = String(input.samplerName || input.sampler_name || engine.sampler || 'Euler a').trim().slice(0, 64) || 'Euler a';

  const body = {
    prompt,
    negative_prompt: negativePrompt,
    width,
    height,
    steps,
    cfg_scale: cfgScale,
    sampler_name: samplerName,
    seed,
    batch_size: 1,
    n_iter: 1,
    save_images: false,
    send_images: true
  };

  await ensureImageApi(cfg);
  await ensureImageModelLoaded(cfg);
  const started = Date.now();
  let buf;
  let usedSeed = seed;
  let usedSampler = samplerName;
  let usedModel = String(loadConfig().imageGen?.model || '');
  let usedEngine = engine.id;

  if (cfg.backend === 'comfy') {
    try {
      const out = await comfyGenerate({
        cfg: { ...cfg.comfy, timeoutMs: cfg.timeoutMs },
        engine,
        prompt,
        negativePrompt,
        width,
        height,
        steps,
        cfgScale,
        seed,
        samplerName
      });
      buf = out.buf;
      usedSeed = out.seed;
      usedSampler = out.samplerName;
      usedModel = out.model;
      usedEngine = out.engine || engine.id;
    } catch (error) {
      throw new Error(`ComfyUI 生成失败（${engine.id}）：${error?.message ?? error}`);
    }
  } else {
    let res;
    try {
      res = await fetch(`${cfg.baseUrl}/sdapi/v1/txt2img`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(cfg.timeoutMs)
      });
    } catch (error) {
      const msg = error?.name === 'TimeoutError'
        ? `A绘世 API 超时（${Math.round(cfg.timeoutMs / 1000)}s）`
        : `连接 A绘世 API 失败（${cfg.baseUrl}）：${error?.message ?? error}`;
      throw new Error(`${msg}；请确认 A绘世已用 --api 启动且 7860 端口在监听`);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`A绘世 API HTTP ${res.status}${text ? `：${text.slice(0, 300)}` : ''}`);
    }
    const json = await res.json().catch(() => null);
    const imageBase64 = json?.images?.[0];
    if (typeof imageBase64 !== 'string' || !imageBase64) throw new Error('A绘世 API 没有返回图片');
    try {
      const raw = imageBase64.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '');
      buf = Buffer.from(raw, 'base64');
    } catch {
      throw new Error('A绘世 API 返回的图片 base64 无法解码');
    }
    try {
      usedSeed = Number(json?.info ? JSON.parse(json.info)?.seed : seed);
    } catch {}
  }

  if (!buf || !buf.length) throw new Error('画图引擎返回了空图片');
  if (buf.length > MAX_IMAGE_BYTES) throw new Error('生成图片超过 20MB，已拒绝保存');
  const dims = imageDimensions(buf);
  if (dims && dims.width * dims.height > MAX_PIXELS) throw new Error('生成图片像素数超过 64MP，已拒绝保存');

  ensureGeneratedDir();
  const filePath = path.join(GENERATED_DIR, safeFileName());
  fs.writeFileSync(filePath, buf);
  imageLastUsedAt = Date.now();
  imageUnloaded = false;
  startImageIdleWatch();

  return {
    ok: true,
    path: filePath,
    relativePath: path.relative(ROOT, filePath).split(path.sep).join('/'),
    bytes: buf.length,
    width: dims?.width ?? width,
    height: dims?.height ?? height,
    seed: Number.isInteger(usedSeed) ? usedSeed : seed,
    samplerName: usedSampler,
    steps,
    cfgScale,
    model: usedModel || '画图引擎当前模型',
    engine: usedEngine,
    backend: cfg.backend,
    elapsedMs: Date.now() - started,
    prompt
  };
}

/**
 * 对外入口：先排队/占用一个图像生成槽位，再执行生成。
 * 这样两个 QQ 用户同时让画图时不会一起压到 8GB 显存上；超出等待队列会明确报错。
 */
export async function generateImage(input = {}) {
  const cfg = imageCfg();
  await acquireImageSlot(cfg);
  try {
    return await generateImageUnlocked(input);
  } finally {
    releaseImageSlot();
  }
}

// 只用于服务端校验的轻量尺寸解析（PNG/GIF/JPEG/WebP），不引入图像库。
export function imageDimensions(buf) {
  if (!buf || buf.length < 24) return null;
  try {
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    }
    if (buf.toString('ascii', 0, 6) === 'GIF87a' || buf.toString('ascii', 0, 6) === 'GIF89a') {
      return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
    }
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
      let offset = 2;
      while (offset + 9 < buf.length) {
        if (buf[offset] !== 0xff) { offset += 1; continue; }
        const marker = buf[offset + 1];
        if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue; }
        const len = buf.readUInt16BE(offset + 2);
        if (len < 2) return null;
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
          return { height: buf.readUInt16BE(offset + 5), width: buf.readUInt16BE(offset + 7) };
        }
        offset += 2 + len;
      }
    }
    if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
      const fourcc = buf.toString('ascii', 12, 16);
      if (fourcc === 'VP8X' && buf.length >= 30) {
        return {
          width: 1 + buf[24] + (buf[25] << 8) + (buf[26] << 16),
          height: 1 + buf[27] + (buf[28] << 8) + (buf[29] << 16)
        };
      }
    }
  } catch {}
  return null;
}

export async function checkImageApi() {
  const cfg = imageCfg();
  if (cfg.backend === 'comfy') {
    assertLocalApi(cfg.comfy.baseUrl);
    const ok = await comfyProbe(cfg.comfy.baseUrl, 8000);
    if (!ok) throw new Error(`ComfyUI API 不可用（${cfg.comfy.baseUrl}）`);
    return { backend: 'comfy', baseUrl: cfg.comfy.baseUrl, model: cfg.comfy.checkpoint, sampler: cfg.comfy.scheduler };
  }
  assertLocalApi(cfg.baseUrl);
  const res = await fetch(`${cfg.baseUrl}/sdapi/v1/options`, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`A绘世 API HTTP ${res.status}`);
  const options = await res.json().catch(() => ({}));
  return { backend: 'a1111', baseUrl: cfg.baseUrl, model: options?.sd_model_checkpoint ?? null };
}

// 即使还没画过图，也启动空闲检查：进程刚启动时 A绘世可能已加载着模型。
startImageIdleWatch();
