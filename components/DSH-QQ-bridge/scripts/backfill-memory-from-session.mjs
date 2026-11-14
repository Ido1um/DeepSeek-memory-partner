#!/usr/bin/env node
/**
 * 从 DSH 会话日志回填「7 天记忆」日志。
 *
 * 为什么需要：记忆功能上线前（或会话被轮转前）的聊天只存在 DSH 会话文件里，
 * hot/ 下没有对应原文，轮转后的新会话就「不记得」。本脚本把旧会话里的
 * 真实 QQ 消息（用户快照 + 机器人 qq_send_message/qq_reply 的实际文本）
 * 按日期补写到 hot/YYYY-MM-DD/private_<owner>.jsonl，供 qq_memory_search
 * 和下一次交接摘要使用。
 *
 * 只读 DSH 会话文件，只追加 hot/ 日志；不改 state、不改会话映射。
 *
 * 用法：
 *   node scripts/backfill-memory-from-session.mjs <sessionId|会话文件路径> [--days 2026-10-24,2026-10-25]
 * 默认回填该会话里最近 7 天内、且 hot 里还没有的消息。
 */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const ROOT = path.resolve(import.meta.dirname, '..')
const CONFIG_PATH = path.join(ROOT, 'config.json')

const args = process.argv.slice(2)
const target = args.find((a) => !a.startsWith('--'))
if (!target) {
  console.error('用法：node scripts/backfill-memory-from-session.mjs <sessionId|会话文件路径> [--days 2026-10-24,2026-10-25]')
  process.exit(2)
}
const daysArg = (() => {
  const i = args.indexOf('--days')
  return i >= 0 && args[i + 1] ? new Set(args[i + 1].split(',').map((s) => s.trim()).filter(Boolean)) : null
})()

function readJsonSafe(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
  } catch {
    return {}
  }
}
const config = readJsonSafe(CONFIG_PATH)
const memory = config.memory && typeof config.memory === 'object' ? config.memory : {}
const DIR = String(process.env.QQ_MEMORY_DIR || memory.dir || '<DSMP_MEMORY_DIR>')
const OWNER = String(config.ownerQQ || '<OWNER_QQ>')
const KEY = `private:${OWNER}`
const HOT = path.join(DIR, 'hot')

function sessionFile(arg) {
  if (/\.zstd$/i.test(arg) && fs.existsSync(arg)) return arg
  const base = '<USER_HOME>\\.dsh\\sessions'
  if (!fs.existsSync(base)) throw new Error(`找不到会话目录：${base}`)
  for (const dir of fs.readdirSync(base)) {
    const candidate = path.join(base, dir, arg, 'session.v4.jsonl.zstd')
    if (fs.existsSync(candidate)) return candidate
    const byFile = path.join(base, dir, `${arg}.jsonl.zstd`)
    if (fs.existsSync(byFile)) return byFile
  }
  throw new Error(`找不到会话：${arg}`)
}

/** DSH 会话日志是「一帧一追加」的多帧 zstd，Node 的一次性解压只吃第一帧，这里按帧魔数切分。 */
function decompressMultiFrame(buf) {
  const offsets = []
  for (let i = 0; i + 4 <= buf.length; i++) {
    if (buf[i] === 0x28 && buf[i + 1] === 0xB5 && buf[i + 2] === 0x2F && buf[i + 3] === 0xFD) offsets.push(i)
  }
  const parts = []
  for (let k = 0; k < offsets.length; k++) {
    const end = k + 1 < offsets.length ? offsets[k + 1] : buf.length
    try {
      parts.push(zlib.zstdDecompressSync(buf.subarray(offsets[k], end)))
    } catch {
      // 魔数偶发误判（压缩数据里出现同样 4 字节）：跳过这一帧，不整份失败
    }
  }
  return Buffer.concat(parts).toString('utf8')
}

function localDay(ms) {
  const d = new Date(ms + 8 * 3600e3) // Asia/Shanghai（本机固定 UTC+8，不依赖 TZ 环境）
  return d.toISOString().slice(0, 10)
}

function textsOf(message) {
  return (message?.content ?? [])
    .filter((c) => c?.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text)
    .join('\n')
}

const SEND_TOOLS = /^(mcp__snowluma__)?qq_(send_message|send_private_message|reply|send_burst|send_group_message)$/

