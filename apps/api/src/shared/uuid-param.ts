import { Param, type PipeTransform } from '@nestjs/common';
import { AppError } from './errors/app-error';

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

export function sameId(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

export class ParseIdPipe implements PipeTransform<unknown, string> {
  transform(value: unknown): string {
    if (!isUuid(value)) {
      throw AppError.validation('That identifier is not in a valid format.');
    }
    return value.toLowerCase();
  }
}

export const IdParam = (name = 'id') => Param(name, new ParseIdPipe());
