/**
 * QQ 语音转写（P0）。
 *
 * 复用 DSH 宿主里已有的语音识别服务（`@deepseek-ai/dsh-experimental-voice-input-bundle`
 * 提供的 `speechToText`，本机 provider 是 SenseVoice），不自己跑模型、不上传云端。
 *
 * 数据流：
 *   bridge 取到 QQ 语音 → SnowLuma `get_record(out_format:'wav')` 解 SILK
 *   → bridge 用 ffmpeg 归一化成 16k/单声道/PCM16 WAV
 *   → POST /api/dsmp/voice/transcribe（本模块）
 *   → speechToText.transcribe() → 文字
 *   → 语音库存一份（带 transcript），bridge 把 "[语音]" 换成 "[语音转写] …"
 *
 * 设计边界：
 *  - 只接受严格的 16k/单声道/PCM16 WAV：provider 的 validateWave 逐字段校验，
 *    这里先按同一套规则拦一次，错误信息比 provider 的可读；
 *  - 4 MB / 110 秒上限（provider 的 maxAudioBytes 是 4 MB，约 125 秒）；
 *  - 同一段语音按 sha1 缓存：voice.jsonl 里已有 transcript 就直接返回，不重复推理；
 *  - `prepare()` 是 fire-and-forget（不返回 Promise），必须轮询 snapshot() 的
 *    preparation.phase，等到 ready/standby 才能 transcribe；
 *  - 任何失败都抛带 code 的错误，由路由转成 4xx/503，让 bridge 回退成 "[语音]"。
 *
 * 注意：本模块被 loadModule() 用 data: URL 载入，不能有相对 import。
 */
import { createHash } from 'node:crypto';

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_SECONDS = 110;
const DEFAULT_MAX_BYTES = 4 * 1024 * 1024;
const DEFAULT_PREPARE_MS = 30_000;
const READY_PHASES = new Set(['ready', 'standby']);
const BUSY_PHASES = new Set(['unprepared', 'checking', 'downloading', 'waking', 'loading', 'cancelling']);

let deps = {
  ctx: null,
  getSettings: () => ({}),
  storeOf: () => null,
  saveInboundVoice: null,
  log: () => {}
};

/** 注入宿主依赖（apply() 里调用一次；测试可直接换掉 store/ctx）。 */
export function configureVoiceStt(next = {}) {
  deps = { ...deps, ...next };
}

/** 读 `media.voice.stt` 配置并夹到安全范围。 */
export function sttConfig() {
  const media = (deps.getSettings() || {}).media || {};
  const raw = (media.voice && media.voice.stt) || {};
  return {
    enabled: raw.enabled !== false,
    provider: String(raw.provider || '').trim(),
    language: String(raw.language || 'zh').trim() || 'zh',
    timeoutMs: Math.min(120_000, Math.max(2_000, Number(raw.timeoutMs) || DEFAULT_TIMEOUT_MS)),
    maxSeconds: Math.min(300, Math.max(5, Number(raw.maxSeconds) || DEFAULT_MAX_SECONDS)),
    maxBytes: Math.min(DEFAULT_MAX_BYTES, Math.max(64 * 1024, Number(raw.maxBytes) || DEFAULT_MAX_BYTES)),
    prepareTimeoutMs: Math.min(300_000, Math.max(5_000, Number(raw.prepareTimeoutMs) || DEFAULT_PREPARE_MS))
  };
}

function fail(message, code, extra = {}) {
  throw Object.assign(new Error(message), { code, ...extra });
}

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

/**
 * 严格解析 canonical WAV（与 provider 的 validateWave 同口径）。
 * @returns {{ok:true, seconds:number, dataBytes:number}|{ok:false, error:string}}
 */
