import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { LoggerService } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { loadEnv } from '@bault/config';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
export type LogLevel = keyof typeof LEVELS;

const context = new AsyncLocalStorage<{ requestId: string }>();

export const currentRequestId = (): string | undefined => context.getStore()?.requestId;

export function requestContext(req: Request, res: Response, next: NextFunction): void {
  const inbound = req.headers['x-request-id'];
  const requestId =
    (typeof inbound === 'string' && inbound.trim().slice(0, 200)) || randomUUID();
  res.setHeader('x-request-id', requestId);

  const started = process.hrtime.bigint();
  res.on('finish', () => {
    const path = (req.originalUrl || req.url || '').split('?')[0] ?? '';
    const status = res.statusCode;
    const probe = PROBES.test(path);
    const level: LogLevel = status >= 500 ? (probe ? 'warn' : 'error') : probe ? 'debug' : 'info';
    accessLog().line(level, `${req.method} ${path} ${status}`, {
      requestId,
      method: req.method,
      path,
      status,
      duration_ms: Number((Number(process.hrtime.bigint() - started) / 1e6).toFixed(1)),
    });
  });

  context.run({ requestId }, () => next());
}

const PROBES = /\/(healthz|readyz)(\/|$)/;

let access: StructuredLogger | undefined;
const accessLog = (): StructuredLogger => (access ??= new StructuredLogger('http'));

interface Line {
  level: LogLevel;
  time: string;
  message: string;
  requestId?: string;
  context?: string;
  [key: string]: unknown;
}

export class StructuredLogger implements LoggerService {
  private readonly threshold: number;
  private readonly json: boolean;

  constructor(private readonly scope?: string) {
    const env = loadEnv();
    this.threshold = LEVELS[env.LOG_LEVEL];
    this.json = env.NODE_ENV !== 'development';
  }

  private write(level: LogLevel, message: unknown, extra?: Record<string, unknown>): void {
    if (LEVELS[level] < this.threshold) return;

    const line: Line = {
      level,
      time: new Date().toISOString(),
      message: typeof message === 'string' ? message : safeString(message),
      ...(currentRequestId() ? { requestId: currentRequestId() } : {}),
      ...(this.scope ? { context: this.scope } : {}),
      ...extra,
    };

    const stream = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
    stream.write(
      this.json ? `${JSON.stringify(line)}\n` : `${humanLine(line)}\n`,
    );
  }

  line(level: LogLevel, message: string, fields: Record<string, unknown>): void {
    this.write(level, message, fields);
  }

  log(message: unknown, ...rest: unknown[]): void {
    this.write('info', message, meta(rest));
  }
  error(message: unknown, ...rest: unknown[]): void {
    this.write('error', message, meta(rest));
  }
  warn(message: unknown, ...rest: unknown[]): void {
    this.write('warn', message, meta(rest));
  }
  debug(message: unknown, ...rest: unknown[]): void {
    this.write('debug', message, meta(rest));
  }
  verbose(message: unknown, ...rest: unknown[]): void {
    this.write('debug', message, meta(rest));
  }
}

function meta(rest: unknown[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const strings = rest.filter((r): r is string => typeof r === 'string');
  if (strings.length > 0) out.detail = strings.length === 1 ? strings[0] : strings;
  const objects = rest.filter((r) => r && typeof r === 'object');
  if (objects.length > 0) out.data = objects.length === 1 ? objects[0] : objects;
  return out;
}

function safeString(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function humanLine(line: Line): string {
  const { level, time, message, requestId, context: scope, ...rest } = line;
  const head = `${time.slice(11, 23)} ${level.toUpperCase().padEnd(5)}`;
  const tags = [scope, requestId ? requestId.slice(0, 8) : undefined].filter(Boolean).join(' ');
  const extra = Object.keys(rest).length > 0 ? ` ${safeString(rest)}` : '';
  return `${head} ${tags ? `[${tags}] ` : ''}${message}${extra}`;
}
