// 记忆数据布局自检（只读）
//
//   node scripts/check-memory-layout.mjs
//   node scripts/check-memory-layout.mjs --dir "<DSMP_MEMORY_DIR>"
//
// 检查：必需目录/文件是否齐全、散落 *.bak-* 是否回潮、图片/语音文件数与索引是否对得上。
// 退出码：0 全通过；1 有缺失或计数不一致。
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_DIR = '<DSMP_MEMORY_DIR>';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
}

const DIR = arg('--dir', DEFAULT_DIR);

const REQUIRED_DIRS = ['state', 'raw', 'raw\\hot', 'raw\\archive', 'window', 'episodes', 'logs', 'media', 'voice'];
const REQUIRED_FILES = ['profile.md', 'rules.md', 'state\\longterm.jsonl', 'state\\memory.json'];
const OPTIONAL_FILES = ['state\\media.jsonl', 'state\\voice.jsonl', 'state\\topics.jsonl', 'activation.json', 'v10.json'];

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
}

function exists(rel) {
  return fs.existsSync(path.join(DIR, rel));
}

for (const rel of REQUIRED_DIRS) check(`目录 ${rel}`, exists(rel));
for (const rel of REQUIRED_FILES) check(`文件 ${rel}`, exists(rel));
for (const rel of OPTIONAL_FILES) check(`可选 ${rel}`, exists(rel), exists(rel) ? '' : '不存在（按需创建）');

// 散落备份回潮
const strays = [];
for (const name of fs.existsSync(path.join(DIR, 'state')) ? fs.readdirSync(path.join(DIR, 'state')) : []) {
  if (/\.bak-/i.test(name)) strays.push(`state\\${name}`);
}
for (const name of fs.readdirSync(DIR)) {
  if (/^profile\.md\.bak-/i.test(name)) strays.push(name);
}
check('没有散落 *.bak-*', strays.length === 0, strays.length ? `发现 ${strays.length} 个：${strays.slice(0, 5).join(', ')}` : '');

// 索引 vs 文件
function countIndex(rel) {
  const file = path.join(DIR, rel);
  if (!fs.existsSync(file)) return { rows: 0, ok: true };
  let rows = 0;
  let bad = 0;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t) continue;
    rows += 1;
    try {
      const row = JSON.parse(t);
      if (!row.sha1) bad += 1;
      else if (row.rel && !fs.existsSync(path.join(DIR, row.rel))) bad += 1;
    } catch {
      bad += 1;
    }
  }
  return { rows, bad, ok: bad === 0 };
}

const media = countIndex('state\\media.jsonl');
check('图片索引可解析且指向存在的文件', media.ok, `${media.rows} 条${media.bad ? `，${media.bad} 条坏` : ''}`);
const voice = countIndex('state\\voice.jsonl');
check('语音索引可解析且指向存在的文件', voice.ok, `${voice.rows} 条${voice.bad ? `，${voice.bad} 条坏` : ''}`);

function countFiles(rel, extRe) {
  const root = path.join(DIR, rel);
  if (!fs.existsSync(root)) return 0;
  let n = 0;
  for (const entry of fs.readdirSync(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (extRe.test(entry.name)) n += 1;
  }
  return n;
}
const imageFiles = countFiles('media', /\.(jpg|jpeg|png|webp|gif|bmp|heic)$/i);
const voiceFiles = countFiles('voice', /\.(ogg|opus|mp3|wav|m4a|amr|silk|flac)$/i);
check('图片文件数与索引一致', imageFiles === media.rows, `文件 ${imageFiles} / 索引 ${media.rows}`);
check('语音文件数与索引一致', voiceFiles === voice.rows, `文件 ${voiceFiles} / 索引 ${voice.rows}`);

const failed = results.filter((r) => !r.ok);
for (const r of results) {
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  —  ${r.detail}` : ''}`);
}
console.log(`\n${results.length - failed.length} 通过 / ${failed.length} 失败  （目录：${DIR}）`);
process.exit(failed.length ? 1 : 0);
