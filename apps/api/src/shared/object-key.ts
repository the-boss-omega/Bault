import { registerDecorator, type ValidationOptions } from 'class-validator';
import { isSafeObjectKey } from '@bault/adapters';

/**
 * A field that names an object in storage (F428).
 *
 * The storage adapter signs URLs for keys that arrive through these fields, and
 * the URL parser it builds them with resolves a `.` or `..` segment before the
 * signature is computed: `intake/../other-bucket/x.png` came back as a valid
 * link into a DIFFERENT bucket. The adapter now refuses such a key itself, but
 * by then it is already written to a row; this is the refusal at the door, with
 * a sentence the person can act on rather than a storage error later.
 *
 * Uses the adapter's own `isSafeObjectKey`, so the DTO and the adapter can never
 * disagree about what a safe key is. `{ each: true }` for an array of keys.
 */
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
