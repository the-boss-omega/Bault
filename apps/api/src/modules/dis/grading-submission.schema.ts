import { index, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { pkId, createdAt, updatedAt } from '../../db/schema/_helpers';

/**
 * A batch of cards going to one grader, together.
 *
 * Graders are not a per-card service. Cards accumulate, go out in one insured
 * package on a schedule, and come back weeks later — which is why the reference
 * service submits weekly rather than on demand.
 *
 * Bault had no notion of this at all. A grading request was accepted and then
 * completed with a grade, and in between the card was not modelled as being
 * anywhere: it stayed `stored`, so it could be listed, sold or shipped while
 * sitting in a grader's building on the other side of the country.
 *
 * The submission is what closes that hole. Requests join one; when it SHIPS,
 * every item in it moves to `at_grader` and stops being sellable; when a grade
 * comes back the item returns to the shelf.
 */
export const gradingSubmissionStatus = pgEnum('grading_submission_status', [
  /** Accepting requests. Cards are still on the shelf. */
  'open',
  /** Sent. Every card in it is at the grader. */
  'shipped',
  /** Everything came back and was recorded. Terminal. */
  'returned',
]);

export const gradingSubmission = pgTable(
  'grading_submission',
  {
    id: pkId(),
    /** Human-facing Submission ID, GSB-XXXXXXXX. */
    code: text('code').notNull(),
    /** PSA, BGS — one submission goes to one grader. */
    gradingBody: text('grading_body').notNull(),
    status: gradingSubmissionStatus('status').notNull().default('open'),
    /** The grader's own reference for the package, once it exists. */
    externalReference: text('external_reference'),
    trackingNumber: text('tracking_number'),
    shippedAt: timestamp('shipped_at', { withTimezone: true }),
    returnedAt: timestamp('returned_at', { withTimezone: true }),
    shippedBy: uuid('shipped_by'),
    notes: text('notes'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({
    gradingSubmissionCodeUnique: uniqueIndex('grading_submission_code_unique').on(t.code),
    /** "What is still open for PSA" — the only query the console runs here. */
    gradingSubmissionBodyStatusIdx: index('grading_submission_body_status_idx').on(t.gradingBody, t.status),
  }),
);
