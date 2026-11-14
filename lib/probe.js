import net from 'node:net';

/**
 * TCP probe with three outcomes, matching the memory project's convention:
 * `open` (listening), `refused` (nothing there), `blocked`/`timeout` (unknown).
 * Pure Node: the DSH sandbox forbids piping child-process stdio.
 */
export function probePort(host, port, timeoutMs = 500) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const finish = (state) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(state);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish('open'));
    socket.once('timeout', () => finish('timeout'));
    socket.once('error', (err) => {
      const code = err && err.code;
      if (code === 'ECONNREFUSED') finish('refused');
      else if (code === 'ETIMEDOUT') finish('timeout');
      else finish('blocked');
    });
    try {
      socket.connect(port, host);
    } catch {
      finish('blocked');
    }
  });
}

/** Fetch a URL and report status without throwing. */
export async function probeHttp(url, timeoutMs = 1500) {
  try {
    const res = await fetch(url, {
      method: 'GET',
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs)
    });
    return { ok: true, status: res.status };
  } catch (err) {
    return { ok: false, status: 0, error: String(err && err.message ? err.message : err) };
  }
}
