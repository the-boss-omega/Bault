import { BadRequestException } from '@nestjs/common';
import { IS_UUID, type ValidationError } from 'class-validator';
import { ErrorCode } from './error-codes';

export interface FieldViolation {
  field: string;
  code: string;
  message: string;
}

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

const MISSING_CONSTRAINTS = new Set([
  'isDefined',
  'isNotEmpty',
  'isNotEmptyObject',
  'arrayNotEmpty',
]);

const TYPE_CONSTRAINTS = new Set([
  'isString',
  'isInt',
  'isNumber',
  'isBoolean',
  'isArray',
  'isObject',
  'isDateString',
  'isEmail',
  IS_UUID,
]);

function restate(violation: FieldViolation, present: boolean): string {
  const field = humanField(violation.field);
  const leaf = violation.field.split('.').pop() ?? violation.field;
  if (violation.code === 'whitelistValidation') {
    return `${field} is not a field this accepts.`;
  }
  const eachOf = violation.message.startsWith(`each value in ${leaf} `);
  if (eachOf) return `every ${field} entry ${violation.message.slice(`each value in ${leaf} `.length)}`.replace(/\.?$/, '.');
  const generated = violation.message.startsWith(leaf);
  if (!generated) return violation.message;

  if (MISSING_CONSTRAINTS.has(violation.code) || (TYPE_CONSTRAINTS.has(violation.code) && !present)) {
    return `${field} is required.`;
  }
  if ((violation.code === 'isEnum' || violation.code === 'isIn') && !present) {
    return `${field} is required.`;
  }
  if (violation.code === 'isEnum' || violation.code === 'isIn') {
    const values = violation.message.replace(/^.*?:\s*/, '');
    return `${field} has to be one of: ${values}.`;
  }
  if (violation.code === 'isPositive') return `${field} has to be more than zero.`;
  if (violation.code === 'isEmail') return `${field} is not a valid email address.`;
  if (violation.code === IS_UUID) return `${field} is not in a valid format.`;

  return `${field} ${violation.message.slice(leaf.length).trim()}`.replace(/\.?$/, '.');
}

function summarise(violations: readonly FieldViolation[], present: (field: string) => boolean): string {
  if (violations.length === 0) return 'That request is not valid.';

  const restated = violations.map((v) => ({ ...v, text: restate(v, present(v.field)) }));
  if (restated.length === 1) return restated[0]!.text;

  const byField = new Map<string, { name: string; kind: 'unknown' | 'missing' | 'invalid' }>();
  for (const v of restated) {
    const kind = v.code === 'whitelistValidation' ? 'unknown' : v.text.endsWith('is required.') ? 'missing' : 'invalid';
    const seen = byField.get(v.field);
    if (!seen || (seen.kind === 'invalid' && kind !== 'invalid')) {
      byField.set(v.field, { name: humanField(v.field), kind });
    }
  }

  const fields = [...byField.values()];
  const names = (kind: string) =>
    [...new Set(fields.filter((f) => f.kind === kind).map((f) => f.name))].join(', ');
  const count = (kind: string) => fields.filter((f) => f.kind === kind).length;

  if (byField.size === 1) {
    const required = restated.find((v) => v.text.endsWith('is required.'));
    if (required) return required.text;
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
