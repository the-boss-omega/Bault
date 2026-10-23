import { registerDecorator, type ValidationOptions } from 'class-validator';
import { isSafeObjectKey } from '@bault/adapters';

export function IsObjectKey(options?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isObjectKey',
      target: object.constructor,
      propertyName,
      options,
      validator: {
        validate(value: unknown) {
          return typeof value === 'string' && isSafeObjectKey(value.trim());
        },
        defaultMessage() {
          return 'A file key cannot have a "." or ".." segment — it names a file, it does not move between folders.';
        },
      },
    });
  };
}
