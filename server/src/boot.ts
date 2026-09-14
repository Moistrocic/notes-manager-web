// This module MUST be imported before any other application module: it loads
// the `.env` file into `process.env` so that every later module sees the
// final configuration.
import { loadEnvFile, envStr } from './env.js';

export const loadedEnvFile = loadEnvFile();
export const envFileMissing = loadedEnvFile === null;

if (loadedEnvFile === null && envStr('SUPPRESS_ENV_WARNING') !== '1') {
  // Not fatal: every setting has a default.
  console.log('[boot] no .env file found - using defaults and environment variables');
}
