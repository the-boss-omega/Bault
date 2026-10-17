import { registerDecorator, type ValidationOptions } from 'class-validator';
import { isSafeObjectKey } from '@bault/adapters';

/**
 * A field that names an object in storage.
 *
 * The URL parser the storage adapter signs with resolves `.` and `..` segments
 * before signing, so `intake/../other-bucket/x.png` would sign a link into a
 * different bucket. The adapter refuses such a key too, but only after it has
 * been written to a row; this refuses it at the door, with a sentence the person
 * can act on.
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
