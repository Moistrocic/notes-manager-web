import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Absolute path of the repository root (…/notes-manager-web). */
export const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
);

/**
 * Minimal `.env` loader (no dependency).
 *
 * Values already present in `process.env` always win so that a real
 * environment variable overrides the file, which is what deployment tooling
 * (systemd, docker, ...) expects.
 */
export function loadEnvFile(file?: string): string | null {
  const target = file ?? envStr('ENV_FILE', path.join(PROJECT_ROOT, '.env'));
  let raw: string;
  try {
    raw = fs.readFileSync(target, 'utf8');
  } catch {
    return null;
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    if (process.env[key] !== undefined) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    } else {
      const hash = value.indexOf(' #');
      if (hash !== -1) value = value.slice(0, hash).trim();
    }
    process.env[key] = value;
  }
  return target;
}

export function envStr(key: string, fallback = ''): string {
  const v = process.env[key];
  if (v === undefined) return fallback;
  const t = v.trim();
  return t === '' ? fallback : t;
}

export function envOptional(key: string): string | undefined {
  const v = process.env[key];
  if (v === undefined) return undefined;
  const t = v.trim();
  return t === '' ? undefined : t;
}

export function envBool(key: string, fallback: boolean): boolean {
  const v = envOptional(key);
  if (v === undefined) return fallback;
  return ['1', 'true', 'yes', 'on', 'enabled'].includes(v.toLowerCase());
}

export function envInt(key: string, fallback: number): number {
  const v = envOptional(key);
  if (v === undefined) return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

export function resolveFromRoot(p: string): string {
  return path.isAbsolute(p) ? p : path.resolve(PROJECT_ROOT, p);
}
