// This module MUST be imported before any other application module: it loads
// the configuration file into `process.env` so that every later module sees the
// final configuration.
import fs from 'node:fs';
import path from 'node:path';
import { PROJECT_ROOT, envStr, loadEnvFile } from './env.js';

/** Default location: `<project root>/.env` (dev runs, manual `npm start`). */
export const DEFAULT_ENV_FILE = path.join(PROJECT_ROOT, '.env');

/**
 * systemd installs pass `ENV_FILE=/etc/notes-manager/notes-manager.env`, which
 * is then the single authoritative configuration file.
 */
export const envFileOverride = envStr('ENV_FILE', '');

/** Absolute path of the file that was actually read, or null when none existed. */
export const activeEnvFile: string | null = loadEnvFile(envFileOverride || DEFAULT_ENV_FILE);

export interface EnvDiagnostic {
  level: 'info' | 'warn';
  message: string;
}

/**
 * Diagnostics for the most common deployment confusion: editing a `.env` that
 * the process never reads. Values already present in the environment always win
 * over the file, which is why a systemd `EnvironmentFile` shadows `.env`.
 */
export const envDiagnostics: EnvDiagnostic[] = [];

if (activeEnvFile) {
  envDiagnostics.push({ level: 'info', message: `config file : ${activeEnvFile}` });
} else {
  const attempted = envFileOverride || DEFAULT_ENV_FILE;
  envDiagnostics.push({
    level: 'info',
    message: `config file : ${attempted} (missing - using environment variables and defaults)`,
  });
}

if (activeEnvFile && path.resolve(activeEnvFile) !== path.resolve(DEFAULT_ENV_FILE)) {
  if (fs.existsSync(DEFAULT_ENV_FILE)) {
    envDiagnostics.push({
      level: 'warn',
      message: `${DEFAULT_ENV_FILE} exists but is NOT read - the active configuration file is ${activeEnvFile}`,
    });
  }
  envDiagnostics.push({
    level: 'info',
    message: `hint        : put overrides in ${activeEnvFile}, or unset ENV_FILE to use ${DEFAULT_ENV_FILE}`,
  });
}
