import fs from 'node:fs';
import path from 'node:path';
import { dsmpHome } from './paths.js';

export const SETTINGS_VERSION = 1;

/**
 * Portable defaults (M5). The packaged tarball ships placeholders instead of
 * this machine's absolute paths; they resolve from env vars at run time so the
 * same build works on another computer. Unresolved placeholders are left as-is
 * and simply make the affected feature report "not configured" in the panel.
 */
const ENV_PLACEHOLDERS = {
  '<DSMP_MEMORY_DIR>': 'DSMP_MEMORY_DIR',
  '<DSMP_BRIDGE_DIR>': 'DSMP_BRIDGE_DIR',
  '<DSH_HOME>': 'DSH_HOME'
};

export function expandPlaceholders(value) {
  if (typeof value !== 'string') return value;
  let out = value;
  for (const [placeholder, envName] of Object.entries(ENV_PLACEHOLDERS)) {
    if (!out.includes(placeholder)) continue;
    const envValue = process.env[envName] || '';
    out = envValue ? out.split(placeholder).join(envValue) : out;
  }
  return out;
}

function expandDeep(value) {
  if (Array.isArray(value)) return value.map(expandDeep);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = expandDeep(item);
    return out;
  }
  return expandPlaceholders(value);
}

export const DEFAULT_SETTINGS_RAW = {
  version: SETTINGS_VERSION,
  memoryDir: '<DSMP_MEMORY_DIR>',
  bridge: {
    baseUrl: 'http://127.0.0.1:3100',
    dir: '<DSMP_BRIDGE_DIR>',
    tokenFile: '<DSMP_BRIDGE_DIR>\\state\\console-token'
  },
  /**
   * Panel-side service control. Start/stop only calls scripts that already
   * exist; idleStopMs is the fallback for engines the panel started while the
   * bridge was down (the bridge keeps its own lifecycle when it is up).
   */
  services: {
    idleStopMs: 600000
  },
  roles: {
    dir: '<DSMP_BRIDGE_DIR>\\roles',
    activeFile: '<DSMP_BRIDGE_DIR>\\state\\current-role.json',
    fallbackName: ''
  },
  workbench: {
    url: 'http://127.0.0.1:7351'
  },
  ui: {
    panelLabelPrefix: '',
    /**
     * 7351 过渡开关：迁移期保留旧工作台入口，默认关（记忆页签已覆盖其能力）。
     * 需要在旧入口上对照时，把 settings.ui.legacyWorkbench 改成 true 再刷新页面。
     */
    legacyWorkbench: false
  },
  /**
   * Test isolation (owner rule 2026-11-06 19:55): the plugin must never touch
   * the live<PERSONA> session, the production memory directory or the QQ bridge while
   * it is still under construction. Everything runs against throwaway sessions
   * and a scratch directory until test.enabled is switched off deliberately.
   */
  test: {
    enabled: true,
    sessionPrefix: 'session-dsmp-test-',
    cwd: '',
    memoryDir: '',
    allowLiveSessions: false,
    /** M2: outgoing QQ messages stay in the outbox until this is true. */
    allowLiveSend: false
  },
  /** QQ channel wiring. The key is configured per install (no owner id shipped). */
  channel: {
    key: '',
    pollMs: 5000,
    unreadBadge: true
  },
  /** The one real QQ session. Discovered from the bridge when left empty. */
  session: {
    liveId: '',
    liveCwd: '',
    boundId: '',
    /**
     * P0: when the QQ bridge is unreachable the panel attaches to the same DSH
     * session instead of failing. The session log stays the single source of
     * truth so the next QQ turn continues the same context; memory accounting
     * still belongs to the bridge, so an offline turn is not ledgered.
     */
    offlineFallback: true,
    /**
     * auto  = DSH first: the panel drives the session itself and records the
     *         ledger; the QQ bridge is only transport for QQ messages.
     * bridge = old behaviour: hand the text to the bridge and let it drive.
     */
    via: 'auto'
  },
  /**
   * Desktop-panel direct send. When on, the panel hands the text to the bridge,
   * which drives the same session the QQ channel uses — one driver per session,
   * and the prompt tells her not to call any QQ send tool.
   */
  panel: {
    liveSend: true
  },
  /**
   * A1: where the memory projection (rules + fact card) is attached.
   * pre-step = compose in `agent/pre-step` as a separate context message, so the
   *            user message stays raw and the card is rebuilt for the running step.
   * send     = legacy: bake it into the user message at send time (rollback).
   */
  inject: {
    mode: 'pre-step'
  },
  chat: {
    provider: '',
    model: ''
  },
  /**
   * Media policy (M3). Images share the memory media library; voice has its own
   * library because the plan keeps text / image / voice in separate stores.
   * `voice.transcript` rows stay empty until a speech-to-text provider exists.
   */
  media: {
    maxImageBytes: 16 * 1024 * 1024,
    maxVoiceBytes: 16 * 1024 * 1024,
    maxImagesPerMessage: 4,
    voice: {
      // Transcription is deliberately deferred (owner 2026-11-07 12:10); the
      // field and this switch exist so enabling it later needs no migration.
      transcript: false,
      tts: { enabled: true, dryRun: true },
      /**
       * P0 speech-to-text (2026-11-10 owner decision): reuse the host
       * `speechToText` service, never feed the transcript into fact extraction,
       * 20 s timeout, truncate long clips at 110 s. Only canonical
       * 16 kHz/mono/PCM16 WAV is accepted (provider's validateWave).
       */
      stt: {
        enabled: true,
        provider: '',
        language: 'zh',
        timeoutMs: 20_000,
        maxSeconds: 110,
        maxBytes: 4 * 1024 * 1024,
        prepareTimeoutMs: 30_000
      }
    }
  },
  /**
   * Single-writer switch (M6/P2). `owner: 'bridge'` keeps today's behaviour: the
   * bridge writes the window ledger and DSMP never takes the lease. Switching
   * to `'dsmp'` makes DSMP acquire <memoryDir>/state/engine-lease.json and
   * accept forwarded turns; the bridge then only forwards.
   * `dir` overrides where the ledger lives — it must be the real memory
   * directory, because the bridge reads the same files.
   */
  memory: {
    owner: 'bridge',
    leaseTtlMs: 60_000,
    heartbeatMs: 15_000,
    dir: '',
    // 她自己的记忆配额：写得多一点，卡片仍按槽位裁剪；超过 600 条不再新增。
    selfWrite: {
      enabled: true,
      maxPerDay: 20,
      maxTotal: 600,
      maxValueChars: 60,
      maxTextChars: 400,
      initialI: 0.7,
      protectFromExtract: true
    },
    // 轮转第四层：月摘要（只留重要信息）与冲突队列上限。
    monthly: { enabled: true, maxChars: 700, days: 30 },
    conflicts: { maxPending: 50 },
    handoverMaxChars: 5200
  },
  /**
   * B2 backups. An empty `dir` means <DSH_HOME>/dsmp/backups; a custom path is
   * useful when the user keeps memory on a small disk. `keep` prunes only after
   * a successful new archive, newest first.
   */
  backup: {
    dir: '',
    keep: 2
  }
};

