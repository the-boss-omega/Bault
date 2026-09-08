import { BadRequestException } from '@nestjs/common';
import type { ValidationError } from 'class-validator';
import { ErrorCode } from './error-codes';

/**
 * Turn a class-validator failure into something a person can act on.
 *
 * Every field-validation failure in this product reached the client as:
 *
 *     { "error": { "code": "validation_failed",
 *                  "message": "Bad Request Exception", "details": {} } }
 *
 * on all 164 routes. "Bad Request Exception" is Nest's internal class name. It
 * names no field, states no rule, and tells a person nothing they can do — which
 * is the exact failure the error-shape contract exists to prevent.
 *
 * The detail was never missing. `ValidationPipe` builds a full list of which
 * property broke which constraint and hands it to `BadRequestException`, whose
 * `.message` is then the class name rather than the list. The global filter,
 * seeing no `code` on the payload, fell back to that `.message` and discarded
 * the rest.
 *
 * So the shape is built HERE, at the pipe, rather than pattern-matched back out
 * in the filter: the payload already carries `code`, so the filter passes it
 * straight through untouched.
 *
 * `details.violations` matches the shape the wallet-request rules already
 * produce, so a client has one thing to read for every kind of validation
 * failure rather than two.
 *
 * WHAT THE MESSAGE SAYS was the second half of the problem, and it survived the
 * first fix. Naming the fields was a large improvement over naming the exception
 * class, and it still produced sentences written for whoever wrote the DTO:
 *
 *     Check these fields: label, recipient, line1, city, country, postalCode.
 *     destinationAccount must be a string.
 *     status must be one of the following values: pending, active, suspended, closed.
 *
 * `line1` and `postalCode` are property names, not the words on the form. "Must
 * be a string" is what a validator library says about an absent value; a person
 * reading it has been told the type system's opinion of their mistake. And a
 * flat list gives no clue whether the fields are missing or merely wrong, which
 * is the one thing a reader needs in order to act.
 *
 * Everything below is that translation, done once at the only place every route
 * passes through.
 */

export interface FieldViolation {
  /** Dotted path, so a nested DTO reports `items.0.binId` rather than `binId`. */
  field: string;
  /** The constraint that failed, e.g. `isPositive`. Stable enough to branch on. */
  code: string;
  message: string;
}

/** Flatten class-validator's tree — nested DTOs and arrays arrive as children. */
function flatten(errors: readonly ValidationError[], parent = ''): FieldViolation[] {
  const out: FieldViolation[] = [];
  for (const e of errors) {
    const path = parent ? `${parent}.${e.property}` : e.property;
    for (const [code, message] of Object.entries(e.constraints ?? {})) {
      out.push({ field: path, code, message });
    }
    if (e.children?.length) out.push(...flatten(e.children, path));
  }
  return out;
}

/**
 * Property names that are not words, or not the word the form uses.
 *
 * Only the ones a generic split cannot reach. `askingPrice` becomes "asking
 * price" on its own and needs no entry; `line1` becomes "line 1", which names
 * nothing, and does.
 */
const FIELD_NAMES: Record<string, string> = {
  line1: 'street address',
  line2: 'second address line',
  postalCode: 'postal code',
  destinationAccount: 'destination account',
  amountMinor: 'amount',
  valueMinor: 'value',
  declaredMinor: 'declared value',
  declaredValueMinor: 'customs value',
  insuredValueMinor: 'insured value',
  minAskingMinor: 'minimum price',
  askingPrice: 'asking price',
  itemIds: 'items',
  itemId: 'item',
  typeClass: 'item type',
  ownerUsername: 'owner username',
  idempotencyKey: 'request key',
  confirmationToken: 'confirmation code',
  newPassword: 'new password',
  currentPassword: 'current password',
  firstName: 'first name',
  lastName: 'last name',
  serviceLevel: 'service',
  binId: 'bin',
  addressId: 'address',
};

/**
 * A property path as a person would say it.
 *
 * `items.0.typeClass` → `item type (item 1)`. The index is preserved because in
 * a twelve-row intake form "item type" alone names nothing findable, and it is
 * shifted to one-based because the row is labelled 1 on screen, not 0.
 */
