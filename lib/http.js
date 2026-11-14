/** Small HTTP helpers shared by the DSMP host routes. */

export function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body)
  });
  res.end(body);
}

export function sendText(res, status, text, contentType = 'text/plain; charset=utf-8') {
  const body = String(text ?? '');
  res.writeHead(status, {
    'content-type': contentType,
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body)
  });
  res.end(body);
}

export function readJsonBody(req, limitBytes = 256 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limitBytes) {
        reject(new Error('request body too large'));
        req.destroy();
        return;
      }
      chunks.push(Buffer.from(chunk));
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

export function queryOf(req) {
  try {
    return new URL(req.url || '/', 'http://127.0.0.1').searchParams;
  } catch {
    return new URLSearchParams();
  }
}

/** Collect a raw request body (media upload). Bytes are never decoded as text. */
export function readRawBody(req, limitBytes = 16 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limitBytes) {
        reject(Object.assign(new Error(`文件超过上限（${limitBytes} 字节）`), { code: 'DSMP_MEDIA_TOO_LARGE' }));
        req.destroy();
        return;
      }
      chunks.push(Buffer.from(chunk));
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** Send bytes with a strong ETag; honours a single Range for audio playback. */
export function sendBuffer(req, res, buffer, { contentType = 'application/octet-stream', etag = '', immutable = true } = {}) {
  const total = buffer.length;
  const tag = etag ? `"${etag}"` : '';
  if (tag && req.headers['if-none-match'] === tag) {
    res.writeHead(304, { etag: tag, 'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-store' });
    res.end();
    return;
  }
  const range = String(req.headers.range || '');
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  const headers = {
    'content-type': contentType,
    'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-store',
    'accept-ranges': 'bytes',
    ...(tag ? { etag: tag } : {})
  };
  if (match) {
    let start = match[1] === '' ? NaN : Number(match[1]);
    let end = match[2] === '' ? NaN : Number(match[2]);
    if (Number.isNaN(start) && Number.isNaN(end)) {
      res.writeHead(416, { 'content-range': `bytes */${total}` });
      res.end();
      return;
    }
    if (Number.isNaN(start)) {
      start = Math.max(0, total - end);
      end = total - 1;
    } else if (Number.isNaN(end) || end >= total) {
      end = total - 1;
    }
    if (start > end || start >= total) {
      res.writeHead(416, { 'content-range': `bytes */${total}` });
      res.end();
      return;
    }
    const slice = buffer.subarray(start, end + 1);
    res.writeHead(206, {
      ...headers,
      'content-range': `bytes ${start}-${end}/${total}`,
      'content-length': slice.length
    });
    res.end(slice);
    return;
  }
  res.writeHead(200, { ...headers, 'content-length': total });
  res.end(buffer);
}