function extractEvents(file) {
  const recs = []
  for (const line of decompressMultiFrame(fs.readFileSync(file)).split('\n')) {
    if (!line) continue
    try {
      recs.push(JSON.parse(line))
    } catch {}
  }
  const events = []
  const push = (ms, role, text, messageId, sender) => {
    const clean = String(text ?? '').replace(/\r/g, '').trim()
    if (!clean) return
    if (clean.length > 8000) return // 超长多半是注入的系统上下文，不是聊天原文
    events.push({ ms, role, text: clean, messageId: String(messageId ?? ''), sender })
  }
  for (const r of recs) {
    const ms = r.time ?? r.data?.time
    if (!Number.isFinite(ms)) continue
    if (r.type === 'user/message') {
      const t = textsOf(r.data)
      const m = t.match(/【本次消息快照】\s*(\{[\s\S]*?\})\s*\n/)
      if (m) {
        try {
          const snap = JSON.parse(m[1])
          for (const msg of snap.messages ?? []) push(ms, 'user', msg.text, msg.messageId, msg.sender || '私聊')
        } catch {}
      }
    } else if (r.type === 'tool/call' && SEND_TOOLS.test(String(r.data?.name ?? ''))) {
      let a = {}
      try {
        a = JSON.parse(r.data.arguments ?? '{}')
      } catch {}
      // qq_send_burst 的 messages 有时是 JSON 字符串（形如 ["甲","乙"]），先展开再逐条记
      const expand = (v) => {
        if (typeof v !== 'string') return Array.isArray(v) ? v : [v]
        const s = v.trim()
        if (s.startsWith('[') && s.endsWith(']')) {
          try {
            const arr = JSON.parse(s)
            if (Array.isArray(arr)) return arr
          } catch {}
        }
        return [s]
      }
      const list = expand(a.messages ?? a.message ?? []).flatMap(expand)
      for (const item of list) {
        if (typeof item === 'string') push(ms, 'assistant', item, '', '<PERSONA_ALT>')
      }
    }
  }
  return events
}

function existingKeys() {
  const ids = new Set()
  const texts = new Set()
  if (!fs.existsSync(HOT)) return { ids, texts }
  for (const day of fs.readdirSync(HOT)) {
    const dir = path.join(HOT, day)
    if (!fs.statSync(dir).isDirectory()) continue
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.jsonl') || !f.startsWith('private_')) continue
      for (const line of fs.readFileSync(path.join(dir, f), 'utf8').split('\n')) {
        if (!line) continue
        try {
          const o = JSON.parse(line)
          if (o.messageId) ids.add(String(o.messageId))
          if (o.text) texts.add(`${o.role}|${o.text}`)
        } catch {}
      }
    }
  }
  return { ids, texts }
}

const file = sessionFile(target)
let events = extractEvents(file)
const since = Date.now() - 7 * 24 * 3600e3
events = events.filter((e) => e.ms >= since && (!daysArg || daysArg.has(localDay(e.ms))))
events.sort((a, b) => a.ms - b.ms)

const { ids, texts } = existingKeys()
const seen = new Set()
let added = 0
let skipped = 0
for (const e of events) {
  const dedupeId = e.messageId ? `id:${e.messageId}` : ''
  const dedupeText = `${e.role}|${e.text}`
  if ((dedupeId && (ids.has(e.messageId) || seen.has(dedupeId))) || texts.has(dedupeText) || seen.has(dedupeText)) {
    skipped++
    continue
  }
  if (dedupeId) seen.add(dedupeId)
  seen.add(dedupeText)
  const day = localDay(e.ms)
  const dir = path.join(HOT, day)
  fs.mkdirSync(dir, { recursive: true })
  const line = JSON.stringify({
    ts: new Date(e.ms).toISOString(),
    key: KEY,
    role: e.role,
    sender: e.sender,
    text: e.text,
    media: [],
    messageId: e.messageId,
    source: 'backfill',
  })
  fs.appendFileSync(path.join(dir, `private_${OWNER}.jsonl`), line + '\n', 'utf8')
  added++
}

console.log(JSON.stringify({ session: file, events: events.length, added, skipped, dir: HOT }, null, 2))
