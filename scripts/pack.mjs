import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

/**
 * Build a single installable tarball without npm:
 *   node scripts/pack.mjs [--out dist/xxx.tgz]
 * Only package.json / lib / vendor / README / CHANGELOG / docs are included.
 * Never ships: dev/, test/, dist/, backups, settings with tokens, absolute paths.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Docs stay in the source tree: their names are Chinese, and a ustar archive
// cannot carry non-ASCII names portably (Windows tar decodes them as GBK).
// The installable package only needs code + engine + the two entry documents.
const INCLUDE = ['package.json', 'cordis.patch.yml', 'README.md', 'README.en.md', 'CHANGELOG.md', 'LICENSE', 'lib', 'vendor', 'workbench'];
const SKIP_NAMES = new Set(['node_modules', '.git', 'dist', 'backup', 'backups', 'dev', 'test']);
// The desktop workbench ships as source only: its config.json holds this
// machine's data dir / policy keys, and .workbench-token is a live secret.
const SKIP_REL = new Set(['workbench/config.json', 'workbench/.workbench-token']);
// vendor keeps only the engine sources at run time; its docs/scripts/examples
// are development material and would drag the original project's paths in.
const SKIP_VENDOR_DIRS = new Set(['docs', 'scripts', 'examples', 'test']);
const TEXT_EXT = new Set(['.js', '.mjs', '.cjs', '.json', '.md', '.yml', '.yaml', '.txt', '.html', '.vbs', '.cmd', '.ps1']);

/**
 * The shipped build must not leak this machine's layout (owner rule: no local
 * absolute paths). Text files are rewritten with placeholders that lib/settings.js
 * resolves from DSMP_MEMORY_DIR / DSMP_BRIDGE_DIR / DSH_HOME at run time.
 */
const PATH_MAP = [
  ['<DSMP_PLUGIN_ROOT>', '<DSMP_PLUGIN_ROOT>'],
  ['<DSMP_BRIDGE_DIR>', '<DSMP_BRIDGE_DIR>'],
  ['<DSMP_BRIDGE_DIR>', '<DSMP_BRIDGE_DIR>'],
  ['<DSMP_MEMORY_DIR>', '<DSMP_MEMORY_DIR>'],
  ['<DSMP_MEMORY_DIR>', '<DSMP_MEMORY_DIR>'],
  ['<DSH_HOME>', '<DSH_HOME>'],
  ['<DSH_HOME>', '<DSH_HOME>'],
  ['<DSMP_MEMORY_SRC>', '<DSMP_MEMORY_SRC>'],
  ['<DSMP_WORKSPACE>', '<DSMP_WORKSPACE>'],
  ['<DSMP_WORKSPACE>', '<DSMP_WORKSPACE>'],
  ['<LOCAL_TOOLS>', '<LOCAL_TOOLS>'],
  // Owner identifiers never ship: the QQ key is configured per install.
  ['private:<OWNER_QQ>', 'private:<OWNER_QQ>'],
  ['<OWNER_QQ>', '<OWNER_QQ>']
].flatMap(([from, to]) => {
  // JS string literals store backslashes doubled, markdown stores them single.
  const doubled = from.replace(/\\/g, '\\\\');
  return [
    [from, to],
    [doubled, to],
    [from.replace(/\\/g, '/'), to]
  ];
});

function sanitize(data, rel) {
  if (!TEXT_EXT.has(path.extname(rel).toLowerCase())) return data;
  const text = data.toString('utf8');
  let out = text;
  for (const [from, to] of PATH_MAP) out = out.split(from).join(to);
  return Buffer.from(out, 'utf8');
}

function walk(dir, base, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_NAMES.has(entry.name)) continue;
    const relDir = path.relative(base, dir).replace(/\\/g, '/');
    if (relDir.startsWith('vendor/memory') && SKIP_VENDOR_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    const rel = path.relative(base, full).replace(/\\/g, '/');
    if (SKIP_REL.has(rel)) continue;
    if (entry.isDirectory()) walk(full, base, out);
    else if (entry.isFile()) out.push({ full, rel });
  }
  return out;
}

function octal(value, width) {
  return `${Math.max(0, value).toString(8).padStart(width - 1, '0')}\0`;
}

function tarHeader(name, size, mtime, mode = 0o644, type = '0') {
  const header = Buffer.alloc(512, 0);
  header.write(name.slice(0, 100), 0, 'utf8');
  header.write(octal(mode, 8), 100, 'ascii');
  header.write(octal(0, 8), 108, 'ascii');
  header.write(octal(0, 8), 116, 'ascii');
  header.write(octal(size, 12), 124, 'ascii');
  header.write(octal(Math.floor(mtime.getTime() / 1000), 12), 136, 'ascii');
  header.write('        ', 148, 'ascii');
  header.write(type, 156, 'ascii');
  header.write('ustar\0', 257, 'ascii');
  header.write('00', 263, 'ascii');
  header.write('root', 265, 'ascii');
  header.write('root', 297, 'ascii');
  let sum = 0;
  for (const byte of header) sum += byte;
  header.write(octal(sum, 8), 148, 'ascii');
  return header;
}

function pad(size) {
  const rest = size % 512;
  return rest === 0 ? Buffer.alloc(0) : Buffer.alloc(512 - rest, 0);
}

export function buildTarball(root = ROOT, include = INCLUDE) {
  const files = [];
  for (const item of include) {
    const full = path.join(root, item);
    if (!fs.existsSync(full)) continue;
    const stat = fs.statSync(full);
    if (stat.isDirectory()) walk(full, root, files);
    else files.push({ full, rel: item });
  }
  files.sort((a, b) => a.rel.localeCompare(b.rel));

  const chunks = [];
  for (const file of files) {
    const data = sanitize(fs.readFileSync(file.full), file.rel);
    const stat = fs.statSync(file.full);
    chunks.push(tarHeader(file.rel, data.length, stat.mtime), data, pad(data.length));
  }
  chunks.push(Buffer.alloc(1024, 0));
  const tar = Buffer.concat(chunks);
  return { buffer: zlib.gzipSync(tar, { level: 9 }), files: files.map((file) => file.rel) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outIndex = process.argv.indexOf('--out');
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const out = outIndex > 0 ? path.resolve(process.argv[outIndex + 1]) : path.join(ROOT, 'dist', `deepseek-memory-partner-${pkg.version}.tgz`);
  const { buffer, files } = buildTarball();
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, buffer);
  console.log(JSON.stringify({ ok: true, out, bytes: buffer.length, files: files.length, entries: files.slice(0, 8) }, null, 2));
}
