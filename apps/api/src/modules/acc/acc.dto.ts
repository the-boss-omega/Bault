import { Transform } from 'class-transformer';
import { IsEmail, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { NAME_PART_MAX, USERNAME_MAX, USERNAME_MIN } from '../../shared/names';

/**
 * Trim before validating.
 *
 * The global ValidationPipe runs with `transform: true`, so these run first.
 * Without them the character rules below reject a value for whitespace the
 * service was going to strip anyway: `AuthService.register` documents that
 * "Red", " red " and "RED" are one account, and that was only true for two of
 * the three — the spaced one was refused at the DTO before normalization could
 * happen. Trimming here makes the documented behaviour the actual behaviour.
 *
 * Only the OUTER whitespace is touched. Internal spacing is a name's own
 * business and is collapsed later by `normalizeNamePart`.
 */
const trimmed = () =>
  Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value));

/** Rejects markup and control characters without narrowing the alphabet a real name may use. */
// eslint-disable-next-line no-control-regex -- control characters are exactly what this rejects
const NAME_PART_RULE = /^[^<>\u0000-\u001f]+$/;

/** Request DTOs for ACC. Validated globally by ValidationPipe (main.ts). */
export class RegisterDto {
  @IsEmail()
  email!: string;

  /**
   * Chosen once, here, and never changeable afterwards (Requirement 4.1). There is
   * deliberately no `username` field on UpdateProfileDto or any admin patch DTO,
   * and `user_account_username_immutable` rejects the write at the database too.
   */
  @trimmed()
  @IsString()
  @MinLength(USERNAME_MIN)
  @MaxLength(USERNAME_MAX)
  @Matches(/^[A-Za-z0-9_.-]+$/, {
    message: 'username may only contain letters, digits, dot, dash and underscore',
  })
  username!: string;

  /**
   * Both name parts are REQUIRED at registration. There is no business rule that
   * lets a self-registered account start without one; the only accounts that may
   * temporarily lack a last name are pre-existing ones whose legacy display name
   * could not be split without guessing (see migration 0004), and those are
   * flagged for review rather than created that way.
   */
  @trimmed()
  @IsString()
  @MinLength(1)
  @MaxLength(NAME_PART_MAX)
  @Matches(NAME_PART_RULE, { message: 'firstName contains invalid characters' })
  firstName!: string;

  @trimmed()
  @IsString()
  @MinLength(1)
  @MaxLength(NAME_PART_MAX)
  @Matches(NAME_PART_RULE, { message: 'lastName contains invalid characters' })
  lastName!: string;

  // Deliberately NOT trimmed: leading or trailing spaces are legitimate
  // characters in a password and stripping them would silently change it.
  @IsString()
  @MinLength(8)
  password!: string;
}

export class LoginDto {
  /**
   * Email OR username — either one identifies the account on its own. Usernames
   * cannot contain '@' (see RegisterDto), so the two namespaces never collide.
   */
  @trimmed()
  @IsString()
  @MinLength(3)
  @MaxLength(254)
  identifier!: string;

  @IsString()
  password!: string;
}

export class TokenDto {
  @IsString()
  token!: string;
}

export class EmailDto {
  @IsEmail()
  email!: string;
}

export class ResetPasswordDto {
  @IsString()
  token!: string;

  @IsString()
  @MinLength(8)
  newPassword!: string;
}

export class ChangePasswordDto {
  @IsString()
  currentPassword!: string;

  @IsString()
  @MinLength(8)
  newPassword!: string;
}

/**
 * The person's name is the only editable identity field. `username` is
 * intentionally absent — it is immutable once set at registration (Requirement
 * 4.1) — and there is no `displayName`: a full name is DERIVED from these two
 * columns, never stored a second time where it could drift.
 */
export class UpdateProfileDto {
  @trimmed()
  @IsString()
  @MinLength(1)
  @MaxLength(NAME_PART_MAX)
  @Matches(NAME_PART_RULE, { message: 'firstName contains invalid characters' })
  firstName!: string;

  @trimmed()
  @IsString()
  @MinLength(1)
  @MaxLength(NAME_PART_MAX)
  @Matches(NAME_PART_RULE, { message: 'lastName contains invalid characters' })
  lastName!: string;
}