export const DEFAULT_SETTINGS = expandDeep(DEFAULT_SETTINGS_RAW);

export function settingsFile() {
  return path.join(dsmpHome(), 'settings.json');
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function mergeSettings(base, patch) {
  const out = isPlainObject(base) ? { ...base } : {};
  if (!isPlainObject(patch)) return out;
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    out[key] = isPlainObject(value) && isPlainObject(out[key]) ? mergeSettings(out[key], value) : value;
  }
  return out;
}

function normalize(raw) {
  const merged = mergeSettings(DEFAULT_SETTINGS, raw);
  merged.version = SETTINGS_VERSION;
  merged.memoryDir = String(merged.memoryDir || '').trim();
  merged.bridge = mergeSettings(DEFAULT_SETTINGS.bridge, merged.bridge);
  merged.roles = mergeSettings(DEFAULT_SETTINGS.roles, merged.roles);
  merged.workbench = mergeSettings(DEFAULT_SETTINGS.workbench, merged.workbench);
  merged.ui = mergeSettings(DEFAULT_SETTINGS.ui, merged.ui);
  merged.test = mergeSettings(DEFAULT_SETTINGS.test, merged.test);
  merged.session = mergeSettings(DEFAULT_SETTINGS.session, merged.session);
  merged.chat = mergeSettings(DEFAULT_SETTINGS.chat, merged.chat);
  merged.channel = mergeSettings(DEFAULT_SETTINGS.channel, merged.channel);
  merged.media = mergeSettings(DEFAULT_SETTINGS.media, merged.media);
  merged.memory = mergeSettings(DEFAULT_SETTINGS.memory, merged.memory);
  merged.memory.owner = merged.memory.owner === 'dsmp' ? 'dsmp' : 'bridge';
  merged.memory.leaseTtlMs = Math.max(15_000, Number(merged.memory.leaseTtlMs) || 60_000);
  merged.memory.heartbeatMs = Math.max(5_000, Math.min(merged.memory.leaseTtlMs / 2, Number(merged.memory.heartbeatMs) || 15_000));
  merged.backup = mergeSettings(DEFAULT_SETTINGS.backup, merged.backup);
  merged.backup.dir = String(merged.backup.dir || '').trim();
  merged.backup.keep = Math.min(50, Math.max(1, Number(merged.backup.keep) || 2));
  merged.bridge.baseUrl = String(merged.bridge.baseUrl || '').replace(/\/+$/, '');
  merged.ui.panelLabelPrefix = String(merged.ui.panelLabelPrefix || '');
  merged.ui.legacyWorkbench = merged.ui.legacyWorkbench === true;
  merged.test.enabled = merged.test.enabled !== false;
  merged.test.allowLiveSessions = merged.test.allowLiveSessions === true;
  merged.test.allowLiveSend = merged.test.allowLiveSend === true;
  merged.test.sessionPrefix = String(merged.test.sessionPrefix || 'session-dsmp-test-');
  if (!merged.test.cwd) merged.test.cwd = path.join(dsmpHome(), 'test', 'cwd');
  if (!merged.test.memoryDir) merged.test.memoryDir = path.join(dsmpHome(), 'test', 'memory');
  merged.chat.provider = String(merged.chat.provider || '');
  merged.chat.model = String(merged.chat.model || '');
  merged.channel.key = String(merged.channel.key || '').trim();
  merged.channel.pollMs = Math.max(1500, Number(merged.channel.pollMs) || 5000);
  merged.media.maxImageBytes = Math.max(64 * 1024, Number(merged.media.maxImageBytes) || 16 * 1024 * 1024);
  merged.media.maxVoiceBytes = Math.max(64 * 1024, Number(merged.media.maxVoiceBytes) || 16 * 1024 * 1024);
  merged.media.maxImagesPerMessage = Math.min(8, Math.max(1, Number(merged.media.maxImagesPerMessage) || 4));
  const stt = (merged.media.voice && merged.media.voice.stt) || {};
  merged.media.voice.stt = {
    enabled: stt.enabled !== false,
    provider: String(stt.provider || '').trim(),
    language: String(stt.language || 'zh').trim() || 'zh',
    timeoutMs: Math.min(120_000, Math.max(2_000, Number(stt.timeoutMs) || 20_000)),
    maxSeconds: Math.min(300, Math.max(5, Number(stt.maxSeconds) || 110)),
    maxBytes: Math.min(4 * 1024 * 1024, Math.max(64 * 1024, Number(stt.maxBytes) || 4 * 1024 * 1024)),
    prepareTimeoutMs: Math.min(300_000, Math.max(5_000, Number(stt.prepareTimeoutMs) || 30_000))
  };
  return merged;
}

export function readSettings() {
  let raw = {};
  try {
    raw = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
  } catch {
    raw = {};
  }
  return normalize(raw);
}

export function writeSettings(patch) {
  const next = normalize(mergeSettings(readSettings(), patch));
  const file = settingsFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temp, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  fs.renameSync(temp, file);
  return next;
}

export function ensureSettings() {
  const file = settingsFile();
  if (!fs.existsSync(file)) writeSettings({});
  return readSettings();
}
