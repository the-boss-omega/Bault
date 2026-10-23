import { index, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { pkId, createdAt, updatedAt } from '../../db/schema/_helpers';

export const gradingSubmissionStatus = pgEnum('grading_submission_status', [
  'open',
  'shipped',
  'returned',
]);

export const gradingSubmission = pgTable(
  'grading_submission',
  {
    id: pkId(),
    code: text('code').notNull(),
    gradingBody: text('grading_body').notNull(),
    status: gradingSubmissionStatus('status').notNull().default('open'),
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
    gradingSubmissionBodyStatusIdx: index('grading_submission_body_status_idx').on(t.gradingBody, t.status),
  }),
);
