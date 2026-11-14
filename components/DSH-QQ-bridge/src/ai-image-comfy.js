// ComfyUI 后端客户端（HTTP API，无 WebSocket 依赖）。
//
// 为什么单独一个模块：
// - A绘世用 /sdapi/v1/txt2img，ComfyUI 用 /prompt + /history + /view，两者请求/取图路径完全不同；
//   分开放，ai-image.js 只保留「选后端 + 限额 + 落盘」这一层，回滚只需改 config 的一个字段。
// - 工作流走 API 格式（节点 id → class_type/inputs），固定 9 节点，便于 future 加 LoRA/放大而不用改接口。
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomInt } from 'node:crypto';

// A1111 采样器名 → ComfyUI (sampler_name, scheduler)。认不出的统一回落 euler_ancestral/normal。
const SAMPLER_MAP = new Map([
  ['euler a', ['euler_ancestral', 'normal']],
  ['euler', ['euler', 'normal']],
  ['euler a karras', ['euler_ancestral', 'karras']],
  ['dpm++ 2m', ['dpmpp_2m', 'normal']],
  ['dpm++ 2m karras', ['dpmpp_2m', 'karras']],
  ['dpm++ 2m sde', ['dpmpp_2m_sde', 'normal']],
  ['dpm++ 2m sde karras', ['dpmpp_2m_sde', 'karras']],
  ['dpm++ sde', ['dpmpp_sde', 'normal']],
  ['dpm++ sde karras', ['dpmpp_sde', 'karras']],
  ['dpm++ 3m sde', ['dpmpp_3m_sde', 'normal']],
  ['dpm2', ['dpm_2', 'normal']],
  ['dpm2 a', ['dpm_2_ancestral', 'normal']],
  ['lms', ['lms', 'normal']],
  ['heun', ['heun', 'normal']],
  ['ddim', ['ddim', 'normal']],
  ['unipc', ['uni_pc', 'normal']],
  ['unipc karras', ['uni_pc', 'karras']],
  ['lcm', ['lcm', 'normal']],
  ['deis', ['deis', 'normal']],
  ['res_multistep', ['res_multistep', 'normal']]
]);

export function mapSampler(name) {
  const key = String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (SAMPLER_MAP.has(key)) {
    const [sampler, scheduler] = SAMPLER_MAP.get(key);
    return { samplerName: sampler, scheduler };
  }
  // 已经是 ComfyUI 原生名的（euler_ancestral / dpmpp_2m 等）直接透传
  if (/^[a-z0-9_]+$/.test(key) && key.length <= 40) {
    return { samplerName: key, scheduler: 'normal' };
  }
  return { samplerName: 'euler_ancestral', scheduler: 'normal' };
}

export function buildWorkflow({ checkpoint, prompt, negativePrompt, width, height, steps, cfgScale, seed, samplerName, scheduler }) {
  return {
    1: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: checkpoint } },
    2: { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['1', 1] } },
    3: { class_type: 'CLIPTextEncode', inputs: { text: negativePrompt, clip: ['1', 1] } },
    4: { class_type: 'EmptyLatentImage', inputs: { width, height, batch_size: 1 } },
    5: {
      class_type: 'KSampler',
      inputs: {
        seed: seed >>> 0,
        steps,
        cfg: cfgScale,
        sampler_name: samplerName,
        scheduler,
        denoise: 1,
        model: ['1', 0],
        positive: ['2', 0],
        negative: ['3', 0],
        latent_image: ['4', 0]
      }
    },
    6: { class_type: 'VAEDecode', inputs: { samples: ['5', 0], vae: ['1', 2] } },
    7: { class_type: 'SaveImage', inputs: { images: ['6', 0], filename_prefix: 'qqbot/tmp' } }
  };
}

/**
 * Qwen-Image 2.1 工作流：主干走 GGUF（需 ComfyUI-GGUF 节点），文本编码器是 Qwen3-VL-8B，
 * VAE 是 2.1 专属；编码节点一次出 positive+negative 两路，所以 cfg 固定 1 也能用负向词。
 * 节点 id 固定 1..9，SaveImage 在 9 号（与 SDXL 的 7 号区分，取图时按引擎选输出节点）。
 */
