// Idempotent SnowLuma auto-load target patch.
// Only UIN <BOT_QQ> is auto-injected; <OWNER_QQ> and any other account are skipped.
// Re-run after a SnowLuma update overwrites index.mjs.
import fs from 'fs';
import path from 'path';

const snowRoot = process.env.SNOWLUMA_ROOT || '<LOCAL_TOOLS>/SnowLuma';
const indexed = path.join(snowRoot, 'index.mjs');
const runtimePath = path.join(snowRoot, 'config', 'runtime.json');
const TARGET_UIN = '<BOT_QQ>';
const STAMP = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
const oldLog = 'if (autoLoadOnDiscovery) log.info("hook auto-load enabled: every discovered QQ process will be injected");';
const newLog = `if (autoLoadOnDiscovery) log.info("hook auto-load enabled: only UIN=${TARGET_UIN} will be injected");`;

if (!fs.existsSync(indexed)) throw new Error(`SnowLuma index.mjs not found: ${indexed}`);
let source = fs.readFileSync(indexed, 'utf8');
let changed = false;

const oldCall = '\t\t\t\tif (this.autoLoadOnDiscovery && shouldAutoLoadPid(info.pid, this.log)) this.runAutoLoad(session);';
const newCall = '\t\t\t\tif (this.autoLoadOnDiscovery && shouldAutoLoadPid(info.pid, this.log)) this.scheduleTargetAutoLoad(info.pid, session);';
if (!source.includes('scheduleTargetAutoLoad')) {
  if (!source.includes(oldCall)) throw new Error('auto-load call line not found; SnowLuma source changed');
  const backup = `${indexed}.bak-auto-inject-${STAMP}`;
  fs.copyFileSync(indexed, backup);
  source = source.replace(oldCall, newCall);

  const anchor = '\trunAutoLoad(session, existing) {';
  if (!source.includes(anchor)) throw new Error('runAutoLoad anchor not found');
  const method = [
    '\tscheduleTargetAutoLoad(pid, session, attempt = 0) {',
    '\t\tif (this.disposed || session.isDisposed || session.injected) return;',
    '\t\tvoid probeQqLoginInfo(pid).then((login) => {',
    '\t\t\tif (this.disposed || session.isDisposed) return;',
    '\t\t\tconst uin = login && login.uin ? String(login.uin) : "";',
    `\t\t\tif (uin === "${TARGET_UIN}") { this.runAutoLoad(session); return; }`,
    '\t\t\tif (attempt >= 60) { this.log.info("auto-load skipped: PID=%d uin=%j", pid, uin); return; }',
    '\t\t\tconst timer = setTimeout(() => this.scheduleTargetAutoLoad(pid, session, attempt + 1), 3000);',
    '\t\t\tif (typeof timer.unref === "function") timer.unref();',
    '\t\t}).catch(() => {',
    '\t\t\tif (this.disposed || session.isDisposed) return;',
    '\t\t\tif (attempt >= 60) { this.log.warn("auto-load probe failed: PID=%d", pid); return; }',
    '\t\t\tconst timer = setTimeout(() => this.scheduleTargetAutoLoad(pid, session, attempt + 1), 3000);',
    '\t\t\tif (typeof timer.unref === "function") timer.unref();',
    '\t\t});',
    '\t}',
    ''
  ].join('\n');
  source = source.replace(anchor, method + anchor);
  if (source.includes(oldLog)) source = source.replace(oldLog, newLog);
  fs.writeFileSync(indexed, source, 'utf8');
  changed = true;
  console.log(`PATCHED index.mjs; backup=${backup}`);
} else {
  console.log('ALREADY_PATCHED index.mjs');
  if (source.includes(oldLog)) {
    const backup = `${indexed}.bak-autoload-log-${STAMP}`;
    fs.copyFileSync(indexed, backup);
    fs.writeFileSync(indexed, source.replace(oldLog, newLog), 'utf8');
    console.log(`PATCHED auto-load log text; backup=${backup}`);
    changed = true;
  }
}

const runtime = JSON.parse(fs.readFileSync(runtimePath, 'utf8'));
if (runtime.hookAutoLoad !== true) {
  runtime.hookAutoLoad = true;
  fs.writeFileSync(runtimePath, JSON.stringify(runtime, null, 2) + '\n', 'utf8');
  console.log('PATCHED config/runtime.json hookAutoLoad=true');
} else {
  console.log('ALREADY_PATCHED config/runtime.json hookAutoLoad=true');
}

console.log(changed ? 'DONE' : 'NO_SOURCE_CHANGE');
