import { envStr } from './env.js';

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 } as const;
export type LogLevel = keyof typeof LEVELS;

let override: number | null = null;

function threshold(): number {
  if (override !== null) return override;
  const raw = envStr('LOG_LEVEL', 'info').toLowerCase();
  override = raw in LEVELS ? LEVELS[raw as LogLevel] : LEVELS.info;
  return override;
}

const COLORS: Record<LogLevel, string> = {
  error: '\u001b[31m',
  warn: '\u001b[33m',
  info: '\u001b[36m',
  debug: '\u001b[90m',
};
const RESET = '\u001b[0m';

function emit(level: LogLevel, scope: string, args: unknown[]): void {
  if (LEVELS[level] > threshold()) return;
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const tag = `${COLORS[level]}${level.toUpperCase().padEnd(5)}${RESET}`;
  const sink = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  sink(`${ts} ${tag} [${scope}]`, ...args);
}

export function setLogLevel(level: string): void {
  const l = level.toLowerCase() as LogLevel;
  if (l in LEVELS) override = LEVELS[l];
}

export interface Logger {
  error(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  info(...args: unknown[]): void;
  debug(...args: unknown[]): void;
  child(scope: string): Logger;
}

export function createLogger(scope: string): Logger {
  return {
    error: (...a) => emit('error', scope, a),
    warn: (...a) => emit('warn', scope, a),
    info: (...a) => emit('info', scope, a),
    debug: (...a) => emit('debug', scope, a),
    child: (sub: string) => createLogger(`${scope}:${sub}`),
  };
}