export function buildQwenWorkflow({ unet, clip, vae, prompt, negativePrompt, width, height, steps, cfgScale, seed, samplerName, scheduler }) {
  return {
    1: { class_type: 'UnetLoaderGGUF', inputs: { unet_name: unet } },
    2: { class_type: 'QwenImage21Cache', inputs: { model: ['1', 0], device: 'auto', dtype: 'default' } },
    3: { class_type: 'CLIPLoader', inputs: { clip_name: clip, type: 'qwen_image' } },
    4: { class_type: 'VAELoader', inputs: { vae_name: vae } },
    5: {
      class_type: 'TextEncodeQwenImage21',
      inputs: {
        clip: ['3', 0],
        prompt,
        negative_prompt: negativePrompt,
        resolution: Math.max(256, Math.min(2048, Math.round(Math.max(width, height) / 64) * 64)),
        vae: ['4', 0]
      }
    },
    6: { class_type: 'EmptyLatentImage', inputs: { width, height, batch_size: 1 } },
    7: {
      class_type: 'KSampler',
      inputs: {
        model: ['2', 0],
        seed: seed >>> 0,
        steps,
        cfg: cfgScale,
        sampler_name: samplerName,
        scheduler,
        positive: ['5', 0],
        negative: ['5', 1],
        latent_image: ['6', 0],
        denoise: 1
      }
    },
    8: { class_type: 'VAEDecode', inputs: { samples: ['7', 0], vae: ['4', 0] } },
    9: { class_type: 'SaveImage', inputs: { images: ['8', 0], filename_prefix: 'qqbot/qwen' } }
  };
}

function normalizeBase(url) {
  return String(url || 'http://127.0.0.1:8188').replace(/\/+$/, '');
}

/** 探活：ComfyUI 的 /system_stats 无条件 200，且比 /queue 便宜。 */
export async function comfyProbe(baseUrl, timeoutMs = 2500) {
  try {
    const res = await fetch(`${normalizeBase(baseUrl)}/system_stats`, { signal: AbortSignal.timeout(timeoutMs) });
    return res.ok;
  } catch {
    return false;
  }
}

/** 空闲卸载：/free 会释放模型与显存缓存，但保留进程（下次生成自动重载）。 */
export async function comfyFree(baseUrl) {
  const res = await fetch(`${normalizeBase(baseUrl)}/free`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ unload_models: true, free_memory: true }),
    signal: AbortSignal.timeout(30_000)
  });
  if (!res.ok) throw new Error(`ComfyUI /free HTTP ${res.status}`);
  return true;
}

/** 系统信息（显存/设备），给 doctor 自检与 doctor 报告用。 */
export async function comfySystemStats(baseUrl) {
  const res = await fetch(`${normalizeBase(baseUrl)}/system_stats`, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`ComfyUI /system_stats HTTP ${res.status}`);
  return res.json();
}

/**
 * 提交工作流 → 轮询 /history → /view 取二进制。
 * 返回 { buf, width, height, seed, model, samplerName, scheduler, elapsedMs }。
 */
export async function comfyGenerate({ cfg, engine, prompt, negativePrompt, width, height, steps, cfgScale, seed, samplerName }) {
  const base = normalizeBase(cfg.baseUrl);
  const useQwen = engine?.type === 'qwen';
  const mapped = useQwen ? { samplerName: String(engine.sampler || 'euler'), scheduler: String(engine.scheduler || 'simple') } : mapSampler(samplerName);
  const finalSeed = seed >= 0 ? seed : randomInt(1, 2 ** 31 - 1);
  const workflow = useQwen
    ? buildQwenWorkflow({
      unet: engine.unet,
      clip: engine.clip,
      vae: engine.vae,
      prompt,
      negativePrompt,
      width,
      height,
      steps,
      cfgScale,
      seed: finalSeed,
      samplerName: mapped.samplerName,
      scheduler: mapped.scheduler
    })
    : buildWorkflow({
      checkpoint: engine?.checkpoint || cfg.checkpoint,
      prompt,
      negativePrompt,
      width,
      height,
      steps,
      cfgScale,
      seed: finalSeed,
      samplerName: mapped.samplerName,
      scheduler: cfg.scheduler || mapped.scheduler
    });
  const outputNode = useQwen ? '9' : '7';

  const started = Date.now();
  let promptId;
  try {
    const res = await fetch(`${base}/prompt`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: workflow, client_id: `qqbot-${process.pid}` }),
      signal: AbortSignal.timeout(30_000)
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      const detail = json?.error?.message || json?.node_errors ? JSON.stringify(json).slice(0, 400) : '';
      throw new Error(`ComfyUI /prompt HTTP ${res.status}${detail ? `：${detail}` : ''}`);
    }
    if (json?.node_errors && Object.keys(json.node_errors).length) {
      throw new Error(`ComfyUI 工作流节点报错：${JSON.stringify(json.node_errors).slice(0, 400)}`);
    }
    promptId = json?.prompt_id;
    if (!promptId) throw new Error('ComfyUI 没有返回 prompt_id');
  } catch (error) {
    if (error?.name === 'TimeoutError') throw new Error('ComfyUI /prompt 超时（30s）');
    if (String(error?.message || '').startsWith('ComfyUI')) throw error;
    throw new Error(`连接 ComfyUI 失败（${base}）：${error?.message ?? error}；请确认 ComfyUI 已在 8188 监听`);
  }

  const deadline = Date.now() + cfg.timeoutMs;
  const interval = Math.max(200, Number(cfg.pollIntervalMs) || 600);
  let entry = null;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, interval));
    let history;
    try {
      const res = await fetch(`${base}/history/${promptId}`, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) continue;
      history = await res.json();
    } catch {
      continue;
    }
    const item = history?.[promptId];
    if (!item) continue;
    if (item.status?.status_str === 'error') {
      const msg = (item.status?.messages || []).flat?.()?.join?.(' ') || '未知错误';
      throw new Error(`ComfyUI 生成失败：${msg}`.slice(0, 500));
    }
    entry = item;
    break;
  }
  if (!entry) throw new Error(`ComfyUI 生成超时（${Math.round(cfg.timeoutMs / 1000)}s）`);

  const images = entry.outputs?.[outputNode]?.images || [];
  const first = images[0];
  if (!first?.filename) throw new Error('ComfyUI 没有返回图片（SaveImage 节点无输出）');

  const qs = new URLSearchParams({
    filename: first.filename,
    subfolder: first.subfolder || '',
    type: first.type || 'output'
  });
  const viewRes = await fetch(`${base}/view?${qs.toString()}`, { signal: AbortSignal.timeout(60_000) });
  if (!viewRes.ok) throw new Error(`ComfyUI /view HTTP ${viewRes.status}`);
  const buf = Buffer.from(await viewRes.arrayBuffer());
  if (!buf.length) throw new Error('ComfyUI 返回了空图片');

  return {
    buf,
    width,
    height,
    seed: finalSeed,
    model: useQwen ? (engine.unet || 'qwen-image') : (engine?.checkpoint || cfg.checkpoint),
    engine: engine?.id || (useQwen ? 'qwen' : 'sdxl'),
    samplerName: mapped.samplerName,
    scheduler: mapped.scheduler,
    elapsedMs: Date.now() - started
  };
}

