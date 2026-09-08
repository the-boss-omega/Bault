import { registerDecorator, type ValidationOptions } from 'class-validator';
import { shippingCountries, toCountryCode } from './countries';

/**
 * A country field that holds a code a carrier rule can read.
 *
 * Written as a decorator rather than an `@IsIn([...])` so the refusal can say
 * something useful. `@IsIn` would answer "country must be one of the following
 * values: US, AU, AT, BE, …" — thirty-three codes, which is a data dump rather
 * than an instruction, and it would not tell somebody who typed "Israel" that
 * they were one letter-pair away from being right.
 *
 * A full country NAME is accepted and normalised, because a person who typed
 * "United States" has said something unambiguous; only a value that names no
 * destination at all is refused.
 */
export function IsShippableCountry(options?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isShippableCountry',
      target: object.constructor,
      propertyName,
      options,
      validator: {
        validate(value: unknown) {
          return typeof value === 'string' && toCountryCode(value) !== null;
        },
        defaultMessage() {
          const total = shippingCountries().length;
          return `Choose a destination country from the list — Bault ships to ${total} of them, and the address has to name one by its two-letter code (US, GB, IL).`;
        },
      },
    });
  };
}