export function waveInfo(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 44) return { ok: false, error: '文件太小，不是 WAV' };
  const ascii = (start, len) => buffer.toString('latin1', start, start + len);
  if (ascii(0, 4) !== 'RIFF' || ascii(8, 4) !== 'WAVE') return { ok: false, error: '不是 RIFF/WAVE' };
  const riffSize = buffer.readUInt32LE(4);
  if (riffSize + 8 !== buffer.length) return { ok: false, error: `RIFF 长度不符（${riffSize + 8} ≠ ${buffer.length}）` };

  let fmt = null;
  let fmtBody = -1;
  let data = null;
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const id = ascii(offset, 4);
    const size = buffer.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (body + size > buffer.length) return { ok: false, error: `chunk ${id} 越界` };
    if (id === 'fmt ') {
      if (size < 16) return { ok: false, error: 'fmt 段太短' };
      fmtBody = body;
      fmt = {
        format: buffer.readUInt16LE(body),
        channels: buffer.readUInt16LE(body + 2),
        sampleRate: buffer.readUInt32LE(body + 4),
        byteRate: buffer.readUInt32LE(body + 8),
        blockAlign: buffer.readUInt16LE(body + 12),
        bits: buffer.readUInt16LE(body + 14)
      };
    } else if (id === 'data') {
      data = { start: body, size };
    }
    offset = body + size + (size % 2);
  }

  if (!fmt) return { ok: false, error: '缺少 fmt 段' };
  if (!data) return { ok: false, error: '缺少 data 段' };
  // provider 是按固定偏移校验的：fmt 必须紧跟在 WAVE 之后（body=20），data 头必须在 36。
  // ffmpeg 默认写 LIST(INFO) 块会破坏这个布局，桥接侧已削掉；这里再拦一次，错误更可读。
  if (fmtBody !== 20) return { ok: false, error: 'WAV 头不是 44 字节标准布局（fmt 偏移不对）' };
  if (data.start !== 44) return { ok: false, error: 'WAV 头不是 44 字节标准布局（data 偏移不对，可能有 LIST 等附加块）' };
  if (fmt.format !== 1) return { ok: false, error: `不是 PCM（format=${fmt.format}）` };
  if (fmt.channels !== 1) return { ok: false, error: `不是单声道（channels=${fmt.channels}）` };
  if (fmt.sampleRate !== 16_000) return { ok: false, error: `采样率不是 16k（${fmt.sampleRate}）` };
  if (fmt.bits !== 16) return { ok: false, error: `位深不是 16bit（${fmt.bits}）` };
  if (fmt.blockAlign !== 2) return { ok: false, error: `blockAlign 不是 2（${fmt.blockAlign}）` };
  if (fmt.byteRate !== 32_000) return { ok: false, error: `byteRate 不是 32000（${fmt.byteRate}）` };
  if (data.size % 2 !== 0) return { ok: false, error: 'data 长度不是偶数' };
  if (data.size === 0) return { ok: false, error: 'data 为空' };
  if (data.start + data.size !== buffer.length) return { ok: false, error: 'data 后还有多余字节' };
  return { ok: true, seconds: data.size / 32_000, dataBytes: data.size };
}

function decodePayload(payload, maxBytes) {
  const body = payload && typeof payload === 'object' ? payload : {};
  const raw = typeof body.data === 'string' ? body.data.trim() : '';
  const base64 = raw.startsWith('data:') ? raw.slice(raw.indexOf(',') + 1) : raw;
  if (!base64) fail('缺少语音数据（data 为空）', 'DSMP_VOICE_EMPTY');
  if (base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    fail('语音 base64 格式不正确', 'DSMP_VOICE_BASE64');
  }
  const estimate = Math.floor((base64.length * 3) / 4);
  if (estimate > maxBytes + 1024) {
    fail(`语音太大：约 ${estimate} 字节，上限 ${maxBytes}`, 'DSMP_STT_TOO_LARGE');
  }
  let buffer;
  try {
    buffer = Buffer.from(base64, 'base64');
  } catch {
    fail('语音 base64 解码失败', 'DSMP_VOICE_BASE64');
  }
  if (!buffer.length) fail('语音数据为空', 'DSMP_VOICE_EMPTY');
  if (buffer.length > maxBytes) fail(`语音太大：${buffer.length} 字节，上限 ${maxBytes}`, 'DSMP_STT_TOO_LARGE');
  return { body, base64, buffer };
}

function pickProvider(stt, cfg) {
  let snap;
  try {
    snap = stt.snapshot();
  } catch (error) {
    fail(`语音识别服务不可用：${error && error.message}`, 'DSMP_STT_UNAVAILABLE');
  }
  const list = Array.isArray(snap && snap.providers) ? snap.providers : [];
  if (!list.length) fail('没有注册任何语音识别 provider', 'DSMP_STT_UNAVAILABLE');
  const wanted = cfg.provider || (snap.selection && snap.selection.providerId) || '';
  const hit = (wanted && list.find((item) => item && item.id === wanted)) || list[0];
  if (!hit || !hit.id) fail('没有可用的语音识别 provider', 'DSMP_STT_UNAVAILABLE');
  return {
    id: String(hit.id),
    name: String(hit.name || hit.id),
    phase: String((hit.preparation && hit.preparation.phase) || 'ready')
  };
}

async function waitReady(stt, provider, cfg) {
  if (READY_PHASES.has(provider.phase)) return provider;
  if (!BUSY_PHASES.has(provider.phase) && provider.phase !== 'unprepared') {
    if (provider.phase === 'failed' || provider.phase === 'cancelled') {
      fail(`语音模型准备失败（phase=${provider.phase}）`, 'DSMP_STT_NOT_READY');
    }
  }
  try {
    stt.prepare(provider.id);
  } catch (error) {
    fail(`语音模型准备启动失败：${error && error.message}`, 'DSMP_STT_NOT_READY');
  }
  const deadline = Date.now() + cfg.prepareTimeoutMs;
  let phase = provider.phase;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 300));
    try {
      const snap = stt.snapshot();
      const item = (snap.providers || []).find((row) => row && row.id === provider.id);
      phase = String((item && item.preparation && item.preparation.phase) || '');
    } catch {
      /* keep polling */
    }
    if (READY_PHASES.has(phase)) return { ...provider, phase };
    if (phase === 'failed' || phase === 'cancelled') {
      fail(`语音模型准备失败（phase=${phase}）`, 'DSMP_STT_NOT_READY');
    }
  }
  fail(`语音模型准备超时（phase=${phase || 'unknown'}）`, 'DSMP_STT_TIMEOUT');
}

