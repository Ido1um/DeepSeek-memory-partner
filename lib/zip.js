import zlib from 'node:zlib';

/**
 * Minimal ZIP (store/deflate) reader & writer — no external dependencies.
 * Only what a memory export needs: UTF-8 names, no zip64, no encryption,
 * no symlinks (entries are plain files).
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

export function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosTime(date) {
  const d = date instanceof Date ? date : new Date(date || Date.now());
  const year = Math.max(1980, d.getFullYear());
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const day = ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, day };
}

/**
 * @param {{name:string,data:Buffer,mtime?:Date|number,compress?:boolean}[]} entries
 * @returns {Buffer}
 */
export function createZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(String(entry.name).replace(/\\/g, '/'), 'utf8');
    const raw = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data || '');
    const deflated = entry.compress === false ? raw : zlib.deflateRawSync(raw, { level: 6 });
    const useDeflate = deflated.length < raw.length;
    const body = useDeflate ? deflated : raw;
    const method = useDeflate ? 8 : 0;
    const crc = crc32(raw);
    const { time, day } = dosTime(entry.mtime);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(day, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);

    locals.push(local, name, body);
    centrals.push(central, name);
    offset += local.length + name.length + body.length;
  }

  const centralBlock = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(centrals.length / 2, 8);
  eocd.writeUInt16LE(centrals.length / 2, 10);
  eocd.writeUInt32LE(centralBlock.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, centralBlock, eocd]);
}

/**
 * @param {Buffer} buffer
 * @returns {{name:string,data:Buffer,size:number}[]}
 */
export const ZIP_LIMITS = Object.freeze({ maxInputBytes: 512 * 1024 * 1024, maxEntries: 20000,
  maxEntryBytes: 64 * 1024 * 1024, maxTotalBytes: 512 * 1024 * 1024 });

export function readZip(buffer, options = {}) {
  const limits = { ...ZIP_LIMITS, ...options };
  for (const n of Object.values(limits)) if (!Number.isSafeInteger(n) || n < 0) throw new Error('zip 预算必须是非负整数');
  const tooLarge = () => { throw Object.assign(new Error('zip 超出解压预算'), { code: 'DSMP_ZIP_TOO_LARGE' }); };
  const range = (at, n, end = buffer.length) => {
    if (!Number.isSafeInteger(at) || at < 0 || n < 0 || at + n > end) throw new Error('zip 数据边界损坏');
  };
  if (!Buffer.isBuffer(buffer)) throw new Error('zip 输入必须是 Buffer');
  if (buffer.length > limits.maxInputBytes) tooLarge();
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 66000); i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('不是有效的 zip：找不到中央目录');
  range(eocd, 22);
  if (buffer.readUInt16LE(eocd + 4) || buffer.readUInt16LE(eocd + 6)) throw new Error('不支持分卷 zip');
  const count = buffer.readUInt16LE(eocd + 10);
  if (count > limits.maxEntries) tooLarge();
  if (count !== buffer.readUInt16LE(eocd + 8)) throw new Error('zip 条目数不符');
  const cdSize = buffer.readUInt32LE(eocd + 12);
  const cdOffset = buffer.readUInt32LE(eocd + 16);
  range(cdOffset, cdSize, eocd);
  const cdEnd = cdOffset + cdSize;

  const out = [];
  let p = cdOffset;
  let total = 0;
  for (let i = 0; i < count; i += 1) {
    range(p, 46, cdEnd);
    if (buffer.readUInt32LE(p) !== 0x02014b50) throw new Error('zip 中央目录损坏');
    const method = buffer.readUInt16LE(p + 10);
    const crc = buffer.readUInt32LE(p + 16);
    const csize = buffer.readUInt32LE(p + 20);
    const usize = buffer.readUInt32LE(p + 24);
    const nameLen = buffer.readUInt16LE(p + 28);
    const extraLen = buffer.readUInt16LE(p + 30);
    const commentLen = buffer.readUInt16LE(p + 32);
    const localOffset = buffer.readUInt32LE(p + 42);
    range(p + 46, nameLen + extraLen + commentLen, cdEnd);
    const name = buffer.toString('utf8', p + 46, p + 46 + nameLen);
    if (buffer.readUInt16LE(p + 8) & 1) throw new Error('不支持加密 zip');
    if (usize > limits.maxEntryBytes || usize > limits.maxTotalBytes - total) tooLarge();

    range(localOffset, 30, cdOffset);
    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new Error(`zip 本地头损坏：${name}`);
    const lNameLen = buffer.readUInt16LE(localOffset + 26);
    const lExtraLen = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + lNameLen + lExtraLen;
    range(localOffset + 30, lNameLen + lExtraLen, cdOffset);
    range(dataStart, csize, cdOffset);
    if (buffer.toString('utf8', localOffset + 30, localOffset + 30 + lNameLen) !== name
        || buffer.readUInt16LE(localOffset + 8) !== method) throw new Error('zip 本地头与中央目录不符');
    // Data-descriptor ZIPs legitimately keep zero sizes in the local header.
    if (!(buffer.readUInt16LE(localOffset + 6) & 8)
        && (buffer.readUInt32LE(localOffset + 18) !== csize || buffer.readUInt32LE(localOffset + 22) !== usize
          || buffer.readUInt32LE(localOffset + 14) !== crc)) throw new Error('zip 本地长度/校验与中央目录不符');
    const body = buffer.subarray(dataStart, dataStart + csize);
    let data;
    const cap = Math.min(limits.maxEntryBytes, limits.maxTotalBytes - total);
    if (method === 0) { if (body.length > cap) tooLarge(); data = Buffer.from(body); }
    else if (method === 8) {
      try { data = zlib.inflateRawSync(body, { maxOutputLength: Math.max(1, cap) }); }
      catch (e) { if (e.code === 'ERR_BUFFER_TOO_LARGE') tooLarge(); throw e; }
    }
    else throw new Error(`不支持的压缩方法 ${method}（${name}）`);

    if (data.length > cap) tooLarge();
    total += data.length;
    if (data.length !== usize) throw new Error(`zip 条目长度不符：${name}`);
    if (crc32(data) !== crc) throw new Error(`zip 条目校验失败：${name}`);
    out.push({ name, data, size: data.length });
    p += 46 + nameLen + extraLen + commentLen;
  }
  if (p !== cdEnd) throw new Error('zip 中央目录长度不符');
  return out;
}
