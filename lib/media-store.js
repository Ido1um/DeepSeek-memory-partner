/**
 * Content-addressed media store (M3).
 *
 * Layout inside the memory directory (shared with the memory engine):
 *   <root>/media/YYYY-MM/<sha1>.<ext>   images  (same place the engine writes)
 *   <root>/voice/YYYY-MM/<sha1>.<ext>   voice   (separate library, M3)
 *   <root>/state/media.jsonl            image index
 *   <root>/state/voice.jsonl            voice index
 *
 * Rules:
 *  - Bytes are addressed by sha1: re-uploading the same picture costs nothing.
 *  - Nothing is ever deleted here; the plan says media is kept forever and the
 *    panel only warns about size.
 *  - Under test isolation the root is <DSH_HOME>/dsmp/test/memory, so the
 *    production library is never touched.
 *  - Voice rows carry a `transcript` field that stays empty until STT exists;
 *    keeping it now means the format does not change when transcription lands.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const IMAGE_MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const MONTH = () => new Date().toISOString().slice(0, 7);

/** 索引里的 rel 不可信：必须是 root 内的普通相对路径，且不能借链接逃逸。 */
export function mediaFilePathSafe(root, rel) {
  const raw = String(rel || '').replace(/\\/g, '/');
  if (!raw || raw.startsWith('/') || /^[a-zA-Z]:/.test(raw)) return null;
  for (const part of raw.split('/')) {
    if (!part || part === '.' || part === '..') return null;
    if (part.endsWith('.') || part.endsWith(' ')) return null;
    if (/[\u0000-\u001f<>:"|?*]/.test(part)) return null;
  }
  const base = path.resolve(String(root || ''));
  const abs = path.resolve(base, raw);
  if (abs === base || !abs.startsWith(base + path.sep)) return null;
  try {
    const realBase = fs.realpathSync.native ? fs.realpathSync.native(base) : fs.realpathSync(base);
    const realAbs = fs.realpathSync.native ? fs.realpathSync.native(abs) : fs.realpathSync(abs);
    if (realAbs !== realBase && !realAbs.startsWith(realBase + path.sep)) return null;
  } catch {
    // 不存在时按字符串结果继续，readFileSync 会报错给调用方。
  }
  return abs;
}

/** Identify a buffer by magic bytes; returns null when it is neither image nor audio. */
export function sniff(buffer) {
  if (!buffer || buffer.length < 12) return null;
  const b = buffer;
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    const width = b.readUInt32BE(16);
    const height = b.readUInt32BE(20);
    return { mime: 'image/png', ext: 'png', kind: 'image', width, height };
  }
  // JPEG: FF D8 FF
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    const size = jpegSize(b);
    return { mime: 'image/jpeg', ext: 'jpg', kind: 'image', width: size.width, height: size.height };
  }
  // GIF: "GIF8"
  if (b.toString('ascii', 0, 4) === 'GIF8') {
    return { mime: 'image/gif', ext: 'gif', kind: 'image', width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
  }
  // WEBP: "RIFF"…"WEBP"
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    return { mime: 'image/webp', ext: 'webp', kind: 'image', ...webpSize(b) };
  }
  // OGG / OPUS
  if (b.toString('ascii', 0, 4) === 'OggS') return { mime: 'audio/ogg', ext: 'ogg', kind: 'voice' };
  // WAV: "RIFF"…"WAVE"
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WAVE') {
    return { mime: 'audio/wav', ext: 'wav', kind: 'voice' };
  }
  // MP3: ID3 tag or a bare frame sync
  if (b.toString('ascii', 0, 3) === 'ID3') return { mime: 'audio/mpeg', ext: 'mp3', kind: 'voice' };
  if (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) return { mime: 'audio/mpeg', ext: 'mp3', kind: 'voice' };
  // MP4/M4A: box size then "ftyp"
  if (b.toString('ascii', 4, 8) === 'ftyp') {
    const brand = b.toString('ascii', 8, 12);
    const ext = brand.startsWith('M4A') ? 'm4a' : 'mp4';
    return { mime: ext === 'm4a' ? 'audio/mp4' : 'video/mp4', ext, kind: 'voice' };
  }
  return null;
}