function humanField(path: string): string {
  const parts = path.split('.');
  const leaf = parts[parts.length - 1] ?? path;
  const indexes = parts.filter((p) => /^\d+$/.test(p)).map((p) => Number(p) + 1);
  const name =
    FIELD_NAMES[leaf] ??
    leaf
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/_/g, ' ')
      .toLowerCase();
  return indexes.length > 0 ? `${name} (item ${indexes[indexes.length - 1]})` : name;
}

/** Constraints that mean "you did not give me this at all". */
const MISSING_CONSTRAINTS = new Set([
  'isDefined',
  'isNotEmpty',
  'isNotEmptyObject',
  'arrayNotEmpty',
]);

/**
 * A type constraint on an ABSENT value reads as a missing field, not a wrong
 * one: class-validator reports a field nobody sent as "must be a string".
 */
const TYPE_CONSTRAINTS = new Set([
  'isString',
  'isInt',
  'isNumber',
  'isBoolean',
  'isArray',
  'isObject',
  'isDateString',
  'isEmail',
  'isUUID',
]);

/**
 * One violation, said plainly.
 *
 * Falls through to the library's own message wherever a DTO has written a
 * custom one — those are the sentences somebody deliberately wrote for a reader,
 * and rewriting them would be exactly backwards. A message is treated as custom
 * when it does not begin with the property name, which is the shape every
 * generated message has.
 */
function restate(violation: FieldViolation, present: boolean): string {
  const field = humanField(violation.field);
  const leaf = violation.field.split('.').pop() ?? violation.field;
  // `@IsString({ each: true })` produces "each value in areas must be a string",
  // which names the property in the middle rather than at the front.
  const eachOf = violation.message.startsWith(`each value in ${leaf} `);
  if (eachOf) return `every ${field} entry ${violation.message.slice(`each value in ${leaf} `.length)}`.replace(/\.?$/, '.');
  const generated = violation.message.startsWith(leaf);
  if (!generated) return violation.message;

  if (violation.code === 'whitelistValidation') {
    return `${field} is not a field this accepts.`;
  }
  if (MISSING_CONSTRAINTS.has(violation.code) || (TYPE_CONSTRAINTS.has(violation.code) && !present)) {
    return `${field} is required.`;
  }
  if ((violation.code === 'isEnum' || violation.code === 'isIn') && !present) {
    // An enum field nobody sent is missing, not mis-chosen. Listing the seven
    // legal values at somebody who supplied none of them buries the one fact
    // they need.
    return `${field} is required.`;
  }
  if (violation.code === 'isEnum' || violation.code === 'isIn') {
    // "must be one of the following values: a, b, c" — keep the list, lose the
    // preamble and the property name.
    const values = violation.message.replace(/^.*?:\s*/, '');
    return `${field} has to be one of: ${values}.`;
  }
  if (violation.code === 'isPositive') return `${field} has to be more than zero.`;
  if (violation.code === 'isEmail') return `${field} is not a valid email address.`;
  if (violation.code === 'isUUID') return `${field} is not in a valid format.`;

  // Everything else keeps the library's sentence with a readable subject:
  // "must be longer than or equal to 8 characters" is genuinely useful.
  return `${field} ${violation.message.slice(leaf.length).trim()}`.replace(/\.?$/, '.');
}

/**
 * One sentence a person can act on.
 *
 * Missing fields and wrong fields are stated separately, because they call for
 * different actions and a single flat list of names told the reader neither. A
 * lone failure states itself; the full list is always in `details.violations` for
 * a client that wants to mark up the form.
 */
