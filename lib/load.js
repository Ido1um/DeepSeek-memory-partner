import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dshHome } from './paths.js';

/**
 * Load a sibling module.
 *
 * Two things make edits visible without a full DSH restart:
 *  - production: the cache-busting `?v=<mtime>` query forces Node to evaluate a
 *    fresh module after a bundle toggle instead of reusing the ESM cache;
 *  - development: while <DSH_HOME>/dsmp/dev-reload.flag exists, modules are
 *    evaluated from a data: URL (always fresh) so even mtime-preserving copies
 *    reload. Modules loaded this way must not use relative imports.
 */
export async function loadModule(name, { dshHome: homeOverride } = {}) {
  const url = new URL(`./${name}`, import.meta.url);
  const home = homeOverride || dshHome();
  const flag = path.join(home, 'dsmp', 'dev-reload.flag');

  if (fs.existsSync(flag)) {
    const source = fs.readFileSync(fileURLToPath(url), 'utf8');
    const encoded = Buffer.from(source, 'utf8').toString('base64');
    return import(`data:text/javascript;base64,${encoded}`);
  }
  const stat = fs.statSync(fileURLToPath(url));
  return import(`${url.href}?v=${Math.round(stat.mtimeMs)}`);
}

export { pathToFileURL };
