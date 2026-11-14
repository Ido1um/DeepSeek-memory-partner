import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
// build marker: bundle toggle re-imports the entry module only when its own mtime changes.
import { PLUGIN_ROOT, dshHome, dsmpHome } from './paths.js';
import { ensureSettings, readSettings, writeSettings, settingsFile } from './settings.js';
import {
  activeRole,
  deleteRoleText,
  listRoles,
  mirrorSummary,
  panelLabel,
  readRoleText,
  saveRoleText,
  syncRolesToMemory
} from './role.js';
import { probePort, probeHttp } from './probe.js';
import { queryOf, readJsonBody, readRawBody, sendBuffer, sendJson } from './http.js';
import { loadModule } from './load.js';

// Churny modules load through the dev-reload helper so a bundle toggle picks up
// edits without restarting DSH. Everything else is safe to import statically.
const { agentOptionsFor, modelCatalog } = await loadModule('models.js');
const { SessionBridge, BUILD: BRIDGE_BUILD } = await loadModule('session-bridge.js');
const { composeChatPrompt, buildFactCard, buildRulesSection, configureVendor } = await loadModule('memory-context.js');
const { BridgeClient, channelModeOf, validateInbound } = await loadModule('bridge-client.js');
const { MediaStore, sniff } = await loadModule('media-store.js');
const { findSessionLog, historyFromFile, itemsOfSession, scanSessions } = await loadModule('session-log.js');
const workbench = await loadModule('workbench/state.js');
const { preflight, runMigration, rollbackMigration, readJournal, rewriteSessionCwd } = await loadModule('migrate.js');
const { buildExport, verifyArchive, importArchive, configureZip } = await loadModule('archive.js');
const machine = await loadModule('machine.js');
const machinePack = await loadModule('machine-pack.js');
const zip = await loadModule('zip.js');
const lease = await loadModule('lease.js');
const panelLock = await loadModule('panel-lock.js');
let memoryWriter = await loadModule('memory-writer.js');
const sessionMeta = await loadModule('session-meta.js');
const memoryEngine = await loadModule('memory-engine.js');
const dsmpInject = await loadModule('inject.js');
const memoryTools = await loadModule('tools.js');
const voiceInbound = await loadModule('voice-inbound.js');
const voiceStt = await loadModule('voice-stt.js');
const backupMod = await loadModule('backup.js');
const robustness = await loadModule('robustness.js');
const services = await loadModule('services.js');
const workbenchWrite = await loadModule('workbench-write.js');
const qqGateway = await loadModule('qq-gateway.js');
const qqChannel = await loadModule('qq-channel.js');
const qqProxy = await loadModule('qq-proxy.js');
const qqWrite = await loadModule('qq-write.js');
const VENDOR_SRC = path.join(PLUGIN_ROOT, 'vendor', 'memory', 'src');
const disputesMod = await import(pathToFileURL(path.join(VENDOR_SRC, 'disputes.mjs')).href);
const monthlyMod = await import(pathToFileURL(path.join(VENDOR_SRC, 'monthly.mjs')).href);
const windowMod = await import(pathToFileURL(path.join(VENDOR_SRC, 'window.mjs')).href);
configureZip(zip);
machinePack.configureMachinePack({ zip, rewriteCwd: rewriteSessionCwd });
services.configureServices({ pluginRoot: PLUGIN_ROOT });
qqChannel.configureQQChannel({ dsmpRoot: PLUGIN_ROOT, gateway: qqGateway });
workbench.configureWorkbench({ vendorDir: path.join(PLUGIN_ROOT, 'vendor', 'memory', 'src'), libDir: path.join(PLUGIN_ROOT, 'lib') });
workbenchWrite.configureWorkbenchWrite({ vendorDir: path.join(PLUGIN_ROOT, 'vendor', 'memory', 'src') });
configureVendor({ vendorDir: path.join(PLUGIN_ROOT, 'vendor', 'memory', 'src') });
memoryTools.configureTools({ vendorDir: path.join(PLUGIN_ROOT, 'vendor', 'memory', 'src') });
backupMod.configureBackup({ archive: { buildExport, verifyArchive } });

let registeredToolCount = 0;
/** D1/D4: 写接口令牌与最近一次启动自检结果。 */
let writeToken = '';
let selfCheckItems = [];

/** Test mode never reads or writes the production memory directory. */
function testMemoryDir(settings) {
  const test = settings.test || {};
  if (test.enabled && test.memoryDir) return test.memoryDir;
  return settings.memoryDir;
}

/**
 * `tools` is required: Cordis throws on `ctx.tools` unless the Service is
 * declared, and this Cordis build only understands the array form (an
 * `{required, optional}` object is read as two service names).
 */
export const inject = ['webServer', 'agents', 'tools'];
export const name = 'dsmp';

const FALLBACK_VERSION = '0.0.0';

function pluginVersion() {
  try {
    return String(JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'package.json'), 'utf8')).version || FALLBACK_VERSION);
  } catch {
    return FALLBACK_VERSION;
  }
}

function memorySummary(settings) {
  const dir = settings.memoryDir;
  const out = { dir, exists: false, longtermBytes: 0, stateFiles: 0 };
  try {
    const st = fs.statSync(dir);
    out.exists = st.isDirectory();
  } catch {
    return out;
  }
  for (const rel of ['longterm.jsonl', path.join('state', 'longterm.jsonl')]) {
    try {
      out.longtermBytes = fs.statSync(path.join(dir, rel)).size;
      if (out.longtermBytes > 0) break;
    } catch {
      out.longtermBytes = 0;
    }
  }
  try {
    out.stateFiles = fs.readdirSync(path.join(dir, 'state')).filter((f) => f.endsWith('.jsonl')).length;
  } catch {
    out.stateFiles = 0;
  }
  return out;
}

async function bridgeSummary(settings) {
  let url;
  try {
    url = new URL(settings.bridge.baseUrl);
  } catch {
    return { url: settings.bridge.baseUrl, tcp: 'blocked', http: 0, alive: false };
  }
  const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
  const tcp = await probePort(url.hostname, port, 400);
  let http = 0;
  if (tcp === 'open') {
    const res = await probeHttp(`${settings.bridge.baseUrl}/api/status`, 1200);
    http = res.status;
  }
  return { url: settings.bridge.baseUrl, tcp, http, alive: http === 200 || http === 401 || http === 403 };
}

/**
 * Three modes from the plan: local (bridge unreachable), degraded (bridge up but
 * account/status not confirmed), qq (bridge answers status with 200).
 */
function modeOf(bridge) {
  if (bridge.tcp !== 'open') return 'local';
  if (bridge.http === 200) return 'qq';
  if (bridge.alive) return 'degraded';
  return 'local';
}

function testSummary(settings, bridge) {
  return {
    enabled: Boolean(settings.test && settings.test.enabled),
    allowsLiveSessions: Boolean(settings.test && settings.test.allowLiveSessions),
    sessionPrefix: String((settings.test && settings.test.sessionPrefix) || ''),
    cwd: String((settings.test && settings.test.cwd) || ''),
    memoryDir: String((settings.test && settings.test.memoryDir) || ''),
    liveSession: {
      id: String((settings.session && settings.session.liveId) || ''),
      cwd: String((settings.session && settings.session.liveCwd) || '')
    },
    note: settings.test && settings.test.enabled
      ? '测试期：只连测试会话，不写生产记忆、不发 QQ、不抢租约'
      : ''
  };
}

function monthlySummary(settings) {
  const file = path.join(memoryWriteDir(settings), 'state', 'monthly', 'index.json');
  try {
    const index = JSON.parse(fs.readFileSync(file, 'utf8'));
    return {
      chars: Number(index.chars) || 0,
      facts: Number(index.facts) || 0,
      month: String(index.month || ''),
      updatedAt: String(index.updatedAt || '')
    };
  } catch {
    return { chars: 0, facts: 0, month: '', updatedAt: '' };
  }
}

async function buildStatus(bridge) {
  const settings = ensureSettings();
  const bridgeState = await bridgeSummary(settings);
  const workbenchProbe = await probeHttp(settings.workbench.url, 900);
  const role = activeRole(settings);
  const devMode = fs.existsSync(path.join(dshHome(), 'dsmp', 'dev-reload.flag'));
  return {
    ok: true,
    name: 'DeepSeek-memory-partner',
    packageName: '@local/dsmp',
    version: pluginVersion(),
    pluginRoot: PLUGIN_ROOT,
    dshHome: dshHome(),
    mode: modeOf(bridgeState),
    panel: { label: panelLabel(settings), role },
    ui: { legacyWorkbench: settings.ui.legacyWorkbench === true },
    bridge: bridgeState,
    memory: {
      ...memorySummary(settings),
      lease: lease.leaseSummary(memoryWriteDir(settings)),
      writer: memoryWriter.memoryWriterStats(),
      engine: memoryEngine.engineStatus()
    },
    workbench: { url: settings.workbench.url, http: workbenchProbe.status },
    disputes: { pending: disputesMod.pendingCount(memoryWriteDir(settings)) },
    monthly: monthlySummary(settings),
    rolesMirror: mirrorSummary(settings.memoryDir),
    test: testSummary(settings, bridgeState),
    media: mediaSummary(settings),
    inject: dsmpInject.injectStatus(),
    tools: { registered: registeredToolCount, names: memoryTools.TOOL_NAMES },
    backup: (() => {
      const configured = String(settings.backup?.dir || '');
      const root = backupMod.backupRootOf(configured, path.join(dshHome(), 'dsmp'));
      return {
        root,
        configured,
        defaultRoot: path.join(dshHome(), 'dsmp', 'backups'),
        keep: Math.max(1, Math.min(50, Number(settings.backup?.keep) || 2)),
        count: backupMod.listBackups(root).length
      };
    })(),
    selfCheck: selfCheckItems,
    security: {
      writeTokenRequired: true,
      tokenFile: path.join(dsmpHome(), 'api-token'),
      sameOriginAllowed: true,
      internalPaths: 6
    },
    // Development-only breadcrumbs: which module build is live and whether the
    // data: URL reload path is active. Never present without the flag.
    ...(devMode ? { dev: { mode: 'reload', moduleBuild: String(BRIDGE_BUILD || ''), loadModule: typeof loadModule } } : {}),
    chat: {
      provider: String((settings.chat && settings.chat.provider) || ''),
      model: String((settings.chat && settings.chat.model) || ''),
      sessions: bridge ? bridge.listSessions().sessions : []
    },
    /**
     * QQ conversation key the panel sends to. Empty means "not configured yet":
     * the packaged plugin carries no owner QQ number, so the panel refuses to
     * guess instead of writing into somebody else's conversation.
     */
    channelKey: String((settings.channel && settings.channel.key) || ''),
    features: {
      localChat: true,
      // QQ is wired but stays observational until the test phase ends.
      qq: true,
      media: true,
      history: true,
      persona: true,
      settings: true,
      migration: true
    },
    settings,
    at: new Date().toISOString()
  };
}

/** Settings the panel is allowed to change in M0/M1. */
function pickSettingsPatch(body) {
  const patch = {};
  if (typeof body.memoryDir === 'string') patch.memoryDir = body.memoryDir.trim();
  if (body.panel && typeof body.panel === 'object' && typeof body.panel.liveSend === 'boolean') {
    patch.panel = { liveSend: body.panel.liveSend };
  }
  if (body.inject && typeof body.inject === 'object') {
    if (body.inject.mode === 'pre-step' || body.inject.mode === 'send') patch.inject = { mode: body.inject.mode };
  }
  if (body.bridge && typeof body.bridge === 'object') {
    patch.bridge = {};
    if (typeof body.bridge.baseUrl === 'string') patch.bridge.baseUrl = body.bridge.baseUrl.trim().replace(/\/+$/, '');
    if (typeof body.bridge.tokenFile === 'string') patch.bridge.tokenFile = body.bridge.tokenFile.trim();
  }
  if (body.roles && typeof body.roles === 'object') {
    patch.roles = {};
    if (typeof body.roles.dir === 'string') patch.roles.dir = body.roles.dir.trim();
    if (typeof body.roles.activeFile === 'string') patch.roles.activeFile = body.roles.activeFile.trim();
    if (typeof body.roles.fallbackName === 'string') patch.roles.fallbackName = body.roles.fallbackName.trim();
  }
  if (body.workbench && typeof body.workbench === 'object' && typeof body.workbench.url === 'string') {
    patch.workbench = { url: body.workbench.url.trim().replace(/\/+$/, '') };
  }
  if (body.ui && typeof body.ui === 'object' && typeof body.ui.panelLabelPrefix === 'string') {
    patch.ui = { panelLabelPrefix: body.ui.panelLabelPrefix };
  }
  if (body.session && typeof body.session === 'object') {
    patch.session = {};
    if (body.session.via === 'auto' || body.session.via === 'bridge') patch.session.via = body.session.via;
    if (typeof body.session.offlineFallback === 'boolean') patch.session.offlineFallback = body.session.offlineFallback;
  }
  if (body.chat && typeof body.chat === 'object') {
    patch.chat = {};
    if (typeof body.chat.provider === 'string') patch.chat.provider = body.chat.provider.trim();
    if (typeof body.chat.model === 'string') patch.chat.model = body.chat.model.trim();
  }
  if (body.memory && typeof body.memory === 'object') {
    patch.memory = {};
    if (body.memory.owner === 'dsmp' || body.memory.owner === 'bridge') patch.memory.owner = body.memory.owner;
    if (body.memory.leaseTtlMs !== undefined) patch.memory.leaseTtlMs = Number(body.memory.leaseTtlMs);
    if (typeof body.memory.dir === 'string') patch.memory.dir = body.memory.dir.trim();
  }
  if (body.test && typeof body.test === 'object') {
    patch.test = {};
    if (typeof body.test.enabled === 'boolean') patch.test.enabled = body.test.enabled;
    if (typeof body.test.allowLiveSend === 'boolean') patch.test.allowLiveSend = body.test.allowLiveSend;
    if (typeof body.test.allowLiveSessions === 'boolean') patch.test.allowLiveSessions = body.test.allowLiveSessions;
  }
  if (body.channel && typeof body.channel === 'object') {
    patch.channel = {};
    if (typeof body.channel.key === 'string') patch.channel.key = body.channel.key.trim();
    if (body.channel.pollMs !== undefined) patch.channel.pollMs = Number(body.channel.pollMs);
  }
  if (body.media && typeof body.media === 'object') {
    patch.media = {};
    if (body.media.maxImagesPerMessage !== undefined) patch.media.maxImagesPerMessage = Number(body.media.maxImagesPerMessage);
    if (typeof body.media.maxImageBytes === 'number') patch.media.maxImageBytes = body.media.maxImageBytes;
    if (typeof body.media.maxVoiceBytes === 'number') patch.media.maxVoiceBytes = body.media.maxVoiceBytes;
    if (body.media.voice && typeof body.media.voice === 'object') {
      patch.media.voice = {};
      if (typeof body.media.voice.transcript === 'boolean') patch.media.voice.transcript = body.media.voice.transcript;
      const stt = body.media.voice.stt;
      if (stt && typeof stt === 'object') {
        patch.media.voice.stt = {};
        for (const key of ['enabled']) if (typeof stt[key] === 'boolean') patch.media.voice.stt[key] = stt[key];
        for (const key of ['provider', 'language']) if (typeof stt[key] === 'string') patch.media.voice.stt[key] = stt[key].trim();
        for (const key of ['timeoutMs', 'maxSeconds', 'maxBytes', 'prepareTimeoutMs']) {
          if (stt[key] !== undefined && Number.isFinite(Number(stt[key]))) patch.media.voice.stt[key] = Number(stt[key]);
        }
      }
    }
  }
  if (body.backup && typeof body.backup === 'object') {
    patch.backup = {};
    if (typeof body.backup.dir === 'string') {
      const dir = body.backup.dir.trim();
      if (dir && !path.isAbsolute(dir)) throw new Error('备份目录必须是绝对路径');
      patch.backup.dir = dir;
    }
    if (body.backup.keep !== undefined && Number.isFinite(Number(body.backup.keep))) {
      patch.backup.keep = Math.min(50, Math.max(1, Math.trunc(Number(body.backup.keep))));
    }
  }
  return patch;
}

