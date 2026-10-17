import { loadEnv } from '@bault/config';

/**
 * The worker's log, in the API's format.
 *
 * It writes the same line as the API's `StructuredLogger`: `level`, `time`,
 * `message`, `context`, then the fields, as one JSON object per line, and a
 * single human-readable line in development.
 *
 * Mirrored BY VALUE from `apps/api/src/shared/observability/logger.ts`, because
 * the worker cannot import the API. Change the shape in both places or in neither.
 */
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
export type LogLevel = keyof typeof LEVELS;

interface Line {
  level: LogLevel;
  time: string;
  message: string;
  context?: string;
  [key: string]: unknown;
}

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

/**
 * Read lazily, on the first line written, so the configuration is what the
 * process has when it logs, not when this module was imported.
 */
let settings: { threshold: number; json: boolean } | undefined;
function resolved(): { threshold: number; json: boolean } {
  if (settings) return settings;
  const env = loadEnv();
  settings = { threshold: LEVELS[env.LOG_LEVEL], json: env.NODE_ENV !== 'development' };
  return settings;
}

/** An Error becomes its name, message and stack; JSON.stringify would make it `{}`. */
function plain(value: unknown): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, ...(value.stack ? { stack: value.stack } : {}) };
  }
  return value;
}

function safeString(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function humanLine(line: Line): string {
  const { level, time, message, context: scope, ...rest } = line;
  const head = `${time.slice(11, 23)} ${level.toUpperCase().padEnd(5)}`;
  const extra = Object.keys(rest).length > 0 ? ` ${safeString(rest)}` : '';
  return `${head} ${scope ? `[${scope}] ` : ''}${message}${extra}`;
}

export function createLogger(scope = 'worker'): Logger {
  const write = (level: LogLevel, message: string, fields: Record<string, unknown> = {}) => {
    const { threshold, json } = resolved();
    if (LEVELS[level] < threshold) return;
    const line: Line = {
      level,
      time: new Date().toISOString(),
      message,
      context: scope,
      ...Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, plain(v)])),
    };
    const stream = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
    stream.write(json ? `${safeString(line)}\n` : `${humanLine(line)}\n`);
  };
  return {
    debug: (m, f) => write('debug', m, f),
    info: (m, f) => write('info', m, f),
    warn: (m, f) => write('warn', m, f),
    error: (m, f) => write('error', m, f),
  };
}

export const log = createLogger('worker');
