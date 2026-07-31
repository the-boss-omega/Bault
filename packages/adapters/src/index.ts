/**
 * External-provider adapter interfaces + sandbox implementations (T020).
 * Keeping providers behind interfaces makes any provider replaceable without
 * touching the core, and keeps the platform the sole system of record (Principle XIII).
 */
export * from './payment';
export * from './shipping';
export * from './email';
export * from './storage';