function fail(res, err) {
  const code = (err && err.code) || '';
  let status = 400;
  if (code === 'DSMP_TEST_ONLY') status = 403;
  else if (code === 'DSMP_SESSION_BUSY') status = 409;
  else if (code === 'DSMP_NOT_WRITER' || code === 'DSMP_WRITE_MIGRATING' || code === 'DSMP_WRITE_NO_DIR') status = 409;
  else if (code === 'DSMP_WRITE_NOT_FOUND') status = 404;
  sendJson(res, status, { ok: false, error: String(err && err.message ? err.message : err), code });
}

/** Media lives inside the active memory directory (test copy while isolated). */
function mediaStoreOf(settings) {
  const media = settings.media || {};
  return new MediaStore({
    rootDir: testMemoryDir(settings),
    maxImageBytes: Number(media.maxImageBytes) || 16 * 1024 * 1024,
    maxVoiceBytes: Number(media.maxVoiceBytes) || 16 * 1024 * 1024
  });
}

function mediaSummary(settings) {
  const store = mediaStoreOf(settings);
  const images = store.list({ kind: 'image', limit: 1 });
  const voice = store.list({ kind: 'voice', limit: 1 });
  return {
    root: store.root,
    images: images.count,
    voice: voice.count,
    latestImage: images.items[0] || null,
    transcription: Boolean(settings.media && settings.media.voice && settings.media.voice.transcript)
  };
}

/** Memory writes go to `memory.dir` when it is set explicitly (P2 points it at the
 *  production directory while chat stays isolated); otherwise they follow the
 *  normal isolation rule — the test copy under test.enabled, production after. */
function memoryWriteDir(settings) {
  const explicit = String((settings.memory && settings.memory.dir) || '').trim();
  if (explicit) return explicit;
  return testMemoryDir(settings);
}

