/**
 * After how many failed dispatches an outbox message is PARKED: left
 * undispatched, with its error, for a person to look at.
 *
 * The worker decides this (`MAX_ATTEMPTS` in
 * `apps/worker/src/jobs/outbox-dispatch.ts`); the API only reads it, to show
 * the parked messages and to requeue one. Mirrored by value rather than
 * imported, as the worker and the API share no code, and pinned equal by
 * `tests/worker/outbox-requeue.test.ts`. If the two drifted, the console would
 * offer to requeue messages the dispatcher is still retrying, or hide some it
 * has given up on.
 */
export const PARKED_AFTER_ATTEMPTS = 5;