// ── 引擎进程管理 ────────────────────────────────────────────────────────────
// 为什么不用 start-comfy.cmd：桥接是 node 进程，spawn 出去的 cmd 一旦退出，
// 它给子进程发的 CTRL_CLOSE 会把 python 一起带走；而 DSH/pwsh 的进程树清理也会顺手杀掉。
// 直接 detached 起 python（无控制台、stdio 全指日志文件）才是真正「脱离调用者」的做法。
export function resolveComfyLayout(cfg = {}) {
  const root = String(cfg.root || '<LOCAL_TOOLS>\\ComfyUI');
  const baseUrl = String(cfg.baseUrl || 'http://127.0.0.1:8188');
  let port = 8188;
  try {
    const u = new URL(baseUrl);
    if (u.port) port = Number(u.port);
  } catch {}
  return {
    root,
    port,
    pythonExe: String(cfg.pythonExe || path.join(root, 'python_embeded', 'python.exe')),
    mainPy: String(cfg.mainPy || path.join(root, 'ComfyUI', 'main.py')),
    logFile: String(cfg.logFile || path.join(root, 'logs', 'comfy.log')),
    outputDir: String(cfg.outputDir || path.join(root, 'output')),
    inputDir: String(cfg.inputDir || path.join(root, 'input'))
  };
}

export function startComfyDetached(cfg = {}) {
  const l = resolveComfyLayout(cfg);
  if (!fs.existsSync(l.pythonExe)) throw new Error(`ComfyUI python 不存在：${l.pythonExe}`);
  if (!fs.existsSync(l.mainPy)) throw new Error(`ComfyUI main.py 不存在：${l.mainPy}`);
  fs.mkdirSync(path.dirname(l.logFile), { recursive: true });
  fs.mkdirSync(l.outputDir, { recursive: true });
  fs.mkdirSync(l.inputDir, { recursive: true });
  const fd = fs.openSync(l.logFile, 'a');
  try {
    fs.writeSync(fd, `\n[${new Date().toISOString()}] bridge start-comfy (detached)\n`);
    const args = [
      '-s', l.mainPy,
      '--windows-standalone-build',
      '--port', String(l.port),
      '--output-directory', l.outputDir,
      '--input-directory', l.inputDir,
      '--disable-auto-launch'
    ];
    const child = spawn(l.pythonExe, args, {
      cwd: l.root,
      detached: true,
      windowsHide: true,
      stdio: ['ignore', fd, fd]
    });
    child.unref();
    return { pid: child.pid, ...l };
  } finally {
    try { fs.closeSync(fd); } catch {}
  }
}
