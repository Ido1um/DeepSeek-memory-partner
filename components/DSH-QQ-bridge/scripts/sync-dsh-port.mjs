// 开机自启用：探测当前 DSH 的 Web API 端口，并把 config.json 的 dsh.baseUrl 改成它。
// 用法：node scripts/sync-dsh-port.mjs 56112 8643 ...
// 只探测传入的候选端口（由 autostart-qqbot.ps1 从 DSH 主进程的监听端口里取），
// 用桥接自己的 Cookie 铸造 + agentPresets/list 判断是不是真正的 DSH API。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeApiClient, unwrap } from '../src/dsh-client.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const configPath = path.join(root, 'config.json');
const ports = process.argv
  .slice(2)
  .map((value) => Number(value))
  .filter((value) => Number.isInteger(value) && value > 0 && value <= 65535);

if (!ports.length) {
  console.error('[sync-dsh-port] no candidate ports');
  process.exit(2);
}

const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const before = String(config.dsh?.baseUrl ?? '');

for (const port of ports) {
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    const api = new NodeApiClient(baseUrl, 2000, {
      token: '',
      header: 'authorization',
      prefix: 'Bearer',
      allowRemote: false,
    });
    const result = await api.agentPresets.list({});
    const value = unwrap(result, 'agentPresets.list');
    if (!Array.isArray(value?.presets) || !value.presets.length) continue;
    config.dsh = { ...(config.dsh ?? {}), baseUrl };
    fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
    console.log(`[sync-dsh-port] DSH API found on ${baseUrl} (presets=${value.presets.length}); baseUrl ${before === baseUrl ? 'unchanged' : `updated ${before} -> ${baseUrl}`}`);
    process.exit(0);
  } catch {
    // 不是 DSH API（或未启动），继续试下一个端口。
  }
}

console.error(`[sync-dsh-port] DSH API not found on candidate ports: ${ports.join(', ')}`);
process.exit(1);
