/**
 * Minimal Wrangler OAuth reader for the canonical encrypted KV vault.
 * This is an alternate READ-ONLY acquisition transport for
 * secure-cloudflare-kv-backup.mjs, NOT an independent backup owner.
 *
 * Invokes the PINNED Wrangler JavaScript CLI via process.execPath with an
 * argv array (never a shell) and captures byte-exact stdout in memory.
 * Remote value bytes, KV key names and Cloudflare errors are never logged.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const CONFIG = resolve(ROOT, 'telemetry-worker/wrangler.jsonc');
const MAX_RECORDS = 100000;
const VALUE_MAX = 26 * 1024 * 1024;

export function localWranglerJs() {
  const candidates = [
    resolve(ROOT, 'telemetry-worker/node_modules/wrangler/bin/wrangler.js'),
    resolve(ROOT, '../Myportfolio-Security-Latest/telemetry-worker/node_modules/wrangler/bin/wrangler.js')
  ];
  const found = candidates.find(existsSync);
  if (!found) throw Error('WRANGLER_INSTALL_NOT_FOUND');
  return found;
}

export function runWranglerRead(args, { executor = spawnSync, wranglerJs = localWranglerJs() } = {}) {
  if (!Array.isArray(args) || !['list', 'get'].includes(args[0])) throw Error('WRANGLER_READ_ONLY_REQUIRED');
  const op = args[0];
  // Accept only the exact, constant Wrangler remote-read subcommands.
  if (op === 'list' && (args.length !== 2 || !/^[0-9a-f]{32}$/i.test(args[1]))) throw Error('WRANGLER_READ_ONLY_REQUIRED');
  if (op === 'get' && (args.length !== 3 || !/^[0-9a-f]{32}$/i.test(args[1]) || typeof args[2] !== 'string')) throw Error('WRANGLER_READ_ONLY_REQUIRED');
  const remote = ['kv','key',op,'--namespace-id',args[1],'--remote','--config',CONFIG];
  if (op === 'get') remote.splice(3,0,args[2]);
  const { CLOUDFLARE_API_TOKEN: unused, ...environment } = process.env;
  const result = executor(process.execPath, [wranglerJs, ...remote], {
    shell: false,
    cwd: ROOT,
    env: { ...environment, CI: 'true', NO_COLOR: '1' },
    windowsHide: true,
    timeout: 90000,
    encoding: 'buffer',
    maxBuffer: op === 'get' ? VALUE_MAX + 8192 : 32 * 1024 * 1024,
    stdio: ['ignore','pipe','pipe']
  });
  if (result.error || result.status !== 0 || !Buffer.isBuffer(result.stdout)) {
    throw Error('WRANGLER_REMOTE_KV_READ_FAILED');
  }
  return result.stdout;
}

export async function wranglerReader(options = {}) {
  const runner = options.runner || ((args) => runWranglerRead(args, options));
  return {
    async readKeys(id) {
      let items;
      try { items = JSON.parse(runner(['list', id]).toString('utf8').trim()); }
      catch { throw Error('WRANGLER_KV_LIST_FORMAT_INVALID'); }
      if (!Array.isArray(items) || items.length > MAX_RECORDS) throw Error('WRANGLER_KV_LIST_FORMAT_INVALID');
      if (items.some(x => !x || typeof x.name !== 'string' || x.name.length > 512 ||
        (x.expiration != null && (!Number.isInteger(x.expiration) || x.expiration < 0)) ||
        (x.metadata != null && (typeof x.metadata !== 'object' || Array.isArray(x.metadata))))) {
        throw Error('WRANGLER_KV_LIST_FORMAT_INVALID');
      }
      return items;
    },
    async readValue(id, name) {
      const b = runner(['get', id, name]);
      if (!Buffer.isBuffer(b) || b.length > VALUE_MAX) throw Error('WRANGLER_KV_VALUE_INVALID');
      return b;
    }
  };
}
