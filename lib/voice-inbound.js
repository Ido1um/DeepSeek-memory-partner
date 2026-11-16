/**
 * Inbound / outbound voice bridge (P1 + B3).
 *
 * QQ 语音的字节由 bridge 取到后经 base64 送进来；这里负责校验并落进语音库
 * （`<记忆根>/voice/YYYY-MM/<sha1>.<ext>` + `state/voice.jsonl`）。
 *
 * 两个方向共用同一套校验，区别只在元数据：
 *  - inbound：主人发来的，`direction:'in'`、`speaker:'owner'`，没有原文；
 *  - outbound：<PERSONA>自己发出去的，`direction:'out'`、`speaker:'persona'`。
 *    TTS 的原文在发送参数里（`textSource:'tts-input'`），直接记下来，不需要识别；
 *    语音库里的固定语音没有原文，先留空，等按需识别或人工补。
 *
 * 设计边界：
 *  - 只接受能被 `sniff()` 认出的音频（OGG/WAV/MP3/M4A），不信任传入的 mime；
 *  - 大小上限沿用语音库的 `maxVoiceBytes`（默认 16 MB）；
 *  - 同一段语音重复上报时按 sha1 去重，只补 msgId / key / duration / text 等缺失字段；
 *  - 任何失败都抛出带 `code` 的错误，由路由转成 4xx，不让 bridge 端的失败静默。
 */
// 注意：这里不能 `import { sniff } from './media-store.js'`。
// 开发期热重载把本模块包成 data:text/javascript，data: URL 不能解析相对
// 模块说明符（ERR_UNSUPPORTED_RESOLVE_REQUEST），整条插件会激活失败。
// 所以只在这里放一份最小音频嗅探；落库时 media-store 还会再判一次。
function sniffVoice(buffer) {
  if (!buffer || buffer.length < 12) return null;
  const head = (start, len) => buffer.toString('latin1', start, start + len);
  if (head(0, 4) === 'OggS') return { mime: 'audio/ogg', kind: 'voice' };
  if (head(0, 4) === 'RIFF' && head(8, 4) === 'WAVE') return { mime: 'audio/wav', kind: 'voice' };
  if (head(0, 3) === 'ID3') return { mime: 'audio/mpeg', kind: 'voice' };
  if (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) return { mime: 'audio/mpeg', kind: 'voice' };
  if (head(4, 4) === 'ftyp') return { mime: 'audio/mp4', kind: 'voice' };
  return null;
}

export const INBOUND_VOICE_SOURCE = 'qq';
export const OUTBOUND_VOICE_SOURCE = 'qq-outbound';

function fail(message, code, extra = {}) {
  throw Object.assign(new Error(message), { code, ...extra });
}

function decodeVoice({ store, payload }) {
  if (!store || typeof store.save !== 'function') {
    fail('媒体库不可用', 'DSMP_MEDIA_UNAVAILABLE');
  }
  const body = payload && typeof payload === 'object' ? payload : {};
  const base64 = typeof body.data === 'string' ? body.data.trim() : '';
  if (!base64) fail('缺少语音数据（data 为空）', 'DSMP_VOICE_EMPTY');

  // 先按 base64 长度估算，避免为一个超限文件真的分配几十 MB。
  const estimate = Math.floor((base64.length * 3) / 4);
  const limit = Number(store.maxVoiceBytes) || 16 * 1024 * 1024;
  if (estimate > limit + 1024) {
    fail(`语音太大：约 ${estimate} 字节，上限 ${limit}`, 'DSMP_VOICE_TOO_LARGE');
  }

  let buffer;
  try {
    buffer = Buffer.from(base64, 'base64');
  } catch {
    fail('语音 base64 解码失败', 'DSMP_VOICE_BASE64');
  }
  if (!buffer.length) fail('语音数据为空', 'DSMP_VOICE_EMPTY');
  if (buffer.length > limit) {
    fail(`语音太大：${buffer.length} 字节，上限 ${limit}`, 'DSMP_VOICE_TOO_LARGE');
  }

  const info = sniffVoice(buffer);
  if (!info || info.kind !== 'voice') {
    fail(`不是可识别的音频（识别为 ${info ? info.mime : '未知'}）`, 'DSMP_VOICE_TYPE');
  }
  return { body, buffer };
}

/**
 * @param {object} opts
 * @param {import('./media-store.js').MediaStore} opts.store
 * @param {object} opts.payload  { data(base64), name, key, msgId, from, duration, transcript }
 * @returns {{ok:true, sha1:string, bytes:number, mime:string, dup:boolean, at:string, name:string, direction:'in'}}
 */
export function saveInboundVoice({ store, payload } = {}) {
  const { body, buffer } = decodeVoice({ store, payload });
  const name = String(body.name || '').slice(0, 120);
  const from = String(body.from || '').slice(0, 60);
  const duration = Number(body.duration) > 0 ? Math.round(Number(body.duration)) : 0;
  const saved = store.save(buffer, {
    kind: 'voice',
    name,
    key: String(body.key || ''),
    msgId: body.msgId == null ? '' : String(body.msgId),
    source: INBOUND_VOICE_SOURCE,
    alt: from ? `来自 ${from}` : '',
    transcript: String(body.transcript || ''),
    duration,
    direction: 'in',
    speaker: 'owner'
  });

  return {
    ok: true,
    sha1: saved.sha1,
    bytes: saved.bytes,
    mime: saved.mime,
    dup: saved.dup,
    at: saved.at,
    name,
    duration,
    direction: 'in'
  };
}

/**
 * <PERSONA>自己发出去的语音（TTS 或语音库）。
 *
 * @param {object} opts
 * @param {object} opts.payload { data(base64), name, key, msgId, text, textSource, source, duration, detail }
 * @returns {{ok:true, sha1:string, bytes:number, dup:boolean, at:string, name:string, direction:'out', text:string}}
 */
export function saveOutboundVoice({ store, payload } = {}) {
  const { body, buffer } = decodeVoice({ store, payload });
  const name = String(body.name || '').slice(0, 120);
  const duration = Number(body.duration) > 0 ? Math.round(Number(body.duration)) : 0;
  const text = String(body.text || '').replace(/\s+/g, ' ').trim().slice(0, 2000);
  // 只有调用方明确给了 textSource 才认，避免把空串写成“有原文”。
  const rawSource = String(body.textSource || body.source || '').trim();
  const textSource = text
    ? (['tts-input', 'stt', 'library-meta', 'manual'].includes(rawSource) ? rawSource : 'tts-input')
    : '';
  const saved = store.save(buffer, {
    kind: 'voice',
    name,
    key: String(body.key || ''),
    msgId: body.msgId == null ? '' : String(body.msgId),
    source: OUTBOUND_VOICE_SOURCE,
    alt: '<PERSONA>发出',
    duration,
    direction: 'out',
    speaker: 'persona',
    text,
    textSource
  });

  return {
    ok: true,
    sha1: saved.sha1,
    bytes: saved.bytes,
    mime: saved.mime,
    dup: saved.dup,
    at: saved.at,
    name,
    duration,
    direction: 'out',
    text,
    textSource
  };
}