function summarise(violations: readonly FieldViolation[], present: (field: string) => boolean): string {
  if (violations.length === 0) return 'That request is not valid.';

  const restated = violations.map((v) => ({ ...v, text: restate(v, present(v.field)) }));
  if (restated.length === 1) return restated[0]!.text;

  /**
   * Bucketed by FIELD, not by violation.
   *
   * One absent property routinely breaks two or three constraints at once —
   * `@IsString()` and `@IsNotEmpty()` and a length rule all fire on the same
   * missing value — and bucketing each violation independently put the same
   * field in two clauses of one sentence: "Subject, body are required; check
   * category, subject, body." A field that was never sent is missing, and that
   * is the only thing worth saying about it.
   */
  const byField = new Map<string, { name: string; kind: 'unknown' | 'missing' | 'invalid' }>();
  for (const v of restated) {
    const kind = v.code === 'whitelistValidation' ? 'unknown' : v.text.endsWith('is required.') ? 'missing' : 'invalid';
    const seen = byField.get(v.field);
    // "Missing" outranks "invalid": there is no point telling somebody to check
    // the format of a value they did not send.
    if (!seen || (seen.kind === 'invalid' && kind !== 'invalid')) {
      byField.set(v.field, { name: humanField(v.field), kind });
    }
  }

  const fields = [...byField.values()];
  const names = (kind: string) =>
    [...new Set(fields.filter((f) => f.kind === kind).map((f) => f.name))].join(', ');
  const count = (kind: string) => fields.filter((f) => f.kind === kind).length;

  /**
   * Every violation on a single field: one sentence, not a pile of them.
   *
   * An absent property breaks several constraints at once, and reading them all
   * back produces "asking price has to be more than zero. asking price is
   * required." — two statements where the second makes the first meaningless.
   * A field that is missing is missing; otherwise the most specific complaint
   * wins over the type-shape one, which is the least informative thing a
   * validator can say.
   */
  if (byField.size === 1) {
    const required = restated.find((v) => v.text.endsWith('is required.'));
    if (required) return required.text;
    /**
     * A value that IS present but the wrong shape makes the type constraint the
     * informative one, not the least informative one: `quantity: "lots"` broke
     * the integer rule and both range rules, and reporting only the ranges gave
     * "must not be greater than 100. must not be less than 1." about a word.
     */
    const wrongType = restated.find((v) => TYPE_CONSTRAINTS.has(v.code));
    if (wrongType) return wrongType.text;
    return [...new Set(restated.map((v) => v.text))].join(' ');
  }

  const clauses: string[] = [];
  if (count('missing') > 0) clauses.push(`${names('missing')} ${count('missing') === 1 ? 'is' : 'are'} required`);
  if (count('unknown') > 0) {
    clauses.push(`${names('unknown')} ${count('unknown') === 1 ? 'is not a field' : 'are not fields'} this accepts`);
  }

  const sentence = clauses.join('; ');
  const grouped = sentence ? `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.` : '';

  /**
   * "Required" is the same statement about every field it applies to, so those
   * group into one clause. A field that is present but WRONG is wrong in its own
   * particular way, and "check country" throws that away — the sentence the
   * country validator writes ("Choose a destination country from the list…") is
   * the whole reason it was written by hand.
   *
   * Capped, because a form with nine bad fields would otherwise answer with a
   * paragraph. `details.violations` always carries every one of them.
   */
  const invalidTexts = [
    ...new Set(
      restated.filter((v) => byField.get(v.field)?.kind === 'invalid').map((v) => v.text),
    ),
  ];
  const shown = invalidTexts.slice(0, 3);
  const rest = invalidTexts.length - shown.length;
  const detail = shown.join(' ') + (rest > 0 ? ` (and ${rest} more.)` : '');

  return [grouped, detail].filter(Boolean).join(' ').trim();
}

export function validationException(errors: ValidationError[]): BadRequestException {
  const violations = flatten(errors);

  /**
   * Whether the caller actually sent a value for a path.
   *
   * A type constraint on something that was never sent means "missing", and on
   * something that WAS sent means "wrong shape". class-validator reports both
   * identically, and telling somebody who typed a word into a number field that
   * the field is required would be its own kind of wrong.
   */
  const values = new Map<string, unknown>();
  const walk = (list: readonly ValidationError[], parent = ''): void => {
    for (const e of list) {
      const path = parent ? `${parent}.${e.property}` : e.property;
      values.set(path, e.value);
      if (e.children?.length) walk(e.children, path);
    }
  };
  walk(errors);
  const present = (field: string) => values.get(field) !== undefined && values.get(field) !== null;

  return new BadRequestException({
    code: ErrorCode.VALIDATION_FAILED,
    message: summarise(violations, present),
    details: {
      violations: violations.map((v) => ({ ...v, message: restate(v, present(v.field)) })),
    },
  });
}