function jpegSize(b) {
  let offset = 2;
  while (offset + 9 < b.length) {
    if (b[offset] !== 0xff) { offset += 1; continue; }
    const marker = b[offset + 1];
    const length = b.readUInt16BE(offset + 2);
    // SOF0..SOF3, SOF5..SOF7, SOF9..SOF11, SOF13..SOF15 carry the frame size.
    const isSof = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isSof) {
      return { height: b.readUInt16BE(offset + 5), width: b.readUInt16BE(offset + 7) };
    }
    offset += 2 + length;
  }
  return { width: 0, height: 0 };
}

function webpSize(b) {
  const chunk = b.toString('ascii', 12, 16);
  if (chunk === 'VP8 ' && b.length >= 30) {
    return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
  }
  if (chunk === 'VP8L' && b.length >= 25) {
    const bits = b.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8X' && b.length >= 30) {
    return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
  }
  return { width: 0, height: 0 };
}

export class MediaStore {
  constructor({ rootDir, maxImageBytes = 16 * 1024 * 1024, maxVoiceBytes = 16 * 1024 * 1024 } = {}) {
    this.root = String(rootDir || '');
    this.maxImageBytes = maxImageBytes;
    this.maxVoiceBytes = maxVoiceBytes;
    this.indexCache = new Map();
  }

  get ready() {
    return Boolean(this.root);
  }

  dirOf(kind) {
    return path.join(this.root, kind === 'voice' ? 'voice' : 'media');
  }

  indexFile(kind) {
    return path.join(this.root, 'state', kind === 'voice' ? 'voice.jsonl' : 'media.jsonl');
  }

