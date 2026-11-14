# DeepSeek-memory-partner (DSMP)

A single [DeepSeek Harness](https://github.com/deepseek-ai) plugin that bundles a long-term
memory engine with a desktop chat panel. It remembers what the owner said — facts,
preferences, plans, deadlines — injects a compact memory card into every agent step, and
lets you inspect, edit, and correct that memory from the Harness UI.

- **One install, no services**: a host plugin plus a web client. No MCP subprocess, no
  separate server, no npm runtime dependencies.
- **Memory that behaves like memory**: facts carry a "said at" time, decay, expire, get
  superseded, and are grouped into topics/slots instead of being one flat blob.
- **Readable and editable**: every fact exposes its revision chain and the conversation
  turn it came from; you can confirm or reject candidates the extractor proposed.
- **Native tools**: seven `dsmp_memory_*` tools (`search`, `recall`, `window`, `write`,
  `edit`, `photo`, `todo`) are registered through `ctx.tools`, so the agent can query
  memory directly.
- **Local by design**: memory lives in a directory you choose; nothing is uploaded.

## Requirements

| Item | Value |
| --- | --- |
| DeepSeek Harness | `>= 0.2.1-rc.2` (tested on `0.2.1-rc.5`) |
| Node | `>= 22.13` |
| OS | Windows 10/11 (panel and services assume Windows paths) |
| Runtime deps | none — the memory engine ships as `vendor/memory/` |

## Install

The desktop profile lives under `<DSH_HOME>/profiles/desktop`. Three landing points must
all exist, otherwise the plugin will not activate:

1. `profiles/desktop/package.json` → `dependencies`:

   ```json
   "@local/dsmp": "link:<absolute path to this folder>"
   ```

2. The same file → append `"@local/dsmp"` to `dsh.profile.bundles`.
3. Create the junction:

   ```cmd
   mklink /J "%DSH_HOME%\profiles\desktop\node_modules\@local\dsmp" "<absolute path to this folder>"
   ```

Then refresh the Harness page. Bundle changes are hot-loaded (about 2 s unload, 4 s
reload); the client UI needs a page refresh to pick up the new plugin list.

Verify:

```cmd
curl -s "http://127.0.0.1:<port>/api/dsmp/status"
curl -s "http://127.0.0.1:<port>/api/dsmp/memory/preview?text=hello"
```

`status` returns `ok: true`, `version`, `mode` (`local` / `degraded` / `qq`), the memory
directory, lease owner, and the registered tool names.

## Five-minute tour

1. Install (three landing points above) and refresh.
2. Open **Chat** → **Settings**, pick the memory directory (start with an empty one if you
   are just trying it) and the default provider/model.
3. Send a local message: "Hi, remember that I drink Americano." The reply shows
   `memory injected: N facts · X chars card · Y chars rules`.
4. Open the **Memory** tab → **Facts**: the new fact (or a pending candidate) is there;
   **Window replay** shows the turn you just had.
5. Ask the agent "what coffee did I say I like?" — it should call `dsmp_memory_recall` and
   return a line with a `⟵ window … turn …` anchor you can expand.

## What is in the box

| Path | Purpose |
| --- | --- |
| `lib/index.js` | host plugin: routes, settings, status, chat, memory bridge, services |
| `lib/client.js` | web client: sidebar item + Chat / History / Memory / Settings tabs |
| `lib/session-bridge.js` | drives the shared DSH session (reuse/adopt, follow-ups, events) |
| `lib/memory-context.js` | read-only projection: rules + fact card → injected prompt |
| `lib/tools.js` | the seven native `dsmp_memory_*` tools |
| `lib/workbench/` | memory views (facts, topics, window, episodes, usage, recall debug) |
| `lib/machine-pack.js` | one-click machine move: export/import a memory pack |
| `lib/backup.js` | panel backup/restore with preflight and sidecar manifest |
| `lib/robustness.js` | write token, diagnostics, ETag (optimistic lock), self-check |
| `vendor/memory/` | vendored memory engine (window ledger, scoring, extraction, topics) |
| `workbench/` | optional legacy workbench (port 7351) for the standalone browser view |

## Memory data layout

```
<memory dir>/
├─ state/
│  ├─ longterm.jsonl        # fact events (append-only)
│  ├─ topics.jsonl          # topic tree
│  ├─ candidates.jsonl      # pending extraction candidates
│  ├─ claims.jsonl          # proposed corrections from chat
│  ├─ media.jsonl           # image index (sha1 addressed)
│  ├─ voice.jsonl           # voice index (in/out, text when known)
│  ├─ calendar.json         # semester / week anchors
│  └─ engine-lease.json     # single-writer lease
├─ window/<sessionId>/turns.jsonl
├─ episodes/<YYYY-MM-DD>.jsonl
├─ media/YYYY-MM/<sha1>.<ext>
├─ roles/                   # mirrored persona cards
├─ logs/                    # token usage, scoring, audit
├─ profile.md               # projected fact card
└─ backup/                  # timed snapshots before writes
```

## Tools

| Tool | What it does |
| --- | --- |
| `dsmp_memory_search` | keyword search over the owner's chat history (7-day window + archive) |
| `dsmp_memory_recall` | structured recall by slot/topic/subject; returns anchors and diagnostics |
| `dsmp_memory_window` | expand one turn: owner text, spoken lines, private thoughts |
| `dsmp_memory_write` | write a first-person fact (quota-limited, writer lease required) |
| `dsmp_memory_edit` | revise a fact, keeping the revision chain |
| `dsmp_memory_photo` | fetch an original image by sha1 |
| `dsmp_memory_todo` | list / complete / cancel dated commitments |

## Privacy and boundaries

- The panel reads and writes only the configured memory directory; it never touches other
  folders.
- QQ delivery stays with qq-bridge. DSMP queues outbound messages and records what was
  sent; it does not open a QQ connection itself.
- No telemetry. The only outbound requests are to the local Harness, the local qq-bridge,
  and optional local model/image/voice services you configure.
- Thumbnails and voice files are stored as content-addressed blobs; deleting the memory
  directory removes everything.

## Known limitations

- Group-chat history is limited to the most recent 100 messages exposed by the bridge.
- When two engines (bridge and DSMP) coexist, only the lease holder writes; the other side
  returns `409 DSMP_NOT_WRITER` for writes and stays readable.
- No speech-to-text: voice is stored as bytes plus metadata. TTS output carries its source
  text; library files without text need an external ASR.
- A memory pack exports `memory/**`, the bound session log, and persona cards only —
  unbound sessions and bridge session mappings are not included.
- The single-machine lock is advisory (heartbeat based), not a hard lock.
- The legacy `workbench/` server (port 7351) is optional; the embedded **Memory** tab does
  not need it.

## License

MIT © 2026 Ido1um. See [LICENSE](LICENSE).