function saveTranscript({ store, body, base64, text, duration }) {
  if (typeof deps.saveInboundVoice !== 'function') return null;
  try {
    return deps.saveInboundVoice({
      store,
      payload: {
        data: base64,
        name: body.name,
        key: body.key,
        msgId: body.msgId,
        from: body.from,
        duration,
        transcript: text
      }
    });
  } catch (error) {
    deps.log(`[stt] 语音落库失败（不影响转写）：${error && error.message}`);
    return null;
  }
}

/**
 * 转写一段语音；成功后顺带把 WAV 与 transcript 写进语音库（按 sha1 去重）。
 * @param {object} opts { payload: {data, key, msgId, name, from, duration} }
 * @returns {Promise<{ok:true, text:string, sha1:string, cached:boolean, ms:number, audioSeconds:number, provider:string}>}
 */
export async function transcribeVoice({ payload } = {}) {
  const cfg = sttConfig();
  if (!cfg.enabled) fail('语音转写未启用（media.voice.stt.enabled=false）', 'DSMP_STT_DISABLED');

  const store = deps.storeOf();
  if (!store || typeof store.get !== 'function') fail('媒体库不可用', 'DSMP_MEDIA_UNAVAILABLE');

  const { body, base64, buffer } = decodePayload(payload, cfg.maxBytes);
  const info = waveInfo(buffer);
  if (!info.ok) fail(`音频不是 16k/单声道/PCM16 WAV：${info.error}`, 'DSMP_STT_WAVE');
  if (info.seconds > cfg.maxSeconds + 0.5) {
    fail(`语音太长：${info.seconds.toFixed(1)}s，上限 ${cfg.maxSeconds}s`, 'DSMP_STT_TOO_LONG');
  }

  const sha1 = createHash('sha1').update(buffer).digest('hex');
  let cachedRow = null;
  try {
    const got = store.get(sha1, { kind: 'voice' });
    if (got && got.ok && got.row) cachedRow = got.row;
  } catch {
    /* cache is best-effort */
  }
  if (cachedRow && cleanText(cachedRow.transcript)) {
    return {
      ok: true,
      text: cleanText(cachedRow.transcript),
      sha1,
      cached: true,
      ms: 0,
      audioSeconds: Number(info.seconds.toFixed(2)),
      provider: String(cfg.provider || '')
    };
  }

  const stt = deps.ctx && typeof deps.ctx.get === 'function' ? deps.ctx.get('speechToText') : null;
  if (!stt || typeof stt.transcribe !== 'function') {
    fail('DSH 没有可用的语音识别服务（speechToText 未加载）', 'DSMP_STT_UNAVAILABLE');
  }

  const provider = await waitReady(stt, pickProvider(stt, cfg), cfg);
  const started = Date.now();
  let out;
  try {
    const spec = stt.resolve({ audio: buffer, providerId: provider.id, language: cfg.language });
    out = await stt.transcribe(spec, AbortSignal.timeout(cfg.timeoutMs));
  } catch (error) {
    const name = String((error && error.name) || '');
    if (name === 'TimeoutError' || name === 'AbortError') {
      fail(`语音识别超时（${cfg.timeoutMs}ms）`, 'DSMP_STT_TIMEOUT');
    }
    fail(`语音识别失败：${(error && error.message) || error}`, 'DSMP_STT_FAILED');
  }

  const text = cleanText(out && out.text);
  if (!text) fail('语音识别结果为空', 'DSMP_STT_EMPTY');

  const saved = saveTranscript({ store, body, base64, text, duration: Number(body.duration) || 0 });
  return {
    ok: true,
    text,
    sha1,
    cached: false,
    ms: Date.now() - started,
    audioSeconds: Number((out && out.audioSeconds) || info.seconds.toFixed(2)),
    provider: `${provider.name || provider.id}`,
    stored: Boolean(saved && saved.ok)
  };
}

/** 面板/诊断用的只读状态（不触发 prepare）。 */
export function sttStatus() {
  const cfg = sttConfig();
  const stt = deps.ctx && typeof deps.ctx.get === 'function' ? deps.ctx.get('speechToText') : null;
  const out = { enabled: cfg.enabled, available: Boolean(stt), provider: '', phase: '', language: cfg.language, error: '' };
  if (!stt) return out;
  try {
    const snap = stt.snapshot();
    const list = Array.isArray(snap && snap.providers) ? snap.providers : [];
    const wanted = cfg.provider || (snap.selection && snap.selection.providerId) || '';
    const hit = (wanted && list.find((item) => item && item.id === wanted)) || list[0];
    if (hit) {
      out.provider = String(hit.id || '');
      out.phase = String((hit.preparation && hit.preparation.phase) || 'ready');
    }
  } catch (error) {
    out.error = String((error && error.message) || error);
  }
  return out;
}
