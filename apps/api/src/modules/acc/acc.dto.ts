import { Transform } from 'class-transformer';
import { IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { NAME_PART_MAX, USERNAME_MAX, USERNAME_MIN } from '../../shared/names';

/**
 * Trim before validating.
 *
 * The global ValidationPipe runs with `transform: true`, so these run first.
 * Without them the character rules below would reject a value for whitespace
 * the service strips anyway: `AuthService.register` treats "Red", " red " and
 * "RED" as one account, and the spaced one must reach it.
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
   * Chosen once, here, and never changeable afterwards. There is
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

  /**
   * The version of the terms the person ticked the box for.
   *
   * REQUIRED: Bault charges fees, accrues interest on a negative balance and
   * suspends accounts, and nobody may get an account without agreeing to that.
   * A string rather than a boolean, because "agreed" is only meaningful with
   * "to what": the service compares it with `CURRENT_TERMS_VERSION` and refuses
   * a page that showed an older text.
   */
  @trimmed()
  @IsString({ message: 'acceptedTermsVersion is required: accept the terms to create an account' })
  @MinLength(1, { message: 'acceptedTermsVersion is required: accept the terms to create an account' })
  @MaxLength(64)
  acceptedTermsVersion!: string;
}

export class LoginDto {
  /**
   * Email OR username: either one identifies the account on its own. Usernames
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

/**
 * The second sign-in step: the challenge the first step returned, and EITHER a
 * code from the authenticator app OR one of the recovery codes; never both,
 * never neither (checked in the controller, where the message can say which).
 */
export class LoginMfaDto {
  @IsString()
  @MaxLength(128)
  challengeToken!: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  recoveryCode?: string;
}

/** A code from the authenticator app. Spaces are allowed ("123 456") and removed. */
export class MfaCodeDto {
  @IsString()
  @MaxLength(32)
  code!: string;
}

/**
 * Turning two-factor sign-in on: a code from the app, and the password. The
 * password is what keeps a stolen session from enrolling the thief's phone.
 */
export class ConfirmMfaDto {
  @IsString()
  password!: string;

  @IsString()
  @MaxLength(32)
  code!: string;
}

/** Turning two-factor sign-in off: the password and a current code, both. */
export class DisableMfaDto {
  @IsString()
  password!: string;

  @IsString()
  @MaxLength(32)
  code!: string;
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
 * intentionally absent (it is immutable once set at registration), and there is
 * no `displayName`: a full name is DERIVED from these two columns, never stored
 * a second time where it could drift.
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
