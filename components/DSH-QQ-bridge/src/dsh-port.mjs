// DSH 端口自愈：DSH 桌面版每次重启都可能换 Web 端口，而 config.json 里的 dsh.baseUrl
// 是静态的。端口过期时桥接并不会「连不上」——它会连到一个已经不存在的端口，
// 表现为每 30 秒「连接 DSH 事件流… → 本次收到 0 帧」，非常像「DSH 没起」。
// 这里做两件事：启动时校准、运行中连续 0 帧时再校准。
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { NodeApiClient, unwrap } from './dsh-client.js';

// 用 agentPresets.list 探活：这是桥接最早会调、且不需要写权限的只读接口。
async function probe(baseUrl, timeoutMs = 1500) {
  const api = new NodeApiClient(baseUrl, timeoutMs, {
    token: '', header: 'authorization', prefix: 'Bearer', allowRemote: false,
  });
  const value = unwrap(await api.agentPresets.list({}), 'agentPresets.list');
  return Array.isArray(value?.presets) ? value.presets : null;
}

function sh(cmd) {
  return new Promise((resolve) => {
    execFile('cmd.exe', ['/c', cmd], { windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, out) => {
      resolve(err ? '' : String(out || ''));
    });
  });
}

// 候选端口 = 「进程名像 DSH」的进程在 127.0.0.1 上 LISTENING 的端口。
// 不猜端口段、不做全端口扫描，避免误连到别的本地服务。
// run 可注入（测试用），默认走 cmd.exe。
async function candidatePorts({ run = sh, max = 16 } = {}) {
  const [task, net] = await Promise.all([run('tasklist /FO CSV /NH'), run('netstat -ano')]);
  return portsFrom(task, net, max);
}

// 纯函数：从 tasklist / netstat 的原始输出里挑端口（便于单测）。
function portsFrom(task, net, max = 16) {
  const pids = new Set();
  for (const line of String(task || '').split(/\r?\n/)) {
    const m = line.match(/^"([^"]+)","(\d+)"/);
    if (!m) continue;
    if (/deepseek|dsh/i.test(m[1])) pids.add(m[2]);
  }
  if (!pids.size) return [];
  const ports = new Set();
  for (const line of String(net || '').split(/\r?\n/)) {
    const m = line.match(/TCP\s+127\.0\.0\.1:(\d+)\s+\S+\s+LISTENING\s+(\d+)/i);
    if (m && pids.has(m[2])) ports.add(Number(m[1]));
  }
  return [...ports].filter((p) => Number.isInteger(p) && p >= 1024 && p <= 65535).sort((a, b) => b - a).slice(0, max);
}

/**
 * 校准 dsh.baseUrl。
 *
 * 依赖都可注入，测试里不需要真的 DSH / 端口：
 *   probePort(url)   → presets 数组 | null（连不上/不是 DSH）
 *   listPorts()      → 候选端口号数组
 *   readFile(path)   → 读 config.json
 *   writeFile(p, s)  → 写 config.json
 *
 * @returns {Promise<{url:string, changed:boolean, source:'config'|'auto'|'fail', presets?:number, candidates?:number[]}>}
 */
export async function ensureDshBaseUrl({
  configPath,
  currentUrl,
  log = () => {},
  force = false,
  probePort = probe,
  listPorts = candidatePorts,
  readFile = (p) => fs.readFileSync(p, 'utf8'),
  writeFile = (p, s) => fs.writeFileSync(p, s, 'utf8'),
} = {}) {
  const current = String(currentUrl || '').replace(/\/+$/, '');
  // 光能连通不够：本机可能同时跑着「另一个 DSH 实例」（没装 qq-agent-presets）。
  // 连到那种实例时 dshReady 也是 true，但建 QQ 会话会因为没有 preset 被拒。
  // 所以只有当前端口「带 qq-chat / qq-chat-v2」才算真正可用。
  if (!force && current) {
    try {
      const presets = await probePort(current);
      if (Array.isArray(presets)) {
        const ids = presets.map((p) => p?.id || p?.name || '');
        if (ids.includes('qq-chat-v2') || ids.includes('qq-chat')) {
          return { url: current, changed: false, source: 'config' };
        }
        log(`⚠️  DSH 端口自动纠正：${current} 可用但只有 ${ids.length} 个内置 preset（无 qq-chat），继续找带插件的实例`);
      }
    } catch { /* 过期端口：继续找 */ }
  }
  let ports = [];
  try { ports = await listPorts(); } catch { ports = []; }
  // 注意：本机可能同时跑着不止一个 DSH 实例（比如旧进程还占着端口），
  // 其中只有「加载了 qq-agent-presets 插件」的那个才有 qq-chat / qq-chat-v2。
  // 连错实例的后果是 QQ 会话建不起来（桥接会拒绝无 preset 的会话），
  // 所以这里按 preset 做优先级排序，而不是「谁先响应用谁」。
  const scored = [];
  for (const port of ports) {
    const url = `http://127.0.0.1:${port}`;
    if (url === current) continue;
    try {
      const presets = await probePort(url);
      if (!presets?.length) continue;
      const ids = presets.map((p) => p?.id || p?.name || '');
      const score = (ids.includes('qq-chat-v2') ? 2 : 0) + (ids.includes('qq-chat') ? 1 : 0);
      scored.push({ url, presets, score, ids });
    } catch { /* 不是 DSH，试下一个 */ }
  }
  scored.sort((a, b) => b.score - a.score || b.presets.length - a.presets.length);
  const best = scored[0];
  if (best && best.score >= 2) {
    if (configPath) {
      try {
        const raw = JSON.parse(readFile(configPath));
        raw.dsh = { ...(raw.dsh ?? {}), baseUrl: best.url };
        writeFile(configPath, `${JSON.stringify(raw, null, 2)}\n`);
      } catch (e) {
        log(`⚠️  DSH 端口自动纠正：探测到 ${best.url}，但回写 config.json 失败（${e.message}），本次仅在内存中使用`);
      }
    }
    log(`ℹ️  DSH 端口自动纠正：${current || '(空)'} → ${best.url}（presets=${best.presets.length}，含 qq-chat-v2）`);
    return { url: best.url, changed: true, source: 'auto', presets: best.presets.length, candidates: ports };
  }
  const others = scored.map((s) => `${s.url}(${s.ids.length})`).join(', ') || '(无)';
  log(`⚠️  DSH 端口自动纠正：找到可用 API 但没有带 qq-chat-v2 的实例（${others}），保持 ${current || '(空)'} 不动`);
  if (current) log(`⚠️  DSH 端口自动纠正失败：候选端口 ${ports.join(', ') || '(无)'} 都不可用，继续使用 ${current}`);
  return { url: current, changed: false, source: 'fail', candidates: ports };
}

export { candidatePorts, portsFrom, probe };
