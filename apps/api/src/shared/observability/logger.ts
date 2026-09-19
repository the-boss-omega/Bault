import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { LoggerService } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { loadEnv } from '@bault/config';

/**
 * Structured logging, and the request id that makes it worth having.
 *
 * `LOG_LEVEL` was in the env schema and read by NOTHING. Logging was Nest's
 * default formatter plus a scattering of `console.log` behind eslint-disable
 * comments: no level control, no JSON, no timestamps an aggregator can parse,
 * and — the part that actually hurts — no correlation. When a collector said
 * "my card vanished", there was no way to find the request that did it, because
 * nothing tied a line of output to the call that produced it.
 *
 * NO DEPENDENCY. pino and winston are both excellent and both are a dependency
 * plus a transport plus a config file for something that is, at this size, one
 * JSON.stringify and a level check. The thing that was missing was never the
 * library; it was the request id and the shape.
 *
 * In development the output stays human — a single tinted line — because a
 * developer reading a terminal is a different reader from a log aggregator, and
 * JSON-per-line is miserable to scan by eye.
 */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
export type LogLevel = keyof typeof LEVELS;

/**
 * The current request's id, carried without threading it through every call.
 *
 * `AsyncLocalStorage` is the reason this works at all: a service five layers
 * down logs a line and it comes out tagged with the request that caused it,
 * without that service knowing a request exists.
 */
const context = new AsyncLocalStorage<{ requestId: string }>();

export const currentRequestId = (): string | undefined => context.getStore()?.requestId;

/**
 * Attach an id to every request and hand it back on the response.
 *
 * An inbound `x-request-id` is honoured so a load balancer or a caller that
 * already assigned one keeps its trace intact; otherwise one is minted. It goes
 * back out on the response header so a customer reporting a problem can quote
 * the id of the exact call that failed.
 */
export function requestContext(req: Request, res: Response, next: NextFunction): void {
  const inbound = req.headers['x-request-id'];
  const requestId =
    (typeof inbound === 'string' && inbound.trim().slice(0, 200)) || randomUUID();
  res.setHeader('x-request-id', requestId);
  context.run({ requestId }, () => next());
}

/** What a log line always carries, on top of whatever the caller passed. */
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
    // Anything that is not development gets machine-readable output: `test`
    // included, so what CI prints is what production prints.
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

/**
 * Nest passes a trailing context string on most calls and a stack on errors.
 * Both are useful and neither should become a positional mystery in the output.
 */
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

/** One line a person can scan, for development only. */
function humanLine(line: Line): string {
  const { level, time, message, requestId, context: scope, ...rest } = line;
  const head = `${time.slice(11, 23)} ${level.toUpperCase().padEnd(5)}`;
  const tags = [scope, requestId ? requestId.slice(0, 8) : undefined].filter(Boolean).join(' ');
  const extra = Object.keys(rest).length > 0 ? ` ${safeString(rest)}` : '';
  return `${head} ${tags ? `[${tags}] ` : ''}${message}${extra}`;
}