  /** Index rows keyed by sha1, re-read only when the file changes. */
  #index(kind) {
    const file = this.indexFile(kind);
    let stat;
    try {
      stat = fs.statSync(file);
    } catch {
      return new Map();
    }
    const cached = this.indexCache.get(file);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.rows;
    const rows = new Map();
    try {
      const text = fs.readFileSync(file, 'utf8');
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        try {
          const row = JSON.parse(line);
          if (row && row.sha1) rows.set(String(row.sha1), row);
        } catch { /* skip a torn line */ }
      }
    } catch {
      /* unreadable index behaves as empty */
    }
    this.indexCache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, rows });
    return rows;
  }

  /**
   * Store one buffer. `meta` may carry key/msgId/alt/source/transcript/duration and
   * the voice-only fields direction/speaker/text/textSource; the picture is written
   * only when its sha1 is new, and the index row is appended once per sha1 (later
   * mentions only fill in missing msgId/key/alt/transcript).
   */
  save(buffer, { kind = 'image', name = '', key = '', msgId = '', alt = '', source = 'panel', transcript = '', duration = 0, direction = 'in', speaker = '', text = '', textSource = '' } = {}) {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      throw Object.assign(new Error('空文件'), { code: 'DSMP_MEDIA_EMPTY' });
    }
    const info = sniff(buffer);
    if (!info) {
      throw Object.assign(new Error('无法识别的文件类型（只支持 PNG/JPEG/WebP/GIF 与 OGG/WAV/MP3/M4A）'), { code: 'DSMP_MEDIA_TYPE' });
    }
    const wanted = kind === 'voice' ? 'voice' : 'image';
    if (info.kind !== wanted) {
      throw Object.assign(new Error(`文件类型与目标库不符：识别为 ${info.kind}，写入 ${wanted}`), { code: 'DSMP_MEDIA_KIND' });
    }
    const limit = wanted === 'voice' ? this.maxVoiceBytes : this.maxImageBytes;
    if (buffer.length > limit) {
      throw Object.assign(new Error(`文件太大：${buffer.length} 字节，上限 ${limit}`), { code: 'DSMP_MEDIA_TOO_LARGE' });
    }
    const sha1 = createHash('sha1').update(buffer).digest('hex');
    const month = MONTH();
    const rel = path.join(wanted === 'voice' ? 'voice' : 'media', month, `${sha1}.${info.ext}`);
    const dest = path.join(this.root, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    let dup = true;
    if (!fs.existsSync(dest)) {
      const tmp = `${dest}.tmp-${process.pid}-${Date.now()}`;
      fs.writeFileSync(tmp, buffer);
      fs.renameSync(tmp, dest);
      dup = false;
    }

    const rows = this.#index(wanted);
    const existing = rows.get(sha1);
    const at = new Date().toISOString();
    const voiceMeta = wanted === 'voice'
      ? { direction: direction === 'out' ? 'out' : 'in', speaker: speaker || (direction === 'out' ? 'persona' : 'owner') }
      : {};
    const fills = { key, msgId, alt, name, transcript, duration: duration || '' };
    let row;
    if (existing) {
      row = { ...existing };
      let changed = false;
      for (const [field, value] of Object.entries(fills)) {
        if (value && !existing[field]) { row[field] = value; changed = true; }
      }
      // Later reports may carry the spoken text (TTS knows it only at send time);
      // fill it in but never clobber a manually corrected line.
      if (wanted === 'voice' && text && (!existing.text || (textSource === 'manual' && existing.textSource !== 'manual'))) {
        row.text = text;
        row.textSource = textSource || 'tts-input';
        changed = true;
      }
      if (changed) this.#rewriteIndex(wanted, rows, row);
    } else {
      row = {
        sha1,
        rel: rel.split(path.sep).join('/'),
        ext: info.ext,
        mime: info.mime,
        bytes: buffer.length,
        kind: wanted,
        at,
        day: at.slice(0, 10),
        key,
        msgId,
        alt,
        name,
        source,
        ...voiceMeta,
        ...(info.width ? { width: info.width, height: info.height } : {}),
        ...(wanted === 'voice'
          ? { transcript: transcript || text || '', ...(duration ? { duration } : {}), text: text || '', textSource: text ? (textSource || 'tts-input') : '' }
          : {})
      };
      fs.mkdirSync(path.dirname(this.indexFile(wanted)), { recursive: true });
      fs.appendFileSync(this.indexFile(wanted), `${JSON.stringify(row)}\n`, 'utf8');
      rows.set(sha1, row);
      this.indexCache.delete(this.indexFile(wanted));
    }
    return { ok: true, sha1, rel: row.rel, ext: row.ext, mime: row.mime, bytes: row.bytes, kind: wanted, dup, at, width: row.width || 0, height: row.height || 0 };
  }

  #rewriteIndex(kind, rows, updated) {
    rows.set(updated.sha1, updated);
    const file = this.indexFile(kind);
    const tmp = `${file}.tmp-${process.pid}`;
    const body = [...rows.values()].map((row) => JSON.stringify(row)).join('\n');
    fs.writeFileSync(tmp, body ? `${body}\n` : '', 'utf8');
    fs.renameSync(tmp, file);
    this.indexCache.delete(file);
  }

  /** Read one stored object: { ok, buffer, row } or { ok:false, error }. */
  get(sha1, { kind = 'image' } = {}) {
    const wanted = kind === 'voice' ? 'voice' : 'image';
    const row = this.#index(wanted).get(String(sha1));
    if (!row) return { ok: false, error: '没有这张图/这条语音' };
    const file = mediaFilePathSafe(this.root, row.rel);
    if (!file) return { ok: false, error: '媒体索引路径越界，已拒绝读取' };
    try {
      return { ok: true, buffer: fs.readFileSync(file), row, file };
    } catch (err) {
      return { ok: false, error: `文件读取失败：${err && err.message}` };
    }
  }

  list({ kind = 'image', limit = 50 } = {}) {
    const wanted = kind === 'voice' ? 'voice' : 'image';
    const rows = [...this.#index(wanted).values()]
      .sort((a, b) => String(b.at).localeCompare(String(a.at)))
      .slice(0, Math.min(500, Math.max(1, Number(limit) || 50)));
    return { ok: true, kind: wanted, count: this.#index(wanted).size, items: rows };
  }
}