export function apply(ctx) {
  let settings = ensureSettings();
  const bridge = new SessionBridge({ ctx, settings });
  const refresh = () => {
    settings = ensureSettings();
    bridge.settings = settings;
    memoryWriter.configureMemoryWriter({ dir: memoryWriteDir(settings) });
    return settings;
  };

  // P0 speech-to-text: reuse the host `speechToText` service (SenseVoice). The
  // store follows the active (test or production) memory directory, and saves
  // go through voice-inbound so the row shape matches bridge uploads exactly.
  voiceStt.configureVoiceStt({
    ctx,
    getSettings: () => settings,
    storeOf: () => mediaStoreOf(settings),
    saveInboundVoice: voiceInbound.saveInboundVoice,
    log: (message) => console.warn(message)
  });

  // The host re-runs apply() when the bundle is toggled, but sibling modules
  // loaded at module scope can still be cached instances. Reload the writer on
  // the first writer-route call of each apply so lib edits apply without a full
  // DSH restart (production still just imports the module once).
  let writerDirty = true;
  let writerReload = null;
  const configureWriter = (mod) => mod.configureMemoryWriter({
    vendorDir: path.join(PLUGIN_ROOT, 'vendor', 'memory', 'src'),
    dir: memoryWriteDir(settings),
    allowed: () => settings.memory.owner === 'dsmp' && lease.leaseOwnedBy(memoryWriteDir(settings), 'dsmp')
  });
  const ensureWriter = async () => {
    if (!writerDirty) return memoryWriter;
    if (!writerReload) {
      writerReload = loadModule('memory-writer.js').then((mod) => {
        memoryWriter = mod;
        configureWriter(mod);
        writerDirty = false;
        writerReload = null;
        return mod;
      }).catch((err) => { writerReload = null; throw err; });
    }
    return writerReload;
  };

  // Single-writer lease (M6). Defaults to `bridge` so production behaviour is
  // unchanged; flipping settings.memory.owner to 'dsmp' is the opt-in.
  memoryWriter.configureMemoryWriter({
    vendorDir: path.join(PLUGIN_ROOT, 'vendor', 'memory', 'src'),
    dir: memoryWriteDir(settings),
    allowed: () => settings.memory.owner === 'dsmp' && lease.leaseOwnedBy(memoryWriteDir(settings), 'dsmp')
  });

  // Persona mirror: keep `<memoryDir>/roles` in step, so migrating or exporting
  // the memory directory carries the active persona card along with it.
  const syncRoles = () => {
    try {
      return syncRolesToMemory({ settings, memoryDir: settings.memoryDir });
    } catch (err) {
      return { ok: false, error: err.message };
    }
  };
  const rolesSyncAtStart = syncRoles();
  if (!rolesSyncAtStart.ok) {
    const detail = rolesSyncAtStart.error || (rolesSyncAtStart.errors || []).join('; ');
    console.log('[dsmp] 人设卡镜像同步失败：', detail);
  }

  const syncLease = () => {
    const dir = memoryWriteDir(settings);
    const owner = settings.memory && settings.memory.owner;
    if (owner === 'dsmp') {
      const res = lease.acquireLease({ memoryDir: dir, owner: 'dsmp', ttlMs: settings.memory.leaseTtlMs });
      if (!res.ok) return res;
      return res;
    }
    const current = lease.readLease(dir);
    if (current && current.owner === 'dsmp') lease.releaseLease({ memoryDir: dir, owner: 'dsmp' });
    return { ok: true, released: true };
  };
  syncLease();

  // D1: every mutating route is wrapped once here instead of adding a token
  // check to ~30 handlers. Browser writes pass via Sec-Fetch-Site: same-origin
  // (CSRF cannot forge it); scripts and the bridge use x-dsmp-token.
  const tokenInfo = robustness.ensureWriteToken(dsmpHome());
  writeToken = tokenInfo.token;
  if (tokenInfo.created) console.log('[dsmp] 已生成写接口令牌：', tokenInfo.file);
  const WRITE_PATHS = new Set([
    '/api/dsmp/settings',
    '/api/dsmp/roles',
    '/api/dsmp/roles/sync',
    '/api/dsmp/bridge/send',
    '/api/dsmp/inbound',
    '/api/dsmp/workbench/write',
    '/api/dsmp/chat/rename',
    '/api/dsmp/chat/delete',
    '/api/dsmp/chat/send',
    '/api/dsmp/chat/attach',
    '/api/dsmp/chat/dispose',
    '/api/dsmp/chat/live',
    '/api/dsmp/migrate',
    '/api/dsmp/memory/export',
    '/api/dsmp/memory/import',
    '/api/dsmp/memory/verify',
    '/api/dsmp/machine/export',
    '/api/dsmp/machine/upload',
    '/api/dsmp/machine/import',
    '/api/dsmp/backup/now',
    '/api/dsmp/backup/restore',
    '/api/dsmp/backup/pick-dir',
    '/api/dsmp/memory/lease',
    '/api/dsmp/memory/writer',
    '/api/dsmp/memory/engine',
    '/api/dsmp/media/upload',
    '/api/dsmp/media/attachment',
    '/api/dsmp/voice/inbound',
    '/api/dsmp/voice/sent',
    '/api/dsmp/voice/transcribe',
    '/api/dsmp/voice/send',
    '/api/dsmp/voice/outbox',
    '/api/dsmp/memory/begin-turn',
    '/api/dsmp/memory/note-spoken',
    '/api/dsmp/memory/finish-turn',
    '/api/dsmp/qq/channel',
    '/api/dsmp/qq/write'
  ]);
  // Machine-to-machine callbacks from qq-bridge: no browser involved, and the
  // bridge cannot read the token file across a machine move. These paths accept
  // `x-dsmp-internal: bridge` instead (a custom header a cross-site page cannot
  // send without a CORS preflight this server never grants).
  const INTERNAL_PATHS = [
    '/api/dsmp/inbound',
    '/api/dsmp/memory/begin-turn',
    '/api/dsmp/memory/note-spoken',
    '/api/dsmp/memory/finish-turn',
    '/api/dsmp/voice/inbound',
    '/api/dsmp/voice/sent',
    '/api/dsmp/voice/transcribe'
  ];
  const webRegister = (route) => ctx['webServer'].register({
    ...route,
    handler: WRITE_PATHS.has(route.path)
      ? robustness.guardWrite(route.path, route.handler, { token: writeToken, internalPaths: INTERNAL_PATHS })
      : route.handler
  });

  // A1: the memory projection is composed at `agent/pre-step`, not at send time.
  // The user message therefore stays exactly what the owner typed; the context
  // message (stable id, source.kind === 'dsmp-inject') is replaced in place on
  // every step, so the window never grows a second copy of the card.
  const isBoundSession = (id) => {
    const live = String((settings.session && (settings.session.liveId || settings.session.boundId)) || '');
    return Boolean(live) && String(id) === live;
  };
  const composeMemoryPrefix = async (raw) => {
    void raw;
    const dir = String(settings.memoryDir || '') || testMemoryDir(settings);
    const [rules, card] = await Promise.all([
      buildRulesSection(dir, { maxChars: 600 }),
      buildFactCard(dir, { maxChars: 1500 })
    ]);
    const parts = [];
    if (rules && rules.text) parts.push(rules.text.trim());
    if (card && card.text) parts.push(card.text.trim());
    return parts.join('\n\n');
  };
  dsmpInject.configureInject({
    getSettings: () => settings,
    isBoundSession,
    compose: composeMemoryPrefix,
    logger: (line) => console.log(line)
  });

  ctx.effect(() => ctx.on('agent/pre-step', (payload, next) => dsmpInject.preStep(payload, next)), 'dsmp: A1 记忆注入');

  // A3: the seven memory tools run in-process instead of through the bridge's
  // MCP child. Read-only ones are always available; write ones check the lease
  // so a degraded (non-writer) DSMP never races the bridge on the same files.
  ctx.effect(() => {
    const disposers = memoryTools.registerMemoryTools({
      ctx,
      dir: () => memoryWriteDir(settings),
      canWrite: () => Boolean(settings.memory)
        && settings.memory.owner === 'dsmp'
        && lease.leaseOwnedBy(memoryWriteDir(settings), 'dsmp'),
      ownerKey: () => String((settings.channel && settings.channel.key) || ''),
      getSettings: () => settings,
      attachments: (ctx.get && ctx.get('attachments')) || null,
      logger: (line) => console.log(line)
    });
    registeredToolCount = disposers.length;
    return () => {
      for (const dispose of disposers) {
        try {
          dispose();
        } catch {
          /* already gone */
        }
      }
      registeredToolCount = 0;
    };
  }, 'dsmp: A3 原生记忆工具');

  ctx.effect(() => {
    const timer = setInterval(() => {
      if (!settings.memory || settings.memory.owner !== 'dsmp') return;
      try {
        lease.heartbeatLease({
          memoryDir: memoryWriteDir(settings),
          owner: 'dsmp',
          ttlMs: settings.memory.leaseTtlMs
        });
      } catch {
        /* 心跳失败留给下一次；租约过期后 DSMP 自己降级只读 */
      }
    }, Math.max(5000, Number(settings.memory && settings.memory.heartbeatMs) || 15000));
    timer.unref?.();
    return () => clearInterval(timer);
  }, 'dsmp: memory lease heartbeat');

  // A2: 日终派生（情境段/条目抽取/归档/轮转/提醒）由 DSMP 负责。
  // bridge 在 owner=dsmp 时会跳过自己的 startMaintenance；这里每次 tick 都先验租约，
  // 丢租约立刻停手，绝不与 bridge 双跑。
  memoryEngine.configureMemoryEngine({
    vendorDir: path.join(PLUGIN_ROOT, 'vendor', 'memory', 'src'),
    dir: memoryWriteDir(settings),
    getSettings: () => settings,
    canWrite: () => settings.memory && settings.memory.owner === 'dsmp'
      && lease.leaseOwnedBy(memoryWriteDir(settings), 'dsmp'),
    getOwnerKey: () => String((settings.channel && settings.channel.key) || ''),
    getSessionId: () => String((settings.session && (settings.session.boundId || settings.session.liveId)) || ''),
    isBusy: (key) => {
      try {
        const id = settings.session && (settings.session.boundId || settings.session.liveId);
        return id ? bridge.isBusy(id) : false;
      } catch {
        return false;
      }
    },
    logger: (line) => console.log('[dsmp]', line)
  });
  ctx.effect(() => {
    memoryEngine.startEngine();
    return () => memoryEngine.stopEngine();
  }, 'dsmp: memory engine');

  // ComfyUI / GPT-SoVITS fallback shutdown: the bridge owns the lifecycle while
  // it runs; this covers engines started from the panel while bridge is down.
  ctx.effect(() => services.startIdleWatch({
    settings: () => settings,
    bridgeUp: async () => (await probePort('127.0.0.1', 3100, 300)) === 'open',
    logger: (line) => console.log('[dsmp]', line)
  }), 'dsmp: engine idle watch');

  // Test isolation is the default; the panel shows it, the routes enforce it.
  // Panel-driven turns: DSMP writes the ledger itself (it is the single writer),
  // so remember the open turn per session and close it when the turn ends.
  const panelTurns = new Map();
  // 面板连发保护：isBusy 依赖 agent.running，而它要等 followup 之后才置位，
  // 中间有几十毫秒窗口——两个请求都判「空闲」就会对同一会话 begin 两次，
  // 前一份 draft 被覆盖、账本直接少一轮。这里用一个同步 Set 把窗口关掉。
  const panelBusy = new Set();
  const messageTextOf = (message) => {
    const content = message && Array.isArray(message.content) ? message.content : [];
    return content.filter((b) => b && b.type === 'text' && b.text).map((b) => b.text).join('\n').trim();
  };
  ctx.effect(() => ctx.on('session/event', (session, event) => {
    bridge.observe(session, event);
    const id = String((session && session.id) || '');
    const rec = id ? panelTurns.get(id) : null;
    if (!rec) return;
    if (event.type === 'assistant/message') {
      const text = messageTextOf(event.data && event.data.message);
      if (text) rec.reply = text;
      return;
    }
    if (event.type === 'turn/end') {
      panelLock.release(id);
      panelBusy.delete(id);
      panelTurns.delete(id);
      const reason = String((event.data && event.data.reason && event.data.reason.kind) || 'completed');
      memoryWriter.finishTurn({ key: rec.key, sessionId: id, reply: rec.reply || '', reason, source: 'panel' })
        .catch((err) => console.log('[dsmp] 面板轮记账收尾失败：', err.message));
    }
  }, { global: true }), 'dsmp: session event mirror');
  // 失联清理：agent 崩了、turn/end 永远不来时，panelTurns / 锁 / busy 标记都靠 TTL。
  // 60s 巡检一次，把「超过 5 分钟且此刻确实不忙」的记录收掉，避免用户被 409 卡住。
  ctx.effect(() => {
    const timer = setInterval(() => {
      const now = Date.now();
      for (const [id, rec] of panelTurns) {
        const at = Number(rec && rec.at) || 0;
        if (!at || now - at < 300000) continue;
        let busy = false;
        try {
          busy = bridge.isBusy(id);
        } catch {
          busy = false;
        }
        if (busy) continue;
        panelTurns.delete(id);
        panelBusy.delete(id);
        panelLock.release(id);
        console.log(`[dsmp] 清理失联面板轮：${id.slice(-8)}（开轮 ${Math.round((now - at) / 1000)}s 未收到 turn/end）`);
      }
    }, 60000);
    if (timer && typeof timer.unref === 'function') timer.unref();
    return () => clearInterval(timer);
  }, 'dsmp: stale panel turn sweeper');
  ctx.effect(() => ctx.on('agent/disposed', (payload) => {
    const agent = payload && payload.agent;
    const id = String((agent && agent.session && agent.session.id) || (agent && agent.id) || '');
    if (id) bridge.handles.delete(id);
  }), 'dsmp: agent disposed cleanup');

  ctx.effect(() => webRegister({
    kind: 'exact',
    path: '/api/dsmp/status',
    handler: async (req, res) => {
      if (req.method !== 'GET') {
        sendJson(res, 405, { ok: false, error: 'method not allowed' });
        return;
      }
      try {
        refresh();
        const status = await buildStatus(bridge);
        // The panel reads this token to call write routes. Electron/custom
        // protocol renderers do not always send Sec-Fetch-Site, so it cannot be
        // the gate: a cross-site page still cannot read this body (no CORS
        // headers), and any local process can read the token file anyway.
        status.writeToken = writeToken;
        // A token lets us tell "bridge up" from "QQ actually online".
        try {
          const qq = await channelClient().status();
          status.qq = qq.ok ? { ok: true, ...qq.data, mode: channelModeOf(qq) } : { ok: false, error: qq.error };
          if (qq.ok) status.mode = channelModeOf(qq);
        } catch {
          /* channel probe is best-effort */
        }
        // P0: 语音转写是否就绪（只读快照，不触发 prepare/下载）。
        try {
          status.stt = voiceStt.sttStatus();
        } catch {
          /* provider may be absent */
        }
        sendJson(res, 200, status);
      } catch (err) {
        sendJson(res, 500, { ok: false, error: String(err && err.message ? err.message : err) });
      }
    }
  }), 'dsmp: status route');

  // Client-side crashes leave no trace in the host log; the panel posts uncaught
  // errors / unhandled rejections here so a black screen can be diagnosed.
  ctx.effect(() => webRegister({
    kind: 'exact',
    path: '/api/dsmp/client-error',
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        sendJson(res, 405, { ok: false, error: 'method not allowed' });
        return;
      }
      try {
        const body = await readJsonBody(req, 32 * 1024);
        const row = {
          at: new Date().toISOString(),
          kind: String((body && body.kind) || '').slice(0, 60),
          message: String((body && body.message) || '').slice(0, 2000),
          stack: String((body && body.stack) || '').slice(0, 8000),
          href: String((body && body.href) || '').slice(0, 600),
          extra: (body && body.extra) || null
        };
        const logDir = path.join(dsmpHome(), 'logs');
        fs.mkdirSync(logDir, { recursive: true });
        fs.appendFileSync(path.join(logDir, 'client-error.log'), JSON.stringify(row) + '\n', 'utf8');
        sendJson(res, 200, { ok: true });
      } catch (err) {
        sendJson(res, 200, { ok: false, error: String(err && err.message ? err.message : err) });
      }
    }
  }), 'dsmp: client error log route');

  ctx.effect(() => webRegister({
    kind: 'exact',
    path: '/api/dsmp/settings',
    handler: async (req, res) => {
      try {
        if (req.method === 'GET') {
          sendJson(res, 200, { ok: true, settings: refresh(), version: pluginVersion() });
          return;
        }
        if (req.method !== 'POST') {
          sendJson(res, 405, { ok: false, error: 'method not allowed' });
          return;
        }
        const body = await readJsonBody(req, 32 * 1024);
        const next = writeSettings(pickSettingsPatch(body));
        bridge.settings = next;
        settings = next;
        syncLease();
        memoryEngine.configureMemoryEngine({ dir: memoryWriteDir(next) });
        sendJson(res, 200, { ok: true, settings: next, note: '已保存；面板状态会在下次刷新时更新' });
      } catch (err) {
        fail(res, err);
      }
    }
  }), 'dsmp: settings route');

  ctx.effect(() => webRegister({
    kind: 'exact',
    path: '/api/dsmp/roles',
    handler: async (req, res) => {
      try {
        const current = refresh();
        const query = queryOf(req);
        if (req.method === 'GET') {
          const wanted = String(query.get('name') || '');
          const listing = {
            ...listRoles(current),
            current: activeRole(current),
            mirror: mirrorSummary(current.memoryDir)
          };
          if (wanted) {
            let content = '';
            try {
              content = readRoleText(wanted, current);
            } catch (err) {
              // 缺卡/坏名都按「不存在」回，不要把绝对路径回显给面板。
              const code = err && err.code;
              const missing = code === 'DSMP_ROLE_NAME' || (err && (err.code === 'ENOENT' || /ENOENT/.test(String(err.message || ''))));
              if (missing) {
                sendJson(res, 404, { ok: false, code: 'DSMP_ROLE_MISSING', error: `没有这张人设卡：${wanted}` });
                return;
              }
              throw err;
            }
            sendJson(res, 200, { ok: true, ...listing, name: wanted, content });
            return;
          }
          sendJson(res, 200, { ok: true, ...listing });
          return;
        }
        if (req.method === 'POST') {
          const body = await readJsonBody(req);
          const saved = saveRoleText(String(body.name || activeRole(current).name), body.content, current);
          // Keep the copy inside the memory directory in step with the edit.
          const mirror = syncRolesToMemory({ settings: current, memoryDir: current.memoryDir });
          sendJson(res, 200, {
            ok: true,
            ...saved,
            ...listRoles(current),
            current: activeRole(current),
            mirror
          });
          return;
        }
        if (req.method === 'DELETE') {
          const body = await readJsonBody(req).catch(() => ({}));
          const target = String(query.get('name') || body.name || '');
          const deleted = deleteRoleText(target, current);
          // Drop the mirror copy too, so a deleted card leaves no ghost behind.
          const mirror = syncRolesToMemory({ settings: current, memoryDir: current.memoryDir });
          sendJson(res, 200, {
            ok: true,
            ...deleted,
            ...listRoles(current),
            current: activeRole(current),
            mirror
          });
          return;
        }
        sendJson(res, 405, { ok: false, error: 'method not allowed' });
      } catch (err) {
        fail(res, err);
      }
    }
  }), 'dsmp: roles route');

  // Persona mirror: copy cards into `<memoryDir>/roles` on demand.
  ctx.effect(() => webRegister({
    kind: 'exact',
    path: '/api/dsmp/roles/sync',
    handler: async (req, res) => {
      try {
        const current = refresh();
        const memoryDir = current.memoryDir;
        if (req.method === 'GET') {
          sendJson(res, 200, { ok: true, memoryDir, mirror: mirrorSummary(memoryDir) });
          return;
        }
        if (req.method === 'POST') {
          const out = syncRolesToMemory({ settings: current, memoryDir });
          sendJson(res, out.ok ? 200 : 500, { ok: out.ok, memoryDir, ...out, mirror: mirrorSummary(memoryDir) });
          return;
        }
        sendJson(res, 405, { ok: false, error: 'method not allowed' });
      } catch (err) {
        fail(res, err);
      }
    }
  }), 'dsmp: roles sync route');

  ctx.effect(() => webRegister({
    kind: 'exact',
    path: '/api/dsmp/models',
    handler: async (req, res) => {
      try {
        if (req.method === 'GET') {
          sendJson(res, 200, await modelCatalog(ctx, refresh()));
          return;
        }
        if (req.method === 'POST') {
          const body = await readJsonBody(req);
          const patch = pickSettingsPatch({ chat: { provider: body.provider, model: body.model } });
          writeSettings(patch);
          refresh();
          let hostApplied = null;
          // 「设为宿主默认」：写 ctx.agentDefaultModel 的持久选择，影响所有未指定模型的会话。
          if (body.applyToHost === true) {
            try {
              const svc = typeof ctx.get === 'function' ? ctx.get('agentDefaultModel') : undefined;
              if (svc && typeof svc.saveSelection === 'function') {
                const prev = typeof svc.currentSelection === 'function' ? svc.currentSelection() : null;
                await svc.saveSelection({
                  provider: String(body.provider || ''),
                  model: String(body.model || ''),
                  ...(prev && prev.reasoningEffort ? { reasoningEffort: prev.reasoningEffort } : {})
                });
                hostApplied = { ok: true };
              } else {
                hostApplied = { ok: false, error: 'agentDefaultModel 不可用' };
              }
            } catch (err) {
              hostApplied = { ok: false, error: String(err && err.message ? err.message : err) };
            }
          }
          const catalog = await modelCatalog(ctx, settings);
          sendJson(res, 200, hostApplied ? { ...catalog, hostApplied } : catalog);
          return;
        }
        sendJson(res, 405, { ok: false, error: 'method not allowed' });
      } catch (err) {
        fail(res, err);
      }
    }
  }), 'dsmp: models route');

  // ---- QQ channel (M2) ----------------------------------------------------
  // Reads are open; writes are dry-run until test.allowLiveSend is flipped.
  const outboxFile = path.join(dsmpHome(), 'bridge-outbox.jsonl');
  const inboxFile = path.join(dsmpHome(), 'bridge-inbox.jsonl');
  const channelClient = () => new BridgeClient({ settings, outboxFile, logger: () => {} });
  // 「当前对话」以 bridge 的实时映射为准（closed-agent / 策略变化会换 sessionId），
  // settings 里只留离线兜底。查不到时回落 boundId / liveId。
  const currentLiveSessionId = async () => {
    try {
      const list = await channelClient().sessions();
      const key = String((settings.channel && settings.channel.key) || '');
      const hit = (Array.isArray(list) ? list : []).find((row) => row && row.sessionId && (!key || row.key === key));
      if (hit) return String(hit.sessionId);
    } catch {
      /* bridge 不在就用兜底 */
    }
    return String(settings.session.boundId || settings.session.liveId || '');
  };

  const appendInbox = (record) => {
    try {
      fs.mkdirSync(path.dirname(inboxFile), { recursive: true });
      fs.appendFileSync(inboxFile, `${JSON.stringify(record)}\n`, 'utf8');
    } catch {
      /* inbound logging must never break delivery */
    }
  };

  const readInbox = (limit = 50) => {
    try {
      return fs.readFileSync(inboxFile, 'utf8').split('\n').filter(Boolean).slice(-limit).map((line) => {
        try { return JSON.parse(line); } catch { return null; }
      }).filter(Boolean);
    } catch {
      return [];
    }
  };

  ctx.effect(() => webRegister({
    kind: 'exact',
    path: '/api/dsmp/bridge/status',
    handler: async (req, res) => {
      if (req.method !== 'GET') {
        sendJson(res, 405, { ok: false, error: 'method not allowed' });
        return;
      }
      try {
        refresh();
        const client = channelClient();
        const result = await client.status();
        sendJson(res, 200, {
          ...result,
          mode: channelModeOf(result),
          tokenPresent: client.hasToken(),
          liveSend: !client.testMode || client.allowLiveSend,
          outbox: client.readOutbox(10).length
        });
      } catch (err) {
        fail(res, err);
      }
    }
  }), 'dsmp: bridge status route');

  ctx.effect(() => webRegister({
    kind: 'exact',
    path: '/api/dsmp/bridge/recent',
    handler: async (req, res) => {
      if (req.method !== 'GET') {
        sendJson(res, 405, { ok: false, error: 'method not allowed' });
        return;
      }
      try {
        const s = refresh();
        const q = queryOf(req);
        const key = String(q.get('key') || s.channel.key || '');
        const limit = Math.min(100, Math.max(1, Number(q.get('limit')) || 20));
        sendJson(res, 200, await channelClient().recent(key, limit));
      } catch (err) {
        fail(res, err);
      }
    }
  }), 'dsmp: bridge recent route');

  ctx.effect(() => webRegister({
    kind: 'exact',
    path: '/api/dsmp/bridge/send',
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        sendJson(res, 405, { ok: false, error: 'method not allowed' });
        return;
      }
      try {
        refresh();
        const body = await readJsonBody(req, 64 * 1024);
        const inbound = validateInbound({ key: body.key || settings.channel.key, messages: body.messages ?? body.message });
        if (!inbound.ok) {
          sendJson(res, 400, { ok: false, error: inbound.error });
          return;
        }
        sendJson(res, 200, { ok: true, ...(await channelClient().sendMessage({
          key: inbound.key,
          messages: inbound.messages.map((m) => m.text),
          replyToMessageId: body.replyToMessageId,
          gapMode: body.gapMode
        })) });
      } catch (err) {
        fail(res, err);
      }
    }
  }), 'dsmp: bridge send route');

  ctx.effect(() => webRegister({
    kind: 'exact',
    path: '/api/dsmp/inbound',
    handler: async (req, res) => {
      try {
        if (req.method === 'GET') {
          sendJson(res, 200, { ok: true, messages: readInbox(50) });
          return;
        }
        if (req.method !== 'POST') {
          sendJson(res, 405, { ok: false, error: 'method not allowed' });
          return;
        }
        const body = await readJsonBody(req, 256 * 1024);
        const parsed = validateInbound(body);
        if (!parsed.ok) {
          sendJson(res, 400, { ok: false, error: parsed.error });
          return;
        }
        const record = {
          at: new Date().toISOString(),
          key: parsed.key,
          messages: parsed.messages,
          testMode: settings.test?.enabled !== false,
          origin: String(body.origin || 'bridge')
        };
        appendInbox(record);
        sendJson(res, 200, { ok: true, accepted: parsed.messages.length, key: parsed.key, record });
      } catch (err) {
        fail(res, err);
      }
    }
  }), 'dsmp: inbound route');

  ctx.effect(() => webRegister({
    kind: 'exact',
    path: '/api/dsmp/inbox',
    handler: (req, res) => {
      if (req.method !== 'GET') {
        sendJson(res, 405, { ok: false, error: 'method not allowed' });
        return;
      }
      try {
        refresh();
        const limit = Math.min(200, Math.max(1, Number(queryOf(req).get('limit')) || 20));
        sendJson(res, 200, { ok: true, file: inboxFile, messages: readInbox(limit) });
      } catch (err) {
        fail(res, err);
      }
    }
  }), 'dsmp: inbox route');

  ctx.effect(() => webRegister({
    kind: 'exact',
    path: '/api/dsmp/outbox',
    handler: (req, res) => {
      if (req.method !== 'GET') {
        sendJson(res, 405, { ok: false, error: 'method not allowed' });
        return;
      }
      try {
        refresh();
        const limit = Math.min(200, Math.max(1, Number(queryOf(req).get('limit')) || 50));
        sendJson(res, 200, { ok: true, file: outboxFile, messages: channelClient().readOutbox(limit) });
      } catch (err) {
        fail(res, err);
      }
    }
  }), 'dsmp: outbox route');

  ctx.effect(() => webRegister({
    kind: 'exact',
    path: '/api/dsmp/history/sessions',
    handler: async (req, res) => {
      if (req.method !== 'GET') {
        sendJson(res, 405, { ok: false, error: 'method not allowed' });
        return;
      }
      try {
        refresh();
        const limit = Math.min(200, Math.max(1, Number(queryOf(req).get('limit')) || 50));
        const bridgeIds = new Set();
        try {
          const sessionClient = channelClient();
          for (const row of await sessionClient.sessions()) {
            const id = String((row && row.sessionId) || '');
            if (id) bridgeIds.add(id);
          }
        } catch { /* bridge offline: settings still tell us the bound id */ }
        const configured = new Set([settings.session.boundId, settings.session.liveId].filter(Boolean).map(String));
        const items = scanSessions(dshHome())
          // 子代理会话的第一条 user 消息是派发提示词，不属于聊天记录。
          // 注意：fork 出来的会话也会带 parentSession（指向分叉来源），
          // 不能据此过滤，只能看 origin / delegationDepth。
          .filter((entry) => entry.origin !== 'subagent' && !Number(entry.delegationDepth || 0))
          .slice(0, limit).map((entry) => ({
          sessionId: entry.sessionId,
          cwd: entry.cwd,
          agentPreset: entry.agentPreset,
          origin: entry.origin,
          bytes: entry.bytes,
          mtime: entry.mtime,
          valid: entry.valid,
          test: String(entry.sessionId).startsWith(String((settings.test || {}).sessionPrefix || 'session-dsmp-test-')),
          bound: configured.has(entry.sessionId) || bridgeIds.has(entry.sessionId),
          bridgeLive: bridgeIds.has(entry.sessionId)
        }));
        sendJson(res, 200, { ok: true, root: path.join(dshHome(), 'sessions'), count: items.length, items });
      } catch (err) {
        fail(res, err);
      }
    }
  }), 'dsmp: history sessions route');

  // QQ 的会话日志会随轮转/策略变化拆成多份（同一 cwd 下多个 session-*）。
  // 「对话」要像 QQ 一样连续，所以按 cwd 把这些会话合成一条时间线。
  const qqHistoryEntries = () => {
    const cwd = String((settings.session && settings.session.liveCwd) || '').toLowerCase();
    if (!cwd) return [];
    return scanSessions(dshHome()).filter((entry) => (
      String(entry.cwd || '').toLowerCase() === cwd
      // 子代理（翻译/调研/并行任务）与主会话共用 cwd，它们的首条 user 消息是
      // 派发提示词，不是主人说过的话；合并聊天记录时必须排除。
      // fork 出来的会话同样带 parentSession（指向分叉来源），不能据此过滤。
      && entry.origin !== 'subagent'
      && !Number(entry.delegationDepth || 0)
    ));
  };

  const mergedQqPage = ({ limit = 40, before = '', q = '' } = {}) => {
    const entries = qqHistoryEntries();
    const all = [];
    const seen = new Set();
    for (const entry of entries) {
      const file = findSessionLog(dshHome(), entry.sessionId);
      if (!file) continue;
      for (const item of itemsOfSession(file).items) {
        const key = `${item.role}|${item.at}|${String(item.displayText || '').slice(0, 80)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        all.push({ ...item, id: `${String(entry.sessionId).slice(-8)}-${item.id}`, sessionId: entry.sessionId });
      }
    }
    all.sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')));
    const needle = String(q || '').toLowerCase();
    const filtered = needle
      ? all.filter((item) => String(item.displayText || item.text || '').toLowerCase().includes(needle))
      : all;
    let end = filtered.length;
    if (before) {
      const index = filtered.findIndex((item) => item.id === before);
      if (index >= 0) end = index;
    }
    const start = Math.max(0, end - limit);
    const items = filtered.slice(start, end);
    return {
      merged: true,
      total: filtered.length,
      sessions: entries.map((entry) => entry.sessionId),
      hasMore: start > 0,
      items,
      first: items.length ? items[0].id : '',
      last: items.length ? items[items.length - 1].id : ''
    };
  };

  // 会话日志里的入站图只有 attachmentId；用轮次账本的 mediaRefs 与媒体库
  // 索引按时间就近补 sha1，让面板能直接 <img src>。
  const decorateHistoryItems = (items, sessionIds, store) => {
    const refs = [];
    for (const sessionId of sessionIds) {
      try {
        const rows = windowMod.readTurns(memoryWriteDir(settings), sessionId, { limit: 500 });
        for (const row of rows) {
          for (const media of (row.mediaRefs || [])) {
            if (media && media.sha1) refs.push({ sha1: media.sha1, at: Number(media.at) || 0, kind: media.kind || 'image', used: false });
          }
        }
      } catch { /* 账本不可读时保持原样，客户端还有 attachment 兜底 */ }
    }
    try {
      const known = new Set(refs.map((ref) => ref.sha1));
      const listed = store.list({ kind: 'image', limit: 500 });
      for (const row of (listed.items || [])) {
        if (!row.sha1 || known.has(row.sha1)) continue;
        refs.push({ sha1: row.sha1, at: Number(row.at) || 0, kind: 'image', used: false });
        known.add(row.sha1);
      }
    } catch { /* 索引不可读就只靠账本 */ }
    const sha1Near = (at) => {
      const ts = Date.parse(at) || 0;
      if (!ts) return '';
      let best = null;
      let diff = Infinity;
      for (const ref of refs) {
        if (ref.used || ref.kind !== 'image') continue;
        const d = Math.abs(ref.at - ts);
        if (d < diff) { best = ref; diff = d; }
      }
      if (best && diff <= 180000) { best.used = true; return best.sha1; }
      return '';
    };
    const attachmentUrl = (image) => {
      const q = new URLSearchParams({ id: String(image.attachmentId) });
      if (image.mediaType) q.set('mt', String(image.mediaType));
      if (image.bytes) q.set('b', String(image.bytes));
      if (image.width) q.set('w', String(image.width));
      if (image.height) q.set('h', String(image.height));
      return `/api/dsmp/media/attachment?${q.toString()}`;
    };
    return (items || []).map((item) => ({
      ...item,
      images: (item.images || []).map((image) => {
        const sha1 = image.sha1 || sha1Near(item.at);
        return {
          ...image,
          sha1,
          url: sha1 ? `/api/dsmp/media/file?sha1=${sha1}&kind=image`
            : (image.attachmentId ? attachmentUrl(image) : '')
        };
      }),
      kind: item.origin === 'qq' ? 'qq' : item.origin === 'bot' ? 'bot' : 'panel'
    }));
  };

  ctx.effect(() => webRegister({
    kind: 'exact',
    path: '/api/dsmp/history',
    handler: async (req, res) => {
      if (req.method !== 'GET') {
        sendJson(res, 405, { ok: false, error: 'method not allowed' });
        return;
      }
      try {
        refresh();
        const query = queryOf(req);
        const limit = Math.min(200, Math.max(1, Number(query.get('limit')) || 40));
        const before = String(query.get('before') || '');
        const q = String(query.get('q') || '');
        const store = mediaStoreOf(settings);
        const scope = String(query.get('scope') || '');
        const sessionIds = new Set();
        let singleSessionId = '';
        let page;
        if (scope === 'qq') {
          // 轮转会把 QQ 会话拆成多份日志；这里按 cwd 合成一条连续时间线。
          page = mergedQqPage({ limit, before, q });
          for (const sid of (page.sessions || [])) sessionIds.add(sid);
        } else {
          // 「当前对话」不写死：bridge 换会话（closed-agent / 策略变化）后，这里要跟着走。
          singleSessionId = String(query.get('sessionId') || '') || (await currentLiveSessionId());
          const file = findSessionLog(dshHome(), singleSessionId);
          if (!file) {
            sendJson(res, 404, { ok: false, error: `没有找到会话日志：${singleSessionId}`, code: 'DSMP_HISTORY_MISSING' });
            return;
          }
          sessionIds.add(singleSessionId);
          page = historyFromFile(file, { limit, before, q });
        }
        const items = decorateHistoryItems(page.items, sessionIds, store);
        sendJson(res, 200, {
          ...page,
          ok: true,
          sessionId: singleSessionId || undefined,
          mediaRoot: store.root,
          items
        });
      } catch (err) {
        fail(res, err);
      }
    }
  }), 'dsmp: history route');

  ctx.effect(() => webRegister({
    kind: 'exact',
    path: '/api/dsmp/workbench',
    handler: async (req, res) => {
      if (req.method !== 'GET') {
        sendJson(res, 405, { ok: false, error: 'method not allowed' });
        return;
      }
      try {
        refresh();
        const query = queryOf(req);
        const view = String(query.get('view') || 'facts');
        const dir = memoryWriteDir(settings);
        if (view === 'facts') {
          const payload = await workbench.factsView(dir);
          sendJson(res, 200, { ...payload, etag: robustness.etagOfDir(dir) });
          return;
        }
        if (view === 'topics') {
          sendJson(res, 200, await workbench.topicsView(dir));
          return;
        }
        if (view === 'window') {
          const sessionId = String(query.get('sessionId') || settings.session.boundId || settings.session.liveId || '');
          const limit = Math.min(200, Math.max(1, Number(query.get('limit')) || 60));
          const from = Number(query.get('from')) || 0;
          const to = Number(query.get('to')) || 0;
          sendJson(res, 200, await workbench.windowView(dir, sessionId, limit, { from, to }));
          return;
        }
        if (view === 'episodes') {
          sendJson(res, 200, await workbench.episodesView(dir, {
            day: String(query.get('day') || ''),
            limit: Math.min(50, Math.max(1, Number(query.get('limit')) || 5))
          }));
          return;
        }
        if (view === 'usage') {
          sendJson(res, 200, await workbench.usageView(dir, {
            days: Number(query.get('days')) || 14,
            scope: String(query.get('scope') || 'all'),
            session: String(query.get('session') || 'all'),
            turn: String(query.get('turn') || 'all')
          }));
          return;
        }
        if (view === 'claims') {
          const payload = await workbench.claimsView(dir);
          sendJson(res, 200, { ...payload, etag: robustness.etagOfDir(dir) });
          return;
        }
        if (view === 'disputes') {
          const status = String(query.get('status') || 'pending');
          const items = disputesMod.listDisputes(dir, { status, limit: 50 });
          sendJson(res, 200, {
            ok: true,
            items,
            pending: disputesMod.pendingCount(dir),
            etag: robustness.etagOfDir(dir)
          });
          return;
        }
        if (view === 'monthly') {
          const cfg = (settings.memory && settings.memory.monthly) || {};
          const text = String(monthlyMod.monthlyForInjection(dir, { now: Date.now(), cfg }) || '');
          sendJson(res, 200, {
            ok: true,
            text,
            chars: text.length,
            index: monthlySummary(settings),
            etag: robustness.etagOfDir(dir)
          });
          return;
        }
        if (view === 'recall') {
          sendJson(res, 200, await workbench.recallView(dir, String(query.get('q') || '')));
          return;
        }
        if (view === 'activation') {
          const payload = await workbenchWrite.activationGet(dir);
          sendJson(res, 200, { ...payload, etag: robustness.etagOfDir(dir) });
          return;
        }
        if (view === 'history') {
          const payload = await workbenchWrite.factHistory(dir, String(query.get('id') || ''));
          sendJson(res, 200, { ...payload, etag: robustness.etagOfDir(dir) });
          return;
        }
        // ---- 7351 移植：新增只读视图 ----
        if (view === 'card') {
          const maxChars = Number(query.get('maxChars')) || 1500;
          sendJson(res, 200, await workbench.cardView(dir, { maxChars }));
          return;
        }
        if (view === 'context') {
          // 真源是桥接 config.memory（经 desired 合并草稿）；settings.memory 只是面板镜像。
          const d = desiredGet().desired;
          sendJson(res, 200, await workbench.contextView(dir, {
            contextWindowTokens: Number(d.contextWindowTokens) || 0,
            thresholdRatio: Number(d.rotationThresholdRatio) || 0.7,
            handoverMaxChars: Number(d.handoverMaxChars) || 0,
            windowDays: Number(d.windowDays) || 7,
            dailyAt: String(d.dailyAt || '')
          }));
          return;
        }
        if (view === 'sessions') {
          // 会话与策略：上下文占用 + 折叠状态 + 每个会话的注入策略（只读展示）。
          const d = desiredGet().desired;
          const payload = await workbench.contextView(dir, {
            contextWindowTokens: Number(d.contextWindowTokens) || 0,
            thresholdRatio: Number(d.rotationThresholdRatio) || 0.7,
            handoverMaxChars: Number(d.handoverMaxChars) || 0,
            windowDays: Number(d.windowDays) || 7,
            dailyAt: String(d.dailyAt || '')
          });
          payload.policies = d.policies || {};
          for (const row of payload.sessions) {
            row.injectPolicy = (d.policies && d.policies[row.key]) || row.policy || 'full';
          }
          sendJson(res, 200, payload);
          return;
        }
        if (view === 'config') {
          sendJson(res, 200, {
            ok: true,
            managed: DESIRED_KEYS,
            scoringKeys: SCORING_NUMERIC,
            policyStates: POLICY_STATES,
            ...desiredGet()
          });
          return;
        }
        if (view === 'overview') {
          const payload = await workbench.overviewView(dir);
          payload.lease = lease.leaseSummary(dir);
          payload.engine = memoryEngine.engineStatus();
          payload.selfCheck = selfCheckItems;
          try {
            const st = await bridge.status();
            payload.bridge = { ok: true, mode: st.mode, alive: st.alive, role: st.role, dshReady: st.dshReady };
          } catch (err) {
            payload.bridge = { ok: false, error: String((err && err.message) || err) };
          }
          sendJson(res, 200, payload);
          return;
        }
        if (view === 'graph') {
          const maxFacts = Math.min(600, Math.max(20, Number(query.get('maxFacts')) || 240));
          sendJson(res, 200, await workbench.graphView(dir, { maxFacts }));
          return;
        }
        if (view === 'media') {
          sendJson(res, 200, await workbench.mediaWallView(dir, {
            kind: String(query.get('kind') || 'image'),
            limit: Number(query.get('limit')) || 60
          }));
          return;
        }
        if (view === 'folds') {
          sendJson(res, 200, await workbench.foldsView(dir));
          return;
        }
        if (view === 'export') {
          sendJson(res, 200, await workbench.exportView(dir, { withWindow: String(query.get('window') || '') === '1' }));
          return;
        }
        if (view === 'window-sessions') {
          sendJson(res, 200, await workbench.windowSessionListView(dir));
          return;
        }
        if (view === 'fact') {
          sendJson(res, 200, await workbench.factDetailView(dir, String(query.get('id') || '')));
          return;
        }
        if (view === 'desired') {
          sendJson(res, 200, { ok: true, ...desiredGet() });
          return;
        }
        sendJson(res, 400, { ok: false, error: `未知视图：${view}` });
      } catch (err) {
        fail(res, err);
      }
    }
  }), 'dsmp: workbench route');

  // Workbench write path (M9). One gate for every mutation: current memory
  // directory, writer lease held by this plugin, mirroring paused, backup first.
  const workbenchGuard = () => {
    const dir = memoryWriteDir(settings);
    let migrating = false;
    try {
      const journal = JSON.parse(fs.readFileSync(path.join(dsmpHome(), 'migration', 'journal.json'), 'utf8'));
      migrating = Boolean(journal && journal.phase && journal.phase !== 'done');
    } catch { migrating = false; }
    workbenchWrite.guardWrite({
      dir,
      leaseOk: lease.leaseOwnedBy(dir, 'dsmp'),
      migrating
    });
    return dir;
  };

  // ---- 7351 移植：期望配置（desired）与写入桥接配置（apply） ----
  const DESIRED_KEYS = [
    'dir', 'enabled', 'windowDays', 'dailyAt', 'maxCharsPerMessage', 'handoverMaxChars',
    'rotationThresholdRatio', 'rotationCooldownMs', 'minRotateTokens', 'contextWindowTokens',
    'reinjectOnUpdate', 'maxEntriesPerKey', 'invalidateEnabled', 'profileMaxChars'
  ];
  const POLICY_STATES = ['off', 'log', 'full'];
  const SCORING_NUMERIC = [
    'baseDefault', 'baseFact', 'mentionBonus', 'cap', 'halfLifeLong', 'halfLifeGeneral',
    'halfLifeTemp', 'sameDayDecay', 'alpha', 'sMaxDays', 'promoteHits', 'promoteScore',
    'demoteFloor', 'tempTtlDays', 'negativePenalty', 'suspectAt'
  ];

  const desiredPath = () => path.join(dsmpHome(), 'workbench-desired.json');

  /** 桥接配置是唯一真源；desired 只是「面板上改过、还没 apply」的草稿。 */
  function readBridgeConfigFile() {
    const dir = String((settings.bridge && settings.bridge.dir) || '').trim();
    if (!dir) {
      const err = new Error('未配置 bridge.dir，无法读写桥接配置');
      err.code = 'DSMP_BRIDGE_NO_DIR';
      throw err;
    }
    const file = path.join(dir, 'config.json');
    if (!fs.existsSync(file)) {
      const err = new Error(`桥接配置不存在：${file}`);
      err.code = 'DSMP_BRIDGE_NO_CONFIG';
      throw err;
    }
    return { file, cfg: JSON.parse(fs.readFileSync(file, 'utf8')) };
  }

  function desiredGet() {
    let mem = {};
    let bridgeError = '';
    try {
      mem = readBridgeConfigFile().cfg.memory || {};
    } catch (err) {
      bridgeError = String((err && err.message) || err);
    }
    let saved = {};
    let savedAt = 0;
    try {
      saved = JSON.parse(fs.readFileSync(desiredPath(), 'utf8'));
      savedAt = fs.statSync(desiredPath()).mtimeMs;
    } catch {
      saved = {};
    }
    const desired = {
      dir: mem.dir || settings.memoryDir || '',
      enabled: mem.enabled !== false,
      windowDays: Number(mem.windowDays) || 7,
      dailyAt: String(mem.dailyAt || '23:00'),
      maxCharsPerMessage: Number(mem.maxCharsPerMessage) || 8000,
      handoverMaxChars: Number(mem.handoverMaxChars) || 5200,
      rotationThresholdRatio: Number(mem.rotationThresholdRatio) || 0.7,
      rotationCooldownMs: Number(mem.rotationCooldownMs) || 600000,
      minRotateTokens: Number(mem.minRotateTokens) || 20000,
      contextWindowTokens: Number(mem.contextWindowTokens) || 0,
      reinjectOnUpdate: mem.reinjectOnUpdate !== false,
      maxEntriesPerKey: Number(mem.maxEntriesPerKey) || 5000,
      invalidateEnabled: mem.invalidateEnabled !== false,
      profileMaxChars: Number(mem.profile && mem.profile.maxChars) || 1500,
      scoring: mem.scoring && typeof mem.scoring === 'object' ? mem.scoring : {},
      policies: mem.policy && mem.policy.keys && typeof mem.policy.keys === 'object' ? mem.policy.keys : {}
    };
    for (const key of DESIRED_KEYS) if (saved[key] !== undefined) desired[key] = saved[key];
    if (saved.scoring && typeof saved.scoring === 'object') desired.scoring = { ...desired.scoring, ...saved.scoring };
    if (saved.policies && typeof saved.policies === 'object') desired.policies = { ...desired.policies, ...saved.policies };
    return { desired, savedAt, bridgeError, file: desiredPath() };
  }

  const clampNum = (value, min, max, fallback) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, Math.round(n * 1000) / 1000));
  };

  function desiredSave(body = {}) {
    const current = desiredGet().desired;
    const next = { ...current };
    for (const key of DESIRED_KEYS) if (body[key] !== undefined) next[key] = body[key];
    if (body.scoring && typeof body.scoring === 'object') next.scoring = { ...current.scoring, ...body.scoring };
    if (body.policies && typeof body.policies === 'object') next.policies = { ...current.policies, ...body.policies };

    const dir = String(next.dir || '').trim();
    if (!dir || !path.isAbsolute(dir)) {
      const err = new Error(`数据目录必须是绝对路径：${dir || '(空)'}`);
      err.code = 'DSMP_WRITE_BAD_INPUT';
      throw err;
    }
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
      const err = new Error(`数据目录不存在：${dir}`);
      err.code = 'DSMP_WRITE_BAD_INPUT';
      throw err;
    }
    next.dir = dir;
    next.enabled = Boolean(next.enabled);
    next.reinjectOnUpdate = Boolean(next.reinjectOnUpdate);
    next.invalidateEnabled = Boolean(next.invalidateEnabled);
    next.windowDays = Math.round(clampNum(next.windowDays, 1, 30, 7));
    next.maxCharsPerMessage = clampNum(next.maxCharsPerMessage, 200, 40000, 8000);
    next.handoverMaxChars = clampNum(next.handoverMaxChars, 500, 20000, 5200);
    next.rotationThresholdRatio = clampNum(next.rotationThresholdRatio, 0.1, 0.95, 0.7);
    next.rotationCooldownMs = clampNum(next.rotationCooldownMs, 60000, 86400000, 600000);
    next.minRotateTokens = clampNum(next.minRotateTokens, 1000, 5000000, 20000);
    next.contextWindowTokens = clampNum(next.contextWindowTokens, 0, 10000000, 0);
    next.maxEntriesPerKey = Math.round(clampNum(next.maxEntriesPerKey, 10, 200000, 5000));
    next.profileMaxChars = Math.round(clampNum(next.profileMaxChars, 200, 8000, 1500));
    if (!/^\d{2}:\d{2}$/.test(String(next.dailyAt || ''))) {
      const err = new Error('dailyAt 必须是 HH:MM');
      err.code = 'DSMP_WRITE_BAD_INPUT';
      throw err;
    }
    const scoring = { ...(next.scoring || {}) };
    for (const key of SCORING_NUMERIC) {
      if (scoring[key] !== undefined) scoring[key] = clampNum(scoring[key], 0, 1000000, Number(current.scoring[key]) || 0);
    }
    if (!['off', 'shadow', 'on'].includes(String(scoring.mode || ''))) scoring.mode = 'shadow';
    next.scoring = scoring;
    const policies = {};
    for (const [key, value] of Object.entries(next.policies || {})) {
      if (!POLICY_STATES.includes(String(value))) continue;
      policies[String(key).slice(0, 120)] = String(value);
      if (Object.keys(policies).length >= 200) break;
    }
    next.policies = policies;

    const file = desiredPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n', 'utf8');
    fs.renameSync(tmp, file);
    return { ok: true, ...desiredGet() };
  }

  async function applyDesired(body = {}) {
    const { desired, bridgeError } = desiredGet();
    if (bridgeError) {
      const err = new Error(bridgeError);
      err.code = 'DSMP_BRIDGE_NO_CONFIG';
      throw err;
    }
    const { file, cfg } = readBridgeConfigFile();
    const stampText = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
    const backupFile = path.join(path.dirname(file), 'backup', `config.json.bak-${stampText}`);
    fs.mkdirSync(path.dirname(backupFile), { recursive: true });
    fs.copyFileSync(file, backupFile);

    cfg.memory = { ...(cfg.memory || {}) };
    for (const key of DESIRED_KEYS) if (key !== 'profileMaxChars') cfg.memory[key] = desired[key];
    cfg.memory.profile = { ...(cfg.memory.profile || {}), maxChars: desired.profileMaxChars };
    cfg.memory.scoring = desired.scoring;
    cfg.memory.policy = { ...(cfg.memory.policy || {}), keys: desired.policies };
    const tmp = `${file}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
    fs.renameSync(tmp, file);

    // 默认「保存稍后重启」：apply 只写盘，不打断正在进行的 QQ 回合。
    let restart = null;
    if (body.restart === true) {
      const stopped = await services.stopService(settings, 'qq');
      if (!stopped || stopped.ok === false) {
        restart = { ok: false, phase: 'stop', detail: stopped };
      } else {
        const started = await services.startService(settings, 'qq');
        restart = { ok: Boolean(started && started.ok !== false), phase: 'start', detail: started };
      }
    }
    return {
      ok: true,
      backup: path.join('backup', path.basename(backupFile)),
      keys: [...DESIRED_KEYS, 'profile.maxChars', 'scoring', 'policy.keys'],
      restart,
      appliedAt: Date.now()
    };
  }

  ctx.effect(() => webRegister({
    kind: 'exact',
    path: '/api/dsmp/workbench/write',
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        sendJson(res, 405, { ok: false, error: 'method not allowed' });
        return;
      }
      try {
        refresh();
        const body = await readJsonBody(req);
        const action = String(body.action || '');
        if (!['claims', 'fact-edit', 'fact', 'activation', 'dispute', 'desired-save', 'apply'].includes(action)) {
          sendJson(res, 400, { ok: false, error: `未知 action：${action || '(空)'}`, code: 'DSMP_WRITE_BAD_INPUT' });
          return;
        }
        const dir = workbenchGuard();
        const before = robustness.etagOfDir(dir);
        const ifMatch = String(body.ifMatch || '');
        if (ifMatch && ifMatch !== before) {
          sendJson(res, 409, { ok: false, code: 'DSMP_STALE', etag: before, error: '数据已更新，请刷新后重试' });
          return;
        }
        let result;
        if (action === 'claims') result = await workbenchWrite.claimsOp(dir, body);
        else if (action === 'fact-edit') result = await workbenchWrite.factEdit(dir, body);
        else if (action === 'fact') result = await workbenchWrite.factOp(dir, body);
        else if (action === 'desired-save') result = desiredSave(body.values || body);
        else if (action === 'apply') result = await applyDesired(body);
        else if (action === 'dispute') {
          result = disputesMod.resolveDispute(dir, {
            id: String(body.id || ''),
            action: String(body.decision || ''),
            value: String(body.value || ''),
            by: 'owner',
            note: String(body.note || '')
          });
          if (!result.ok) {
            const err = new Error(result.error || '裁决失败');
            err.code = 'DSMP_DISPUTE';
            throw err;
          }
        } else result = await workbenchWrite.activationOp(dir, body);
        sendJson(res, 200, { ok: true, action, result, etag: robustness.etagOfDir(dir) });
      } catch (err) {
        fail(res, err);
      }
    }
  }), 'dsmp: workbench write route');

  ctx.effect(() => webRegister({
    kind: 'exact',
    path: '/api/dsmp/chat/sessions',
    handler: async (req, res) => {
      try {
        refresh();
        if (req.method === 'GET') {
          const payload = bridge.listSessions();
          // Sessions survive plugin reloads on disk but not in the in-memory
          // mirror; pull the test-prefixed ones back so rename/delete/attach
          // keep working after a reload.
          const prefix = String((settings.test && settings.test.sessionPrefix) || 'session-dsmp-test-');
          const known = new Set((payload.sessions || []).map((row) => row.id));
          for (const row of scanSessions(dshHome()) || []) {
            if (!row || !row.valid || known.has(row.sessionId)) continue;
            if (!String(row.sessionId).startsWith(prefix)) continue;
            payload.sessions.push({
              id: row.sessionId,
              title: '',
              busy: false,
              attached: false,
              messages: 0,
              lastAt: row.mtime || 0
            });
          }
          payload.sessions.sort((a, b) => (b.lastAt || 0) - (a.lastAt || 0));
          sendJson(res, 200, sessionMeta.decorateSessions(payload));
          return;
        }
        if (req.method !== 'POST') {
          sendJson(res, 405, { ok: false, error: 'method not allowed' });
          return;
        }
        const body = await readJsonBody(req, 32 * 1024);
        const created = await bridge.createTestSession({
          agentOptions: agentOptionsFor(settings, body),
          cwd: typeof body.cwd === 'string' && body.cwd ? body.cwd : undefined,
          title: typeof body.title === 'string' ? body.title : ''
        });
        sendJson(res, 200, { ok: true, ...created });
      } catch (err) {
        fail(res, err);
      }
    }
  }), 'dsmp: chat sessions route');

  ctx.effect(() => webRegister({
    kind: 'exact',
    path: '/api/dsmp/chat/rename',
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        sendJson(res, 405, { ok: false, error: 'method not allowed' });
        return;
      }
      try {
        refresh();
        const body = await readJsonBody(req, 16 * 1024);
        const sessionId = String(body.sessionId || '');
        if (!sessionId) {
          sendJson(res, 400, { ok: false, error: '缺少 sessionId' });
          return;
        }
        bridge.guard(sessionId);
        const title = String(body.title || '').trim();
        if (!title) {
          sendJson(res, 400, { ok: false, error: '会话名不能为空' });
          return;
        }
        const saved = sessionMeta.setTitle(sessionId, title);
        bridge.titles.set(sessionId, saved.title);
        sendJson(res, 200, { ...saved, sessions: sessionMeta.decorateSessions(bridge.listSessions()) });
      } catch (err) {
        fail(res, err);
      }
    }
  }), 'dsmp: chat rename route');

  ctx.effect(() => webRegister({
    kind: 'exact',
    path: '/api/dsmp/chat/delete',
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        sendJson(res, 405, { ok: false, error: 'method not allowed' });
        return;
      }
      try {
        refresh();
        const body = await readJsonBody(req, 16 * 1024);
        const sessionId = String(body.sessionId || '');
        if (!sessionId) {
          sendJson(res, 400, { ok: false, error: '缺少 sessionId' });
          return;
        }
        bridge.guard(sessionId);
        // Only detach from the panel: the DSH transcript on disk is never
        // touched, so this stays reversible.
        bridge.dispose(sessionId);
        sessionMeta.hideSession(sessionId);
        sendJson(res, 200, {
          ok: true,
          sessionId,
          deleted: true,
          note: '已从面板移除；会话日志仍保留在磁盘上',
          sessions: sessionMeta.decorateSessions(bridge.listSessions())
        });
      } catch (err) {
        fail(res, err);
      }
    }
  }), 'dsmp: chat delete route');

  ctx.effect(() => webRegister({
    kind: 'exact',
    path: '/api/dsmp/services',
    handler: async (req, res) => {
      try {
        refresh();
        if (req.method === 'GET') {
          const query = queryOf(req);
          if (query.get('log')) {
            sendJson(res, 200, services.readServiceLog(String(query.get('log') || 'qq')));
            return;
          }
          sendJson(res, 200, await services.serviceList(settings));
          return;
        }
        if (req.method !== 'POST') {
          sendJson(res, 405, { ok: false, error: 'method not allowed' });
          return;
        }
        const body = await readJsonBody(req, 16 * 1024);
        const action = String(body.action || '');
        const name = String(body.name || '');
        if (action !== 'start' && action !== 'stop') {
          sendJson(res, 400, { ok: false, error: 'action 必须是 start 或 stop' });
          return;
        }
        const result = action === 'start'
          ? await services.startService(settings, name)
          : await services.stopService(settings, name);
        // 未知服务是调用方参数错误，不该报 500；脚本执行失败才是 500。
        const notFound = !result.ok && /^未知服务/.test(String(result.error || ''));
        sendJson(res, result.ok ? 200 : (notFound ? 400 : 500), { ...result, action, name, list: await services.serviceList(settings) });
      } catch (err) {
        fail(res, err);
      }
    }
  }), 'dsmp: services route');

  ctx.effect(() => webRegister({
    kind: 'exact',
    path: '/api/dsmp/qq/channel',
    handler: async (req, res) => {
      try {
        refresh();
        if (req.method === 'GET') {
          sendJson(res, 200, await qqChannel.gatewayStatus(settings));
          return;
        }
        if (req.method !== 'POST') { sendJson(res, 405, { ok: false, error: 'method not allowed' }); return; }
        const body = await readJsonBody(req, 16 * 1024);
        const action = String(body.action || '');
        if (action === 'probe') { sendJson(res, 200, await qqChannel.probeProfile(settings, String(body.name || ''))); return; }
        if (action === 'set-active') { sendJson(res, 200, qqChannel.setActive(settings, String(body.name || ''))); return; }
        if (action === 'boot') { sendJson(res, 200, await qqChannel.bootGateway(settings, { to: String(body.to || '') })); return; }
        if (action === 'halt') { sendJson(res, 200, await qqChannel.haltGateway(settings)); return; }
        sendJson(res, 400, { ok: false, error: `未知 action：${action || '(空)'}` });
      } catch (err) { fail(res, err); }
    }
  }), 'dsmp: qq channel route');

  ctx.effect(() => webRegister({
    kind: 'exact',
    path: '/api/dsmp/qq/write',
    handler: async (req, res) => {
      try {
        refresh();
        if (req.method !== 'POST') { sendJson(res, 405, { ok: false, error: 'method not allowed' }); return; }
        const body = await readJsonBody(req, 32 * 1024);
        const result = await qqWrite.apply({
          settings,
          body,
          request: qqProxy.bridgeRequest,
          auditFile: path.join(dsmpHome(), 'logs', 'qq-audit.jsonl')
        });
        sendJson(res, 200, result);
      } catch (err) { fail(res, err); }
    }
  }), 'dsmp: qq write route');

  for (const sectionName of qqProxy.QQ_SECTIONS) {
    ctx.effect(() => webRegister({
      kind: 'exact',
      path: `/api/dsmp/qq/${sectionName}`,
      handler: async (req, res) => {
        try {
          refresh();
          if (req.method !== 'GET') { sendJson(res, 405, { ok: false, error: 'method not allowed' }); return; }
          const qs = String(req.url || '').split('?')[1] || '';
          sendJson(res, 200, await qqProxy.section(settings, sectionName, qs));
        } catch (err) { fail(res, err); }
      }
    }), `dsmp: qq ${sectionName} route`);
  }

  ctx.effect(() => webRegister({
    kind: 'exact',
    path: '/api/dsmp/chat/send',
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        sendJson(res, 405, { ok: false, error: 'method not allowed' });
        return;
      }
      try {
        refresh();
        const body = await readJsonBody(req, 64 * 1024);
        let sessionId = String(body.sessionId || '');
        if (!sessionId) {
          sendJson(res, 400, { ok: false, error: '缺少 sessionId' });
          return;
        }
        const memoryDir = testMemoryDir(settings);
        const text = String(body.text || '').trim();
        // The bound conversation is driven by the QQ bridge. Forward panel text to
        // it instead of starting a second agent on the same session. The bridge may
        // map a different session after a mode switch or rotation, so ask it rather
        // than trusting the id we recorded earlier.
        const liveIds = new Set([settings.session && settings.session.boundId, settings.session && settings.session.liveId].filter(Boolean).map(String));
        const liveClient = channelClient();
        let mappedId = '';
        try {
          const rows = await liveClient.sessions();
          for (const row of rows) {
            const id = String((row && row.sessionId) || '');
            if (!id) continue;
            liveIds.add(id);
            if (!mappedId && row && row.key === settings.channel.key) mappedId = id;
          }
          if (!mappedId && rows.length === 1) mappedId = String((rows[0] && rows[0].sessionId) || '');
        } catch { /* bridge offline: panel forward will fail with a clear error */ }
        // A stale liveId sends the message into a session nobody reads (the panel
        // then looks like "send does nothing"). Use the bridge's current mapping.
        if (liveIds.has(sessionId) && mappedId && mappedId !== sessionId) {
          sessionId = mappedId;
        }
        if (liveIds.has(sessionId) && mappedId && settings.session && settings.session.liveId !== mappedId) {
          settings.session.liveId = mappedId;
          try {
            writeSettings({ session: { liveId: mappedId } });
          } catch { /* keep the in-memory value for this request */ }
        }
        if (liveIds.has(sessionId)) {
          const images0 = Array.isArray(body.images) ? body.images.filter(Boolean) : [];
          if (images0.length) {
            sendJson(res, 400, { ok: false, error: '当前对话（QQ 会话）暂不支持从面板发图片，请改用测试会话' });
            return;
          }
          if (!text) {
            sendJson(res, 400, { ok: false, error: '消息不能为空' });
            return;
          }
          const panelKey = String(body.key || settings.channel.key || '');
          if (!panelKey) {
            sendJson(res, 400, {
              ok: false,
              code: 'DSMP_NO_CHANNEL_KEY',
              error: '还没配置 QQ 会话 key：请在设置里填写，或先启动 bridge 让面板自动发现'
            });
            return;
          }
          const via = String((settings.session && settings.session.via) || 'auto');

          // auto（默认）：DSMP 直接驱动这条 DSH 会话——面板不依附 QQ 桥接。
          // 只有显式设 session.via='bridge' 时才继续走 bridge 转发（旧行为）。
          if (via !== 'bridge') {
            const lock = panelLock.tryAcquire(sessionId);
            if (!lock.ok || panelBusy.has(sessionId) || bridge.isBusy(sessionId)) {
              if (lock.ok) panelLock.release(sessionId);
              sendJson(res, 409, { ok: false, code: 'DSMP_SESSION_BUSY', error: '她正在回复上一条消息，等这一轮结束再发' });
              return;
            }
            panelBusy.add(sessionId);
            const lockHeld = lock.ok;
            const busyGuard = setTimeout(() => panelBusy.delete(sessionId), 180000);
            if (busyGuard && typeof busyGuard.unref === 'function') busyGuard.unref();
            const directComposed = await composeChatPrompt(text, {
              memoryDir: String(settings.memoryDir || '') || testMemoryDir(settings),
              rulesChars: 600,
              cardChars: 1500
            });
            // A1: the agent receives the owner's raw text. The memory projection
            // is attached by the `agent/pre-step` hook (as a separate context
            // message) using this precomputed prefix — one card build per turn.
            const injectionPrefix = String(directComposed.text).split('\n\n【本次消息快照】')[0] || '';
            if (injectionPrefix) dsmpInject.notePanelTurn(sessionId, { raw: text, composed: injectionPrefix });
            const begun = await memoryWriter.beginTurn({
              key: panelKey,
              sessionId,
              userRaw: text,
              windowText: directComposed.text,
              mode: 'panel'
            }).catch(() => ({ ok: false, skipped: 'begin-failed' }));
            try {
              // 先登记、再投递：turn/end 可能比 send() 的返回更早到达，
              // 若等返回再登记就会漏掉这一轮的 finish，账本静默少一条。
              if (begun && begun.ok) panelTurns.set(sessionId, { key: panelKey, reply: '', at: Date.now() });
              const out = await bridge.send(sessionId, text, {
                agentOptions: agentOptionsFor(settings, body),
                allowLive: true
              });
              sendJson(res, 200, {
                ...out,
                sessionId,
                live: true,
                via: 'local',
                memory: { ...directComposed.meta, via: 'local', ledger: begun && begun.ok ? 'dsmp' : 'skipped', injected: 'pre-step' },
                notice: '面板直连（不依赖 QQ 桥接）'
              });
              return;
            } catch (err) {
              panelTurns.delete(sessionId);
              if (begun && begun.ok) {
                memoryWriter.finishTurn({ key: panelKey, sessionId, reply: '', reason: 'error', source: 'panel' }).catch(() => {});
              }
              if (err && err.code === 'DSMP_SESSION_BUSY') {
                sendJson(res, 409, { ok: false, code: 'DSMP_SESSION_BUSY', error: err.message });
                return;
              }
              throw err;
            } finally {
              panelBusy.delete(sessionId);
            }
          }

          const forwarded = await liveClient.panelMessage({ key: panelKey, text });
          if (!forwarded.ok && forwarded.code !== 'DSMP_PANEL_OFF') {
            // P0 offline fallback: when the bridge is not reachable the panel can
            // still talk to her by attaching to the very same DSH session. The
            // session log stays the single source of truth, so the next QQ turn
            // continues from the same context. A deliberate "panel send off" is a
            // configuration choice, not an outage, so it never falls back.
            const offline = settings.session && settings.session.offlineFallback !== false;
            let transportDown = forwarded.code === 'UNREACHABLE' || forwarded.code === 'TIMEOUT';
            if (!transportDown) {
              try {
                const url = new URL(String(settings.bridge && settings.bridge.baseUrl) || 'http://127.0.0.1:3100');
                const port = Number(url.port) || 3100;
                transportDown = (await probePort(url.hostname, port, 400)) !== 'open';
              } catch { transportDown = false; }
            }
            if (offline && transportDown) {
              const localComposed = await composeChatPrompt(text, { memoryDir, rulesChars: 600, cardChars: 1500 });
              const local = await bridge.send(sessionId, localComposed.text, {
                agentOptions: agentOptionsFor(settings, body),
                allowLive: true
              });
              sendJson(res, 200, {
                ...local,
                sessionId,
                live: true,
                via: 'local',
                memory: { ...localComposed.meta, via: 'local' },
                warning: 'QQ 桥接离线，本轮由 DSH 本地直连同一会话；记忆账户仍由 bridge 持有，本轮不记账'
              });
              return;
            }
          }
          sendJson(res, forwarded.ok ? 200 : (forwarded.code === 'DSMP_PANEL_OFF' ? 403 : 502), {
            ...forwarded,
            sessionId,
            live: true,
            memory: { skipped: 'live-forward', via: 'bridge' }
          });
          return;
        }
        const composed = text
          ? await composeChatPrompt(text, { memoryDir, rulesChars: 600, cardChars: 1500 })
          : { text: '', meta: { memoryDir, skipped: 'image-only' } };

        // Panel images: bytes live in the media library, the agent gets durable
        // attachment refs (the same shape DSH uses for pasted images).
        const requested = Array.isArray(body.images)
          ? body.images.slice(0, Number(settings.media && settings.media.maxImagesPerMessage) || 4)
          : [];
        let images = [];
        if (requested.length) {
          const store = mediaStoreOf(settings);
          const attachments = typeof ctx.get === 'function' ? ctx.get('attachments') : null;
          if (!attachments || typeof attachments.saveImages !== 'function') {
            throw Object.assign(new Error('当前宿主没有 attachments 服务，无法把图片交给模型'), { code: 'DSMP_NO_ATTACHMENTS' });
          }
          const inputs = requested.map((item) => {
            const sha1 = typeof item === 'string' ? item : String((item && item.sha1) || '');
            const got = store.get(sha1, { kind: 'image' });
            if (!got.ok) throw Object.assign(new Error(`图片不在媒体库：${sha1}`), { code: got.code || 'DSMP_MEDIA_MISSING' });
            return {
              data: got.buffer,
              mediaType: got.row.mime,
              name: got.row.name || `${sha1}.${got.row.ext}`
            };
          });
          images = await attachments.saveImages(inputs);
        }

        const result = await bridge.send(sessionId, composed.text, {
          agentOptions: agentOptionsFor(settings, body),
          images
        });
        sendJson(res, 200, { ...result, memory: composed.meta, attachments: images });
      } catch (err) {
        fail(res, err);
      }
    }
  }), 'dsmp: chat send route');

  ctx.effect(() => webRegister({
    kind: 'exact',
    path: '/api/dsmp/chat/messages',
    handler: (req, res) => {
      if (req.method !== 'GET') {
        sendJson(res, 405, { ok: false, error: 'method not allowed' });
        return;
      }
      try {
        refresh();
        const sessionId = String(queryOf(req).get('sessionId') || '');
        if (!sessionId) {
          sendJson(res, 400, { ok: false, error: '缺少 sessionId' });
          return;
        }
        bridge.guard(sessionId);
        const after = Number(queryOf(req).get('after') || 0) || 0;
        sendJson(res, 200, bridge.snapshot(sessionId, { after }));
      } catch (err) {
        fail(res, err);
      }
    }
  }), 'dsmp: chat messages route');

  ctx.effect(() => webRegister({
    kind: 'exact',
    path: '/api/dsmp/chat/attach',
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        sendJson(res, 405, { ok: false, error: 'method not allowed' });
        return;
      }
      try {
        refresh();
        const body = await readJsonBody(req, 16 * 1024);
        const sessionId = String(body.sessionId || '');
        if (!sessionId) {
          sendJson(res, 400, { ok: false, error: '缺少 sessionId' });
          return;
        }
        const { mode } = await bridge.attach(sessionId, { agentOptions: agentOptionsFor(settings, body) });
        sendJson(res, 200, { ok: true, sessionId, mode });
      } catch (err) {
        fail(res, err);
      }
    }
  }), 'dsmp: chat attach route');

  ctx.effect(() => webRegister({
    kind: 'exact',
    path: '/api/dsmp/chat/dispose',
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        sendJson(res, 405, { ok: false, error: 'method not allowed' });
        return;
      }
      try {
        refresh();
        const body = await readJsonBody(req, 16 * 1024);
        const sessionId = String(body.sessionId || '');
        if (!sessionId) {
          sendJson(res, 400, { ok: false, error: '缺少 sessionId' });
          return;
        }
        bridge.guard(sessionId);
        bridge.dispose(sessionId);
        sendJson(res, 200, { ok: true, sessionId, disposed: true });
      } catch (err) {
        fail(res, err);
      }
    }
  }), 'dsmp: chat dispose route');

  ctx.effect(() => webRegister({
    kind: 'exact',
    path: '/api/dsmp/chat/live',
    handler: (req, res) => {
      if (req.method !== 'GET') {
        sendJson(res, 405, { ok: false, error: 'method not allowed' });
        return;
      }
      try {
        refresh();
        sendJson(res, 200, bridge.liveSessionInfo());
      } catch (err) {
        fail(res, err);
      }
    }
  }), 'dsmp: chat live route');

  /**
   * Read-only preview of what a panel message will carry into the session:
   * the rules block, the projected fact card, and the length of each part.
   * Useful both for the settings page and for testing injection without
   * sending an actual turn.
   */
  ctx.effect(() => webRegister({
    kind: 'exact',
    path: '/api/dsmp/memory/preview',
    handler: async (req, res) => {
      if (req.method !== 'GET') {
        sendJson(res, 405, { ok: false, error: 'method not allowed' });
        return;
      }
      try {
        refresh();
        const query = queryOf(req);
        const dir = query.get('dir') ? String(query.get('dir')) : testMemoryDir(settings);
        const cardChars = Number(query.get('cardChars') || 1500);
        const text = String(query.get('text') || '');
        const composed = await composeChatPrompt(text, { memoryDir: dir, rulesChars: 600, cardChars });
        sendJson(res, 200, {
          ok: true,
          memoryDir: dir,
          testMode: Boolean(settings.test && settings.test.enabled),
          meta: composed.meta,
          prompt: composed.text,
          promptChars: composed.text.length
        });
      } catch (err) {
        fail(res, err);
      }
    }
  }), 'dsmp: memory preview route');

  // ---- Migration / export / import (M5) -----------------------------------
  // Test mode refuses to move the live memory directory: migration is destructive
  // by nature and the production tree is the one thing we must never gamble on.
  const migrationDir = path.join(dsmpHome(), 'migration');
  const exportDir = path.join(dsmpHome(), 'exports');

  const migrationGuard = (sourceDir) => {
    if (!settings.test || !settings.test.enabled) return;
    const live = path.resolve(settings.memoryDir);
    if (path.resolve(sourceDir) === live) {
      const err = new Error('测试期不允许迁移生产记忆目录（先关 test.enabled 或指定测试副本）');
      err.code = 'DSMP_TEST_ONLY';
      throw err;
    }
  };

  ctx.effect(() => webRegister({
    kind: 'exact',
    path: '/api/dsmp/migrate',
    handler: async (req, res) => {
      try {
        refresh();
        if (req.method === 'GET') {
          const query = queryOf(req);
          const file = String(query.get('journal') || path.join(migrationDir, 'journal.json'));
          sendJson(res, 200, { ok: true, journalFile: file, journal: readJournal(file) });
          return;
        }
        if (req.method !== 'POST') {
          sendJson(res, 405, { ok: false, error: 'method not allowed' });
          return;
        }
        const body = await readJsonBody(req);
        const action = String(body.action || 'preflight');
        const sourceDir = String(body.sourceDir || testMemoryDir(settings));
        const targetDir = String(body.targetDir || '');
        const journalFile = String(body.journal || path.join(migrationDir, 'journal.json'));

        if (action === 'rollback') {
          const out = rollbackMigration({ journalFile, deleteTarget: Boolean(body.deleteTarget) });
          sendJson(res, out.ok ? 200 : 409, out);
          return;
        }
        if (action === 'preflight') {
          sendJson(res, 200, { ok: true, ...preflight({ sourceDir, targetDir }) });
          return;
        }
        if (action === 'run') {
          migrationGuard(sourceDir);
          const out = await runMigration({
            sourceDir,
            targetDir,
            journalFile,
            dryRun: Boolean(body.dryRun),
            log: () => {}
          });
          sendJson(res, out.ok ? 200 : 409, out);
          return;
        }
        sendJson(res, 400, { ok: false, error: `未知动作：${action}` });
      } catch (err) {
        fail(res, err);
      }
    }
  }), 'dsmp: migrate route');

  ctx.effect(() => webRegister({
    kind: 'exact',
    path: '/api/dsmp/memory/export',
    handler: async (req, res) => {
      try {
        refresh();
        if (req.method !== 'POST') {
          sendJson(res, 405, { ok: false, error: 'method not allowed' });
          return;
        }
        const body = await readJsonBody(req);
        const memoryDir = String(body.memoryDir || testMemoryDir(settings));
        const includeWorkspace = Boolean(body.includeWorkspace);
        const pack = buildExport({
          memoryDir,
          rolesDir: settings.roles.dir,
          settingsFile: settingsFile(),
          includeWorkspace,
          boundSessionId: settings.session.boundId || settings.session.liveId,
          sessionsRoot: path.join(dshHome(), 'sessions')
        });
        const name = String(body.name || `deepseek-memory-${new Date().toISOString().slice(0, 10)}.dsmp.zip`);
        const file = path.join(exportDir, name);
        fs.mkdirSync(exportDir, { recursive: true });
        fs.writeFileSync(file, pack.buffer);
        sendJson(res, 200, {
          ok: true,
          file,
          name,
          bytes: pack.buffer.length,
          files: pack.files,
          manifest: { ...pack.manifest, hashes: undefined, hashCount: Object.keys(pack.manifest.hashes).length }
        });
      } catch (err) {
        fail(res, err);
      }
    }
  }), 'dsmp: memory export route');

  ctx.effect(() => webRegister({
    kind: 'exact',
    path: '/api/dsmp/memory/import',
    handler: async (req, res) => {
      try {
        refresh();
        if (req.method !== 'POST') {
          sendJson(res, 405, { ok: false, error: 'method not allowed' });
          return;
        }
        const body = await readJsonBody(req);
        const file = String(body.file || '');
        if (!file || !fs.existsSync(file)) {
          sendJson(res, 404, { ok: false, error: `找不到记忆包：${file}` });
          return;
        }
        const buffer = fs.readFileSync(file);
        const out = importArchive({
          buffer,
          targetDir: String(body.targetDir || path.join(testMemoryDir(settings), '..', 'imported')),
          dryRun: Boolean(body.dryRun),
          overwrite: Boolean(body.overwrite),
          includeWorkspace: body.includeWorkspace !== false
        });
        sendJson(res, out.ok ? 200 : 409, out);
      } catch (err) {
        fail(res, err);
      }
    }
  }), 'dsmp: memory import route');

  ctx.effect(() => webRegister({
    kind: 'exact',
    path: '/api/dsmp/memory/verify',
    handler: async (req, res) => {
      try {
        if (req.method !== 'POST') {
          sendJson(res, 405, { ok: false, error: 'method not allowed' });
          return;
        }
        const body = await readJsonBody(req);
        const file = String(body.file || '');
        if (!file || !fs.existsSync(file)) {
          sendJson(res, 404, { ok: false, error: `找不到记忆包：${file}` });
          return;
        }
        const out = verifyArchive(fs.readFileSync(file));
        sendJson(res, 200, {
          ok: out.ok,
          problems: out.problems,
          missing: out.missing,
          mismatched: out.mismatched,
          extras: out.extras,
          manifest: out.manifest ? { ...out.manifest, hashes: undefined } : null
        });
      } catch (err) {
        fail(res, err);
      }
    }
  }), 'dsmp: memory verify route');

  // ---- One-click machine move (B1) ---------------------------------------
  // The pack carries memory + sessions + roles + settings; import rewrites the
  // absolute paths (session log headers, workspace index, bridge config).
  const exportsDir = path.join(dsmpHome(), 'exports');

  ctx.effect(() => webRegister({
    kind: 'exact',
    path: '/api/dsmp/machine',
    handler: async (req, res) => {
      try {
        const current = refresh();
        const dir = testMemoryDir(current);
        const info = machine.readMachine(dir);
        const selfId = info?.machineId || '';
        sendJson(res, 200, {
          ok: true,
          memoryDir: dir,
          machine: info,
          heartbeat: machine.readHeartbeat(dir),
          lock: machine.lockState(dir, { selfId }),
          history: machine.historyOf(dir).slice(-5)
        });
      } catch (err) {
        fail(res, err);
      }
    }
  }), 'dsmp: machine info route');

  ctx.effect(() => webRegister({
    kind: 'exact',
    path: '/api/dsmp/machine/export',
    handler: async (req, res) => {
      try {
        if (req.method !== 'POST') {
          sendJson(res, 405, { ok: false, error: 'method not allowed' });
          return;
        }
        const body = await readJsonBody(req);
        const current = refresh();
        const status = await buildStatus(bridge);
        const memoryDir = String(body.memoryDir || testMemoryDir(current));
        if (!status.memory.writer || status.memory.writer.writer !== true) {
          sendJson(res, 409, { ok: false, code: 'DSMP_NOT_WRITER', error: '不是记忆写者，导出会拿到不完整的数据；先在设置里把 memory.owner 切到 dsmp' });
          return;
        }
        machine.ensureMachine(memoryDir, {
          dsmpVersion: status.version,
          boundSessionId: current.session?.boundId || current.session?.liveId || '',
          cwd: current.session?.liveCwd || path.join(memoryDir, 'agent')
        });
        machine.writeHeartbeat(memoryDir);
        const sessionIds = Array.from(new Set([
          current.session?.boundId,
          current.session?.liveId,
          ...(Array.isArray(body.sessionIds) ? body.sessionIds.map(String) : [])
        ].filter(Boolean)));
        const pack = machinePack.buildMachinePack({
          memoryDir,
          sessionsRoot: path.join(dshHome(), 'sessions'),
          rolesDir: current.roles?.dir || '',
          settingsFile: settingsFile(),
          sessionIds,
          boundSessionId: sessionIds[0] || '',
          dsmpVersion: status.version
        });
        const name = String(body.name || `dsmp-move-${new Date().toISOString().slice(0, 10)}.zip`);
        fs.mkdirSync(exportsDir, { recursive: true });
        const file = path.join(exportsDir, name);
        fs.writeFileSync(file, pack.buffer);
        sendJson(res, 200, {
          ok: true,
          file,
          name,
          bytes: pack.buffer.length,
          files: pack.files,
          manifest: { ...pack.manifest, hashes: undefined, hashCount: Object.keys(pack.manifest.hashes || {}).length }
        });
      } catch (err) {
        if (err.code === undefined) err.code = 'DSMP_EXPORT';
        fail(res, err);
      }
    }
  }), 'dsmp: machine export route');

  // Browser upload of a machine pack: the UI cannot hand us a local path, so the
  // bytes land in <DSH_HOME>/dsmp/imports and the import route takes that path.
  ctx.effect(() => webRegister({
    kind: 'exact',
    path: '/api/dsmp/machine/upload',
    handler: async (req, res) => {
      try {
        if (req.method !== 'POST') {
          sendJson(res, 405, { ok: false, error: 'method not allowed' });
          return;
        }
        const q = queryOf(req);
        const raw = String(q.get('name') || 'machine-pack.zip');
        const name = raw.replace(/[^\w.\-]+/g, '_').slice(-80) || 'machine-pack.zip';
        const buf = await readRawBody(req, 512 * 1024 * 1024);
        if (!buf || buf.length < 22) {
          sendJson(res, 400, { ok: false, code: 'DSMP_PACK_EMPTY', error: '换机包是空的' });
          return;
        }
        const dir = path.join(dshHome(), 'dsmp', 'imports');
        fs.mkdirSync(dir, { recursive: true });
        const file = path.join(dir, name);
        fs.writeFileSync(file, buf);
        sendJson(res, 200, { ok: true, file, name, bytes: buf.length });
      } catch (err) {
        if (err.code === undefined) err.code = 'DSMP_UPLOAD';
        fail(res, err);
      }
    }
  }), 'dsmp: machine upload route');

  ctx.effect(() => webRegister({
    kind: 'exact',
    path: '/api/dsmp/machine/import',
    handler: async (req, res) => {
      try {
        if (req.method !== 'POST') {
          sendJson(res, 405, { ok: false, error: 'method not allowed' });
          return;
        }
        const body = await readJsonBody(req);
        const current = refresh();
        const file = String(body.file || '');
        if (!file || !fs.existsSync(file)) {
          sendJson(res, 404, { ok: false, error: `找不到换机包：${file}` });
          return;
        }
        const targetDir = String(body.targetDir || path.join(dshHome(), 'imported', 'memory'));
        const lock = machine.lockState(targetDir, { selfId: machine.readMachine(targetDir)?.machineId || '' });
        if (lock.fresh && !body.force) {
          sendJson(res, 409, {
            ok: false,
            code: 'DSMP_MACHINE_BUSY',
            error: `这份数据 10 分钟内还有心跳（${lock.name || lock.machineId}），可能另一台机器正在用；确认要覆盖就传 force=true`,
            lock
          });
          return;
        }
        const out = machinePack.importMachinePack({
          buffer: fs.readFileSync(file),
          targetDir,
          sessionsRoot: path.join(dshHome(), 'sessions'),
          workspaceFile: path.join(dshHome(), 'storages', 'workspace.json'),
          bridgeDir: current.bridge?.dir || '',
          settingsFile: settingsFile(),
          dryRun: Boolean(body.dryRun),
          overwrite: Boolean(body.overwrite),
          newMachineName: String(body.machineName || '')
        });
        sendJson(res, out.ok ? 200 : 409, out);
      } catch (err) {
        if (err.code === undefined) err.code = 'DSMP_IMPORT';
        fail(res, err);
      }
    }
  }), 'dsmp: machine import route');

  // ---- B2: panel backups --------------------------------------------------
  // Archives live outside the memory tree so losing the memory directory does
  // not lose its backups; the manifest inside each zip re-verifies on restore.
  const backupRoot = () => backupMod.backupRootOf(settings.backup?.dir || '', dsmpHome());
  const backupKeep = () => Math.max(1, Math.min(50, Number(settings.backup?.keep) || 2));

  ctx.effect(() => webRegister({
    kind: 'exact',
    path: '/api/dsmp/backup',
    handler: async (req, res) => {
      try {
        refresh();
        const root = backupRoot();
        const items = backupMod.listBackups(root).map(({ file, name, bytes, at, meta }) => ({ file, name, bytes, at, meta }));
        sendJson(res, 200, {
          ok: true,
          root,
          configured: String(settings.backup?.dir || ''),
          defaultRoot: path.join(dsmpHome(), 'backups'),
          keep: backupKeep(),
          count: items.length,
          items
        });
      } catch (err) {
        fail(res, err);
      }
    }
  }), 'dsmp: backup list route');

  ctx.effect(() => webRegister({
    kind: 'exact',
    path: '/api/dsmp/backup/now',
    handler: async (req, res) => {
      try {
        if (req.method !== 'POST') {
          sendJson(res, 405, { ok: false, error: 'method not allowed' });
          return;
        }
        const body = await readJsonBody(req, 1024 * 1024);
        const current = refresh();
        const status = await buildStatus(bridge);
        if (!status.memory.writer || status.memory.writer.writer !== true) {
          sendJson(res, 409, { ok: false, code: 'DSMP_NOT_WRITER', error: '不是记忆写者，备份可能拿到半截数据；先在设置里把 memory.owner 切到 dsmp' });
          return;
        }
        const root = backupRoot();
        const out = backupMod.createBackup({
          memoryDir: testMemoryDir(current),
          root,
          name: String(body.name || ''),
          keep: backupKeep(),
          rolesDir: current.roles?.dir || '',
          settingsFile: settingsFile(),
          sessionsRoot: path.join(dshHome(), 'sessions'),
          boundSessionId: current.session?.boundId || current.session?.liveId || '',
          includeWorkspace: body.includeWorkspace !== false,
          machine: process.env.COMPUTERNAME || ''
        });
        sendJson(res, 200, out);
      } catch (err) {
        if (err.code === undefined) err.code = 'DSMP_BACKUP';
        fail(res, err);
      }
    }
  }), 'dsmp: backup create route');

  ctx.effect(() => webRegister({
    kind: 'exact',
    path: '/api/dsmp/backup/restore',
    handler: async (req, res) => {
      try {
        if (req.method !== 'POST') {
          sendJson(res, 405, { ok: false, error: 'method not allowed' });
          return;
        }
        const body = await readJsonBody(req, 1024 * 1024);
        const current = refresh();
        const status = await buildStatus(bridge);
        if (!status.memory.writer || status.memory.writer.writer !== true) {
          sendJson(res, 409, { ok: false, code: 'DSMP_NOT_WRITER', error: '不是记忆写者，恢复会和另一个写者打架；先在设置里把 memory.owner 切到 dsmp' });
          return;
        }
        const out = backupMod.restoreBackup({
          file: String(body.file || ''),
          memoryDir: testMemoryDir(current),
          dryRun: Boolean(body.dryRun),
          overwrite: Boolean(body.overwrite)
        });
        if (out.ok && out.phase === 'done') {
          dsmpInject.clearPending();
        }
        sendJson(res, out.ok ? 200 : 409, out);
      } catch (err) {
        if (err.code === undefined) err.code = 'DSMP_BACKUP_RESTORE';
        fail(res, err);
      }
    }
  }), 'dsmp: backup restore route');

  ctx.effect(() => webRegister({
    kind: 'exact',
    path: '/api/dsmp/backup/pick-dir',
    handler: async (req, res) => {
      try {
        if (req.method !== 'POST') {
          sendJson(res, 405, { ok: false, error: 'method not allowed' });
          return;
        }
        await readJsonBody(req, 16 * 1024);
        const outFile = path.join(dsmpHome(), 'logs', `pick-dir-${process.pid}-${Date.now()}.txt`);
        fs.mkdirSync(path.dirname(outFile), { recursive: true });
        const fd = fs.openSync(outFile, 'w');
        const script = [
          'Add-Type -AssemblyName System.Windows.Forms',
          '$d = New-Object System.Windows.Forms.FolderBrowserDialog',
          "$d.Description = '选择 DSMP 备份目录'",
          '$d.ShowNewFolderButton = $true',
          'if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($d.SelectedPath) }'
        ].join('; ');
        const child = spawn('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', ['-NoProfile', '-STA', '-Command', script], {
          stdio: ['ignore', fd, fd],
          windowsHide: false
        });
        const outcome = await new Promise((resolve) => {
          const timer = setTimeout(() => {
            try { child.kill(); } catch { /* ignore */ }
            resolve('timeout');
          }, 180_000);
          child.on('error', () => { clearTimeout(timer); resolve('error'); });
          child.on('exit', () => { clearTimeout(timer); resolve('exit'); });
        });
        try { fs.closeSync(fd); } catch { /* already closed */ }
        let picked = '';
        try { picked = fs.readFileSync(outFile, 'utf8').trim(); } catch { /* empty */ }
        try { fs.unlinkSync(outFile); } catch { /* optional */ }
        if (outcome === 'timeout') {
          sendJson(res, 504, { ok: false, code: 'DSMP_BACKUP_PICK_TIMEOUT', error: '选择目录超时（窗口未操作）' });
          return;
        }
        if (outcome === 'error') {
          sendJson(res, 500, { ok: false, code: 'DSMP_BACKUP_PICK', error: '无法启动目录选择窗口' });
          return;
        }
        sendJson(res, 200, { ok: true, path: picked, cancelled: !picked });
      } catch (err) {
        if (err.code === undefined) err.code = 'DSMP_BACKUP_PICK';
        fail(res, err);
      }
    }
  }), 'dsmp: backup pick-dir route');

  // Heartbeat every 5 minutes while this plugin really is the writer.
  ctx.effect(() => {
    const tick = () => {
      try {
        if (!settings.memory || settings.memory.owner !== 'dsmp') return;
        const dir = testMemoryDir(settings);
        const id = machine.machineIdOf(dir);
        if (!id) return;
        machine.writeHeartbeat(dir);
      } catch {
        /* heartbeat must never break the plugin */
      }
    };
    const timer = setInterval(tick, machine.HEARTBEAT_MS);
    if (timer.unref) timer.unref();
    tick();
    return () => clearInterval(timer);
  }, 'dsmp: machine heartbeat');

  // ---- Single-writer lease (M6) ------------------------------------------
  // DSMP only takes the lease when settings.memory.owner === 'dsmp'. While the
  // bridge owns it, every route below stays a no-op and reports not-writer.
  ctx.effect(() => webRegister({
    kind: 'exact',
    path: '/api/dsmp/memory/lease',
    handler: async (req, res) => {
      try {
        if (req.method === 'GET') {
          const current = refresh();
          sendJson(res, 200, {
            ok: true,
            owner: current.memory.owner,
            lease: lease.leaseSummary(testMemoryDir(current)),
            writer: memoryWriter.memoryWriterStats()
          });
          return;
        }
        if (req.method !== 'POST') {
          sendJson(res, 405, { ok: false, error: 'method not allowed' });
          return;
        }
        const body = await readJsonBody(req);
        const current = refresh();
        const dir = testMemoryDir(current);
        const action = String(body.action || 'status');
        if (action === 'acquire') {
          const out = lease.acquireLease({ memoryDir: dir, owner: 'dsmp', ttlMs: current.memory.leaseTtlMs });
          sendJson(res, 200, { ok: out.ok, action, ...out, lease: lease.leaseSummary(dir) });
          return;
        }
        if (action === 'release') {
          sendJson(res, 200, { ok: true, action, ...lease.releaseLease({ memoryDir: dir, owner: 'dsmp' }), lease: lease.leaseSummary(dir) });
          return;
        }
        if (action === 'heartbeat') {
          const out = lease.heartbeatLease({ memoryDir: dir, owner: 'dsmp', ttlMs: current.memory.leaseTtlMs });
          sendJson(res, 200, { ok: out.ok, action, ...out, lease: lease.leaseSummary(dir) });
          return;
        }
        sendJson(res, 200, { ok: true, action: 'status', owner: current.memory.owner, lease: lease.leaseSummary(dir) });
      } catch (err) {
        fail(res, err);
      }
    }
  }), 'dsmp: memory lease route');

  const writerRoute = (path, fn) => ctx.effect(() => webRegister({
    kind: 'exact',
    path,
    handler: async (req, res) => {
      try {
        if (req.method !== 'POST') {
          sendJson(res, 405, { ok: false, error: 'method not allowed' });
          return;
        }
        refresh();
        const body = await readJsonBody(req, 512 * 1024);
        const writer = await ensureWriter();
        const out = await fn(body, refresh(), writer);
        if (out && out.code === 'DSMP_NOT_WRITER') {
          sendJson(res, 409, out);
          return;
        }
        sendJson(res, 200, out);
      } catch (err) {
        fail(res, err);
      }
    }
  }), `dsmp: ${path}`);

  writerRoute('/api/dsmp/memory/begin-turn', (body, _current, writer) => writer.beginTurn({ ...body, source: 'bridge' }));
  writerRoute('/api/dsmp/memory/note-spoken', (body, _current, writer) => writer.noteSpoken(body));
  writerRoute('/api/dsmp/memory/finish-turn', (body, _current, writer) => writer.finishTurn({ ...body, source: 'bridge' }));

  ctx.effect(() => webRegister({
    kind: 'exact',
    path: '/api/dsmp/memory/writer',
    handler: async (req, res) => {
      try {
        const current = refresh();
        sendJson(res, 200, {
          ok: true,
          owner: current.memory.owner,
          ...(await memoryWriter.writerStatus()),
          lease: lease.leaseSummary(testMemoryDir(current))
        });
      } catch (err) {
        fail(res, err);
      }
    }
  }), 'dsmp: memory writer route');

  // A2: 记忆日终引擎的控制面。GET 看状态，POST tick/daily/start/stop。
  ctx.effect(() => webRegister({
    kind: 'exact',
    path: '/api/dsmp/memory/engine',
    handler: async (req, res) => {
      try {
        const current = refresh();
        if (req.method === 'GET') {
          sendJson(res, 200, {
            ok: true,
            engine: memoryEngine.engineStatus(),
            dir: memoryWriteDir(current),
            lease: lease.leaseSummary(memoryWriteDir(current))
          });
          return;
        }
        if (req.method !== 'POST') {
          sendJson(res, 405, { ok: false, error: 'method not allowed' });
          return;
        }
        const body = await readJsonBody(req, 16 * 1024);
        const action = String(body.action || 'tick');
        if (action === 'tick') {
          const out = await memoryEngine.tickNow();
          sendJson(res, out.ok ? 200 : 409, { ...out, engine: memoryEngine.engineStatus() });
          return;
        }
        if (action === 'daily') {
          const out = await memoryEngine.tickNow({ force: true });
          sendJson(res, out.ok ? 200 : 409, { ...out, engine: memoryEngine.engineStatus() });
          return;
        }
        if (action === 'start') {
          sendJson(res, 200, { ok: true, engine: memoryEngine.startEngine() });
          return;
        }
        if (action === 'stop') {
          sendJson(res, 200, { ok: true, engine: memoryEngine.stopEngine() });
          return;
        }
        sendJson(res, 400, { ok: false, error: `未知动作：${action}` });
      } catch (err) {
        fail(res, err);
      }
    }
  }), 'dsmp: memory engine route');

  // ---- Media library (M3) -------------------------------------------------
  // Images share the memory media library; voice has its own library. Both are
  // content-addressed by sha1 and indexed in state/media.jsonl / voice.jsonl.
  const voiceOutboxFile = path.join(dsmpHome(), 'voice-outbox.jsonl');

  ctx.effect(() => webRegister({
    kind: 'exact',
    path: '/api/dsmp/media/upload',
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        sendJson(res, 405, { ok: false, error: 'method not allowed' });
        return;
      }
      try {
        refresh();
        const query = queryOf(req);
        const kind = query.get('kind') === 'voice' ? 'voice' : 'image';
        const store = mediaStoreOf(settings);
        const limit = kind === 'voice' ? store.maxVoiceBytes : store.maxImageBytes;
        const buffer = await readRawBody(req, limit);
        if (!buffer.length) {
          sendJson(res, 400, { ok: false, error: '空文件', code: 'DSMP_MEDIA_EMPTY' });
          return;
        }
        const detected = sniff(buffer);
        if (!detected || detected.kind !== kind) {
          sendJson(res, 400, {
            ok: false,
            error: `文件类型不支持（识别为 ${detected ? detected.mime : '未知'}，需要 ${kind === 'image' ? '图片' : '语音'}）`,
            code: 'DSMP_MEDIA_TYPE'
          });
          return;
        }
        const saved = store.save(buffer, {
          kind,
          name: String(query.get('name') || ''),
          alt: String(query.get('alt') || ''),
          key: String(query.get('key') || ''),
          source: 'panel-upload'
        });
        sendJson(res, 200, { ok: true, ...saved, url: `/api/dsmp/media/file?sha1=${saved.sha1}&kind=${kind}` });
      } catch (err) {
        fail(res, err);
      }
    }
  }), 'dsmp: media upload route');

  /**
   * P1：QQ 收到的语音。bridge 先向 SnowLuma 取字节（get_record / record.url），
   * 再以 base64 投到这里；落库后 `<audio>` 直接走 /api/dsmp/media/file 播放。
   * 只接受本机回环调用（bridge 与 DSMP 同机），不做公网暴露。
   */
  ctx.effect(() => webRegister({
    kind: 'exact',
    path: '/api/dsmp/voice/inbound',
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        sendJson(res, 405, { ok: false, error: 'method not allowed' });
        return;
      }
      try {
        refresh();
        const store = mediaStoreOf(settings);
        const limit = (Number(store.maxVoiceBytes) || 16 * 1024 * 1024) * 2 + 8192;
        const body = await readJsonBody(req, limit);
        const saved = voiceInbound.saveInboundVoice({ store, payload: body });
        sendJson(res, 200, {
          ...saved,
          key: String((body && body.key) || ''),
          url: `/api/dsmp/media/file?sha1=${saved.sha1}&kind=voice`
        });
      } catch (err) {
        fail(res, err);
      }
    }
  }), 'dsmp: voice inbound route');

  /**
   * B3：<PERSONA>自己发出去的语音。bridge 在 send-voice / tts 成功后回报，TTS 带原文
   * （textSource=tts-input），语音库不带（等按需识别或人工补）。
   */
  ctx.effect(() => webRegister({
    kind: 'exact',
    path: '/api/dsmp/voice/sent',
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        sendJson(res, 405, { ok: false, error: 'method not allowed' });
        return;
      }
      try {
        refresh();
        const store = mediaStoreOf(settings);
        const limit = (Number(store.maxVoiceBytes) || 16 * 1024 * 1024) * 2 + 8192;
        const body = await readJsonBody(req, limit);
        const saved = voiceInbound.saveOutboundVoice({ store, payload: body });
        sendJson(res, 200, {
          ...saved,
          key: String((body && body.key) || ''),
          url: `/api/dsmp/media/file?sha1=${saved.sha1}&kind=voice`
        });
      } catch (err) {
        fail(res, err);
      }
    }
  }), 'dsmp: voice sent route');

  /**
   * P0：QQ 语音转写。bridge 先把语音归一化成 16k/单声道/PCM16 WAV（SILK 由
   * SnowLuma 的 get_record 解），base64 送进来；这里复用宿主 speechToText
   * （SenseVoice），成功后顺手把 WAV + 文字写进语音库（sha1 去重）。
   * 只给桥接调用（INTERNAL_PATHS），不暴露给浏览器。
   */
  ctx.effect(() => webRegister({
    kind: 'exact',
    path: '/api/dsmp/voice/transcribe',
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        sendJson(res, 405, { ok: false, error: 'method not allowed' });
        return;
      }
      try {
        refresh();
        const sttCfg = voiceStt.sttConfig();
        const limit = Math.min(4 * 1024 * 1024, sttCfg.maxBytes) * 2 + 16 * 1024;
        const body = await readJsonBody(req, limit);
        const result = await voiceStt.transcribeVoice({ payload: body });
        sendJson(res, 200, result);
      } catch (err) {
        fail(res, err);
      }
    }
  }), 'dsmp: voice transcribe route');

  ctx.effect(() => webRegister({
    kind: 'exact',
    path: '/api/dsmp/media/file',
    handler: (req, res) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        sendJson(res, 405, { ok: false, error: 'method not allowed' });
        return;
      }
      try {
        refresh();
        const query = queryOf(req);
        const sha1 = String(query.get('sha1') || '');
        const kind = query.get('kind') === 'voice' ? 'voice' : 'image';
        const got = mediaStoreOf(settings).get(sha1, { kind });
        if (!got.ok) {
          sendJson(res, 404, { ok: false, error: '媒体不存在', code: got.code || 'DSMP_MEDIA_MISSING' });
          return;
        }
        sendBuffer(req, res, got.buffer, {
          contentType: got.row.mime || 'application/octet-stream',
          etag: sha1,
          immutable: true
        });
      } catch (err) {
        fail(res, err);
      }
    }
  }), 'dsmp: media file route');

  ctx.effect(() => webRegister({
    kind: 'exact',
    path: '/api/dsmp/media/list',
    handler: (req, res) => {
      if (req.method !== 'GET') {
        sendJson(res, 405, { ok: false, error: 'method not allowed' });
        return;
      }
      try {
        refresh();
        const query = queryOf(req);
        const kind = query.get('kind') === 'voice' ? 'voice' : 'image';
        const limit = Math.min(200, Math.max(1, Number(query.get('limit')) || 30));
        const store = mediaStoreOf(settings);
        const list = store.list({ kind, limit });
        sendJson(res, 200, {
          ok: true,
          kind,
          root: store.root,
          count: list.count,
          items: list.items.map((row) => ({
            ...row,
            url: `/api/dsmp/media/file?sha1=${row.sha1}&kind=${kind}`
          }))
        });
      } catch (err) {
        fail(res, err);
      }
    }
  }), 'dsmp: media list route');

  /**
   * Serve a DSH attachment (image the agent received) by its ref, so the panel
   * can render mirrored turns without holding the bytes in the mirror buffer.
   */
  ctx.effect(() => webRegister({
    kind: 'exact',
    path: '/api/dsmp/media/attachment',
    handler: async (req, res) => {
      if (req.method !== 'POST' && req.method !== 'GET') {
        sendJson(res, 405, { ok: false, error: 'method not allowed' });
        return;
      }
      try {
        const query = queryOf(req);
        const body = req.method === 'POST' ? await readJsonBody(req, 16 * 1024) : null;
        // GET 用查询参数传引用，让 <img src> 可以直接指向这里（wait 结果里的图
        // 没有媒体库 sha1，只有 DSH 附件引用）。
        const ref = req.method === 'GET'
          ? {
              attachmentId: String(query.get('id') || ''),
              ...(query.get('mt') ? { mediaType: String(query.get('mt')) } : {}),
              ...(Number(query.get('b')) ? { bytes: Number(query.get('b')) } : {}),
              ...(Number(query.get('w')) ? { width: Number(query.get('w')) } : {}),
              ...(Number(query.get('h')) ? { height: Number(query.get('h')) } : {})
            }
          : (body && body.ref);
        if (!ref || !ref.attachmentId) {
          sendJson(res, 400, { ok: false, error: '缺少附件引用' });
          return;
        }
        const attachments = typeof ctx.get === 'function' ? ctx.get('attachments') : null;
        if (!attachments || typeof attachments.readImage !== 'function') {
          sendJson(res, 400, { ok: false, error: '当前宿主没有 attachments 服务', code: 'DSMP_NO_ATTACHMENTS' });
          return;
        }
        const read = await attachments.readImage(ref);
        sendBuffer(req, res, Buffer.from(read.data), {
          contentType: ref.mediaType || 'application/octet-stream',
          etag: String(ref.attachmentId)
        });
      } catch (err) {
        fail(res, err);
      }
    }
  }), 'dsmp: media attachment route');

  ctx.effect(() => webRegister({
    kind: 'exact',
    path: '/api/dsmp/voice/send',
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        sendJson(res, 405, { ok: false, error: 'method not allowed' });
        return;
      }
      try {
        refresh();
        const body = await readJsonBody(req, 16 * 1024);
        const client = channelClient();
        const live = !client.testMode || client.allowLiveSend;
        const key = String(body.key || (settings.channel && settings.channel.key) || '');
        if (!key) {
          sendJson(res, 400, { ok: false, code: 'DSMP_NO_CHANNEL_KEY', error: '还没配置 QQ 会话 key' });
          return;
        }
        let voiceRow = null;
        if (body.sha1) {
          const got = mediaStoreOf(settings).get(String(body.sha1), { kind: 'voice' });
          if (!got.ok) {
            sendJson(res, 404, { ok: false, error: `语音不在语音库：${body.sha1}`, code: got.code || 'DSMP_MEDIA_MISSING' });
            return;
          }
          voiceRow = got.row;
        }
        const record = {
          at: new Date().toISOString(),
          key,
          source: voiceRow ? 'library' : body.voice ? 'bridge-library' : 'tts',
          sha1: voiceRow ? voiceRow.sha1 : '',
          voice: String(body.voice || ''),
          text: String(body.text || ''),
          label: String(body.label || ''),
          live
        };
        if (!live) {
          fs.mkdirSync(path.dirname(voiceOutboxFile), { recursive: true });
          fs.appendFileSync(voiceOutboxFile, `${JSON.stringify({ ...record, dryRun: true })}\n`, 'utf8');
          sendJson(res, 200, {
            ok: true,
            dryRun: true,
            queued: record,
            note: '测试期语音只入队，不合成也不发出'
          });
          return;
        }
        const sent = await client.sendVoice({ key, voice: String(body.voice || ''), sha1: voiceRow ? voiceRow.sha1 : '', text: String(body.text || ''), label: String(body.label || '') });
        sendJson(res, sent.ok ? 200 : 400, sent);
      } catch (err) {
        fail(res, err);
      }
    }
  }), 'dsmp: voice send route');

  ctx.effect(() => webRegister({
    kind: 'exact',
    path: '/api/dsmp/voice/outbox',
    handler: (req, res) => {
      if (req.method !== 'GET') {
        sendJson(res, 405, { ok: false, error: 'method not allowed' });
        return;
      }
      try {
        const limit = Math.min(200, Math.max(1, Number(queryOf(req).get('limit')) || 50));
        let rows = [];
        try {
          rows = fs.readFileSync(voiceOutboxFile, 'utf8').split('\n').filter(Boolean).slice(-limit).map((line) => {
            try { return JSON.parse(line); } catch { return null; }
          }).filter(Boolean);
        } catch {
          rows = [];
        }
        sendJson(res, 200, { ok: true, file: voiceOutboxFile, messages: rows });
      } catch (err) {
        fail(res, err);
      }
    }
  }), 'dsmp: voice outbox route');

  // D2: one read-only snapshot for the panel's diagnostics card.
  ctx.effect(() => webRegister({
    kind: 'exact',
    path: '/api/dsmp/diagnostics',
    handler: async (req, res) => {
      if (req.method !== 'GET') {
        sendJson(res, 405, { ok: false, error: 'method not allowed' });
        return;
      }
      try {
        refresh();
        const dir = memoryWriteDir(settings);
        const data = await robustness.diagnostics({
          memoryDir: dir,
          dsmpDir: dsmpHome(),
          bridgeDir: String((settings.bridge && settings.bridge.dir) || ''),
          logsDir: path.join(dsmpHome(), 'logs'),
          lease: lease.leaseSummary(dir),
          selfCheckItems,
          ports: [3100, 7351, 8188, 9880]
        });
        sendJson(res, 200, data);
      } catch (err) {
        fail(res, err);
      }
    }
  }), 'dsmp: diagnostics route');

  // D4: one startup self-check. The bridge probe is deliberately async and
  // non-blocking: local chat must work with the bridge down.
  const runSelfCheck = async () => {
    let bridgeOnline = null;
    try {
      const base = String((settings.bridge && settings.bridge.baseUrl) || '').replace(/\/+$/, '');
      if (base) {
        const probe = await probeHttp(`${base}/api/status`, 1200);
        bridgeOnline = Boolean(probe && (probe.status === 200 || probe.status === 401 || probe.status === 403));
      }
    } catch {
      bridgeOnline = null;
    }
    robustness.cleanStaleLocks(dsmpHome());
    const dir = memoryWriteDir(settings);
    selfCheckItems = robustness.selfCheck({
      memoryDir: dir,
      dsmpDir: dsmpHome(),
      devMode: fs.existsSync(path.join(dsmpHome(), 'dev-reload.flag')),
      lease: lease.leaseSummary(dir),
      bridgeOnline,
      tokenFile: path.join(dsmpHome(), 'api-token')
    });
    const failed = selfCheckItems.filter((row) => !row.ok);
    if (failed.length) console.log('[dsmp] 启动自检异常：', failed.map((row) => row.label).join('、'));
  };
  // 面板的「重新检查」需要一个能真正重跑的入口：status 只回启动时那份缓存。
  ctx.effect(() => webRegister({
    kind: 'exact',
    path: '/api/dsmp/selfcheck',
    handler: async (req, res) => {
      if (req.method !== 'GET' && req.method !== 'POST') {
        sendJson(res, 405, { ok: false, error: 'method not allowed' });
        return;
      }
      try {
        await runSelfCheck();
        sendJson(res, 200, { ok: true, items: selfCheckItems });
      } catch (err) {
        fail(res, err);
      }
    }
  }), 'dsmp: selfcheck route');
  setTimeout(() => { runSelfCheck().catch(() => {}); }, 1200).unref?.();
}



