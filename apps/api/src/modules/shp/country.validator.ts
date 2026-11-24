import { registerDecorator, type ValidationOptions } from 'class-validator';
import { shippingCountries, toCountryCode } from './countries';

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
          return `Choose a destination country from the list — Card Embassy ships to ${total} of them, and the address has to name one by its English name or its two-letter code (United States, US).`;
        },
      },
    });
  };
}
