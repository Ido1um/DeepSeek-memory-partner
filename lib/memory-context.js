import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Read-only memory projection for chat injection.
 *
 * Deliberately avoids the full memory engine: the engine's composePrompt also
 * mutates per-session bookkeeping (rules marks, handover consumption) and needs
 * a store bound to the bridge's config. For panel chat we only need the same
 * text the engine would put in front of the model — rules, fact card — so we
 * assemble it straight from the data directory. Nothing here writes.
 */

const MODULE_CACHE = new Map();

// Set by the host entry (lib/index.js) from PLUGIN_ROOT. Needed because during
// dev reload this file is evaluated from a data: URL, where relative imports
// cannot be resolved against import.meta.url.
let VENDOR_SRC = '';

export function configureVendor({ vendorDir } = {}) {
  if (vendorDir) VENDOR_SRC = String(vendorDir);
}

function vendorUrl(name) {
  if (VENDOR_SRC) return pathToFileURL(path.join(VENDOR_SRC, name)).href;
  return new URL(`../vendor/memory/src/${name}`, import.meta.url).href;
}

async function loadModule(name) {
  if (!MODULE_CACHE.has(name)) {
    MODULE_CACHE.set(name, import(vendorUrl(name)));
  }
  return MODULE_CACHE.get(name);
}

export function memoryDataPresent(dir) {
  if (!dir) return false;
  // The engine keeps longterm.jsonl under state/, older copies sometimes sit at
  // the memory root — accept either so a hand-copied directory still injects.
  for (const rel of ['longterm.jsonl', path.join('state', 'longterm.jsonl')]) {
    try {
      if (fs.existsSync(path.join(dir, rel))) return true;
    } catch {
      /* keep probing */
    }
  }
  return false;
}

export async function buildFactCard(dir, { maxChars = 1500 } = {}) {
  if (!memoryDataPresent(dir)) {
    return { ok: false, reason: 'no-data', text: '', chars: 0, facts: 0, topics: 0 };
  }
  const [longterm, cardTree, topics] = await Promise.all([
    loadModule('longterm.mjs'),
    loadModule('card-tree.mjs'),
    loadModule('topics.mjs')
  ]);

  const facts = longterm.openIndex(dir).facts();
  let topicRows = [];
  try {
    topicRows = topics.readTopics(dir) || [];
  } catch {
    topicRows = [];
  }
  const built = cardTree.buildTreeCard(facts, { maxChars }, topicRows);
  const text = String(built.text || '');
  return {
    ok: true,
    text,
    chars: text.length,
    facts: facts.length,
    topics: topicRows.length,
    mode: built.mode || (topicRows.length ? 'tree' : 'flat'),
    dropped: Array.isArray(built.dropped) ? built.dropped.length : 0
  };
}

export async function buildRulesSection(dir, { maxChars = 600 } = {}) {
  if (!dir) return { text: '', chars: 0 };
  try {
    const rules = await loadModule('rules.mjs');
    const section = rules.rulesSection(dir, maxChars);
    return { text: String(section.text || ''), chars: String(section.text || '').length };
  } catch {
    return { text: '', chars: 0 };
  }
}

/**
 * Compose the text actually handed to the agent for one panel message.
 * Mirrors the engine's section order (rules → card → the new message) so the
 * model reads the same shape it reads on the QQ side.
 */
export async function composeChatPrompt(text, { memoryDir, rulesChars = 600, cardChars = 1500 } = {}) {
  const [rules, card] = await Promise.all([
    buildRulesSection(memoryDir, { maxChars: rulesChars }),
    buildFactCard(memoryDir, { maxChars: cardChars })
  ]);

  const parts = [];
  if (rules.text) parts.push(rules.text.trim());
  if (card.text) parts.push(card.text.trim());
  parts.push(`【本次消息快照】\n${text}`);

  return {
    text: parts.join('\n\n'),
    meta: {
      memoryDir: memoryDir || '',
      dataPresent: memoryDataPresent(memoryDir),
      rulesChars: rules.chars,
      cardChars: card.chars,
      facts: card.facts || 0,
      topics: card.topics || 0,
      mode: card.mode || (card.ok ? 'flat' : 'none')
    }
  };
}
