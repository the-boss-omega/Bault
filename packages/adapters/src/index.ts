/**
 * External-provider adapter interfaces and sandbox implementations. Providers
 * sit behind interfaces so any of them can be replaced without touching the
 * core, and the platform stays the sole system of record.
 */
export * from './payment';
export * from './shipping';
export * from './easypost';
export * from './email';
export * from './storage';
export * from './s3';
export * from './select';
export * from './error-report';
