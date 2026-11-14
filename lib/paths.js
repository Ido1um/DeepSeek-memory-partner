import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Package root: <plugin>/lib/paths.js -> <plugin>
export const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * DSH home directory. The desktop app sets DSH_HOME for the host process; the
 * fallback keeps standalone scripts (tests, CLI helpers) working.
 */
export function dshHome() {
  return process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
}

/** DSMP's own state directory inside the DSH home. */
export function dsmpHome() {
  return path.join(dshHome(), 'dsmp');
}

export function pluginFile(...parts) {
  return path.join(PLUGIN_ROOT, ...parts);
}
